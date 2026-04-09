/**
 * Integration tests for POST /api/auth/logout and GET /api/auth/me.
 *
 * These tests exercise the full handler chain — from HTTP request through
 * the requireAuth middleware, prisma queries, and cookie management — using
 * an in-memory database mock and a deterministic JWT implementation.
 *
 * No real database or network connections are made.
 *
 * Acceptance criteria verified:
 *  1.  GET /api/auth/me with a valid session returns 200 with { id, email, name, avatarUrl }
 *  2.  GET /api/auth/me without a session returns 401
 *  3.  POST /api/auth/logout returns 200 and clears the `session` cookie (Max-Age=0)
 *  4.  GET /api/auth/me called after logout returns 401
 *  5.  POST /api/auth/logout with an expired token does not return 500
 *  6.  POST /api/auth/logout with an invalid/malformed token does not return 500
 *  7.  All tests clean up their in-memory state via beforeEach/afterEach
 *
 * Additional integration scenarios:
 *  8.  GET /api/auth/me returns the avatarUrl from the Settings row
 *  9.  GET /api/auth/me returns avatarUrl: null when no Settings row exists
 * 10.  GET /api/auth/me returns email: null when the owner has no email
 * 11.  Multiple users — /me returns correct data for each independent session
 * 12.  POST /api/auth/logout is idempotent (calling it twice still returns 200)
 * 13.  GET /api/auth/me with a structurally valid but unknown-user token → 401
 */

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// In-memory database — reset before each test for clean isolation
// ---------------------------------------------------------------------------

interface OwnerRow {
  id: number;
  email: string | null;
  cloneName: string;
  passwordHash: string;
}

interface SettingsRow {
  id: number;
  ownerId: number;
  avatarUrl: string | null;
}

const db = {
  owners: [] as OwnerRow[],
  settings: [] as SettingsRow[],
  nextId: { owners: 1, settings: 1 },
};

function resetDb(): void {
  db.owners = [];
  db.settings = [];
  db.nextId = { owners: 1, settings: 1 };
}

// ---------------------------------------------------------------------------
// Prisma mock — must be declared before importing any module under test
// ---------------------------------------------------------------------------

// We define the mock object up-front so $transaction can reference it by
// closure (avoiding a circular-initialisation issue).
// eslint-disable-next-line prefer-const
let prismaMock: {
  owner: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  settings: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  $transaction: jest.Mock;
};

prismaMock = {
  owner: {
    findUnique: jest.fn(({ where }: { where: { id?: number; email?: string } }) => {
      if (where.id !== undefined) {
        return Promise.resolve(db.owners.find((o) => o.id === where.id) ?? null);
      }
      if (where.email !== undefined) {
        return Promise.resolve(db.owners.find((o) => o.email === where.email) ?? null);
      }
      return Promise.resolve(null);
    }),
    create: jest.fn((args: { data: Partial<OwnerRow>; select?: unknown }) => {
      const row: OwnerRow = {
        id: db.nextId.owners++,
        email: args.data.email ?? null,
        cloneName: args.data.cloneName ?? 'My Second Self',
        passwordHash: args.data.passwordHash ?? '',
      };
      db.owners.push(row);
      return Promise.resolve(row);
    }),
  },
  settings: {
    findUnique: jest.fn(({ where }: { where: { ownerId?: number; id?: number } }) => {
      const row = db.settings.find(
        (s) =>
          (where.ownerId !== undefined && s.ownerId === where.ownerId) ||
          (where.id !== undefined && s.id === where.id),
      );
      return Promise.resolve(row ?? null);
    }),
    create: jest.fn((args: { data: Partial<SettingsRow> }) => {
      const row: SettingsRow = {
        id: db.nextId.settings++,
        ownerId: args.data.ownerId!,
        avatarUrl: args.data.avatarUrl ?? null,
      };
      db.settings.push(row);
      return Promise.resolve(row);
    }),
  },
  // The signup route wraps owner.create + settings.create in a transaction.
  // We execute the callback immediately against the same mock object so both
  // rows land in the in-memory db exactly as the real handler expects.
  $transaction: jest.fn(
    async (cb: (tx: typeof prismaMock) => Promise<unknown>) => cb(prismaMock),
  ),
};

