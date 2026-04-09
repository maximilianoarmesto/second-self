/**
 * Unit tests for src/lib/auth.ts
 *
 * All jsonwebtoken calls are mocked so tests remain deterministic and require
 * no real cryptographic operations or environment setup (except where the
 * JWT_SECRET env var behaviour itself is under test).
 *
 * Tests validate:
 *
 * signToken()
 *  1.  Returns the string produced by jwt.sign
 *  2.  Calls jwt.sign with the supplied payload
 *  3.  Calls jwt.sign with the JWT_SECRET from the environment
 *  4.  Sets expiresIn to '7d'
 *  5.  Throws when JWT_SECRET is not set
 *
 * verifyToken()
 *  6.  Returns a typed TokenPayload on a valid token
 *  7.  Returns null for an expired token (TokenExpiredError)
 *  8.  Returns null for a tampered / invalid token (JsonWebTokenError)
 *  9.  Returns null when userId is missing from the decoded payload
 * 10.  Returns null when userId is not a number
 * 11.  Coerces absent email to null
 * 12.  Coerces absent name to null
 * 13.  Throws when JWT_SECRET is not set (config error surfaces, not swallowed)
 *
 * getUserFromRequest()
 * 14.  Reads a token from the Authorization: Bearer header
 * 15.  Falls back to the session cookie when no Authorization header is present
 * 16.  Prefers the Authorization header over the cookie when both are present
 * 17.  Returns null when both header and cookie are absent
 * 18.  Returns null when the Bearer token is invalid
 * 19.  Returns null when the session cookie token is invalid
 * 20.  Ignores a malformed Authorization header (no Bearer scheme)
 * 21.  Ignores an Authorization header with only the scheme and no token
 * 22.  Returns null when the cookie header contains no session cookie
 * 23.  Parses the session cookie correctly when multiple cookies are present
 * 24.  Returns null when the session cookie value is an empty string
 */

import { NextRequest } from 'next/server';
import { TokenExpiredError, JsonWebTokenError } from 'jsonwebtoken';

// ---------------------------------------------------------------------------
// Mock jsonwebtoken BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockJwtSign = jest.fn();
const mockJwtVerify = jest.fn();

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    sign: (...args: unknown[]) => mockJwtSign(...args),
    verify: (...args: unknown[]) => mockJwtVerify(...args),
  },
  sign: (...args: unknown[]) => mockJwtSign(...args),
  verify: (...args: unknown[]) => mockJwtVerify(...args),
  // Re-export the real error classes so `instanceof` checks work correctly
  TokenExpiredError: jest.requireActual('jsonwebtoken').TokenExpiredError,
  JsonWebTokenError: jest.requireActual('jsonwebtoken').JsonWebTokenError,
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are set up
// ---------------------------------------------------------------------------
import { signToken, verifyToken, getUserFromRequest } from '@/lib/auth';
import type { TokenPayload } from '@/lib/auth';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_TOKEN = 'mock.jwt.token';
const MOCK_SECRET = 'super-secret-jwt-value';

const MOCK_PAYLOAD: TokenPayload = {
  userId: 42,
  email: 'alice@example.com',
  name: 'Alice',
};

/** A decoded jwt.verify result that maps to the MOCK_PAYLOAD. */
const MOCK_DECODED = {
  userId: 42,
  email: 'alice@example.com',
  name: 'Alice',
  iat: 1700000000,
  exp: 1700604800,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(options: {
  authorizationHeader?: string;
  cookieHeader?: string;
}): Request {
  const headers = new Headers();
  if (options.authorizationHeader !== undefined) {
    headers.set('authorization', options.authorizationHeader);
  }
  if (options.cookieHeader !== undefined) {
    headers.set('cookie', options.cookieHeader);
  }
  return new Request('http://localhost/api/test', { headers });
}

function makeNextRequest(options: {
  authorizationHeader?: string;
  cookieHeader?: string;
}): NextRequest {
  const headers = new Headers();
  if (options.authorizationHeader !== undefined) {
    headers.set('authorization', options.authorizationHeader);
  }
  if (options.cookieHeader !== undefined) {
    headers.set('cookie', options.cookieHeader);
  }
  return new NextRequest('http://localhost/api/test', { headers });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_SECRET = MOCK_SECRET;
});

afterAll(() => {
  if (ORIGINAL_JWT_SECRET === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  }
});

// ===========================================================================
// signToken()
// ===========================================================================

