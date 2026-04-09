/**
 * Unit tests for POST /api/auth/login route handler.
 *
 * All external dependencies (prisma, bcryptjs, jsonwebtoken) are mocked so
 * the tests remain deterministic and require no database or network.
 *
 * Tests validate:
 *  1.  Valid credentials → 200 with { id, email, name }
 *  2.  Valid credentials → Set-Cookie header sets `session` HttpOnly cookie
 *  3.  Valid credentials → JWT in the cookie contains { userId, email, name }
 *  4.  Valid credentials → positive Max-Age on the session cookie
 *  5.  Wrong password → 401 with generic "Invalid credentials" message
 *  6.  Unknown email → 401 with the same generic message (no user enumeration)
 *  7.  Both failure modes return identical error messages (no user enumeration)
 *  8.  bcrypt.compare is ALWAYS called, even for an unknown email (timing mitigation)
 *  9.  Missing email → 400
 * 10.  Empty email → 400
 * 11.  Missing password → 400
 * 12.  Empty password → 400
 * 13.  Non-JSON body → 400
 * 14.  Cookie is HttpOnly
 * 15.  Cookie has SameSite=Lax
 * 16.  Cookie has Secure flag in production
 * 17.  Cookie does NOT have Secure flag in development
 * 18.  Email is normalised to lowercase before lookup
 * 19.  Database error during lookup → 500
 * 20.  bcrypt error during compare → 500
 * 21.  JWT signing error → 500
 */

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Module-level mocks — declared before any imports that resolve the modules
// ---------------------------------------------------------------------------

const mockFindUnique = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    owner: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

const mockCompare = jest.fn();
jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: { compare: (...args: unknown[]) => mockCompare(...args) },
  compare: (...args: unknown[]) => mockCompare(...args),
}));

const mockJwtSign = jest.fn();
jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: { sign: (...args: unknown[]) => mockJwtSign(...args) },
  sign: (...args: unknown[]) => mockJwtSign(...args),
}));

// ---------------------------------------------------------------------------
// Import the handler AFTER mocks are in place
// ---------------------------------------------------------------------------
import { POST } from '@/app/api/auth/login/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a NextRequest with a JSON body for POST /api/auth/login.
 */
function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Parse the Set-Cookie header string into a key→value map of directives.
 * e.g. "session=tok; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax"
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_OWNER = {
  id: 7,
  email: 'alice@example.com',
  cloneName: 'Alice',
  passwordHash: '$2b$12$hashedpassword',
};
const MOCK_TOKEN = 'mock.jwt.token';

// ---------------------------------------------------------------------------
// Default mock implementations for the "happy path"
// ---------------------------------------------------------------------------

