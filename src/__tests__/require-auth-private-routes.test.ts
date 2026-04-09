/**
 * Integration tests — requireAuth middleware on all private API routes.
 *
 * Verifies that **every** protected API route correctly rejects unauthenticated
 * requests (no cookie → 401) AND requests carrying a tampered / invalid JWT
 * (bad signature → 401).  Public clone routes must NOT return 401.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Acceptance criteria:
 *
 *  AC-1   All 12 private route groups return 401 with no session cookie.
 *  AC-2   All 12 private route groups return 401 with a malformed/tampered JWT.
 *  AC-3   /api/clone/[token]/validate (GET) does NOT return 401 — it is public.
 *  AC-4   /api/clone/[token]/chat (POST) does NOT return 401 — it is public.
 *  AC-5   Test covers at least one GET and one POST/PATCH/DELETE per route group.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Strategy — fully isolated, no database, no network:
 *
 *  • The real `requireAuth` middleware and `getUserFromRequest` / `verifyToken`
 *    from `@/lib/auth` are used WITHOUT mocking so the cryptographic rejection
 *    path is exercised end-to-end.
 *  • jsonwebtoken is used as-is: a token signed with a different secret fails
 *    real signature verification and `verifyToken` returns `null` → 401.
 *  • Prisma is mocked so database calls made by handlers that pass auth (which
 *    never happens in these tests) do not need a running database.  The mocks
 *    also prevent errors from handlers that are called past the auth gate by
 *    accident, providing a safety net.
 *  • The `JWT_SECRET` env var is overridden locally so `signToken` / `verifyToken`
 *    use a known test secret without affecting other test files.
 *
 * Route coverage (all handlers that call `requireAuth`):
 *
 *  Private route group              | Methods tested
 *  ─────────────────────────────────┼──────────────────────────────
 *  /api/chat                        | POST
 *  /api/chat/sessions               | GET, POST
 *  /api/chat/sessions/[sessionId]   | GET, DELETE, PATCH
 *  /api/dashboard                   | GET
 *  /api/documents                   | GET
 *  /api/documents/upload            | POST
 *  /api/documents/[documentId]      | GET, DELETE, POST (re-process)
 *  /api/settings                    | GET, PUT
 *  /api/settings/avatar             | POST
 *  /api/settings/test-connection    | POST
 *  /api/share-links                 | GET, POST
 *  /api/share-links/[linkId]        | DELETE
 *
 *  Public routes (must NOT return 401):
 *  /api/clone/[token]/validate      | GET
 *  /api/clone/[token]/chat          | POST
 */

import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// JWT secret configuration — two separate secrets so tokens signed with one
// secret are provably invalid under the other.
// ─────────────────────────────────────────────────────────────────────────────

/** Secret the routes under test will use during this suite. */
const CORRECT_SECRET = 'require-auth-routes-test-secret-correct';

/** A different secret used to produce structurally valid but signature-invalid JWTs. */
const WRONG_SECRET = 'require-auth-routes-test-secret-wrong';

// Override JWT_SECRET before any module is imported so `getJwtSecret()` inside
// auth.ts picks up the test value immediately.  Individual tests that need a
// different secret override process.env.JWT_SECRET locally.
const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
process.env.JWT_SECRET = CORRECT_SECRET;

