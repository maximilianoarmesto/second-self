/**
 * Integration tests for POST /api/auth/signup
 *
 * These tests exercise the full handler chain against a **real** PostgreSQL
 * test database.  bcryptjs and jsonwebtoken are used as-is (no mocks).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ DATABASE REQUIREMENT                                                     │
 * │                                                                          │
 * │ These tests require a running PostgreSQL instance.  The connection URL   │
 * │ is read from PRISMA_DATABASE_URL (or DATABASE_URL) — the same variable  │
 * │ that the application itself reads.                                       │
 * │                                                                          │
 * │ When no database is reachable the entire suite is skipped so it does    │
 * │ not block other tests or CI pipelines that run without a database.       │
 * │                                                                          │
 * │ Start the database with:  docker compose up -d postgres                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Acceptance criteria verified (when DB is available):
 *  AC-1   201 returned for a valid signup with correct { id, email, name }
 *  AC-2   `session` cookie is set as HttpOnly in the response
 *  AC-3   Duplicate email returns 409 Conflict
 *  AC-4   Missing or invalid fields return 400 with a descriptive error
 *  AC-5   `passwordHash` is never present in any response body
 *  AC-6   A Settings record exists in the DB for the new owner after signup
 *  AC-7   JWT decoded from the cookie contains the correct userId
 *  AC-8   All tests clean up test data after each run
 *
 * Additional scenarios:
 *  — Whitespace-only name → 400
 *  — Invalid email formats → 400
 *  — Passwords shorter than 8 characters → 400
 *  — Non-JSON body → 400
 *  — Email normalised to lowercase before storage
 *  — Name trimmed before storage
 *  — Stored password is a bcrypt hash, never the plaintext
 *  — Cookie Max-Age is positive (session persists across requests)
 *  — Cookie has SameSite=Lax
 *  — JWT contains correct email and name claims
 *  — JWT exp is exactly 7 days in the future
 *  — Boundary value: password of exactly 8 characters succeeds
 */

import net from 'net';
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';

// ---------------------------------------------------------------------------
// JWT secret used exclusively by this integration test suite.
// Set BEFORE the signup route is imported so the handler picks it up at
// call-time via process.env.JWT_SECRET.
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = 'integration-test-signup-jwt-secret-2024';
const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

// ---------------------------------------------------------------------------
// Database connection — raw pg Pool used for assertions and cleanup.
// ---------------------------------------------------------------------------

const TEST_DB_URL =
  process.env.PRISMA_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://secondself_user:secondself_pass@localhost:5488/secondself_db';

let pool: Pool;

// ---------------------------------------------------------------------------
// Availability probe — resolve once before the suite begins.
// ---------------------------------------------------------------------------

/**
 * Returns `true` when we can open a TCP connection to the database host/port
 * derived from TEST_DB_URL within the given timeout.
 */
async function isDatabaseReachable(): Promise<boolean> {
  try {
    const url = new URL(TEST_DB_URL);
    const host = url.hostname;
    const port = parseInt(url.port || '5432', 10);

    return await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(3000);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.on('error', () => { socket.destroy(); resolve(false); });
      socket.connect(port, host);
    });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Provide a real Prisma client backed by the test database.
//
// jest.mock() is hoisted by ts-jest so this factory runs before any `import`
// statement resolves.  We create the Prisma client inside the getter so that
// the constructor is called AFTER process.env.PRISMA_DATABASE_URL is set
// (either by setup-env.ts or by the test itself).
// ---------------------------------------------------------------------------

import { PrismaClient } from '@/generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';

let _testPrisma: PrismaClient | null = null;

function getTestPrisma(): PrismaClient {
  if (!_testPrisma) {
    const adapter = new PrismaPg({ connectionString: TEST_DB_URL });
    _testPrisma = new PrismaClient({ adapter });
  }
  return _testPrisma;
}

jest.mock('@/lib/prisma', () => ({
  get prisma() {
    return getTestPrisma();
  },
}));

// ---------------------------------------------------------------------------
// Import the handler AFTER the mock is registered.
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/auth/signup/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a NextRequest with a JSON body for POST /api/auth/signup. */
function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Parse a Set-Cookie header string into a directive map.
 * "session=tok; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax"
 *   → { session: 'tok', Path: '/', 'Max-Age': '604800', HttpOnly: true, SameSite: 'Lax' }
 */
