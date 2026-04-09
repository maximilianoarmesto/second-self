/**
 * Integration tests for POST /api/auth/login
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
 *  AC-1   200 returned for valid credentials with correct { id, email, name }
 *  AC-2   `session` cookie is set as HttpOnly in the response
 *  AC-3   Wrong password returns 401 with generic "Invalid credentials" message
 *  AC-4   Unknown email returns 401 with the same generic message (no enumeration)
 *  AC-5   `passwordHash` is never present in any response body
 *  AC-6   JWT decoded from cookie matches the user's id
 *  AC-7   Calling login after a prior signup works correctly end-to-end
 *  AC-8   All tests clean up test data after each run
 *
 * Additional scenarios:
 *  — Missing email → 400
 *  — Empty email → 400
 *  — Missing password → 400
 *  — Empty password → 400
 *  — Non-JSON body → 400
 *  — Wrong password and unknown email return byte-for-byte identical error body
 *  — Email lookup is case-insensitive (normalised to lowercase)
 *  — Session cookie has correct attributes: HttpOnly, Path=/, Max-Age > 0, SameSite=Lax
 *  — JWT contains correct userId, email, and name claims
 *  — JWT exp is exactly 7 days after iat
 *  — Response body contains exactly { id, email, name } — no extra fields
 *  — Login produces a different session cookie from the signup cookie
 */

import net from 'net';
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

// ---------------------------------------------------------------------------
// JWT secret used exclusively by this integration test suite.
// Set BEFORE the login route is imported so the handler picks it up at
// call-time via process.env.JWT_SECRET.
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = 'integration-test-login-jwt-secret-2024';
const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

// ---------------------------------------------------------------------------
// Database connection — raw pg Pool used for seeding, assertions, and cleanup.
// ---------------------------------------------------------------------------

const TEST_DB_URL =
  process.env.PRISMA_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://secondself_user:secondself_pass@localhost:5488/secondself_db';

let pool: Pool;

// ---------------------------------------------------------------------------
// Availability probe — resolved once before the suite begins.
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
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
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
// Import the handlers AFTER the mock is registered.
// ---------------------------------------------------------------------------

import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as signupPOST } from '@/app/api/auth/signup/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a NextRequest with a JSON body for POST /api/auth/login. */
function makeLoginRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Build a NextRequest with a JSON body for POST /api/auth/signup. */
function makeSignupRequest(body: unknown): NextRequest {
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
        acc[part] = true; // flag directive, e.g. HttpOnly
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
  return `test+login+${label}+${ts}+${rand}@integration.test`;
}

// ---------------------------------------------------------------------------
// Database seeding and cleanup helpers
// ---------------------------------------------------------------------------

/** Emails of owners created during a test — cleaned up in afterEach. */
const createdEmails: string[] = [];

/**
 * Insert a test owner directly into the database with a bcrypt-hashed
 * password. Returns { id, email, cloneName } for use in assertions.
 *
 * This avoids the signup route's overhead (email validation, bcrypt at 12
 * rounds) and lets us create fixtures with known credentials quickly.
 * A lower bcrypt cost factor (4) is used to keep individual tests fast.
 */
async function seedOwner(opts: {
  email: string;
  password: string;
  name: string;
}): Promise<{ id: number; email: string; cloneName: string }> {
  const passwordHash = await bcrypt.hash(opts.password, 4 /* low cost for tests */);

  const { rows } = await pool.query<{ id: number; email: string; clone_name: string }>(
    `INSERT INTO owners (email, password_hash, clone_name)
     VALUES ($1, $2, $3)
     RETURNING id, email, clone_name`,
    [opts.email.toLowerCase(), passwordHash, opts.name.trim()],
  );

  const row = rows[0];
  return { id: row.id, email: row.email, cloneName: row.clone_name };
}

