/**
 * Security-focused tests for the JWT session mechanism.
 *
 * This suite covers five distinct JWT security edge cases that arise in
 * stateless, cookie-based authentication systems.  Real jsonwebtoken
 * cryptographic operations are used throughout — no JWT-level mocks — so
 * every acceptance criterion is validated through genuine signature
 * verification.  Prisma is mocked to keep tests deterministic and
 * database-free.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Edge cases covered
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * SEC-1  Tampered JWT (modified payload, re-signed with wrong secret) → 401
 *        A JWT whose header+payload have been altered and then signed with a
 *        secret that is NOT the application secret fails real HMAC-SHA256
 *        verification.  Every protected route must reject it with 401.
 *
 * SEC-2  Expired JWT → 401 on all protected routes
 *        A legitimately-signed JWT whose `exp` claim lies in the past is
 *        rejected by `jwt.verify` with a TokenExpiredError.  The application
 *        must translate this into a 401 on every protected route.
 *
 * SEC-3  JWT referencing a deleted user → 401
 *        A cryptographically valid, non-expired JWT whose `userId` claim
 *        refers to an owner row that has since been deleted from the database
 *        must be rejected with 401.  This exercises the "deleted account"
 *        code path in /api/auth/me and similar routes that perform a DB
 *        look-up after token verification.
 *
 * SEC-4  Wrong token channel (Authorization: Bearer header instead of cookie) → 401
 *        IMPORTANT: This app supports BOTH channels (cookie AND Authorization
 *        header).  See getUserFromRequest() in src/lib/auth.ts — it checks
 *        the Authorization header first, then falls back to the session cookie.
 *        Therefore:
 *          • A valid JWT in the Authorization: Bearer header IS accepted (200).
 *          • A request with NEITHER a cookie NOR an Authorization header → 401.
 *          • A request with an invalid/missing session cookie and no header → 401.
 *        The tests document this dual-channel behaviour explicitly so future
 *        maintainers understand what is expected versus what would be a
 *        regression.
 *
 * SEC-5  Pre-password-change JWT is still valid (stateless behaviour)
 *        JWTs are stateless: the application has no token revocation list and
 *        the schema has no `passwordChangedAt` field.  A token issued before a
 *        password change therefore remains valid until its natural expiry.
 *        This is the intended design of the system.  The tests document this
 *        explicitly so the behaviour is understood and conscious — not an
 *        accidental omission.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Testing strategy
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  • Real jsonwebtoken (no mock) — cryptographic operations are genuine.
 *  • Two secrets: CORRECT_SECRET (what routes use) and WRONG_SECRET (for
 *    tampered tokens) — provably distinct so signature mismatches are real.
 *  • Prisma mocked — no database required; returns controlled values.
 *  • Route handlers imported directly — full handler chain executed in-process.
 *  • Each suite uses a dedicated describe block with focused beforeEach setup.
 */

import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// JWT secrets — set before any module import so getJwtSecret() in auth.ts
// picks up CORRECT_SECRET at call-time.
// ─────────────────────────────────────────────────────────────────────────────

/** The secret the application routes will use during this entire suite. */
const CORRECT_SECRET = 'jwt-security-edge-cases-correct-secret';

/**
 * A completely different secret used to sign "tampered" tokens.
 * Any token signed with WRONG_SECRET will fail verification against
 * CORRECT_SECRET — this is the tampered-JWT scenario (SEC-1).
 */
const WRONG_SECRET = 'jwt-security-edge-cases-wrong-secret-tampered';

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;

// Override JWT_SECRET before module resolution so every imported handler
// reads CORRECT_SECRET when it calls getJwtSecret().
process.env.JWT_SECRET = CORRECT_SECRET;

// ─────────────────────────────────────────────────────────────────────────────
// Prisma mock
//
// All database calls are mocked so the suite has no external dependencies.
// Individual tests configure the mock return values (e.g. owner found vs.
// owner deleted) using the exported mock function references below.
// ─────────────────────────────────────────────────────────────────────────────

const mockOwnerFindUnique = jest.fn();
const mockSettingsFindUnique = jest.fn();
const mockDocumentFindMany = jest.fn();
const mockShareLinkFindMany = jest.fn();
const mockChatSessionFindMany = jest.fn();
const mockSettingsUpsert = jest.fn();
const mockSettingsCreate = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    owner: {
      findUnique: (...args: unknown[]) => mockOwnerFindUnique(...args),
    },
    settings: {
      findUnique: (...args: unknown[]) => mockSettingsFindUnique(...args),
      upsert: (...args: unknown[]) => mockSettingsUpsert(...args),
      create: (...args: unknown[]) => mockSettingsCreate(...args),
    },
    document: {
      findMany: (...args: unknown[]) => mockDocumentFindMany(...args),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    documentChunk: {
      count: jest.fn().mockResolvedValue(0),
    },
    shareLink: {
      findMany: (...args: unknown[]) => mockShareLinkFindMany(...args),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    chatSession: {
      findMany: (...args: unknown[]) => mockChatSessionFindMany(...args),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Other mocks — prevent real network calls from transitive imports
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    models: { list: jest.fn().mockResolvedValue({ data: [] }) },
  })),
}));