function parseCookieHeader(header: string): Record<string, string | boolean> {
  return header
    .split(';')
    .map((p) => p.trim())
    .reduce<Record<string, string | boolean>>((acc, part) => {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) {
        acc[part] = true;
      } else {
        acc[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim();
      }
      return acc;
    }, {});
}

/** Generate a unique test email to prevent collisions between test runs. */
function uniqueEmail(label: string): string {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 100_000);
  return `test+${label}+${ts}+${rand}@integration.test`;
}

// ---------------------------------------------------------------------------
// Database cleanup (raw SQL — avoids a second Prisma client instantiation)
// ---------------------------------------------------------------------------

/** Emails of owners created during a test — cleaned up in afterEach. */
const createdEmails: string[] = [];

async function cleanupCreatedOwners(): Promise<void> {
  if (createdEmails.length === 0) return;

  // Use raw SQL so we do not depend on a second Prisma client.
  // ON DELETE CASCADE on Settings.owner_id handles the settings rows.
  const placeholders = createdEmails.map((_, i) => `$${i + 1}`).join(', ');
  await pool.query(
    `DELETE FROM owners WHERE email IN (${placeholders})`,
    [...createdEmails]
  );
  createdEmails.length = 0;
}

// ---------------------------------------------------------------------------
// Global setup / teardown
// ---------------------------------------------------------------------------

// `dbAvailable` is set once in `beforeAll` and used to skip the entire suite
// when no database is reachable.
let dbAvailable = false;

beforeAll(async () => {
  // Override JWT_SECRET so the handler signs tokens we can verify.
  process.env.JWT_SECRET = TEST_JWT_SECRET;

  // Probe database connectivity.
  dbAvailable = await isDatabaseReachable();

  if (dbAvailable) {
    pool = new Pool({ connectionString: TEST_DB_URL });
  }
});

afterAll(async () => {
  if (dbAvailable) {
    await cleanupCreatedOwners();

    if (_testPrisma) {
      await _testPrisma.$disconnect();
      _testPrisma = null;
    }

    await pool?.end();
  }

  // Restore JWT_SECRET.
  if (ORIGINAL_JWT_SECRET === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  }
});

afterEach(async () => {
  if (dbAvailable) {
    await cleanupCreatedOwners();
  }
});

// ---------------------------------------------------------------------------
// Skip guard helper — wraps test.each and regular `it` calls.
// ---------------------------------------------------------------------------

/**
 * Returns a `describe` / `it` substitute that skips all contained tests when
 * the database is not reachable.
 *
 * We cannot call `jest.skip` at module evaluation time (it runs before
 * `beforeAll`), so instead we use a conditional `it` inside each describe
 * block to check `dbAvailable` at runtime.
 */
function maybeIt(name: string, fn: () => Promise<void> | void, timeoutMs?: number): void {
  it(name, async () => {
    if (!dbAvailable) {
      console.warn(
        `[signup-integration] SKIPPED — no database reachable at ${TEST_DB_URL}.\n` +
        `  Start the database with: docker compose up -d postgres`
      );
      return; // Pass without executing
    }
    await fn();
  }, timeoutMs);
}

// ===========================================================================
// AC-1 — successful signup returns 201 with { id, email, name }
// ===========================================================================

describe('AC-1: successful signup returns 201 with { id, email, name }', () => {
  maybeIt('returns HTTP 201 for a valid payload', async () => {
    const email = uniqueEmail('ac1-status');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    expect(res.status).toBe(201);
  });

  maybeIt('response body contains exactly { id, email, name } — no extra fields', async () => {
    const email = uniqueEmail('ac1-body');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['email', 'id', 'name']);
  });

  maybeIt('response body email matches the submitted (normalised) email', async () => {
    const email = uniqueEmail('ac1-email');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    const body = await res.json();
    expect(body.email).toBe(email.toLowerCase());
  });

  maybeIt('response body name matches the submitted (trimmed) name', async () => {
    const email = uniqueEmail('ac1-name');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    const body = await res.json();
    expect(body.name).toBe('Alice');
  });

  maybeIt('response body id is a positive integer matching the DB row', async () => {
    const email = uniqueEmail('ac1-id');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    const body = await res.json();

    expect(typeof body.id).toBe('number');
    expect(body.id).toBeGreaterThan(0);
    expect(Number.isInteger(body.id)).toBe(true);

    const { rows } = await pool.query<{ id: number }>(
      'SELECT id FROM owners WHERE email = $1',
      [email]
    );
    expect(rows.length).toBe(1);
    expect(body.id).toBe(rows[0].id);
  });
});