/** Delete all owner rows created during a test run. */
async function cleanupCreatedOwners(): Promise<void> {
  if (createdEmails.length === 0) return;

  const placeholders = createdEmails.map((_, i) => `$${i + 1}`).join(', ');
  await pool.query(
    `DELETE FROM owners WHERE email IN (${placeholders})`,
    [...createdEmails],
  );
  createdEmails.length = 0;
}

// ---------------------------------------------------------------------------
// Global setup / teardown
// ---------------------------------------------------------------------------

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

  // Restore JWT_SECRET to its previous state.
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
// Skip guard helper
//
// Returns a regular `it` that no-ops (with a log message) when the database
// is not reachable, so the suite passes in environments without a database
// while being fully exercised when one is available.
// ---------------------------------------------------------------------------

function maybeIt(
  name: string,
  fn: () => Promise<void> | void,
  timeoutMs?: number,
): void {
  it(
    name,
    async () => {
      if (!dbAvailable) {
        console.warn(
          `[login-integration] SKIPPED — no database reachable at ${TEST_DB_URL}.\n` +
            `  Start the database with: docker compose up -d postgres`,
        );
        return;
      }
      await fn();
    },
    timeoutMs,
  );
}

// ===========================================================================
// AC-1 — valid credentials return 200 with { id, email, name }
// ===========================================================================

describe('AC-1: valid credentials return 200 with { id, email, name }', () => {
  maybeIt('returns HTTP 200 for a valid email / password combination', async () => {
    const email = uniqueEmail('ac1-status');
    createdEmails.push(email);
    const owner = await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'correct-pass1' }));

    expect(res.status).toBe(200);
    void owner; // referenced to silence unused warning
  });

  maybeIt('response body contains exactly { id, email, name } — no extra fields', async () => {
    const email = uniqueEmail('ac1-keys');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'correct-pass1' }));
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(['email', 'id', 'name']);
  });

  maybeIt('response body id matches the owner row id in the database', async () => {
    const email = uniqueEmail('ac1-id');
    createdEmails.push(email);
    const owner = await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'correct-pass1' }));
    const body = await res.json();

    expect(typeof body.id).toBe('number');
    expect(body.id).toBe(owner.id);
  });

  maybeIt('response body email matches the normalised (lowercase) stored email', async () => {
    const email = uniqueEmail('ac1-email');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'correct-pass1' }));
    const body = await res.json();

    expect(body.email).toBe(email.toLowerCase());
  });

  maybeIt('response body name matches the stored clone name', async () => {
    const email = uniqueEmail('ac1-name');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'correct-pass1' }));
    const body = await res.json();

    expect(body.name).toBe('Alice');
  });

  maybeIt('email lookup is case-insensitive — mixed-case input matches lowercase record', async () => {
    const email = uniqueEmail('ac1-case');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    // Submit a mixed-case version of the same email
    const ts = Date.now();
    const rand = Math.floor(Math.random() * 100_000);
    const mixedEmail = `Test+Login+AC1Case+${ts}+${rand}@INTEGRATION.TEST`;
    const normalised = mixedEmail.toLowerCase();
    createdEmails.push(normalised);
    await seedOwner({ email: normalised, password: 'correct-pass1', name: 'Bob' });

    const res = await loginPOST(
      makeLoginRequest({ email: mixedEmail.toUpperCase(), password: 'correct-pass1' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe(normalised);
  });
});

// ===========================================================================
// AC-2 — session cookie is set correctly
// ===========================================================================

describe('AC-2: session cookie is set as HttpOnly on successful login', () => {
  maybeIt('Set-Cookie header is present in the 200 response', async () => {
    const email = uniqueEmail('ac2-present');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'correct-pass1' }));

    expect(res.headers.get('Set-Cookie')).not.toBeNull();
  });

  maybeIt('cookie name is `session` and value is a non-empty string', async () => {
    const email = uniqueEmail('ac2-name');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'correct-pass1' }));
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);

    expect(Object.prototype.hasOwnProperty.call(directives, 'session')).toBe(true);
    expect(typeof directives['session']).toBe('string');
    expect((directives['session'] as string).length).toBeGreaterThan(0);
  });

  maybeIt('HttpOnly attribute is set on the session cookie', async () => {
    const email = uniqueEmail('ac2-httponly');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'correct-pass1' }));
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);

    expect(directives['HttpOnly']).toBe(true);
  });

  maybeIt('Path=/ is set on the session cookie', async () => {
    const email = uniqueEmail('ac2-path');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'correct-pass1' }));
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);

    expect(directives['Path']).toBe('/');
  });

  maybeIt('SameSite=Lax is set on the session cookie', async () => {
    const email = uniqueEmail('ac2-samesite');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'correct-pass1' }));
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);

    expect(directives['SameSite']).toBe('Lax');
  });

  maybeIt(
    'Max-Age is a positive number (cookie persists beyond the browser session)',
    async () => {
      const email = uniqueEmail('ac2-maxage');
      createdEmails.push(email);
      await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

      const res = await loginPOST(makeLoginRequest({ email, password: 'correct-pass1' }));
      const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);

      expect(Number(directives['Max-Age'])).toBeGreaterThan(0);
    },
  );
});