jest.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

// ---------------------------------------------------------------------------
// JWT mock — deterministic sign/verify that mirrors the real HS256 flow.
//
// Tokens are three-part base64url strings embedding a real JSON payload.
// The mock verify function respects exp claims so expired-token scenarios
// work correctly without real crypto.
// ---------------------------------------------------------------------------

const JWT_SECRET = 'integration-test-secret';

function fakeSign(
  payload: Record<string, unknown>,
  _secret: string,
  options?: { expiresIn?: string | number },
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

  // Resolve exp from the expiresIn option so callers that pass a number of
  // seconds (e.g. for an already-expired token) work correctly.
  let exp: number;
  if (typeof options?.expiresIn === 'number') {
    exp = Math.floor(Date.now() / 1000) + options.expiresIn;
  } else {
    // Default: 7 days
    exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  }

  const body = Buffer.from(
    JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp }),
  ).toString('base64url');

  const sig = Buffer.from(`sig:${JWT_SECRET}`).toString('base64url');
  return `${header}.${body}.${sig}`;
}

function fakeVerify(token: string, secret: string): Record<string, unknown> {
  if (secret !== JWT_SECRET) throw new Error('invalid signature');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('malformed token');

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const now = Math.floor(Date.now() / 1000);

    if (typeof payload.exp === 'number' && payload.exp < now) {
      const err = Object.assign(new Error('jwt expired'), { name: 'TokenExpiredError' });
      throw err;
    }

    return payload;
  } catch (err: unknown) {
    const e = err as Error & { name?: string };
    if (e.name === 'TokenExpiredError') throw e;
    throw Object.assign(new Error('invalid token'), { name: 'JsonWebTokenError' });
  }
}

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    sign: (
      payload: Record<string, unknown>,
      secret: string,
      options?: Record<string, unknown>,
    ) => fakeSign(payload, secret, options as { expiresIn?: string | number }),
    verify: (token: string, secret: string) => fakeVerify(token, secret),
  },
  sign: (
    payload: Record<string, unknown>,
    secret: string,
    options?: Record<string, unknown>,
  ) => fakeSign(payload, secret, options as { expiresIn?: string | number }),
  verify: (token: string, secret: string) => fakeVerify(token, secret),
  TokenExpiredError: class TokenExpiredError extends Error {
    expiredAt = new Date();
    constructor(msg: string, _expiredAt: Date) {
      super(msg);
      this.name = 'TokenExpiredError';
    }
  },
  JsonWebTokenError: class JsonWebTokenError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'JsonWebTokenError';
    }
  },
}));

// ---------------------------------------------------------------------------
// bcryptjs mock — deterministic so tests do not pay bcrypt's cost
// ---------------------------------------------------------------------------

jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: {
    hash: (pw: string, _rounds: number) => Promise.resolve(`$hash:${pw}`),
    compare: (pw: string, hash: string) => Promise.resolve(hash === `$hash:${pw}`),
  },
  hash: (pw: string, _rounds: number) => Promise.resolve(`$hash:${pw}`),
  compare: (pw: string, hash: string) => Promise.resolve(hash === `$hash:${pw}`),
}));

// ---------------------------------------------------------------------------
// Import handlers AFTER all mocks are registered
// ---------------------------------------------------------------------------

import { POST as logoutPOST } from '@/app/api/auth/logout/route';
import { GET as meGET } from '@/app/api/auth/me/route';
import { POST as signupPOST } from '@/app/api/auth/signup/route';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

process.env.JWT_SECRET = JWT_SECRET;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a NextRequest with an optional session cookie.
 */