describe('signToken()', () => {
  // 1. Returns the string produced by jwt.sign
  it('returns the token string produced by jwt.sign', () => {
    mockJwtSign.mockReturnValue(MOCK_TOKEN);

    const result = signToken(MOCK_PAYLOAD);

    expect(result).toBe(MOCK_TOKEN);
  });

  // 2. Calls jwt.sign with the supplied payload
  it('forwards the payload to jwt.sign', () => {
    mockJwtSign.mockReturnValue(MOCK_TOKEN);

    signToken(MOCK_PAYLOAD);

    const [calledPayload] = mockJwtSign.mock.calls[0] as [TokenPayload, ...unknown[]];
    expect(calledPayload).toMatchObject({
      userId: MOCK_PAYLOAD.userId,
      email: MOCK_PAYLOAD.email,
      name: MOCK_PAYLOAD.name,
    });
  });

  // 3. Calls jwt.sign with the JWT_SECRET from the environment
  it('passes JWT_SECRET from process.env to jwt.sign', () => {
    mockJwtSign.mockReturnValue(MOCK_TOKEN);

    signToken(MOCK_PAYLOAD);

    const [, calledSecret] = mockJwtSign.mock.calls[0] as [unknown, string, ...unknown[]];
    expect(calledSecret).toBe(MOCK_SECRET);
  });

  // 4. Sets expiresIn to '7d'
  it('sets expiresIn to "7d" in the jwt.sign options', () => {
    mockJwtSign.mockReturnValue(MOCK_TOKEN);

    signToken(MOCK_PAYLOAD);

    const [, , calledOptions] = mockJwtSign.mock.calls[0] as [
      unknown,
      unknown,
      { expiresIn: string },
    ];
    expect(calledOptions).toMatchObject({ expiresIn: '7d' });
  });

  // 5. Throws when JWT_SECRET is not set
  it('throws an Error when JWT_SECRET environment variable is not set', () => {
    delete process.env.JWT_SECRET;

    expect(() => signToken(MOCK_PAYLOAD)).toThrow(/JWT_SECRET/);
  });
});

// ===========================================================================
// verifyToken()
// ===========================================================================

describe('verifyToken()', () => {
  // 6. Returns a typed TokenPayload on a valid token
  it('returns a TokenPayload on a valid token', () => {
    mockJwtVerify.mockReturnValue(MOCK_DECODED);

    const result = verifyToken(MOCK_TOKEN);

    expect(result).toEqual({
      userId: MOCK_DECODED.userId,
      email: MOCK_DECODED.email,
      name: MOCK_DECODED.name,
    });
  });

  // 7. Returns null for an expired token
  it('returns null when jwt.verify throws TokenExpiredError', () => {
    mockJwtVerify.mockImplementation(() => {
      throw new TokenExpiredError('jwt expired', new Date());
    });

    const result = verifyToken(MOCK_TOKEN);

    expect(result).toBeNull();
  });

  // 8. Returns null for a tampered / invalid token
  it('returns null when jwt.verify throws JsonWebTokenError', () => {
    mockJwtVerify.mockImplementation(() => {
      throw new JsonWebTokenError('invalid signature');
    });

    const result = verifyToken(MOCK_TOKEN);

    expect(result).toBeNull();
  });

  // 9. Returns null when userId is missing from the decoded payload
  it('returns null when the decoded payload has no userId field', () => {
    mockJwtVerify.mockReturnValue({ email: 'alice@example.com', name: 'Alice' });

    const result = verifyToken(MOCK_TOKEN);

    expect(result).toBeNull();
  });

  // 10. Returns null when userId is not a number
  it('returns null when userId is present but not a number', () => {
    mockJwtVerify.mockReturnValue({ userId: 'not-a-number', email: 'a@b.com', name: 'A' });

    const result = verifyToken(MOCK_TOKEN);

    expect(result).toBeNull();
  });

  // 11. Coerces absent email to null
  it('returns email as null when the decoded payload has no email field', () => {
    mockJwtVerify.mockReturnValue({ userId: 1, name: 'Alice' });

    const result = verifyToken(MOCK_TOKEN);

    expect(result).not.toBeNull();
    expect(result!.email).toBeNull();
  });

  // 12. Coerces absent name to null
  it('returns name as null when the decoded payload has no name field', () => {
    mockJwtVerify.mockReturnValue({ userId: 1, email: 'a@b.com' });

    const result = verifyToken(MOCK_TOKEN);

    expect(result).not.toBeNull();
    expect(result!.name).toBeNull();
  });

  // 13. Throws when JWT_SECRET is not set (config error surfaces)
  it('throws an Error when JWT_SECRET environment variable is not set', () => {
    delete process.env.JWT_SECRET;

    expect(() => verifyToken(MOCK_TOKEN)).toThrow(/JWT_SECRET/);
  });
});

// ===========================================================================
// getUserFromRequest()
// ===========================================================================