// ===========================================================================
// AC-3 — wrong password returns 401 with generic message
// ===========================================================================

describe('AC-3: wrong password returns 401 with generic "Invalid credentials" message', () => {
  maybeIt('returns HTTP 401 when the password is incorrect', async () => {
    const email = uniqueEmail('ac3-status');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'wrong-password!' }));

    expect(res.status).toBe(401);
  });

  maybeIt('401 response body has a non-empty error string', async () => {
    const email = uniqueEmail('ac3-body');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'wrong-password!' }));
    const body = await res.json();

    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  maybeIt('401 response for wrong password contains "Invalid credentials"', async () => {
    const email = uniqueEmail('ac3-msg');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'wrong-password!' }));
    const body = await res.json();

    expect(body.error).toMatch(/invalid credentials/i);
  });

  maybeIt('does not set a session cookie on a failed login', async () => {
    const email = uniqueEmail('ac3-no-cookie');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'wrong-password!' }));

    // No Set-Cookie header, or session value is empty
    const setCookie = res.headers.get('Set-Cookie');
    if (setCookie !== null) {
      const directives = parseCookieHeader(setCookie);
      // If present, the session value must be empty (not a real token)
      expect((directives['session'] as string | undefined) ?? '').toBe('');
    }
  });
});

// ===========================================================================
// AC-4 — unknown email returns 401 with the same generic message (no enumeration)
// ===========================================================================