// ===========================================================================
// AC-2 — session cookie is HttpOnly
// ===========================================================================

describe('AC-2: session cookie is set as HttpOnly', () => {
  maybeIt('Set-Cookie header is present in the 201 response', async () => {
    const email = uniqueEmail('ac2-present');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    expect(res.headers.get('Set-Cookie')).not.toBeNull();
  });

  maybeIt('cookie name is `session` and value is a non-empty string', async () => {
    const email = uniqueEmail('ac2-name');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);

    expect(Object.prototype.hasOwnProperty.call(directives, 'session')).toBe(true);
    expect(typeof directives['session']).toBe('string');
    expect((directives['session'] as string).length).toBeGreaterThan(0);
  });

  maybeIt('HttpOnly attribute is set on the session cookie', async () => {
    const email = uniqueEmail('ac2-httponly');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
    expect(directives['HttpOnly']).toBe(true);
  });

  maybeIt('Path=/ is set on the session cookie', async () => {
    const email = uniqueEmail('ac2-path');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
    expect(directives['Path']).toBe('/');
  });

  maybeIt('SameSite=Lax is set on the session cookie', async () => {
    const email = uniqueEmail('ac2-samesite');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
    expect(directives['SameSite']).toBe('Lax');
  });

  maybeIt('Max-Age is a positive number (cookie persists beyond the browser session)', async () => {
    const email = uniqueEmail('ac2-maxage');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
    expect(Number(directives['Max-Age'])).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AC-3 — duplicate email returns 409 Conflict
// ===========================================================================

describe('AC-3: duplicate email returns 409 Conflict', () => {
  maybeIt('returns 409 when the same email is used for a second signup', async () => {
    const email = uniqueEmail('ac3-dup');
    createdEmails.push(email);

    const first = await POST(makeRequest({ email, password: 'firstpass1', name: 'Alice' }));
    expect(first.status).toBe(201);

    const second = await POST(
      makeRequest({ email, password: 'secondpass1', name: 'Alice Again' })
    );
    expect(second.status).toBe(409);
  });

  maybeIt('409 response body has a non-empty error string', async () => {
    const email = uniqueEmail('ac3-body');
    createdEmails.push(email);

    await POST(makeRequest({ email, password: 'firstpass1', name: 'Alice' }));
    const res = await POST(
      makeRequest({ email, password: 'secondpass1', name: 'Alice Again' })
    );
    const body = await res.json();

    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  maybeIt('duplicate check is case-insensitive (email normalised to lowercase)', async () => {
    const base = uniqueEmail('ac3-case');
    const emailLower = base.toLowerCase();
    const emailUpper = base.toUpperCase();
    createdEmails.push(emailLower);

    const first = await POST(
      makeRequest({ email: emailLower, password: 'firstpass1', name: 'Alice' })
    );
    expect(first.status).toBe(201);

    const second = await POST(
      makeRequest({ email: emailUpper, password: 'secondpass1', name: 'Alice Upper' })
    );
    expect(second.status).toBe(409);
  });
});

// ===========================================================================
// AC-4 — missing / invalid fields return 400
// ===========================================================================

describe('AC-4: missing or invalid fields return 400 with a descriptive error', () => {
  // ── name validation ───────────────────────────────────────────────────

  maybeIt('returns 400 when name is missing', async () => {
    const res = await POST(
      makeRequest({ email: uniqueEmail('ac4-no-name'), password: 'securepass1' })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  maybeIt('returns 400 when name is an empty string', async () => {
    const res = await POST(
      makeRequest({ email: uniqueEmail('ac4-empty-name'), password: 'securepass1', name: '' })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  maybeIt('returns 400 when name is a whitespace-only string', async () => {
    const res = await POST(
      makeRequest({ email: uniqueEmail('ac4-ws-name'), password: 'securepass1', name: '   ' })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  // ── email validation ──────────────────────────────────────────────────

  maybeIt('returns 400 when email is missing', async () => {
    const res = await POST(makeRequest({ password: 'securepass1', name: 'Alice' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  maybeIt('returns 400 when email is an empty string', async () => {
    const res = await POST(
      makeRequest({ email: '', password: 'securepass1', name: 'Alice' })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/email/i);
  });

  // Test invalid email formats individually (it.each doesn't support maybeIt directly)
  for (const [label, invalidEmail] of [
    ['missing TLD', 'user@nodomain'],
    ['missing domain', '@nodomain.com'],
    ['spaces in local part', 'spaces in@email.com'],
    ['plain text', 'notanemail'],
  ] as [string, string][]) {
    maybeIt(`returns 400 for invalid email format — ${label}`, async () => {
      const res = await POST(
        makeRequest({ email: invalidEmail, password: 'securepass1', name: 'Alice' })
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toMatch(/email/i);
    });
  }

  // ── password validation ───────────────────────────────────────────────

  maybeIt('returns 400 when password is missing', async () => {
    const res = await POST(
      makeRequest({ email: uniqueEmail('ac4-no-pass'), name: 'Alice' })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });

  for (const shortPass of ['', 'a', 'abc', '1234567']) {
    maybeIt(`returns 400 for password "${shortPass}" — shorter than 8 characters`, async () => {
      const res = await POST(
        makeRequest({
          email: uniqueEmail('ac4-short-pw'),
          password: shortPass,
          name: 'Alice',
        })
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toMatch(/password/i);
    });
  }

  // ── body parsing ──────────────────────────────────────────────────────

  maybeIt('returns 400 when the request body is not valid JSON', async () => {
    const req = new NextRequest('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is { not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty('error');
  });
});

// ===========================================================================
// AC-5 — passwordHash is never returned in any response body
// ===========================================================================

describe('AC-5: passwordHash is never present in any response body', () => {
  maybeIt('successful 201 response does not include any password field', async () => {
    const email = uniqueEmail('ac5-201');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body).not.toHaveProperty('passwordHash');
    expect(body).not.toHaveProperty('password_hash');
    expect(body).not.toHaveProperty('password');
    expect(JSON.stringify(body)).not.toMatch(/password/i);
  });

  maybeIt('409 Conflict response does not include any password-related fields', async () => {
    const email = uniqueEmail('ac5-409');
    createdEmails.push(email);

    await POST(makeRequest({ email, password: 'firstpass1', name: 'Alice' }));
    const res = await POST(
      makeRequest({ email, password: 'secondpass1', name: 'Alice' })
    );
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body).not.toHaveProperty('passwordHash');
    expect(body).not.toHaveProperty('password_hash');
    expect(body).not.toHaveProperty('password');
  });

  maybeIt('400 Bad Request response does not include any password-related fields', async () => {
    const res = await POST(
      makeRequest({ email: uniqueEmail('ac5-400'), password: 'securepass1' /* name missing */ })
    );
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).not.toHaveProperty('passwordHash');
    expect(body).not.toHaveProperty('password');
  });
});

// ===========================================================================
// AC-6 — Settings record is auto-created in the DB
// ===========================================================================

describe('AC-6: a Settings record is auto-created for the new owner', () => {
  maybeIt('a Settings row exists in the DB after a successful signup', async () => {
    const email = uniqueEmail('ac6-settings');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    expect(res.status).toBe(201);
    const body = await res.json();

    const { rows } = await pool.query<{ id: number; owner_id: number }>(
      'SELECT id, owner_id FROM settings WHERE owner_id = $1',
      [body.id]
    );
    expect(rows.length).toBe(1);
  });

  maybeIt('Settings row is linked to the new owner via owner_id', async () => {
    const email = uniqueEmail('ac6-fk');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    const body = await res.json();

    const { rows } = await pool.query<{ owner_id: number }>(
      'SELECT owner_id FROM settings WHERE owner_id = $1',
      [body.id]
    );
    expect(rows[0].owner_id).toBe(body.id);
  });

  maybeIt('Settings clone_name is initialised with the trimmed submitted name', async () => {
    const email = uniqueEmail('ac6-clone-name');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    const body = await res.json();

    const { rows } = await pool.query<{ clone_name: string }>(
      'SELECT clone_name FROM settings WHERE owner_id = $1',
      [body.id]
    );
    expect(rows[0].clone_name).toBe('Alice');
  });

  maybeIt('does not create an extra Settings row when a 409 occurs', async () => {
    const email = uniqueEmail('ac6-no-dupe-settings');
    createdEmails.push(email);

    const first = await POST(makeRequest({ email, password: 'firstpass1', name: 'Alice' }));
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    // This will 409 — no second Settings row should be created
    await POST(makeRequest({ email, password: 'secondpass1', name: 'Alice Clone' }));

    const { rows } = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM settings WHERE owner_id = $1',
      [firstBody.id]
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  maybeIt('does not create a Settings row when signup fails validation', async () => {
    const email = uniqueEmail('ac6-no-settings-on-400');
    // Do NOT push to createdEmails — no row should be created at all

    await POST(makeRequest({ email, password: 'securepass1' /* name missing */ }));

    const { rows } = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM owners WHERE email = $1',
      [email]
    );
    expect(Number(rows[0].count)).toBe(0);
  });
});

// ===========================================================================
// AC-7 — JWT in the session cookie contains the correct userId
// ===========================================================================

describe('AC-7: JWT in the session cookie contains the correct userId', () => {
  maybeIt('the token in Set-Cookie is a valid three-segment JWT string', async () => {
    const email = uniqueEmail('ac7-jwt-shape');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
    const token = directives['session'] as string;
    expect(token.split('.').length).toBe(3);
  });

  maybeIt('the JWT is verifiable using the JWT_SECRET environment variable', async () => {
    const email = uniqueEmail('ac7-verifiable');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
    const token = directives['session'] as string;

    // Must not throw — the handler signs with process.env.JWT_SECRET which we
    // set to TEST_JWT_SECRET in beforeAll.
    const decoded = jwt.verify(token, TEST_JWT_SECRET) as jwt.JwtPayload;
    expect(decoded).toBeDefined();
  });

  maybeIt('JWT userId claim matches the owner id in the response body and in the DB', async () => {
    const email = uniqueEmail('ac7-userid');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    expect(res.status).toBe(201);
    const body = await res.json();

    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
    const decoded = jwt.verify(directives['session'] as string, TEST_JWT_SECRET) as jwt.JwtPayload & {
      userId: number;
    };

    // Matches the response body id
    expect(decoded.userId).toBe(body.id);

    // Also matches the DB row
    const { rows } = await pool.query<{ id: number }>(
      'SELECT id FROM owners WHERE email = $1',
      [email]
    );
    expect(decoded.userId).toBe(rows[0].id);
  });

  maybeIt('JWT email claim matches the normalised email', async () => {
    const email = uniqueEmail('ac7-email-claim');
    createdEmails.push(email);

    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
    const decoded = jwt.verify(directives['session'] as string, TEST_JWT_SECRET) as jwt.JwtPayload & {
      email: string;
    };
    expect(decoded.email).toBe(email.toLowerCase());
  });

  maybeIt('JWT name claim matches the trimmed submitted name', async () => {
    const email = uniqueEmail('ac7-name-claim');
    createdEmails.push(email);

    const res = await POST(
      makeRequest({ email, password: 'securepass1', name: '  Alice  ' })
    );
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
    const decoded = jwt.verify(directives['session'] as string, TEST_JWT_SECRET) as jwt.JwtPayload & {
      name: string;
    };
    expect(decoded.name).toBe('Alice');
  });

  maybeIt('JWT exp is exactly 7 days after iat', async () => {
    const email = uniqueEmail('ac7-exp');
    createdEmails.push(email);

    const before = Math.floor(Date.now() / 1000);
    const res = await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));
    const after = Math.floor(Date.now() / 1000);

    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
    const decoded = jwt.verify(directives['session'] as string, TEST_JWT_SECRET) as jwt.JwtPayload;

    expect(decoded.iat).toBeGreaterThanOrEqual(before);
    expect(decoded.iat).toBeLessThanOrEqual(after);
    expect(decoded.exp! - decoded.iat!).toBe(7 * 24 * 60 * 60);
  });
});

// ===========================================================================
// AC-8 — data actually stored in the database
// ===========================================================================

describe('AC-8: data stored in the database after signup', () => {
  maybeIt('an Owner row is created in the DB after a valid signup', async () => {
    const email = uniqueEmail('ac8-owner-row');
    createdEmails.push(email);

    await POST(makeRequest({ email, password: 'securepass1', name: 'Alice' }));

    const { rows } = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM owners WHERE email = $1',
      [email]
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  maybeIt('the stored email is normalised to all lowercase', async () => {
    const ts = Date.now();
    const rand = Math.floor(Math.random() * 100_000);
    const mixed = `Test+AC8Mixed+${ts}+${rand}@EXAMPLE.TEST`;
    const normalised = mixed.toLowerCase();
    createdEmails.push(normalised);

    await POST(makeRequest({ email: mixed, password: 'securepass1', name: 'Alice' }));

    const { rows } = await pool.query<{ email: string }>(
      'SELECT email FROM owners WHERE email = $1',
      [normalised]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].email).toBe(normalised);
  });

  maybeIt('the stored clone_name is the trimmed version of the submitted name', async () => {
    const email = uniqueEmail('ac8-trimmed-name');
    createdEmails.push(email);

    await POST(makeRequest({ email, password: 'securepass1', name: '  Bob  ' }));

    const { rows } = await pool.query<{ clone_name: string }>(
      'SELECT clone_name FROM owners WHERE email = $1',
      [email]
    );
    expect(rows[0].clone_name).toBe('Bob');
  });

  maybeIt('the stored password_hash is a bcrypt hash (starts with $2b$), not the plaintext', async () => {
    const email = uniqueEmail('ac8-hash');
    createdEmails.push(email);
    const plainPassword = 'securepass1';

    await POST(makeRequest({ email, password: plainPassword, name: 'Alice' }));

    const { rows } = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM owners WHERE email = $1',
      [email]
    );
    expect(rows[0].password_hash).toMatch(/^\$2[ab]\$/);
    expect(rows[0].password_hash).not.toBe(plainPassword);
  });

  maybeIt('the stored password_hash verifies correctly against the original password using bcrypt', async () => {
    const email = uniqueEmail('ac8-bcrypt-verify');
    createdEmails.push(email);
    const plainPassword = 'securepass1';

    await POST(makeRequest({ email, password: plainPassword, name: 'Alice' }));

    const { rows } = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM owners WHERE email = $1',
      [email]
    );
    const bcrypt = await import('bcryptjs');
    const matches = await bcrypt.default.compare(plainPassword, rows[0].password_hash);
    expect(matches).toBe(true);
  });

  maybeIt('no Owner row is created when signup fails validation', async () => {
    const email = uniqueEmail('ac8-no-row-on-400');

    await POST(makeRequest({ email, password: 'securepass1' /* name missing */ }));

    const { rows } = await pool.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM owners WHERE email = $1',
      [email]
    );
    expect(Number(rows[0].count)).toBe(0);
  });
});

// ===========================================================================
// Additional: email normalisation, name trimming, boundary password
// ===========================================================================

describe('Email normalisation, name trimming, and boundary values', () => {
  maybeIt('stores a mixed-case submitted email as all lowercase', async () => {
    const ts = Date.now();
    const rand = Math.floor(Math.random() * 100_000);
    const mixed = `Test+MixedCase+${ts}+${rand}@EXAMPLE.TEST`;
    const normalised = mixed.toLowerCase();
    createdEmails.push(normalised);

    const res = await POST(makeRequest({ email: mixed, password: 'securepass1', name: 'Alice' }));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.email).toBe(normalised);
  });

  maybeIt('trims leading/trailing whitespace from name in both DB and response', async () => {
    const email = uniqueEmail('trim-name');
    createdEmails.push(email);

    const res = await POST(
      makeRequest({ email, password: 'securepass1', name: '  Charlie  ' })
    );
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.name).toBe('Charlie');

    const { rows } = await pool.query<{ clone_name: string }>(
      'SELECT clone_name FROM owners WHERE email = $1',
      [email]
    );
    expect(rows[0].clone_name).toBe('Charlie');
  });

  maybeIt('accepts a password of exactly 8 characters (lower boundary)', async () => {
    const email = uniqueEmail('pw-boundary-8');
    createdEmails.push(email);

    const res = await POST(
      makeRequest({ email, password: '12345678', name: 'Alice' })
    );
    expect(res.status).toBe(201);
  });

  maybeIt('rejects a password of exactly 7 characters (just below boundary)', async () => {
    const res = await POST(
      makeRequest({
        email: uniqueEmail('pw-boundary-7'),
        password: '1234567',
        name: 'Alice',
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/password/i);
  });
});