describe('getUserFromRequest()', () => {
  // 14. Reads a token from the Authorization: Bearer header
  it('extracts and verifies the token from an Authorization: Bearer header', () => {
    mockJwtVerify.mockReturnValue(MOCK_DECODED);

    const req = makeRequest({ authorizationHeader: `Bearer ${MOCK_TOKEN}` });
    const result = getUserFromRequest(req);

    expect(mockJwtVerify).toHaveBeenCalledWith(MOCK_TOKEN, MOCK_SECRET);
    expect(result).toEqual({
      userId: MOCK_DECODED.userId,
      email: MOCK_DECODED.email,
      name: MOCK_DECODED.name,
    });
  });

  // 15. Falls back to the session cookie
  it('falls back to the session cookie when no Authorization header is present', () => {
    mockJwtVerify.mockReturnValue(MOCK_DECODED);

    const req = makeRequest({ cookieHeader: `session=${MOCK_TOKEN}` });
    const result = getUserFromRequest(req);

    expect(mockJwtVerify).toHaveBeenCalledWith(MOCK_TOKEN, MOCK_SECRET);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe(MOCK_DECODED.userId);
  });

  // 16. Prefers Authorization header over the cookie
  it('prefers the Authorization header over the session cookie when both are present', () => {
    const headerToken = 'header.token';
    const cookieToken = 'cookie.token';
    mockJwtVerify.mockReturnValue(MOCK_DECODED);

    const req = makeRequest({
      authorizationHeader: `Bearer ${headerToken}`,
      cookieHeader: `session=${cookieToken}`,
    });
    getUserFromRequest(req);

    // verifyToken must be called with the header token, not the cookie token
    const [calledToken] = mockJwtVerify.mock.calls[0] as [string, ...unknown[]];
    expect(calledToken).toBe(headerToken);
    // jwt.verify must have been called only once (not for the cookie)
    expect(mockJwtVerify).toHaveBeenCalledTimes(1);
  });

  // 17. Returns null when both header and cookie are absent
  it('returns null when no Authorization header or session cookie is present', () => {
    const req = makeRequest({});
    const result = getUserFromRequest(req);

    expect(result).toBeNull();
    expect(mockJwtVerify).not.toHaveBeenCalled();
  });

  // 18. Returns null when the Bearer token is invalid
  it('returns null when the Authorization bearer token fails verification', () => {
    mockJwtVerify.mockImplementation(() => {
      throw new JsonWebTokenError('invalid token');
    });

    const req = makeRequest({ authorizationHeader: `Bearer bad-token` });
    const result = getUserFromRequest(req);

    expect(result).toBeNull();
  });

  // 19. Returns null when the session cookie token is invalid
  it('returns null when the session cookie token fails verification', () => {
    mockJwtVerify.mockImplementation(() => {
      throw new TokenExpiredError('jwt expired', new Date());
    });

    const req = makeRequest({ cookieHeader: `session=expired-token` });
    const result = getUserFromRequest(req);

    expect(result).toBeNull();
  });

  // 20. Ignores a malformed Authorization header (no "Bearer" scheme)
  it('ignores an Authorization header that does not use the Bearer scheme', () => {
    mockJwtVerify.mockReturnValue(MOCK_DECODED);

    const req = makeRequest({ authorizationHeader: `Basic dXNlcjpwYXNz` });
    // With no bearer token extracted, there is no cookie either → null
    const result = getUserFromRequest(req);

    expect(mockJwtVerify).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  // 21. Ignores an Authorization header with only the scheme and no token
  it('ignores an Authorization header that has "Bearer" but no token value', () => {
    const req = makeRequest({ authorizationHeader: `Bearer` });
    const result = getUserFromRequest(req);

    expect(mockJwtVerify).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  // 22. Returns null when the cookie header contains no session cookie
  it('returns null when the Cookie header has cookies but no session cookie', () => {
    const req = makeRequest({ cookieHeader: 'other=abc; another=xyz' });
    const result = getUserFromRequest(req);

    expect(mockJwtVerify).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  // 23. Parses the session cookie correctly when multiple cookies are present
  it('correctly extracts the session token when the Cookie header contains multiple cookies', () => {
    mockJwtVerify.mockReturnValue(MOCK_DECODED);

    const req = makeRequest({
      cookieHeader: `other=abc; session=${MOCK_TOKEN}; another=xyz`,
    });
    const result = getUserFromRequest(req);

    expect(mockJwtVerify).toHaveBeenCalledWith(MOCK_TOKEN, MOCK_SECRET);
    expect(result).not.toBeNull();
  });

  // 24. Returns null when the session cookie value is an empty string
  it('returns null when the session cookie is present but has an empty value', () => {
    const req = makeRequest({ cookieHeader: `session=` });
    const result = getUserFromRequest(req);

    expect(mockJwtVerify).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  // Works with a NextRequest (the primary type used in Next.js App Router handlers)
  it('works correctly when called with a NextRequest object', () => {
    mockJwtVerify.mockReturnValue(MOCK_DECODED);

    const req = makeNextRequest({ cookieHeader: `session=${MOCK_TOKEN}` });
    const result = getUserFromRequest(req);

    expect(result).not.toBeNull();
    expect(result!.userId).toBe(MOCK_DECODED.userId);
  });
});