describe('AC-4: unknown email returns 401 with the same generic message', () => {
  maybeIt('returns HTTP 401 when the email is not registered', async () => {
    const unknownEmail = uniqueEmail('ac4-status');
    // Do NOT push to createdEmails — this email is never inserted

    const res = await loginPOST(
      makeLoginRequest({ email: unknownEmail, password: 'any-password' }),
    );

    expect(res.status).toBe(401);
  });

  maybeIt('unknown email 401 body has a non-empty error string', async () => {
    const unknownEmail = uniqueEmail('ac4-body');

    const res = await loginPOST(
      makeLoginRequest({ email: unknownEmail, password: 'any-password' }),
    );
    const body = await res.json();

    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  maybeIt(
    'unknown email and wrong password return the exact same error message (no user enumeration)',
    async () => {
      const email = uniqueEmail('ac4-enumeration');
      createdEmails.push(email);
      await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

      // Wrong password against a known account
      const wrongPassRes = await loginPOST(
        makeLoginRequest({ email, password: 'wrong-password!' }),
      );
      const wrongPassBody = await wrongPassRes.json();

      // Completely unknown email
      const unknownEmailRes = await loginPOST(
        makeLoginRequest({
          email: uniqueEmail('ac4-unknown'),
          password: 'any-password',
        }),
      );
      const unknownEmailBody = await unknownEmailRes.json();

      expect(wrongPassRes.status).toBe(401);
      expect(unknownEmailRes.status).toBe(401);

      // The error message must be identical — no information about whether
      // the email exists in the system
      expect(wrongPassBody.error).toBe(unknownEmailBody.error);
    },
  );

  maybeIt(
    'error message does not contain "not found", "no user", or "email" (no enumeration hints)',
    async () => {
      const unknownEmail = uniqueEmail('ac4-no-hints');

      const res = await loginPOST(
        makeLoginRequest({ email: unknownEmail, password: 'any-password' }),
      );
      const body = await res.json();

      // The error must be generic enough that it does not reveal whether the
      // email is registered
      expect(body.error).not.toMatch(/not found/i);
      expect(body.error).not.toMatch(/no user/i);
      expect(body.error).not.toMatch(/user not found/i);
      expect(body.error).not.toMatch(/email.*not/i);
    },
  );
});

// ===========================================================================
// AC-5 — passwordHash is never present in any response body
// ===========================================================================

describe('AC-5: passwordHash is never present in any response body', () => {
  maybeIt('successful 200 response does not include any password-related field', async () => {
    const email = uniqueEmail('ac5-200');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'correct-pass1' }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).not.toHaveProperty('passwordHash');
    expect(body).not.toHaveProperty('password_hash');
    expect(body).not.toHaveProperty('password');
    // Belt-and-braces: scan the raw JSON string for the word "password"
    expect(JSON.stringify(body)).not.toMatch(/password/i);
  });

  maybeIt('401 wrong-password response does not include any password-related field', async () => {
    const email = uniqueEmail('ac5-401-wrong');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'wrong-password!' }));
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body).not.toHaveProperty('passwordHash');
    expect(body).not.toHaveProperty('password_hash');
    expect(body).not.toHaveProperty('password');
  });

  maybeIt('401 unknown-email response does not include any password-related field', async () => {
    const unknownEmail = uniqueEmail('ac5-401-unknown');

    const res = await loginPOST(
      makeLoginRequest({ email: unknownEmail, password: 'any-password' }),
    );
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body).not.toHaveProperty('passwordHash');
    expect(body).not.toHaveProperty('password_hash');
    expect(body).not.toHaveProperty('password');
  });

  maybeIt('400 bad-request response does not include any password-related field', async () => {
    // Missing password → 400
    const res = await loginPOST(
      makeLoginRequest({ email: uniqueEmail('ac5-400') /* no password */ }),
    );
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).not.toHaveProperty('passwordHash');
    expect(body).not.toHaveProperty('password');
  });
});

// ===========================================================================
// AC-6 — JWT decoded from cookie matches the user's id
// ===========================================================================