// ─────────────────────────────────────────────────────────────────────────────
// Prisma mock — prevents any real DB calls.
// All methods return safe no-op values; the auth gate fires before any DB
// call is made in the protected handlers, so these mocks are only a safety net.
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('@/lib/prisma', () => ({
  prisma: {
    owner: { findUnique: jest.fn().mockResolvedValue(null) },
    settings: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    document: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    documentChunk: { count: jest.fn().mockResolvedValue(0) },
    shareLink: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    chatSession: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI mock — prevents any accidental network call from transitive imports.
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    models: { list: jest.fn().mockResolvedValue({ data: [] }) },
  })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Service layer mocks — prevent real RAG / ingestion processing.
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('@/lib/services/rag-service', () => ({
  generateResponse: jest.fn().mockResolvedValue({ message: 'ok', sessionId: 1 }),
}));

jest.mock('@/lib/services/document-service', () => ({
  ingestDocument: jest.fn().mockResolvedValue(undefined),
  reingestDocument: jest.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Import route handlers AFTER all mocks are registered.
// ─────────────────────────────────────────────────────────────────────────────

// /api/chat
import { POST as chatPOST } from '@/app/api/chat/route';

// /api/chat/sessions
import {
  GET as chatSessionsGET,
  POST as chatSessionsPOST,
} from '@/app/api/chat/sessions/route';

// /api/chat/sessions/[sessionId]
import {
  GET as chatSessionByIdGET,
  DELETE as chatSessionDELETE,
  PATCH as chatSessionPATCH,
} from '@/app/api/chat/sessions/[sessionId]/route';

// /api/dashboard
import { GET as dashboardGET } from '@/app/api/dashboard/route';

// /api/documents
import { GET as documentsGET } from '@/app/api/documents/route';

// /api/documents/upload
import { POST as documentsUploadPOST } from '@/app/api/documents/upload/route';

// /api/documents/[documentId]
import {
  GET as documentByIdGET,
  DELETE as documentDELETE,
  POST as documentReprocessPOST,
} from '@/app/api/documents/[documentId]/route';

// /api/settings
import {
  GET as settingsGET,
  PUT as settingsPUT,
} from '@/app/api/settings/route';

// /api/settings/avatar
import { POST as settingsAvatarPOST } from '@/app/api/settings/avatar/route';

// /api/settings/test-connection
import { POST as testConnectionPOST } from '@/app/api/settings/test-connection/route';

// /api/share-links
import {
  GET as shareLinksGET,
  POST as shareLinksPOST,
} from '@/app/api/share-links/route';

// /api/share-links/[linkId]
import { DELETE as shareLinkDELETE } from '@/app/api/share-links/[linkId]/route';

// /api/clone/[token]/validate  ← PUBLIC — must NOT return 401
import { GET as cloneValidateGET } from '@/app/api/clone/[token]/validate/route';

// /api/clone/[token]/chat  ← PUBLIC — must NOT return 401
import { POST as cloneChatPOST } from '@/app/api/clone/[token]/chat/route';

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.JWT_SECRET = CORRECT_SECRET;
});

afterAll(() => {
  // Restore the original JWT_SECRET so this suite does not affect others.
  if (ORIGINAL_JWT_SECRET === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Request factory helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a NextRequest with no authentication whatsoever (no cookie, no header).
 */
function unauthenticatedRequest(
  url: string,
  method = 'GET',
  extraHeaders: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { ...extraHeaders },
  });
}

/**
 * Build a NextRequest with a session cookie containing a JWT signed by
 * WRONG_SECRET — structurally valid but the signature does NOT match
 * CORRECT_SECRET, so `verifyToken` returns null → 401.
 */
function tamperedTokenRequest(
  url: string,
  method = 'GET',
  extraHeaders: Record<string, string> = {},
): NextRequest {
  const tamperedToken = jwt.sign(
    { userId: 999, email: 'hacker@evil.com', name: 'Hacker' },
    WRONG_SECRET,
    { expiresIn: '7d' },
  );
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: {
      cookie: `session=${tamperedToken}`,
      ...extraHeaders,
    },
  });
}

/**
 * Build a NextRequest with a completely garbled (non-JWT) session cookie value.
 * Exercises the code path where `verifyToken` throws a JsonWebTokenError.
 */
function malformedTokenRequest(
  url: string,
  method = 'GET',
): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { cookie: 'session=this.is.not.a.valid.jwt.at.all' },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic assertion helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assert that `response` carries HTTP 401 and a JSON body with an `error`
 * field.  This is the exact shape that `requireAuth` produces.
 */
async function assert401(response: Response, description: string): Promise<void> {
  expect({ route: description, status: response.status }).toEqual({
    route: description,
    status: 401,
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${description}: response body is not valid JSON`);
  }

  expect({ route: description, hasError: typeof (body as Record<string, unknown>).error }).toEqual({
    route: description,
    hasError: 'string',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared params used for dynamic-segment routes
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_PARAMS = { params: Promise.resolve({ sessionId: '1' }) };
const DOCUMENT_PARAMS = { params: Promise.resolve({ documentId: '1' }) };
const LINK_PARAMS = { params: Promise.resolve({ linkId: '1' }) };
const TOKEN_PARAMS = { params: Promise.resolve({ token: 'any-token-value' }) };

// ─────────────────────────────────────────────────────────────────────────────
// Test matrix — each entry describes a single route × method combination.
// ─────────────────────────────────────────────────────────────────────────────

type RouteCase = {
  /** Human-readable label used in test names and error messages. */
  label: string;
  /** Invoke the route handler; receives a prebuilt NextRequest. */
  invoke: (req: NextRequest) => Promise<Response>;
};

/** All private route × method combinations that must return 401 without auth. */
const PRIVATE_ROUTE_CASES: RouteCase[] = [
  // ── /api/chat ──────────────────────────────────────────────────────────────
  {
    label: 'POST /api/chat',
    invoke: (req) => chatPOST(req),
  },

  // ── /api/chat/sessions ─────────────────────────────────────────────────────
  {
    label: 'GET /api/chat/sessions',
    invoke: (req) => chatSessionsGET(req),
  },
  {
    label: 'POST /api/chat/sessions',
    invoke: (req) => chatSessionsPOST(req),
  },

  // ── /api/chat/sessions/[sessionId] ─────────────────────────────────────────
  {
    label: 'GET /api/chat/sessions/[sessionId]',
    invoke: (req) => chatSessionByIdGET(req, SESSION_PARAMS),
  },
  {
    label: 'DELETE /api/chat/sessions/[sessionId]',
    invoke: (req) => chatSessionDELETE(req, SESSION_PARAMS),
  },
  {
    label: 'PATCH /api/chat/sessions/[sessionId]',
    invoke: (req) => chatSessionPATCH(req, SESSION_PARAMS),
  },

  // ── /api/dashboard ─────────────────────────────────────────────────────────
  {
    label: 'GET /api/dashboard',
    invoke: (req) => dashboardGET(req),
  },

  // ── /api/documents ─────────────────────────────────────────────────────────
  {
    label: 'GET /api/documents',
    invoke: (req) => documentsGET(req),
  },

  // ── /api/documents/upload ──────────────────────────────────────────────────
  {
    label: 'POST /api/documents/upload',
    invoke: (req) => documentsUploadPOST(req),
  },

  // ── /api/documents/[documentId] ────────────────────────────────────────────
  {
    label: 'GET /api/documents/[documentId]',
    invoke: (req) => documentByIdGET(req, DOCUMENT_PARAMS),
  },
  {
    label: 'DELETE /api/documents/[documentId]',
    invoke: (req) => documentDELETE(req, DOCUMENT_PARAMS),
  },
  {
    label: 'POST /api/documents/[documentId] (re-process)',
    invoke: (req) => documentReprocessPOST(req, DOCUMENT_PARAMS),
  },

  // ── /api/settings ──────────────────────────────────────────────────────────
  {
    label: 'GET /api/settings',
    invoke: (req) => settingsGET(req),
  },
  {
    label: 'PUT /api/settings',
    invoke: (req) => settingsPUT(req),
  },

  // ── /api/settings/avatar ───────────────────────────────────────────────────
  {
    label: 'POST /api/settings/avatar',
    invoke: (req) => settingsAvatarPOST(req),
  },

  // ── /api/settings/test-connection ──────────────────────────────────────────
  {
    label: 'POST /api/settings/test-connection',
    invoke: (req) => testConnectionPOST(req),
  },

  // ── /api/share-links ───────────────────────────────────────────────────────
  {
    label: 'GET /api/share-links',
    invoke: (req) => shareLinksGET(req),
  },
  {
    label: 'POST /api/share-links',
    invoke: (req) => shareLinksPOST(req),
  },

  // ── /api/share-links/[linkId] ──────────────────────────────────────────────
  {
    label: 'DELETE /api/share-links/[linkId]',
    invoke: (req) => shareLinkDELETE(req, LINK_PARAMS),
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helper: derive an HTTP method string from the label so we can build
// correctly-typed NextRequest objects (not strictly required by Next.js
// mock routes, but keeps things clean).
// ─────────────────────────────────────────────────────────────────────────────

function methodFromLabel(label: string): string {
  const first = label.split(' ')[0];
  return first;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — AC-1: No cookie → 401 on every private route
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-1: No session cookie → 401 on every private API route', () => {
  test.each(PRIVATE_ROUTE_CASES)(
    '$label returns 401 with no auth cookie',
    async ({ label, invoke }) => {
      const method = methodFromLabel(label);
      const req = unauthenticatedRequest(`/api/test`, method);
      const response = await invoke(req);
      await assert401(response, label);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — AC-2: Tampered JWT (wrong secret) → 401 on every private route
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-2: Tampered JWT (signed with wrong secret) → 401 on every private API route', () => {
  test.each(PRIVATE_ROUTE_CASES)(
    '$label returns 401 with a JWT signed by the wrong secret',
    async ({ label, invoke }) => {
      const method = methodFromLabel(label);
      const req = tamperedTokenRequest(`/api/test`, method);
      const response = await invoke(req);
      await assert401(response, `${label} [tampered JWT]`);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — AC-2 variant: Malformed/garbage JWT → 401 on every private route
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-2 (malformed token): Garbage JWT string → 401 on every private API route', () => {
  test.each(PRIVATE_ROUTE_CASES)(
    '$label returns 401 with a malformed (non-JWT) session cookie',
    async ({ label, invoke }) => {
      const method = methodFromLabel(label);
      const req = malformedTokenRequest(`/api/test`, method);
      const response = await invoke(req);
      await assert401(response, `${label} [malformed JWT]`);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — AC-3 & AC-4: Public clone routes must NOT return 401
//
// These routes intentionally have no `requireAuth` wrapper — they must remain
// accessible without any session token.  The assertions here verify that the
// response status is NOT 401 (it may be 400, 404, etc., depending on whether
// the token parameter resolves to a real share link, which is mocked to null).
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-3 & AC-4: Public clone routes are accessible without authentication', () => {
  /**
   * AC-3: GET /api/clone/[token]/validate with no session cookie.
   *
   * Prisma mock returns `null` for any token hash lookup, so the handler
   * returns 404 ("Invalid or expired link") — which is explicitly NOT 401.
   */
  it('AC-3: GET /api/clone/[token]/validate with no cookie does NOT return 401', async () => {
    const req = unauthenticatedRequest('/api/clone/abc123/validate', 'GET');
    const response = await cloneValidateGET(req, TOKEN_PARAMS);

    // Must not be 401 — the public validate route should never gate on auth.
    expect(response.status).not.toBe(401);
    // Prisma mock returns null for any share link → handler returns 404.
    // We assert a concrete non-401 value to make the test deterministic.
    expect(response.status).toBe(404);
  });

  /**
   * AC-3 variant: GET /api/clone/[token]/validate with a tampered JWT cookie
   * must also NOT return 401 — the route is truly public.
   */
  it('AC-3: GET /api/clone/[token]/validate with a tampered JWT does NOT return 401', async () => {
    const req = tamperedTokenRequest('/api/clone/abc123/validate', 'GET');
    const response = await cloneValidateGET(req, TOKEN_PARAMS);

    expect(response.status).not.toBe(401);
    expect(response.status).toBe(404);
  });

  /**
   * AC-4: POST /api/clone/[token]/chat with no session cookie.
   *
   * Prisma mock returns `null` for the share link lookup, so the handler
   * returns 404 ("Invalid or expired link") — which is explicitly NOT 401.
   */
  it('AC-4: POST /api/clone/[token]/chat with no cookie does NOT return 401', async () => {
    const req = new NextRequest('http://localhost/api/clone/abc123/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' }),
    });
    const response = await cloneChatPOST(req, TOKEN_PARAMS);

    expect(response.status).not.toBe(401);
    // Prisma mock returns null for the share link → 404.
    expect(response.status).toBe(404);
  });

  /**
   * AC-4 variant: POST /api/clone/[token]/chat with a tampered JWT cookie
   * must also NOT return 401.
   */
  it('AC-4: POST /api/clone/[token]/chat with a tampered JWT does NOT return 401', async () => {
    const tamperedToken = jwt.sign(
      { userId: 999, email: 'hacker@evil.com', name: 'Hacker' },
      WRONG_SECRET,
      { expiresIn: '7d' },
    );
    const req = new NextRequest('http://localhost/api/clone/abc123/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `session=${tamperedToken}`,
      },
      body: JSON.stringify({ message: 'Hello' }),
    });
    const response = await cloneChatPOST(req, TOKEN_PARAMS);

    expect(response.status).not.toBe(401);
    expect(response.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — AC-1 & AC-2 detailed: Response shape assertions
//
// Pick a representative route from each of the 12 protected route groups and
// verify both the status code AND the response body shape in detail.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-1 & AC-2: 401 response body shape is correct for every route group', () => {
  /**
   * One representative handler per protected route group.
   * The test verifies that:
   *  - status is 401
   *  - body is JSON
   *  - body has an `error` property that is a non-empty string
   *  - Content-Type is application/json
   */
  const REPRESENTATIVE_CASES: Array<{
    group: string;
    invoke: (req: NextRequest) => Promise<Response>;
  }> = [
    { group: '/api/chat',                         invoke: (r) => chatPOST(r) },
    { group: '/api/chat/sessions',                invoke: (r) => chatSessionsGET(r) },
    { group: '/api/chat/sessions/[sessionId]',    invoke: (r) => chatSessionByIdGET(r, SESSION_PARAMS) },
    { group: '/api/dashboard',                    invoke: (r) => dashboardGET(r) },
    { group: '/api/documents',                    invoke: (r) => documentsGET(r) },
    { group: '/api/documents/upload',             invoke: (r) => documentsUploadPOST(r) },
    { group: '/api/documents/[documentId]',       invoke: (r) => documentByIdGET(r, DOCUMENT_PARAMS) },
    { group: '/api/settings',                     invoke: (r) => settingsGET(r) },
    { group: '/api/settings/avatar',              invoke: (r) => settingsAvatarPOST(r) },
    { group: '/api/settings/test-connection',     invoke: (r) => testConnectionPOST(r) },
    { group: '/api/share-links',                  invoke: (r) => shareLinksGET(r) },
    { group: '/api/share-links/[linkId]',         invoke: (r) => shareLinkDELETE(r, LINK_PARAMS) },
  ];

  describe('No cookie — body shape', () => {
    test.each(REPRESENTATIVE_CASES)(
      '$group: 401 body has { error: string } and Content-Type: application/json',
      async ({ group, invoke }) => {
        const req = unauthenticatedRequest('/api/test');
        const response = await invoke(req);

        // Status
        expect(response.status).toBe(401);

        // Content-Type must be application/json
        const contentType = response.headers.get('content-type') ?? '';
        expect(contentType).toMatch(/application\/json/);

        // Body must be parseable JSON with an `error` string
        const body = await response.json() as Record<string, unknown>;
        expect(typeof body.error).toBe('string');
        expect((body.error as string).length).toBeGreaterThan(0);
      },
    );
  });

  describe('Tampered JWT — body shape', () => {
    test.each(REPRESENTATIVE_CASES)(
      '$group: 401 body has { error: string } with tampered JWT',
      async ({ group, invoke }) => {
        const req = tamperedTokenRequest('/api/test');
        const response = await invoke(req);

        expect(response.status).toBe(401);

        const body = await response.json() as Record<string, unknown>;
        expect(typeof body.error).toBe('string');
        expect((body.error as string).length).toBeGreaterThan(0);
      },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — Expired JWT → 401
//
// An expired token is technically structurally valid (correct signature) but
// jwt.verify() throws TokenExpiredError → verifyToken() returns null → 401.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-2: Expired JWT → 401 on private routes', () => {
  /**
   * Build a NextRequest carrying a legitimately-signed but already-expired JWT.
   */
  function expiredTokenRequest(url: string, method = 'GET'): NextRequest {
    const pastExp = Math.floor(Date.now() / 1000) - 1; // 1 second in the past
    const expiredToken = jwt.sign(
      { userId: 1, email: 'alice@example.com', name: 'Alice', exp: pastExp },
      CORRECT_SECRET,
    );
    return new NextRequest(`http://localhost${url}`, {
      method,
      headers: { cookie: `session=${expiredToken}` },
    });
  }

  // Spot-check a few representative routes.

  it('GET /api/documents with expired JWT → 401', async () => {
    const req = expiredTokenRequest('/api/documents');
    const response = await documentsGET(req);
    await assert401(response, 'GET /api/documents [expired JWT]');
  });

  it('GET /api/settings with expired JWT → 401', async () => {
    const req = expiredTokenRequest('/api/settings');
    const response = await settingsGET(req);
    await assert401(response, 'GET /api/settings [expired JWT]');
  });

  it('GET /api/chat/sessions with expired JWT → 401', async () => {
    const req = expiredTokenRequest('/api/chat/sessions');
    const response = await chatSessionsGET(req);
    await assert401(response, 'GET /api/chat/sessions [expired JWT]');
  });

  it('GET /api/dashboard with expired JWT → 401', async () => {
    const req = expiredTokenRequest('/api/dashboard');
    const response = await dashboardGET(req);
    await assert401(response, 'GET /api/dashboard [expired JWT]');
  });

  it('GET /api/share-links with expired JWT → 401', async () => {
    const req = expiredTokenRequest('/api/share-links');
    const response = await shareLinksGET(req);
    await assert401(response, 'GET /api/share-links [expired JWT]');
  });

  it('DELETE /api/share-links/[linkId] with expired JWT → 401', async () => {
    const req = expiredTokenRequest('/api/share-links/1', 'DELETE');
    const response = await shareLinkDELETE(req, LINK_PARAMS);
    await assert401(response, 'DELETE /api/share-links/[linkId] [expired JWT]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7 — AC-5: Verify GET and POST/PATCH/DELETE coverage per route group
//
// This suite is documentation-oriented: it explicitly names the HTTP method
// combinations covered so reviewers can confirm AC-5 compliance at a glance.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-5: GET and mutating method coverage per route group (no cookie)', () => {
  // /api/chat — POST only (no GET)
  it('/api/chat POST → 401', async () => {
    const res = await chatPOST(unauthenticatedRequest('/api/chat', 'POST'));
    expect(res.status).toBe(401);
  });

  // /api/chat/sessions — GET + POST
  it('/api/chat/sessions GET → 401', async () => {
    const res = await chatSessionsGET(unauthenticatedRequest('/api/chat/sessions'));
    expect(res.status).toBe(401);
  });
  it('/api/chat/sessions POST → 401', async () => {
    const res = await chatSessionsPOST(unauthenticatedRequest('/api/chat/sessions', 'POST'));
    expect(res.status).toBe(401);
  });

  // /api/chat/sessions/[sessionId] — GET + DELETE + PATCH
  it('/api/chat/sessions/[sessionId] GET → 401', async () => {
    const res = await chatSessionByIdGET(
      unauthenticatedRequest('/api/chat/sessions/1'),
      SESSION_PARAMS,
    );
    expect(res.status).toBe(401);
  });
  it('/api/chat/sessions/[sessionId] DELETE → 401', async () => {
    const res = await chatSessionDELETE(
      unauthenticatedRequest('/api/chat/sessions/1', 'DELETE'),
      SESSION_PARAMS,
    );
    expect(res.status).toBe(401);
  });
  it('/api/chat/sessions/[sessionId] PATCH → 401', async () => {
    const res = await chatSessionPATCH(
      unauthenticatedRequest('/api/chat/sessions/1', 'PATCH'),
      SESSION_PARAMS,
    );
    expect(res.status).toBe(401);
  });

  // /api/dashboard — GET only
  it('/api/dashboard GET → 401', async () => {
    const res = await dashboardGET(unauthenticatedRequest('/api/dashboard'));
    expect(res.status).toBe(401);
  });

  // /api/documents — GET
  it('/api/documents GET → 401', async () => {
    const res = await documentsGET(unauthenticatedRequest('/api/documents'));
    expect(res.status).toBe(401);
  });

  // /api/documents/upload — POST
  it('/api/documents/upload POST → 401', async () => {
    const res = await documentsUploadPOST(unauthenticatedRequest('/api/documents/upload', 'POST'));
    expect(res.status).toBe(401);
  });

  // /api/documents/[documentId] — GET + DELETE + POST (re-process)
  it('/api/documents/[documentId] GET → 401', async () => {
    const res = await documentByIdGET(
      unauthenticatedRequest('/api/documents/1'),
      DOCUMENT_PARAMS,
    );
    expect(res.status).toBe(401);
  });
  it('/api/documents/[documentId] DELETE → 401', async () => {
    const res = await documentDELETE(
      unauthenticatedRequest('/api/documents/1', 'DELETE'),
      DOCUMENT_PARAMS,
    );
    expect(res.status).toBe(401);
  });
  it('/api/documents/[documentId] POST (re-process) → 401', async () => {
    const res = await documentReprocessPOST(
      unauthenticatedRequest('/api/documents/1', 'POST'),
      DOCUMENT_PARAMS,
    );
    expect(res.status).toBe(401);
  });

  // /api/settings — GET + PUT
  it('/api/settings GET → 401', async () => {
    const res = await settingsGET(unauthenticatedRequest('/api/settings'));
    expect(res.status).toBe(401);
  });
  it('/api/settings PUT → 401', async () => {
    const res = await settingsPUT(unauthenticatedRequest('/api/settings', 'PUT'));
    expect(res.status).toBe(401);
  });

  // /api/settings/avatar — POST
  it('/api/settings/avatar POST → 401', async () => {
    const res = await settingsAvatarPOST(unauthenticatedRequest('/api/settings/avatar', 'POST'));
    expect(res.status).toBe(401);
  });

  // /api/settings/test-connection — POST
  it('/api/settings/test-connection POST → 401', async () => {
    const res = await testConnectionPOST(
      unauthenticatedRequest('/api/settings/test-connection', 'POST'),
    );
    expect(res.status).toBe(401);
  });

  // /api/share-links — GET + POST
  it('/api/share-links GET → 401', async () => {
    const res = await shareLinksGET(unauthenticatedRequest('/api/share-links'));
    expect(res.status).toBe(401);
  });
  it('/api/share-links POST → 401', async () => {
    const res = await shareLinksPOST(unauthenticatedRequest('/api/share-links', 'POST'));
    expect(res.status).toBe(401);
  });

  // /api/share-links/[linkId] — DELETE
  it('/api/share-links/[linkId] DELETE → 401', async () => {
    const res = await shareLinkDELETE(
      unauthenticatedRequest('/api/share-links/1', 'DELETE'),
      LINK_PARAMS,
    );
    expect(res.status).toBe(401);
  });
});
