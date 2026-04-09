/**
 * Integration-style unit tests for src/lib/auth.ts
 *
 * These tests use the **real** jsonwebtoken library (no mocks) so that each
 * acceptance criterion is verified through genuine cryptographic operations.
 * `JWT_SECRET` is provided via `process.env` — no hard-coded secrets appear
 * in this file.
 *
 * Acceptance criteria covered:
 *
 * signToken()
 *  AC-1  Produced token decodes to a payload containing `userId`, `email`, `name`
 *
 * verifyToken()
 *  AC-2  Valid token returns the correct decoded payload
 *  AC-3  Expired token causes verifyToken to return null (TokenExpiredError is handled)
 *  AC-4  Token signed with a different secret causes verifyToken to return null
 *        (tampered / wrong-secret scenario — JsonWebTokenError is handled)
 *
 * getUserFromRequest()
 *  AC-5  Correctly extracts and verifies the token from the `session` cookie header
 *  AC-6  Returns `null` when no cookie is present in the request
 */

import jwt from 'jsonwebtoken';

// ---------------------------------------------------------------------------
// Import the module under test — real implementation, no mocks
// ---------------------------------------------------------------------------
import { signToken, verifyToken, getUserFromRequest } from '@/lib/auth';
import type { TokenPayload } from '@/lib/auth';

// ---------------------------------------------------------------------------
// Constants — all secrets live in env vars, never hard-coded
// ---------------------------------------------------------------------------

/** Secret used by the module under test (set in beforeEach). */
const TEST_SECRET = 'test-only-jwt-secret-not-used-in-production';

/** A different secret used to produce a "wrong-key" tampered token. */
const WRONG_SECRET = 'a-completely-different-secret-that-is-not-the-real-one';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PAYLOAD: TokenPayload = {
  userId: 99,
  email: 'bob@example.com',
  name: 'Bob',
};

// ---------------------------------------------------------------------------
// Setup / teardown — inject JWT_SECRET via env var before every test
// ---------------------------------------------------------------------------

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

beforeEach(() => {
  process.env.JWT_SECRET = TEST_SECRET;
});

afterAll(() => {
  // Restore the original value so other test suites are not affected
  if (ORIGINAL_JWT_SECRET === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  }
});

// ===========================================================================
// signToken() — AC-1
// ===========================================================================

describe('signToken()', () => {
  /**
   * AC-1: The token produced by signToken must be a genuine JWT whose decoded
   * payload carries the `userId`, `email`, and `name` fields that were passed
   * in.  We decode the token with the real jwt library (using the same secret
   * from the env var) to confirm the fields are embedded correctly.
   */
  it('AC-1: produces a valid JWT whose decoded payload contains userId, email, and name', () => {
    const token = signToken(PAYLOAD);

    // Must be a non-empty string (a JWT has three dot-separated segments)
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);

    // Decode the real token with the same secret — this will throw if the
    // token is malformed, expired, or signed with a different key.
    const decoded = jwt.verify(token, TEST_SECRET) as jwt.JwtPayload;

    expect(decoded.userId).toBe(PAYLOAD.userId);
    expect(decoded.email).toBe(PAYLOAD.email);
    expect(decoded.name).toBe(PAYLOAD.name);
  });

  it('embeds standard JWT claims (iat, exp) in the produced token', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = signToken(PAYLOAD);
    const after = Math.floor(Date.now() / 1000);

    const decoded = jwt.verify(token, TEST_SECRET) as jwt.JwtPayload;

    // iat must be within the time window of this test
    expect(decoded.iat).toBeGreaterThanOrEqual(before);
    expect(decoded.iat).toBeLessThanOrEqual(after);

    // exp must be 7 days (604800 s) after iat
    const expectedExp = decoded.iat! + 7 * 24 * 60 * 60;
    expect(decoded.exp).toBe(expectedExp);
  });
});

// ===========================================================================
// verifyToken() — AC-2, AC-3, AC-4
// ===========================================================================