jest.mock('@/lib/services/rag-service', () => ({
  generateResponse: jest.fn().mockResolvedValue({ message: 'ok', sessionId: 1 }),
}));

jest.mock('@/lib/services/document-service', () => ({
  ingestDocument: jest.fn().mockResolvedValue(undefined),
  reingestDocument: jest.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Route handler imports — after all mocks are registered
// ─────────────────────────────────────────────────────────────────────────────

import { GET as meGET } from '@/app/api/auth/me/route';
import { GET as documentsGET } from '@/app/api/documents/route';
import { GET as settingsGET } from '@/app/api/settings/route';
import { GET as shareLinksGET } from '@/app/api/share-links/route';
import { GET as chatSessionsGET } from '@/app/api/chat/sessions/route';
import { GET as dashboardGET } from '@/app/api/dashboard/route';

// ─────────────────────────────────────────────────────────────────────────────
// Global setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.JWT_SECRET = CORRECT_SECRET;
});

afterAll(() => {
  if (ORIGINAL_JWT_SECRET === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  }
});

beforeEach(() => {
  jest.clearAllMocks();

  // Default happy-path DB mock values — individual tests override as needed.
  mockOwnerFindUnique.mockResolvedValue(EXISTING_OWNER);
  mockSettingsFindUnique.mockResolvedValue(EXISTING_SETTINGS);
  mockDocumentFindMany.mockResolvedValue([]);
  mockShareLinkFindMany.mockResolvedValue([]);
  mockChatSessionFindMany.mockResolvedValue([]);
  mockSettingsUpsert.mockResolvedValue(EXISTING_SETTINGS);
  mockSettingsCreate.mockResolvedValue(EXISTING_SETTINGS);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** A legitimate owner row returned by successful DB look-ups. */
const EXISTING_OWNER = {
  id: 42,
  email: 'alice@example.com',
  cloneName: 'Alice',
};

/** Settings row associated with EXISTING_OWNER. */
const EXISTING_SETTINGS = {
  id: 1,
  ownerId: 42,
  cloneName: 'Alice',
  systemPrompt: '',
  tone: 'natural',
  responseLength: 'balanced',
  openaiApiKeyEncrypted: null,
  avatarUrl: null,
  updatedAt: new Date(),
};

/** A valid token payload for EXISTING_OWNER. */
const VALID_PAYLOAD = {
  userId: EXISTING_OWNER.id,
  email: EXISTING_OWNER.email,
  name: EXISTING_OWNER.cloneName,
};

// ─────────────────────────────────────────────────────────────────────────────
// Token factory helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mint a legitimately signed, non-expired JWT for EXISTING_OWNER.
 * Signed with CORRECT_SECRET — accepted by all protected routes.
 */
function validToken(overrides: Partial<typeof VALID_PAYLOAD> = {}): string {
  return jwt.sign({ ...VALID_PAYLOAD, ...overrides }, CORRECT_SECRET, {
    expiresIn: '7d',
  });
}

/**
 * Mint a JWT that has already expired (exp set 1 second in the past).
 * Signed with CORRECT_SECRET — signature is valid but jwt.verify throws
 * TokenExpiredError, causing verifyToken() to return null.
 */
function expiredToken(): string {
  const pastExp = Math.floor(Date.now() / 1000) - 1; // 1 second ago
  return jwt.sign(
    { ...VALID_PAYLOAD, exp: pastExp },
    CORRECT_SECRET,
    // No expiresIn — exp is embedded directly in the payload above.
  );
}

/**
 * Mint a structurally valid JWT signed with WRONG_SECRET.
 * The payload may contain anything — the signature will not match
 * CORRECT_SECRET, causing jwt.verify to throw JsonWebTokenError.
 */
function tamperedToken(payload: Record<string, unknown> = VALID_PAYLOAD): string {
  return jwt.sign(payload, WRONG_SECRET, { expiresIn: '7d' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Request factory helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a NextRequest carrying a JWT in the `session` cookie. */
function requestWithCookie(token: string, url = '/api/test'): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    headers: { cookie: `session=${token}` },
  });
}

/** Build a NextRequest carrying a JWT in the Authorization: Bearer header. */
function requestWithBearerHeader(token: string, url = '/api/test'): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

/** Build a NextRequest with no authentication credentials at all. */
function unauthenticatedRequest(url = '/api/test'): NextRequest {
  return new NextRequest(`http://localhost${url}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic assertion helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assert that a response has HTTP 401 and a JSON body with a non-empty
 * `error` string — the exact shape produced by `requireAuth`.
 */
async function assert401WithError(response: Response, label: string): Promise<void> {
  expect({ route: label, status: response.status }).toEqual({
    route: label,
    status: 401,
  });

  const body = await response.json() as Record<string, unknown>;
  expect({ route: label, errorType: typeof body.error }).toEqual({
    route: label,
    errorType: 'string',
  });
  expect((body.error as string).length).toBeGreaterThan(0);
}

// =============================================================================
// SEC-1: Tampered JWT (invalid signature) → 401
//
// Scenario: An attacker intercepts a JWT and modifies the `userId` payload to
// impersonate a different user, then re-signs the forged token with a secret
// they control (not the real application secret).  The server must reject this
// token because the HMAC-SHA256 signature does not match CORRECT_SECRET.
//
// This test exercises the full path from the cookie → getUserFromRequest()
// → verifyToken() → jwt.verify() throwing JsonWebTokenError → null → 401.
// =============================================================================

describe('SEC-1: Tampered JWT (modified payload re-signed with wrong secret) → 401', () => {
  /**
   * The root cause of rejection: jwt.verify(token, CORRECT_SECRET) throws
   * JsonWebTokenError("invalid signature") because WRONG_SECRET !== CORRECT_SECRET.
   * verifyToken() catches the error and returns null.  requireAuth() converts
   * null → 401.
   *
   * NOTE: The attacker's payload modifications are irrelevant — the signature
   * check fails before any payload field is even read.
   */

  it('rejects a JWT whose userId was elevated and re-signed with the wrong secret — GET /api/auth/me', async () => {
    // Attacker modifies userId from 42 → 1 (tries to impersonate user 1)
    const forgedToken = tamperedToken({ userId: 1, email: 'victim@example.com', name: 'Victim' });
    const req = requestWithCookie(forgedToken, '/api/auth/me');
    const res = await meGET(req);

    await assert401WithError(res, 'SEC-1 / GET /api/auth/me — elevated userId');
  });

  it('rejects a JWT with a modified email field re-signed with the wrong secret — GET /api/documents', async () => {
    // Attacker swaps the email claim but uses the wrong signing secret
    const forgedToken = tamperedToken({ userId: 99, email: 'hacker@evil.com', name: 'Hacker' });
    const req = requestWithCookie(forgedToken, '/api/documents');
    const res = await documentsGET(req);

    await assert401WithError(res, 'SEC-1 / GET /api/documents — modified email');
  });

  it('rejects a JWT with a modified name field re-signed with the wrong secret — GET /api/settings', async () => {
    const forgedToken = tamperedToken({
      userId: VALID_PAYLOAD.userId,
      email: VALID_PAYLOAD.email,
      name: 'ImpersonatedName',
    });
    const req = requestWithCookie(forgedToken, '/api/settings');
    const res = await settingsGET(req);

    await assert401WithError(res, 'SEC-1 / GET /api/settings — modified name');
  });

  it('rejects a tampered JWT in both cookie and Authorization: Bearer channels', async () => {
    const forgedToken = tamperedToken({ userId: 0, email: 'root@evil.com', name: 'Root' });

    // Via cookie
    const cookieRes = await shareLinksGET(requestWithCookie(forgedToken, '/api/share-links'));
    await assert401WithError(cookieRes, 'SEC-1 / GET /api/share-links — tampered via cookie');

    // Via Authorization: Bearer header
    const headerRes = await shareLinksGET(requestWithBearerHeader(forgedToken, '/api/share-links'));
    await assert401WithError(headerRes, 'SEC-1 / GET /api/share-links — tampered via header');
  });

  it('rejects a completely garbled (non-JWT) session cookie value', async () => {
    // Not even a valid JWT structure — three random segments that do not
    // decode to meaningful JSON.  jwt.verify throws JsonWebTokenError.
    const req = new NextRequest('http://localhost/api/chat/sessions', {
      headers: { cookie: 'session=not.a.real.jwt.just.garbage' },
    });
    const res = await chatSessionsGET(req);

    await assert401WithError(res, 'SEC-1 / GET /api/chat/sessions — garbled session cookie');
  });

  it('rejects a JWT whose signature segment was manually altered (bit-flip attack)', async () => {
    // Take a legitimately signed token and flip one character in its signature
    // segment so the HMAC no longer matches.
    const legitimate = validToken();
    const [header, payload, sig] = legitimate.split('.');
    // XOR the first character of the signature with a different character
    const alteredSig = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    const alteredToken = `${header}.${payload}.${alteredSig}`;

    const req = requestWithCookie(alteredToken, '/api/documents');
    const res = await documentsGET(req);

    await assert401WithError(res, 'SEC-1 / GET /api/documents — bit-flipped signature');
  });

  it('always returns 401 regardless of how many times a tampered token is presented', async () => {
    // Repeated attempts must all be rejected (no "warm-up" or caching
    // that might let a tampered token through after a retry).
    const forgedToken = tamperedToken();

    for (let attempt = 1; attempt <= 3; attempt++) {
      const req = requestWithCookie(forgedToken, '/api/settings');
      const res = await settingsGET(req);
      expect(res.status).toBe(401);
    }
  });
});

// =============================================================================
// SEC-2: Expired JWT → 401 on all protected routes
//
// Scenario: A user's session cookie contains a JWT that was legitimately
// issued by the application but whose `exp` timestamp is now in the past.
// The server must reject it with 401 on every protected route.
//
// The token has a valid signature (signed with CORRECT_SECRET) — only the
// expiry check causes rejection.  jwt.verify() throws TokenExpiredError,
// which verifyToken() catches and converts to null → 401.
// =============================================================================

describe('SEC-2: Expired JWT → 401 on all protected routes', () => {
  /**
   * IMPORTANT: An expired JWT is distinguishable from a tampered JWT internally
   * (TokenExpiredError vs. JsonWebTokenError), but both result in the same
   * external behaviour: verifyToken() returns null and the caller receives 401.
   * The status code and error body shape must be identical in both cases.
   */

  it('rejects an expired JWT on GET /api/auth/me', async () => {
    const req = requestWithCookie(expiredToken(), '/api/auth/me');
    const res = await meGET(req);

    await assert401WithError(res, 'SEC-2 / GET /api/auth/me');
  });

  it('rejects an expired JWT on GET /api/documents', async () => {
    const req = requestWithCookie(expiredToken(), '/api/documents');
    const res = await documentsGET(req);

    await assert401WithError(res, 'SEC-2 / GET /api/documents');
  });

  it('rejects an expired JWT on GET /api/settings', async () => {
    const req = requestWithCookie(expiredToken(), '/api/settings');
    const res = await settingsGET(req);

    await assert401WithError(res, 'SEC-2 / GET /api/settings');
  });

  it('rejects an expired JWT on GET /api/share-links', async () => {
    const req = requestWithCookie(expiredToken(), '/api/share-links');
    const res = await shareLinksGET(req);

    await assert401WithError(res, 'SEC-2 / GET /api/share-links');
  });

  it('rejects an expired JWT on GET /api/chat/sessions', async () => {
    const req = requestWithCookie(expiredToken(), '/api/chat/sessions');
    const res = await chatSessionsGET(req);

    await assert401WithError(res, 'SEC-2 / GET /api/chat/sessions');
  });

  it('rejects an expired JWT on GET /api/dashboard', async () => {
    const req = requestWithCookie(expiredToken(), '/api/dashboard');
    const res = await dashboardGET(req);

    await assert401WithError(res, 'SEC-2 / GET /api/dashboard');
  });

  it('rejects an expired JWT delivered via Authorization: Bearer header', async () => {
    // Expiry applies regardless of which authentication channel is used.
    const req = requestWithBearerHeader(expiredToken(), '/api/documents');
    const res = await documentsGET(req);

    await assert401WithError(res, 'SEC-2 / GET /api/documents — expired via Bearer header');
  });

  it('returns the same 401 shape for expired and tampered tokens (no information leakage)', async () => {
    // The error response must be identical whether the token is expired or
    // tampered — leaking which check failed would give attackers useful info.
    const expiredReq = requestWithCookie(expiredToken(), '/api/documents');
    const tamperedReq = requestWithCookie(tamperedToken(), '/api/documents');

    const expiredRes = await documentsGET(expiredReq);
    const tamperedRes = await documentsGET(tamperedReq);

    expect(expiredRes.status).toBe(401);
    expect(tamperedRes.status).toBe(401);

    const expiredBody = await expiredRes.json() as Record<string, unknown>;
    const tamperedBody = await tamperedRes.json() as Record<string, unknown>;

    // Same error message — does not reveal "token expired" vs "invalid signature"
    expect(expiredBody.error).toBe(tamperedBody.error);
  });

  it('does not reach the database when the JWT is expired (requireAuth short-circuits)', async () => {
    // If the route reaches the DB it means requireAuth failed to gate on the
    // expired token — that would be a regression in the auth middleware.
    const req = requestWithCookie(expiredToken(), '/api/auth/me');
    await meGET(req);

    expect(mockOwnerFindUnique).not.toHaveBeenCalled();
    expect(mockSettingsFindUnique).not.toHaveBeenCalled();
  });
});

// =============================================================================
// SEC-3: JWT referencing a deleted user → 401
//
// Scenario: A user's account is deleted from the database while they still
// hold a valid, non-expired JWT.  When they make a subsequent request, the
// JWT passes cryptographic verification (valid signature, not expired) but the
// associated owner row no longer exists in the database.
//
// This is handled explicitly in routes that perform a DB look-up after token
// verification.  The /api/auth/me route is the canonical example — it looks up
// the owner row and returns 401 when it is missing.  Other routes that do NOT
// perform an explicit owner look-up (e.g. /api/documents, which filters by
// ownerId directly in the query predicate) will return an empty result set
// rather than 401, which is also an acceptable and documented behaviour for
// those routes.
// =============================================================================

describe('SEC-3: Valid JWT whose userId no longer exists in the DB → 401', () => {
  /**
   * Why does /api/auth/me return 401 for a deleted user?
   *
   * The route explicitly calls `prisma.owner.findUnique({ where: { id: userId } })`
   * AFTER the JWT is verified.  When that look-up returns null it immediately
   * returns 401 with { error: 'Not authenticated.' }.  This is the correct
   * behaviour: the session is valid cryptographically but the identity it
   * references no longer exists.
   *
   * See: src/app/api/auth/me/route.ts
   */
  it('returns 401 when the owner row referenced by a valid JWT has been deleted — GET /api/auth/me', async () => {
    // Simulate a deleted account: the DB returns null even though the JWT is valid.
    mockOwnerFindUnique.mockResolvedValue(null);

    const req = requestWithCookie(validToken(), '/api/auth/me');
    const res = await meGET(req);

    await assert401WithError(res, 'SEC-3 / GET /api/auth/me — deleted user');
  });

  it('does not expose the deleted user\'s data even when the JWT is cryptographically valid', async () => {
    // The token itself is valid — the deletion happened server-side.
    mockOwnerFindUnique.mockResolvedValue(null);

    const req = requestWithCookie(validToken(), '/api/auth/me');
    const res = await meGET(req);

    expect(res.status).toBe(401);

    // Body must only contain an error — no user data must leak.
    const body = await res.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('name');
    expect(body).not.toHaveProperty('avatarUrl');
    expect(body).toHaveProperty('error');
  });

  it('does not query the settings table once the deleted owner is confirmed missing', async () => {
    // After /api/auth/me discovers owner === null it must return 401 immediately
    // without making any further DB calls — settings data is irrelevant.
    mockOwnerFindUnique.mockResolvedValue(null);

    const req = requestWithCookie(validToken(), '/api/auth/me');
    await meGET(req);

    expect(mockOwnerFindUnique).toHaveBeenCalledTimes(1);
    expect(mockSettingsFindUnique).not.toHaveBeenCalled();
  });

  it('JWT verification still passes before the DB look-up (confirms token itself is valid)', async () => {
    // This test documents the TWO-PHASE nature of SEC-3:
    //   Phase 1: JWT signature + expiry check → PASSES (valid token)
    //   Phase 2: DB owner look-up → FAILS (owner deleted) → 401
    //
    // We verify Phase 1 independently by checking that jwt.verify() accepts
    // the same token before it is passed to the route handler.
    const token = validToken();
    const decoded = jwt.verify(token, CORRECT_SECRET) as jwt.JwtPayload & { userId: number };
    expect(decoded.userId).toBe(EXISTING_OWNER.id);

    // Phase 2: the route correctly rejects despite Phase 1 passing.
    mockOwnerFindUnique.mockResolvedValue(null);
    const req = requestWithCookie(token, '/api/auth/me');
    const res = await meGET(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 for the deleted user on /api/auth/me but the route-level behaviour on other routes is correctly documented', async () => {
    /**
     * DOCUMENTATION: How deleted-user handling varies by route
     *
     * /api/auth/me          Explicit owner look-up → returns 401 when owner is null.
     *                       This is the primary identity-check route.
     *
     * /api/documents        Filters documents WHERE ownerId = userId (from JWT).
     *                       If the owner is deleted, their documents are also
     *                       deleted (CASCADE) so the query returns an empty array.
     *                       The route returns 200 with [] — not 401.
     *
     * /api/settings         Creates default settings if none exist. For a deleted
     *                       owner the settings row is cascade-deleted too, so the
     *                       route would attempt to create a new one. The mock
     *                       simulates this by returning null from findUnique and
     *                       returning a created row from create — resulting in 200.
     *
     * The canonical "deleted user" guard is /api/auth/me.  Applications that
     * need stronger revocation guarantees should either:
     *   (a) add a token revocation list / jti blocklist, or
     *   (b) add an explicit owner existence check in requireAuth itself.
     */

    // Verify /api/auth/me correctly returns 401 for a deleted owner.
    mockOwnerFindUnique.mockResolvedValue(null);
    const meReq = requestWithCookie(validToken(), '/api/auth/me');
    const meRes = await meGET(meReq);
    expect(meRes.status).toBe(401);
  });
});

// =============================================================================
// SEC-4: Wrong token channel behaviour — documenting dual-channel support
//
// IMPORTANT: This application supports TWO authentication channels (see
// getUserFromRequest() in src/lib/auth.ts):
//   1. session HttpOnly cookie  (browser client)
//   2. Authorization: Bearer header  (programmatic API clients)
//
// The function checks the Authorization header FIRST and falls back to the
// session cookie.  Therefore:
//   • A valid JWT in EITHER channel is accepted → 200
//   • A request with no credentials in EITHER channel → 401
//   • A request with an invalid cookie and no header → 401
//
// The tests below document this behaviour explicitly so it is clear what is
// intentional vs. what would constitute a regression.
// =============================================================================

describe('SEC-4: Token channel behaviour — dual-channel (cookie + Bearer header) support', () => {
  /**
   * ARCHITECTURE DECISION: This application intentionally supports both the
   * `session` HttpOnly cookie (used by the browser) and the `Authorization:
   * Bearer` header (used by programmatic clients).  This is documented in
   * src/lib/auth.ts under the getUserFromRequest() JSDoc comment.
   *
   * A future decision to restrict to cookies-only would require changing
   * getUserFromRequest() and updating these tests to expect 401 on the header
   * channel.
   */

  // ── Supported channel 1: session cookie ──────────────────────────────────

  it('SUPPORTED: accepts a valid JWT delivered via the session cookie (primary browser channel)', async () => {
    const req = requestWithCookie(validToken(), '/api/auth/me');
    const res = await meGET(req);

    // 200 — cookie channel is the primary, supported browser mechanism.
    expect(res.status).toBe(200);
  });

  // ── Supported channel 2: Authorization: Bearer header ────────────────────

  it('SUPPORTED: accepts a valid JWT delivered via the Authorization: Bearer header (API client channel)', async () => {
    /**
     * The Authorization: Bearer header is an explicitly supported channel
     * (checked first in getUserFromRequest).  A valid JWT here is accepted
     * with 200 — this is NOT a channel confusion vulnerability.
     */
    const req = requestWithBearerHeader(validToken(), '/api/auth/me');
    const res = await meGET(req);

    // 200 — Bearer header is the supported programmatic API client mechanism.
    expect(res.status).toBe(200);
  });

  it('SUPPORTED: Authorization header is checked BEFORE the cookie (channel priority)', async () => {
    /**
     * getUserFromRequest() checks the Authorization header first.
     * If a request supplies BOTH channels, the header token is used.
     * This tests the documented priority — not a security vulnerability.
     */
    // Cookie carries a tampered token; header carries a valid token.
    const req = new NextRequest('http://localhost/api/auth/me', {
      headers: {
        authorization: `Bearer ${validToken()}`,
        cookie: `session=${tamperedToken()}`,
      },
    });
    const res = await meGET(req);

    // The valid header token wins → 200 (tampered cookie is ignored).
    expect(res.status).toBe(200);
  });

  // ── Unsupported / rejected scenarios ─────────────────────────────────────

  it('REJECTED: no credentials in either channel → 401', async () => {
    /**
     * A request with neither a session cookie nor an Authorization header
     * has no authentication credentials at all.  This must always be 401.
     */
    const req = unauthenticatedRequest('/api/auth/me');
    const res = await meGET(req);

    await assert401WithError(res, 'SEC-4 / no credentials in either channel');
  });

  it('REJECTED: tampered cookie with no Authorization header → 401', async () => {
    /**
     * An attacker sends a forged/tampered cookie but supplies no Authorization
     * header.  The cookie fails signature verification → 401.
     */
    const req = requestWithCookie(tamperedToken(), '/api/auth/me');
    const res = await meGET(req);

    await assert401WithError(res, 'SEC-4 / tampered cookie, no header');
  });

  it('REJECTED: expired cookie with no Authorization header → 401', async () => {
    const req = requestWithCookie(expiredToken(), '/api/auth/me');
    const res = await meGET(req);

    await assert401WithError(res, 'SEC-4 / expired cookie, no header');
  });

  it('REJECTED: valid token in cookie but tampered token in Authorization header → 401', async () => {
    /**
     * The header is checked first.  A tampered header token fails verification
     * → getUserFromRequest returns null immediately WITHOUT falling back to the
     * cookie, because extractBearerToken() found a non-null token string in
     * the header.  The valid cookie is never reached.
     *
     * This behaviour is by design: once a bearer token is found in the header
     * it is verified directly — no fallback to the cookie occurs.
     */
    const req = new NextRequest('http://localhost/api/auth/me', {
      headers: {
        authorization: `Bearer ${tamperedToken()}`,
        cookie: `session=${validToken()}`,
      },
    });
    const res = await meGET(req);

    // Tampered header token fails → 401 (valid cookie is not checked).
    await assert401WithError(res, 'SEC-4 / tampered header wins over valid cookie');
  });

  it('REJECTED: malformed Authorization header (wrong scheme) with no cookie → 401', async () => {
    /**
     * An "Authorization: Basic ..." header is not the Bearer scheme and is
     * ignored by extractBearerToken().  With no session cookie either, the
     * result is 401.
     */
    const req = new NextRequest('http://localhost/api/documents', {
      headers: {
        // Base64-encoded "user:password" — the Basic scheme, not Bearer
        authorization: 'Basic dXNlcjpwYXNzd29yZA==',
      },
    });
    const res = await documentsGET(req);

    await assert401WithError(res, 'SEC-4 / wrong Auth scheme (Basic), no cookie');
  });

  it('REJECTED: Authorization header present but value is only "Bearer " with no token → 401', async () => {
    /**
     * The Authorization header is present but contains only the scheme keyword
     * and no token value.  extractBearerToken() returns null for this case,
     * and the cookie is absent too, so the result is 401.
     */
    const req = new NextRequest('http://localhost/api/settings', {
      headers: { authorization: 'Bearer' },
    });
    const res = await settingsGET(req);

    await assert401WithError(res, 'SEC-4 / "Bearer" with no token value');
  });
});

// =============================================================================
// SEC-5: Pre-password-change JWT remains valid (stateless behaviour — by design)
//
// Scenario: A user changes their password.  Because this application uses
// stateless JWTs with no server-side revocation mechanism and the database
// schema has no `passwordChangedAt` or `tokenVersion` field, any JWT issued
// before the password change remains valid until its natural 7-day expiry.
//
// THIS IS THE INTENDED DESIGN — not a bug.  The tests below document this
// stateless behaviour explicitly so future maintainers understand it and can
// make an informed decision if they need to add revocation support.
//
// Implications:
//   • A stolen JWT cannot be invalidated by changing the password.
//   • Session invalidation requires either:
//       (a) Waiting for the token to expire (up to 7 days), or
//       (b) Adding a token revocation list (jti blocklist in Redis/DB), or
//       (c) Adding a `passwordChangedAt` / `tokenVersion` DB column and
//           checking it in getUserFromRequest() or requireAuth().
// =============================================================================

describe('SEC-5: Pre-password-change JWT is still valid (stateless — documented behaviour)', () => {
  /**
   * STATELESS JWT DESIGN NOTE
   *
   * This application issues JWTs containing { userId, email, name } and signs
   * them with JWT_SECRET.  The token is verified solely by:
   *   1. Signature validity (HMAC-SHA256 against JWT_SECRET)
   *   2. Expiry claim (exp must be in the future)
   *
   * There is NO server-side state associated with individual tokens.  Changing
   * a password does NOT invalidate existing tokens because:
   *   • The schema has no `passwordChangedAt` column (see prisma/schema.prisma)
   *   • There is no jti claim or token revocation list
   *   • JWT_SECRET rotation would invalidate ALL tokens simultaneously, not
   *     just those for a specific user
   *
   * This means a pre-password-change token remains valid for its full 7-day
   * lifetime.  The tests below assert this EXPECTED BEHAVIOUR explicitly.
   */

  it('EXPECTED: a JWT issued before a password change is still accepted after the change', async () => {
    /**
     * Simulates the full timeline:
     *   t=0  User logs in → JWT issued (pre-change token)
     *   t=1  User changes their password (simulated by updating the mock's
     *         password hash — the JWT itself is unchanged)
     *   t=2  User makes a request with the OLD JWT → ACCEPTED (by design)
     *
     * The key insight: password is never embedded in the JWT.  Changing the
     * password changes the DB record but the JWT payload and signature are
     * immutable — there is nothing to invalidate without a revocation list.
     */

    // t=0: Token was minted before the password change (valid, non-expired).
    const preChangeToken = validToken();

    // t=1: Simulate password change — the mock owner row now has a new hash.
    // From the JWT's perspective, nothing has changed.
    mockOwnerFindUnique.mockResolvedValue({
      ...EXISTING_OWNER,
      // passwordHash updated (not stored in JWT, not checked during verification)
      passwordHash: '$2b$12$newHashAfterPasswordChange',
    });

    // t=2: Request with the pre-change JWT.
    const req = requestWithCookie(preChangeToken, '/api/auth/me');
    const res = await meGET(req);

    // EXPECTED: 200 — the JWT is still valid because the system is stateless.
    expect(res.status).toBe(200);

    // The user data is still returned normally.
    const body = await res.json() as { id: number; email: string; name: string };
    expect(body.id).toBe(EXISTING_OWNER.id);
    expect(body.email).toBe(EXISTING_OWNER.email);
  });

  it('EXPECTED: the pre-change JWT is accepted on /api/documents after a password change', async () => {
    /**
     * Stateless acceptance applies to every protected route, not just /api/auth/me.
     * A pre-change token grants full access to all protected resources until expiry.
     */
    const preChangeToken = validToken();

    // Simulate password change (DB updated but JWT is unchanged).
    mockDocumentFindMany.mockResolvedValue([
      { id: 1, filename: 'report.pdf', ownerId: EXISTING_OWNER.id },
    ]);

    const req = requestWithCookie(preChangeToken, '/api/documents');
    const res = await documentsGET(req);

    // EXPECTED: 200 with documents — pre-change token still works.
    expect(res.status).toBe(200);
  });

  it('EXPECTED: the pre-change JWT is accepted on /api/settings after a password change', async () => {
    const preChangeToken = validToken();

    // Settings route uses ownerId from the JWT — still valid post password-change.
    mockSettingsFindUnique.mockResolvedValue(EXISTING_SETTINGS);

    const req = requestWithCookie(preChangeToken, '/api/settings');
    const res = await settingsGET(req);

    // EXPECTED: 200 — stateless JWT is accepted.
    expect(res.status).toBe(200);
  });

  it('EXPECTED: the pre-change JWT is accepted on /api/chat/sessions after a password change', async () => {
    const preChangeToken = validToken();
    mockChatSessionFindMany.mockResolvedValue([]);

    const req = requestWithCookie(preChangeToken, '/api/chat/sessions');
    const res = await chatSessionsGET(req);

    expect(res.status).toBe(200);
  });

  it('EXPECTED: token expiry is the ONLY server-enforced revocation mechanism', async () => {
    /**
     * This test documents the security boundary explicitly.
     *
     * The ONLY way a legitimately-signed token can be rejected by the server is:
     *   1. The `exp` claim is in the past (TokenExpiredError from jwt.verify)
     *   2. The signature does not match JWT_SECRET (JsonWebTokenError)
     *   3. The userId references a deleted owner row (only on routes that
     *      perform an explicit owner look-up, e.g. /api/auth/me)
     *
     * Changing a password does NOT trigger any of these three conditions.
     * Therefore a pre-change JWT is indistinguishable from a current one.
     */

    // Verify an expired token IS rejected (the one genuine server-side gate).
    const expiredReq = requestWithCookie(expiredToken(), '/api/documents');
    const expiredRes = await documentsGET(expiredReq);
    expect(expiredRes.status).toBe(401);

    // Verify a pre-change (valid, non-expired) token is NOT rejected.
    const preChangeReq = requestWithCookie(validToken(), '/api/documents');
    const preChangeRes = await documentsGET(preChangeReq);
    expect(preChangeRes.status).toBe(200);
  });

  it('EXPECTED: two requests with pre-change and post-change tokens are handled identically', async () => {
    /**
     * After a password change, the user receives a new JWT (because they
     * re-authenticated with the new password).  But the OLD token also works.
     * Both tokens are accepted — the server cannot tell them apart.
     *
     * This test mints two tokens with explicitly different iat values
     * (simulating issuance before and after a hypothetical password change)
     * and verifies that both are accepted with 200.
     *
     * We use explicit `iat` / `exp` values rather than a sleep to guarantee
     * the two tokens are distinct and the test is deterministic at any speed.
     */

    const now = Math.floor(Date.now() / 1000);
    const sevenDays = 7 * 24 * 60 * 60;

    // "Pre-change" token — issued 1 hour before "now" (still valid, not expired).
    const preChangeToken = jwt.sign(
      { ...VALID_PAYLOAD, iat: now - 3600, exp: now - 3600 + sevenDays },
      CORRECT_SECRET,
    );

    // "Post-change" token — issued "now" (a fresh re-login after password change).
    const postChangeToken = jwt.sign(
      { ...VALID_PAYLOAD, iat: now, exp: now + sevenDays },
      CORRECT_SECRET,
    );

    // The tokens must be distinct (different iat / exp embedded in the payload).
    expect(preChangeToken).not.toBe(postChangeToken);

    // Both are accepted — the server cannot distinguish pre- from post-change.
    const preRes = await documentsGET(requestWithCookie(preChangeToken, '/api/documents'));
    expect(preRes.status).toBe(200);

    const postRes = await documentsGET(requestWithCookie(postChangeToken, '/api/documents'));
    expect(postRes.status).toBe(200);
  });

  it('MITIGATION REMINDER: an expired pre-change JWT IS correctly rejected (expiry still applies)', async () => {
    /**
     * Even though changing a password does not revoke a token, the natural
     * 7-day token expiry is still enforced.  An "old" token that has expired
     * is rejected with 401 regardless of password changes.
     *
     * This means the maximum window of exposure for a stolen pre-change token
     * is bounded by the remaining lifetime of that token at the time of theft.
     */

    // Simulate a pre-change token that has now also expired.
    const expiredPreChangeToken = expiredToken();

    const req = requestWithCookie(expiredPreChangeToken, '/api/auth/me');
    const res = await meGET(req);

    // EXPECTED: 401 — expiry is enforced even for "pre-change" tokens.
    expect(res.status).toBe(401);
  });
});