describe('AC-6: JWT in the session cookie is valid and contains the correct userId', () => {
  maybeIt('the token in Set-Cookie is a valid three-segment JWT string', async () => {
    const email = uniqueEmail('ac6-shape');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'correct-pass1' }));
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
    const token = directives['session'] as string;

    expect(token.split('.').length).toBe(3);
  });

  maybeIt('the JWT is verifiable using the TEST_JWT_SECRET set in beforeAll', async () => {
    const email = uniqueEmail('ac6-verifiable');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'correct-pass1' }));
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
    const token = directives['session'] as string;

    // Must not throw — the handler signs with process.env.JWT_SECRET which
    // we set to TEST_JWT_SECRET in beforeAll.
    const decoded = jwt.verify(token, TEST_JWT_SECRET) as jwt.JwtPayload;
    expect(decoded).toBeDefined();
  });

  maybeIt(
    'JWT userId claim matches the owner id in the response body and in the database',
    async () => {
      const email = uniqueEmail('ac6-userid');
      createdEmails.push(email);
      const owner = await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

      const res = await loginPOST(makeLoginRequest({ email, password: 'correct-pass1' }));
      expect(res.status).toBe(200);
      const body = await res.json();

      const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
      const decoded = jwt.verify(
        directives['session'] as string,
        TEST_JWT_SECRET,
      ) as jwt.JwtPayload & { userId: number };

      // Matches the response body
      expect(decoded.userId).toBe(body.id);
      // Matches the directly-seeded owner row
      expect(decoded.userId).toBe(owner.id);
      // Matches the database directly
      const { rows } = await pool.query<{ id: number }>(
        'SELECT id FROM owners WHERE email = $1',
        [email.toLowerCase()],
      );
      expect(decoded.userId).toBe(rows[0].id);
    },
  );

  maybeIt('JWT email claim matches the normalised (lowercase) stored email', async () => {
    const email = uniqueEmail('ac6-email-claim');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'correct-pass1' }));
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
    const decoded = jwt.verify(
      directives['session'] as string,
      TEST_JWT_SECRET,
    ) as jwt.JwtPayload & { email: string };

    expect(decoded.email).toBe(email.toLowerCase());
  });

  maybeIt('JWT name claim matches the stored clone name', async () => {
    const email = uniqueEmail('ac6-name-claim');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const res = await loginPOST(makeLoginRequest({ email, password: 'correct-pass1' }));
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
    const decoded = jwt.verify(
      directives['session'] as string,
      TEST_JWT_SECRET,
    ) as jwt.JwtPayload & { name: string };

    expect(decoded.name).toBe('Alice');
  });

  maybeIt('JWT exp is exactly 7 days after iat', async () => {
    const email = uniqueEmail('ac6-exp');
    createdEmails.push(email);
    await seedOwner({ email, password: 'correct-pass1', name: 'Alice' });

    const before = Math.floor(Date.now() / 1000);
    const res = await loginPOST(makeLoginRequest({ email, password: 'correct-pass1' }));
    const after = Math.floor(Date.now() / 1000);

    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
    const decoded = jwt.verify(
      directives['session'] as string,
      TEST_JWT_SECRET,
    ) as jwt.JwtPayload;

    expect(decoded.iat).toBeGreaterThanOrEqual(before);
    expect(decoded.iat).toBeLessThanOrEqual(after);
    expect(decoded.exp! - decoded.iat!).toBe(7 * 24 * 60 * 60);
  });
});

// ===========================================================================
// AC-7 — end-to-end: signup followed by login works correctly
// ===========================================================================