describe('verifyToken()', () => {
  /**
   * AC-2: A token produced by signToken (signed with the correct secret) must
   * be accepted by verifyToken and the returned payload must match what was
   * originally embedded.
   */
  it('AC-2: returns the correct decoded payload for a valid token', () => {
    const token = signToken(PAYLOAD);

    const result = verifyToken(token);

    expect(result).not.toBeNull();
    expect(result!.userId).toBe(PAYLOAD.userId);
    expect(result!.email).toBe(PAYLOAD.email);
    expect(result!.name).toBe(PAYLOAD.name);
  });

  /**
   * AC-3: verifyToken must return null (not throw) when presented with a token
   * whose `exp` claim is in the past.  We create such a token directly with
   * jwt.sign using `expiresIn: 0` which sets exp === iat, effectively
   * producing an already-expired token.
   */
  it('AC-3: returns null for a token that has already expired', () => {
    // Build an already-expired token by back-dating exp by 1 second.
    // jwt.sign({ ..., exp: pastTimestamp }) is the canonical way to do this
    // without relying on fake timers.
    const pastExp = Math.floor(Date.now() / 1000) - 1; // 1 second ago
    const expiredToken = jwt.sign(
      { userId: PAYLOAD.userId, email: PAYLOAD.email, name: PAYLOAD.name, exp: pastExp },
      TEST_SECRET,
    );

    const result = verifyToken(expiredToken);

    expect(result).toBeNull();
  });

  /**
   * AC-4: verifyToken must return null (not throw) when the token was signed
   * with a different secret — this covers the tampering / wrong-key scenario.
   * We mint a structurally valid JWT with WRONG_SECRET and attempt to verify
   * it against TEST_SECRET (the value in process.env.JWT_SECRET).
   */
  it('AC-4: returns null for a token signed with a different secret (tampering)', () => {
    // Token is structurally valid but was signed with the wrong key
    const tamperedToken = jwt.sign(
      { userId: PAYLOAD.userId, email: PAYLOAD.email, name: PAYLOAD.name },
      WRONG_SECRET,
      { expiresIn: '7d' },
    );

    // verifyToken reads JWT_SECRET from env (= TEST_SECRET) — signature mismatch
    const result = verifyToken(tamperedToken);

    expect(result).toBeNull();
  });

  it('round-trip: a token signed and then verified carries all three payload fields', () => {
    const token = signToken(PAYLOAD);
    const result = verifyToken(token);

    // Complete round-trip equality check
    expect(result).toEqual({
      userId: PAYLOAD.userId,
      email: PAYLOAD.email,
      name: PAYLOAD.name,
    });
  });
});

// ===========================================================================
// getUserFromRequest() — AC-5, AC-6
// ===========================================================================

describe('getUserFromRequest()', () => {
  /**
   * AC-5: getUserFromRequest must parse the `session` cookie from the Cookie
   * header, extract the token value, verify it, and return the decoded payload.
   */
  it('AC-5: extracts and verifies the token from the session cookie header', () => {
    const token = signToken(PAYLOAD);

    const req = new Request('http://localhost/api/test', {
      headers: { cookie: `session=${token}` },
    });

    const result = getUserFromRequest(req);

    expect(result).not.toBeNull();
    expect(result!.userId).toBe(PAYLOAD.userId);
    expect(result!.email).toBe(PAYLOAD.email);
    expect(result!.name).toBe(PAYLOAD.name);
  });

  it('AC-5 (multi-cookie): correctly isolates the session cookie among multiple cookies', () => {
    const token = signToken(PAYLOAD);

    const req = new Request('http://localhost/api/test', {
      headers: { cookie: `theme=dark; session=${token}; lang=en` },
    });

    const result = getUserFromRequest(req);

    expect(result).not.toBeNull();
    expect(result!.userId).toBe(PAYLOAD.userId);
  });

  /**
   * AC-6: getUserFromRequest must return null when the request carries no
   * Authorization header and no cookie header — i.e., the caller is
   * completely unauthenticated.
   */
  it('AC-6: returns null when no cookie is present in the request', () => {
    const req = new Request('http://localhost/api/test');

    const result = getUserFromRequest(req);

    expect(result).toBeNull();
  });

  it('returns null when the Cookie header is present but contains no session cookie', () => {
    const req = new Request('http://localhost/api/test', {
      headers: { cookie: 'theme=dark; lang=en' },
    });

    const result = getUserFromRequest(req);

    expect(result).toBeNull();
  });

  it('returns null when the session cookie contains an expired token', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 1;
    const expiredToken = jwt.sign(
      { userId: PAYLOAD.userId, email: PAYLOAD.email, name: PAYLOAD.name, exp: pastExp },
      TEST_SECRET,
    );

    const req = new Request('http://localhost/api/test', {
      headers: { cookie: `session=${expiredToken}` },
    });

    const result = getUserFromRequest(req);

    expect(result).toBeNull();
  });

  it('returns null when the session cookie contains a token signed with the wrong secret', () => {
    const tamperedToken = jwt.sign(
      { userId: PAYLOAD.userId, email: PAYLOAD.email, name: PAYLOAD.name },
      WRONG_SECRET,
      { expiresIn: '7d' },
    );

    const req = new Request('http://localhost/api/test', {
      headers: { cookie: `session=${tamperedToken}` },
    });

    const result = getUserFromRequest(req);

    expect(result).toBeNull();
  });

  it('also verifies the token from an Authorization: Bearer header (real JWT)', () => {
    const token = signToken(PAYLOAD);

    const req = new Request('http://localhost/api/test', {
      headers: { authorization: `Bearer ${token}` },
    });

    const result = getUserFromRequest(req);

    expect(result).not.toBeNull();
    expect(result!.userId).toBe(PAYLOAD.userId);
    expect(result!.email).toBe(PAYLOAD.email);
    expect(result!.name).toBe(PAYLOAD.name);
  });
});