function setupHappyPath() {
  mockFindUnique.mockResolvedValue(MOCK_OWNER);
  mockCompare.mockResolvedValue(true);
  mockJwtSign.mockReturnValue(MOCK_TOKEN);
  process.env.JWT_SECRET = 'test-secret-value';
  process.env.NODE_ENV = 'test'; // treated as non-production
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupHappyPath();
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  // -------------------------------------------------------------------------
  // 1. Successful login → 200 with user info
  // -------------------------------------------------------------------------
  it('returns HTTP 200 with { id, email, name } on valid credentials', async () => {
    const req = makeRequest({ email: 'alice@example.com', password: 'securepass' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      id: MOCK_OWNER.id,
      email: MOCK_OWNER.email,
      name: MOCK_OWNER.cloneName,
    });
  });

  // -------------------------------------------------------------------------
  // 2. Session cookie is present
  // -------------------------------------------------------------------------
  it('sets a `session` HttpOnly cookie containing the JWT on success', async () => {
    const req = makeRequest({ email: 'alice@example.com', password: 'securepass' });
    const res = await POST(req);

    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).not.toBeNull();

    const directives = parseCookieHeader(setCookie!);
    expect(directives['session']).toBe(MOCK_TOKEN);
    expect(directives['HttpOnly']).toBe(true);
    expect(directives['Path']).toBe('/');
    expect(directives['SameSite']).toBe('Lax');
  });

  // -------------------------------------------------------------------------
  // 3. JWT payload contains { userId, email, name }
  // -------------------------------------------------------------------------
  it('signs a JWT with { userId, email, name } as the payload', async () => {
    const req = makeRequest({ email: 'alice@example.com', password: 'securepass' });
    await POST(req);

    expect(mockJwtSign).toHaveBeenCalledTimes(1);
    const [payload] = mockJwtSign.mock.calls[0] as [Record<string, unknown>, ...unknown[]];
    expect(payload).toMatchObject({
      userId: MOCK_OWNER.id,
      email: MOCK_OWNER.email,
      name: MOCK_OWNER.cloneName,
    });
  });

  // -------------------------------------------------------------------------
  // 4. Cookie Max-Age is positive (not expired)
  // -------------------------------------------------------------------------
  it('sets a positive Max-Age on the session cookie so it persists across requests', async () => {
    const req = makeRequest({ email: 'alice@example.com', password: 'securepass' });
    const res = await POST(req);

    const setCookie = res.headers.get('Set-Cookie')!;
    const directives = parseCookieHeader(setCookie);
    expect(Number(directives['Max-Age'])).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 5. Wrong password → 401 with generic message
  // -------------------------------------------------------------------------
  it('returns 401 with a generic message when the password is wrong', async () => {
    mockCompare.mockResolvedValue(false); // password mismatch

    const req = makeRequest({ email: 'alice@example.com', password: 'wrongpassword' });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 6. Unknown email → 401 with generic message
  // -------------------------------------------------------------------------
  it('returns 401 with a generic message when the email is not found', async () => {
    mockFindUnique.mockResolvedValue(null); // no user with this email
    // bcrypt.compare will be called with a dummy hash, return false
    mockCompare.mockResolvedValue(false);

    const req = makeRequest({ email: 'nobody@example.com', password: 'anypassword' });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 7. Wrong password and unknown email return the same error message (no enumeration)
  // -------------------------------------------------------------------------
  it('returns the same error body for wrong password and unknown email to prevent user enumeration', async () => {
    // Wrong password case
    mockCompare.mockResolvedValue(false);
    const wrongPassReq = makeRequest({ email: 'alice@example.com', password: 'wrongpassword' });
    const wrongPassRes = await POST(wrongPassReq);
    const wrongPassBody = await wrongPassRes.json();

    // Unknown email case
    mockFindUnique.mockResolvedValue(null);
    mockCompare.mockResolvedValue(false);
    const unknownEmailReq = makeRequest({ email: 'nobody@example.com', password: 'anypassword' });
    const unknownEmailRes = await POST(unknownEmailReq);
    const unknownEmailBody = await unknownEmailRes.json();

    expect(wrongPassRes.status).toBe(401);
    expect(unknownEmailRes.status).toBe(401);
    expect(wrongPassBody.error).toBe(unknownEmailBody.error);
  });

  // -------------------------------------------------------------------------
  // 8. bcrypt.compare is ALWAYS called — even when the email is not found
  // -------------------------------------------------------------------------
  it('always calls bcrypt.compare even when the email is not found (timing mitigation)', async () => {
    mockFindUnique.mockResolvedValue(null); // no user
    mockCompare.mockResolvedValue(false);

    const req = makeRequest({ email: 'nobody@example.com', password: 'anypassword' });
    await POST(req);

    // Must have been called exactly once — against the dummy hash
    expect(mockCompare).toHaveBeenCalledTimes(1);
    const [suppliedPassword] = mockCompare.mock.calls[0] as [string, string];
    expect(suppliedPassword).toBe('anypassword');
  });

  // -------------------------------------------------------------------------
  // 9. Missing email → 400
  // -------------------------------------------------------------------------
  it('returns 400 when email is missing from the request body', async () => {
    const req = makeRequest({ password: 'securepass' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // -------------------------------------------------------------------------
  // 10. Empty email → 400
  // -------------------------------------------------------------------------
  it('returns 400 when email is an empty string', async () => {
    const req = makeRequest({ email: '', password: 'securepass' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // -------------------------------------------------------------------------
  // 11. Missing password → 400
  // -------------------------------------------------------------------------
  it('returns 400 when password is missing from the request body', async () => {
    const req = makeRequest({ email: 'alice@example.com' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // -------------------------------------------------------------------------
  // 12. Empty password → 400
  // -------------------------------------------------------------------------
  it('returns 400 when password is an empty string', async () => {
    const req = makeRequest({ email: 'alice@example.com', password: '' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // -------------------------------------------------------------------------
  // 13. Non-JSON body → 400
  // -------------------------------------------------------------------------
  it('returns 400 when the request body is not valid JSON', async () => {
    const req = new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not json',
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // -------------------------------------------------------------------------
  // 14. Cookie is HttpOnly
  // -------------------------------------------------------------------------
  it('sets the HttpOnly attribute on the session cookie', async () => {
    const req = makeRequest({ email: 'alice@example.com', password: 'securepass' });
    const res = await POST(req);

    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
    expect(directives['HttpOnly']).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 15. Cookie has SameSite=Lax
  // -------------------------------------------------------------------------
  it('sets SameSite=Lax on the session cookie', async () => {
    const req = makeRequest({ email: 'alice@example.com', password: 'securepass' });
    const res = await POST(req);

    const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
    expect(directives['SameSite']).toBe('Lax');
  });

  // -------------------------------------------------------------------------
  // 16. Secure flag is set in production
  // -------------------------------------------------------------------------
  it('sets the Secure flag on the session cookie in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    // @ts-expect-error — NODE_ENV is readonly in TypeScript but writable in tests
    process.env.NODE_ENV = 'production';

    try {
      const req = makeRequest({ email: 'alice@example.com', password: 'securepass' });
      const res = await POST(req);

      const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
      expect(directives['Secure']).toBe(true);
    } finally {
      // @ts-expect-error
      process.env.NODE_ENV = originalEnv;
    }
  });

  // -------------------------------------------------------------------------
  // 17. Secure flag is NOT set outside production
  // -------------------------------------------------------------------------
  it('does NOT set the Secure flag on the session cookie in development', async () => {
    const originalEnv = process.env.NODE_ENV;
    // @ts-expect-error
    process.env.NODE_ENV = 'development';

    try {
      const req = makeRequest({ email: 'alice@example.com', password: 'securepass' });
      const res = await POST(req);

      const directives = parseCookieHeader(res.headers.get('Set-Cookie')!);
      expect(directives['Secure']).toBeUndefined();
    } finally {
      // @ts-expect-error
      process.env.NODE_ENV = originalEnv;
    }
  });

  // -------------------------------------------------------------------------
  // 18. Email is normalised to lowercase before lookup
  // -------------------------------------------------------------------------
  it('normalises the email to lowercase before querying the database', async () => {
    const req = makeRequest({ email: 'Alice@EXAMPLE.COM', password: 'securepass' });
    await POST(req);

    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'alice@example.com' } })
    );
  });

  // -------------------------------------------------------------------------
  // 19. Database error during lookup → 500
  // -------------------------------------------------------------------------
  it('returns 500 when the database throws during the owner lookup', async () => {
    mockFindUnique.mockRejectedValue(new Error('DB connection lost'));

    const req = makeRequest({ email: 'alice@example.com', password: 'securepass' });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // -------------------------------------------------------------------------
  // 20. bcrypt error during compare → 500
  // -------------------------------------------------------------------------
  it('returns 500 when bcrypt.compare throws an unexpected error', async () => {
    mockCompare.mockRejectedValue(new Error('bcrypt internal error'));

    const req = makeRequest({ email: 'alice@example.com', password: 'securepass' });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // -------------------------------------------------------------------------
  // 21. JWT signing error → 500
  // -------------------------------------------------------------------------
  it('returns 500 when jwt.sign throws an unexpected error', async () => {
    mockJwtSign.mockImplementation(() => {
      throw new Error('JWT signing failure');
    });

    const req = makeRequest({ email: 'alice@example.com', password: 'securepass' });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