describe('AC-7: end-to-end — signing up then logging in works correctly', () => {
  maybeIt(
    'a user who signs up via the signup route can immediately log in',
    async () => {
      const email = uniqueEmail('ac7-e2e');
      createdEmails.push(email);

      // 1. Sign up through the actual signup handler
      const signupRes = await signupPOST(
        makeSignupRequest({ email, password: 'securepass1', name: 'Alice' }),
      );
      expect(signupRes.status).toBe(201);
      const signupBody = await signupRes.json();

      // 2. Log in with the same credentials
      const loginRes = await loginPOST(
        makeLoginRequest({ email, password: 'securepass1' }),
      );
      expect(loginRes.status).toBe(200);

      const loginBody = await loginRes.json();

      // 3. Login response references the same owner
      expect(loginBody.id).toBe(signupBody.id);
      expect(loginBody.email).toBe(signupBody.email);
      expect(loginBody.name).toBe(signupBody.name);
    },
    15_000 /* signup bcrypt at 12 rounds can take a few seconds */,
  );

  maybeIt(
    'the login session cookie is a valid, verifiable JWT containing the correct userId',
    async () => {
      const email = uniqueEmail('ac7-jwt');
      createdEmails.push(email);

      // Sign up first (real handler, real bcrypt hash)
      const signupRes = await signupPOST(
        makeSignupRequest({ email, password: 'securepass1', name: 'Alice' }),
      );
      expect(signupRes.status).toBe(201);
      const signupBody = await signupRes.json();

      // Log in
      const loginRes = await loginPOST(
        makeLoginRequest({ email, password: 'securepass1' }),
      );
      expect(loginRes.status).toBe(200);

      const loginCookieHeader = loginRes.headers.get('Set-Cookie')!;
      const loginDirectives = parseCookieHeader(loginCookieHeader);
      const loginToken = loginDirectives['session'] as string;

      // The JWT must be verifiable and carry the correct userId
      const decoded = jwt.verify(loginToken, TEST_JWT_SECRET) as jwt.JwtPayload & {
        userId: number;
      };
      expect(decoded.userId).toBe(signupBody.id);
    },
    15_000,
  );

  maybeIt(
    'login produces a distinct session cookie from the signup cookie',
    async () => {
      const email = uniqueEmail('ac7-distinct');
      createdEmails.push(email);

      // Sign up
      const signupRes = await signupPOST(
        makeSignupRequest({ email, password: 'securepass1', name: 'Alice' }),
      );
      expect(signupRes.status).toBe(201);
      const signupDirectives = parseCookieHeader(signupRes.headers.get('Set-Cookie')!);
      const signupToken = signupDirectives['session'] as string;

      // Log in
      const loginRes = await loginPOST(
        makeLoginRequest({ email, password: 'securepass1' }),
      );
      expect(loginRes.status).toBe(200);
      const loginDirectives = parseCookieHeader(loginRes.headers.get('Set-Cookie')!);
      const loginToken = loginDirectives['session'] as string;

      // Two separate JWTs (different iat at minimum)
      expect(loginToken).not.toBe(signupToken);

      // Both must decode to the same userId and email
      const decodedSignup = jwt.verify(signupToken, TEST_JWT_SECRET) as jwt.JwtPayload & {
        userId: number;
        email: string;
      };
      const decodedLogin = jwt.verify(loginToken, TEST_JWT_SECRET) as jwt.JwtPayload & {
        userId: number;
        email: string;
      };
      expect(decodedLogin.userId).toBe(decodedSignup.userId);
      expect(decodedLogin.email).toBe(decodedSignup.email);
    },
    15_000,
  );

  maybeIt(
    'wrong password on a signed-up account returns 401 (not 200 or 500)',
    async () => {
      const email = uniqueEmail('ac7-wrong-pass');
      createdEmails.push(email);

      await signupPOST(
        makeSignupRequest({ email, password: 'securepass1', name: 'Alice' }),
      );

      const loginRes = await loginPOST(
        makeLoginRequest({ email, password: 'wrong-password!' }),
      );
      expect(loginRes.status).toBe(401);
    },
    15_000,
  );

  maybeIt(
    'login with the wrong password does not set a session cookie',
    async () => {
      const email = uniqueEmail('ac7-no-cookie');
      createdEmails.push(email);

      await signupPOST(
        makeSignupRequest({ email, password: 'securepass1', name: 'Alice' }),
      );

      const loginRes = await loginPOST(
        makeLoginRequest({ email, password: 'wrong-password!' }),
      );
      expect(loginRes.status).toBe(401);

      const setCookie = loginRes.headers.get('Set-Cookie');
      if (setCookie !== null) {
        const directives = parseCookieHeader(setCookie);
        expect((directives['session'] as string | undefined) ?? '').toBe('');
      }
    },
    15_000,
  );
});

// ===========================================================================
// AC-8 — input validation (400 responses)
// ===========================================================================