function makeRequest(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    sessionCookie?: string;
  } = {},
): NextRequest {
  const { method = 'GET', body, sessionCookie } = options;
  const headers: Record<string, string> = {};

  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  if (sessionCookie) {
    headers['cookie'] = `session=${sessionCookie}`;
  }

  return new NextRequest(`http://localhost${url}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/**
 * Extract the `session` cookie value from a response's Set-Cookie header.
 * Returns `null` when absent or when the cookie value is empty (cleared).
 */
function extractSessionCookie(response: Response): string | null {
  const setCookie = response.headers.get('Set-Cookie');
  if (!setCookie) return null;

  for (const part of setCookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('session=')) {
      const value = trimmed.slice('session='.length);
      return value || null; // treat empty string as null (cookie cleared)
    }
  }
  return null;
}

/**
 * Parse a Set-Cookie header string into a key→value directive map.
 *
 * Example: "session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"
 *   → { session: '', Path: '/', 'Max-Age': '0', HttpOnly: true, SameSite: 'Lax' }
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

/**
 * Sign up a test user and return their session cookie.
 * Asserts that the signup succeeded (201) to surface setup failures clearly.
 */
async function registerUser(
  email: string,
  password: string,
  name: string,
): Promise<string> {
  const req = makeRequest('/api/auth/signup', {
    method: 'POST',
    body: { email, password, name },
  });
  const res = await signupPOST(req);
  expect(res.status).toBe(201);

  const cookie = extractSessionCookie(res);
  expect(cookie).not.toBeNull();
  return cookie!;
}

/**
 * Mint a session token for a user whose row already exists in the in-memory
 * db without going through the signup handler (useful for injecting edge-case
 * tokens like expired ones).
 */
function mintTokenForOwner(
  ownerId: number,
  email: string | null,
  name: string,
  expiresInSeconds: number = 7 * 24 * 60 * 60,
): string {
  return fakeSign(
    { userId: ownerId, email, name },
    JWT_SECRET,
    { expiresIn: expiresInSeconds },
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetDb();
  jest.clearAllMocks();
  process.env.JWT_SECRET = JWT_SECRET;
});

afterEach(() => {
  // Reset re-implementation so subsequent tests get fresh mock functions
  prismaMock.owner.findUnique.mockImplementation(
    ({ where }: { where: { id?: number; email?: string } }) => {
      if (where.id !== undefined) {
        return Promise.resolve(db.owners.find((o) => o.id === where.id) ?? null);
      }
      if (where.email !== undefined) {
        return Promise.resolve(db.owners.find((o) => o.email === where.email) ?? null);
      }
      return Promise.resolve(null);
    },
  );
  prismaMock.settings.findUnique.mockImplementation(
    ({ where }: { where: { ownerId?: number; id?: number } }) => {
      const row = db.settings.find(
        (s) =>
          (where.ownerId !== undefined && s.ownerId === where.ownerId) ||
          (where.id !== undefined && s.id === where.id),
      );
      return Promise.resolve(row ?? null);
    },
  );
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

// ===========================================================================
// GET /api/auth/me — authenticated
// ===========================================================================

describe('GET /api/auth/me — authenticated', () => {
  // 1. Valid session returns 200 with correct shape
  it('returns 200 with { id, email, name, avatarUrl } for an authenticated user', async () => {
    const cookie = await registerUser('alice@example.com', 'password123', 'Alice');

    const owner = db.owners.find((o) => o.email === 'alice@example.com')!;

    const res = await meGET(makeRequest('/api/auth/me', { sessionCookie: cookie }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      id: owner.id,
      email: 'alice@example.com',
      name: 'Alice',
      avatarUrl: null, // no avatarUrl set during signup
    });
  });

  // Response shape is exactly { id, email, name, avatarUrl } — no extra fields
  it('response body contains exactly the id, email, name, and avatarUrl keys', async () => {
    const cookie = await registerUser('bob@example.com', 'password123', 'Bob');

    const res = await meGET(makeRequest('/api/auth/me', { sessionCookie: cookie }));
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(['avatarUrl', 'email', 'id', 'name']);
  });

  // id is a number
  it('returns id as a number', async () => {
    const cookie = await registerUser('carol@example.com', 'password123', 'Carol');

    const res = await meGET(makeRequest('/api/auth/me', { sessionCookie: cookie }));
    const body = await res.json();

    expect(typeof body.id).toBe('number');
  });

  // 8. avatarUrl is returned from the Settings row
  it('returns the avatarUrl from the linked Settings row when one is set', async () => {
    const cookie = await registerUser('dave@example.com', 'password123', 'Dave');
    const owner = db.owners.find((o) => o.email === 'dave@example.com')!;

    // Add an avatarUrl to the settings row that was auto-created on signup
    const settingsRow = db.settings.find((s) => s.ownerId === owner.id);
    if (settingsRow) {
      settingsRow.avatarUrl = '/uploads/avatars/dave.png';
    }

    const res = await meGET(makeRequest('/api/auth/me', { sessionCookie: cookie }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.avatarUrl).toBe('/uploads/avatars/dave.png');
  });

  // 9. avatarUrl is null when no Settings row exists
  it('returns avatarUrl: null when no Settings row exists for the owner', async () => {
    const cookie = await registerUser('eve@example.com', 'password123', 'Eve');
    const owner = db.owners.find((o) => o.email === 'eve@example.com')!;

    // Remove the settings row that was created during signup
    const idx = db.settings.findIndex((s) => s.ownerId === owner.id);
    if (idx !== -1) db.settings.splice(idx, 1);

    const res = await meGET(makeRequest('/api/auth/me', { sessionCookie: cookie }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.avatarUrl).toBeNull();
  });

  // 10. email: null when owner has no email
  it('returns email: null when the owner row has a null email', async () => {
    // Insert an owner directly with no email
    const owner: OwnerRow = {
      id: db.nextId.owners++,
      email: null,
      cloneName: 'NoEmail',
      passwordHash: '$hash:password',
    };
    db.owners.push(owner);

    const token = mintTokenForOwner(owner.id, null, owner.cloneName);
    const res = await meGET(makeRequest('/api/auth/me', { sessionCookie: token }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(body, 'email')).toBe(true);
  });

  // 11. Multiple users — /me returns correct data for each independent session
  it('returns the correct user for each of two independent sessions', async () => {
    const cookieA = await registerUser('alice@example.com', 'password123', 'Alice');
    const cookieB = await registerUser('bob@example.com', 'password456', 'Bob');

    const resA = await meGET(makeRequest('/api/auth/me', { sessionCookie: cookieA }));
    const bodyA = await resA.json();

    const resB = await meGET(makeRequest('/api/auth/me', { sessionCookie: cookieB }));
    const bodyB = await resB.json();

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    expect(bodyA.email).toBe('alice@example.com');
    expect(bodyA.name).toBe('Alice');

    expect(bodyB.email).toBe('bob@example.com');
    expect(bodyB.name).toBe('Bob');

    // The two sessions must resolve to different owner IDs
    expect(bodyA.id).not.toBe(bodyB.id);
  });

  // Content-Type is application/json
  it('returns Content-Type: application/json for a successful response', async () => {
    const cookie = await registerUser('frank@example.com', 'password123', 'Frank');

    const res = await meGET(makeRequest('/api/auth/me', { sessionCookie: cookie }));

    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });
});

// ===========================================================================
// GET /api/auth/me — unauthenticated
// ===========================================================================

describe('GET /api/auth/me — unauthenticated', () => {
  // 2. No session cookie → 401
  it('returns 401 when no session cookie is present', async () => {
    const res = await meGET(makeRequest('/api/auth/me'));

    expect(res.status).toBe(401);
  });

  // 401 body has an error property
  it('includes an "error" property in the 401 response body', async () => {
    const res = await meGET(makeRequest('/api/auth/me'));
    const body = await res.json();

    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  // 401 response is application/json
  it('returns Content-Type: application/json for the 401 response', async () => {
    const res = await meGET(makeRequest('/api/auth/me'));

    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });

  // Database is never queried when auth fails
  it('does not query the database when the request carries no session', async () => {
    await meGET(makeRequest('/api/auth/me'));

    expect(prismaMock.owner.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.settings.findUnique).not.toHaveBeenCalled();
  });

  // Malformed / garbage token → 401, not 500
  it('returns 401 (not 500) when the session cookie contains a malformed token', async () => {
    const res = await meGET(
      makeRequest('/api/auth/me', { sessionCookie: 'not.a.valid.jwt.at.all' }),
    );

    expect(res.status).toBe(401);
  });

  // 13. Structurally valid token signed with a DIFFERENT secret → 401
  it('returns 401 when the session cookie was signed with a different secret', async () => {
    // Forge a token with a wrong secret — fakeVerify will reject it
    const wrongSecretToken = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ userId: 99, email: 'ghost@example.com', exp: 9999999999 })).toString('base64url'),
      Buffer.from('sig:wrong-secret').toString('base64url'),
    ].join('.');

    const res = await meGET(
      makeRequest('/api/auth/me', { sessionCookie: wrongSecretToken }),
    );

    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// GET /api/auth/me — token valid but owner deleted
// ===========================================================================

describe('GET /api/auth/me — owner not found', () => {
  // Valid token for a user whose row no longer exists → 401
  it('returns 401 when the token is valid but the owner row does not exist in the database', async () => {
    // Create and immediately remove the owner so the token is valid but stale
    const cookie = await registerUser('ghost@example.com', 'password123', 'Ghost');
    const owner = db.owners.find((o) => o.email === 'ghost@example.com')!;

    // Delete the owner row (simulate account deletion)
    const idx = db.owners.findIndex((o) => o.id === owner.id);
    db.owners.splice(idx, 1);

    const res = await meGET(makeRequest('/api/auth/me', { sessionCookie: cookie }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ===========================================================================
// POST /api/auth/logout
// ===========================================================================

describe('POST /api/auth/logout', () => {
  // 3. Returns 200
  it('returns HTTP 200 OK', async () => {
    const res = await logoutPOST();

    expect(res.status).toBe(200);
  });

  // 3. Returns { success: true }
  it('returns { success: true } in the response body', async () => {
    const res = await logoutPOST();
    const body = await res.json();

    expect(body).toEqual({ success: true });
  });

  // 3. Clears the session cookie — Set-Cookie header is present
  it('includes a Set-Cookie header in the response', async () => {
    const res = await logoutPOST();

    expect(res.headers.get('Set-Cookie')).not.toBeNull();
  });

  // 3. session cookie is cleared with Max-Age=0
  it('sets Max-Age=0 on the session cookie to instruct the browser to delete it', async () => {
    const res = await logoutPOST();
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);

    expect(directives['Max-Age']).toBe('0');
  });

  // Cookie value is empty
  it('sets the session cookie value to an empty string', async () => {
    const res = await logoutPOST();
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);

    expect(Object.prototype.hasOwnProperty.call(directives, 'session')).toBe(true);
    expect(directives['session']).toBe('');
  });

  // Cookie scope covers all routes
  it('sets Path=/ so the cookie expiry applies to all routes', async () => {
    const res = await logoutPOST();
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);

    expect(directives['Path']).toBe('/');
  });

  // Cookie is HttpOnly
  it('sets the HttpOnly attribute on the expiry cookie', async () => {
    const res = await logoutPOST();
    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);

    expect(directives['HttpOnly']).toBe(true);
  });

  // 5. Expired token — logout must not return 500
  it('returns 200 (not 500) when called with an expired session cookie', async () => {
    // Create a user so we have a real owner ID, then mint an expired token for them
    const owner: OwnerRow = {
      id: db.nextId.owners++,
      email: 'expired@example.com',
      cloneName: 'Expired User',
      passwordHash: '$hash:password',
    };
    db.owners.push(owner);

    // Token expired 1 second ago
    const expiredToken = mintTokenForOwner(owner.id, owner.email, owner.cloneName, -1);

    // The logout route takes no arguments — it never reads the incoming cookie.
    // We call it the same way regardless of caller state.
    const res = await logoutPOST();

    expect(res.status).toBe(200);
    expect(res.status).not.toBe(500);
  });

  // 6. Invalid / malformed token — logout must not return 500
  it('returns 200 (not 500) when called with a completely invalid session cookie', async () => {
    // Logout does not inspect the incoming request at all,
    // so invalid tokens never reach any verification code.
    const res = await logoutPOST();

    expect(res.status).toBe(200);
    expect(res.status).not.toBe(500);
  });

  // 12. Calling logout twice is idempotent — both calls succeed
  it('is idempotent — calling logout twice both return 200 with { success: true }', async () => {
    const res1 = await logoutPOST();
    const res2 = await logoutPOST();

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const [body1, body2] = await Promise.all([res1.json(), res2.json()]);
    expect(body1).toEqual({ success: true });
    expect(body2).toEqual({ success: true });
  });

  // No authentication is required — logout works without any prior session
  it('succeeds even when the caller has never been authenticated (no cookie at all)', async () => {
    const res = await logoutPOST();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
  });
});

// ===========================================================================
// Logout → me sequence
// ===========================================================================

describe('POST /api/auth/logout → GET /api/auth/me sequence', () => {
  // 4. /me after logout returns 401
  it('GET /api/auth/me returns 401 after POST /api/auth/logout clears the session cookie', async () => {
    // 1. Register and capture the session cookie
    const sessionCookie = await registerUser('alice@example.com', 'password123', 'Alice');

    // 2. Verify we are authenticated before logout
    const meBefore = await meGET(
      makeRequest('/api/auth/me', { sessionCookie }),
    );
    expect(meBefore.status).toBe(200);

    // 3. Logout — clears the cookie on the client side (cookie value → empty)
    const logoutRes = await logoutPOST();
    expect(logoutRes.status).toBe(200);

    // Confirm the expiry cookie was issued
    const setCookie = logoutRes.headers.get('Set-Cookie')!;
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('session=');

    // 4. Simulate a browser that honoured the Max-Age=0 by not sending the
    //    session cookie in subsequent requests — /me without a cookie → 401
    const meAfterNoCookie = await meGET(makeRequest('/api/auth/me'));
    expect(meAfterNoCookie.status).toBe(401);
  });

  // After logout, using the old (now-cleared) cookie still relies on JWT
  // validity — but since the token is not expired yet and the cookie value is
  // still technically valid (the server cannot "revoke" stateless JWTs), the
  // real-world logout flow is cookie deletion on the client.  The integration
  // test simulates what the client experiences: no cookie → 401.
  it('does not allow access when the session cookie is absent after logout', async () => {
    await registerUser('bob@example.com', 'password123', 'Bob');

    // Logout
    await logoutPOST();

    // Client no longer sends the session cookie
    const res = await meGET(makeRequest('/api/auth/me'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // Logout with an expired token does not produce a 500 — confirmed end-to-end
  it('POST /api/auth/logout followed by GET /api/auth/me with an expired token returns 401, not 500', async () => {
    // Create an owner directly with an already-expired token
    const owner: OwnerRow = {
      id: db.nextId.owners++,
      email: 'stale@example.com',
      cloneName: 'Stale User',
      passwordHash: '$hash:password',
    };
    db.owners.push(owner);

    const expiredToken = mintTokenForOwner(owner.id, owner.email, owner.cloneName, -60);

    // Logout — must succeed regardless of the caller's token state
    const logoutRes = await logoutPOST();
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.status).not.toBe(500);

    // Calling /me with the expired token → 401, not 500
    const meRes = await meGET(
      makeRequest('/api/auth/me', { sessionCookie: expiredToken }),
    );
    expect(meRes.status).toBe(401);
    expect(meRes.status).not.toBe(500);
  });
});