describe('AC-8: invalid input returns 400 with a descriptive error', () => {
  maybeIt('returns 400 when email is missing from the request body', async () => {
    const res = await loginPOST(makeLoginRequest({ password: 'securepass1' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  maybeIt('returns 400 when email is an empty string', async () => {
    const res = await loginPOST(makeLoginRequest({ email: '', password: 'securepass1' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  maybeIt('returns 400 when email is whitespace-only', async () => {
    const res = await loginPOST(
      makeLoginRequest({ email: '   ', password: 'securepass1' }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  maybeIt('returns 400 when password is missing from the request body', async () => {
    const res = await loginPOST(
      makeLoginRequest({ email: 'someone@example.com' /* no password */ }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  maybeIt('returns 400 when password is an empty string', async () => {
    const res = await loginPOST(
      makeLoginRequest({ email: 'someone@example.com', password: '' }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  maybeIt('returns 400 when the request body is not valid JSON', async () => {
    const req = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is { not valid json',
    });
    const res = await loginPOST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  maybeIt('400 responses never contain a session cookie', async () => {
    const res = await loginPOST(makeLoginRequest({ password: 'securepass1' }));
    expect(res.status).toBe(400);

    const setCookie = res.headers.get('Set-Cookie');
    if (setCookie !== null) {
      const directives = parseCookieHeader(setCookie);
      expect((directives['session'] as string | undefined) ?? '').toBe('');
    }
  });
});

// ===========================================================================
// Additional edge cases
// ===========================================================================

describe('Additional edge cases', () => {
  maybeIt(
    'two distinct users can each log in and receive separate, valid session cookies',
    async () => {
      const emailA = uniqueEmail('extra-userA');
      const emailB = uniqueEmail('extra-userB');
      createdEmails.push(emailA, emailB);

      const ownerA = await seedOwner({ email: emailA, password: 'pass-alice', name: 'Alice' });
      const ownerB = await seedOwner({ email: emailB, password: 'pass-bob', name: 'Bob' });

      const resA = await loginPOST(
        makeLoginRequest({ email: emailA, password: 'pass-alice' }),
      );
      const resB = await loginPOST(
        makeLoginRequest({ email: emailB, password: 'pass-bob' }),
      );

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      const tokenA = parseCookieHeader(resA.headers.get('Set-Cookie')!)['session'] as string;
      const tokenB = parseCookieHeader(resB.headers.get('Set-Cookie')!)['session'] as string;

      expect(tokenA).not.toBe(tokenB);

      const decodedA = jwt.verify(tokenA, TEST_JWT_SECRET) as jwt.JwtPayload & {
        userId: number;
        email: string;
      };
      const decodedB = jwt.verify(tokenB, TEST_JWT_SECRET) as jwt.JwtPayload & {
        userId: number;
        email: string;
      };

      expect(decodedA.userId).toBe(ownerA.id);
      expect(decodedB.userId).toBe(ownerB.id);
      expect(decodedA.email).toBe(emailA.toLowerCase());
      expect(decodedB.email).toBe(emailB.toLowerCase());
      expect(decodedA.userId).not.toBe(decodedB.userId);
    },
  );

  maybeIt(
    'the same user can log in multiple times and each session token is unique',
    async () => {
      const email = uniqueEmail('extra-multi-login');
      createdEmails.push(email);
      await seedOwner({ email, password: 'my-password', name: 'Charlie' });

      const res1 = await loginPOST(makeLoginRequest({ email, password: 'my-password' }));
      const res2 = await loginPOST(makeLoginRequest({ email, password: 'my-password' }));

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const token1 = parseCookieHeader(res1.headers.get('Set-Cookie')!)['session'] as string;
      const token2 = parseCookieHeader(res2.headers.get('Set-Cookie')!)['session'] as string;

      // Different iat values mean the tokens will differ even for the same user
      expect(token1).not.toBe(token2);

      // Both still decode to the same userId
      const decoded1 = jwt.verify(token1, TEST_JWT_SECRET) as jwt.JwtPayload & {
        userId: number;
      };
      const decoded2 = jwt.verify(token2, TEST_JWT_SECRET) as jwt.JwtPayload & {
        userId: number;
      };
      expect(decoded1.userId).toBe(decoded2.userId);
    },
  );

  maybeIt(
    'response Content-Type is application/json on both 200 and 401 responses',
    async () => {
      const email = uniqueEmail('extra-content-type');
      createdEmails.push(email);
      await seedOwner({ email, password: 'my-password', name: 'Diana' });

      const successRes = await loginPOST(
        makeLoginRequest({ email, password: 'my-password' }),
      );
      expect(successRes.headers.get('content-type')).toMatch(/application\/json/);

      const failRes = await loginPOST(
        makeLoginRequest({ email, password: 'wrong-password!' }),
      );
      expect(failRes.headers.get('content-type')).toMatch(/application\/json/);
    },
  );
});
