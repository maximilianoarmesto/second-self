/**
 * Unit tests for src/lib/middleware/requireAuth.ts
 *
 * All external dependencies (getUserFromRequest from @/lib/auth) are mocked
 * so tests remain deterministic and require no real JWT operations.
 *
 * Tests validate:
 *
 *  1.  Missing token → 401 JSON response with "Unauthorized" error
 *  2.  Invalid / expired token → 401 JSON response
 *  3.  Valid token → handler is invoked (not short-circuited)
 *  4.  Valid token → handler receives userId in ctx.auth
 *  5.  Valid token → handler receives email in ctx.auth
 *  6.  Valid token → handler receives name in ctx.auth
 *  7.  Valid token → handler return value is forwarded to the caller
 *  8.  Auth context does not expose extra fields from the JWT payload
 *  9.  401 response body is JSON with an "error" property
 * 10.  401 response Content-Type is application/json
 * 11.  Handler is NOT called when authentication fails
 * 12.  getUserFromRequest throwing (config error) → 500 response
 * 13.  Existing route context (e.g. params) is merged with auth context
 * 14.  email is null-safe (token with no email → ctx.auth.email is null)
 * 15.  name is null-safe (token with no name → ctx.auth.name is null)
 * 16.  Handler errors propagate naturally (not swallowed by the wrapper)
 * 17.  Wrapper works with async handlers
 * 18.  Wrapper works with sync (non-async) handlers
 */

import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Mock @/lib/auth BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockGetUserFromRequest = jest.fn();

jest.mock('@/lib/auth', () => ({
  getUserFromRequest: (...args: unknown[]) => mockGetUserFromRequest(...args),
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are set up
// ---------------------------------------------------------------------------
import { requireAuth } from '@/lib/middleware/requireAuth';
import type { AuthContext } from '@/lib/middleware/requireAuth';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_PAYLOAD = {
  userId: 7,
  email: 'alice@example.com',
  name: 'Alice',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(options: { cookieHeader?: string; authHeader?: string } = {}): NextRequest {
  const headers = new Headers();
  if (options.cookieHeader) headers.set('cookie', options.cookieHeader);
  if (options.authHeader) headers.set('authorization', options.authHeader);
  return new NextRequest('http://localhost/api/protected', { headers });
}

/**
 * Create a simple protected handler that captures its context and returns 200.
 */
function makeCaptureHandler(): {
  handler: (req: NextRequest, ctx: AuthContext) => NextResponse;
  getCapturedCtx: () => AuthContext | null;
} {
  let capturedCtx: AuthContext | null = null;

  const handler = (_req: NextRequest, ctx: AuthContext): NextResponse => {
    capturedCtx = ctx;
    return NextResponse.json({ ok: true });
  };

  return { handler, getCapturedCtx: () => capturedCtx };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// 401 — unauthenticated paths
// ===========================================================================

describe('requireAuth() — unauthenticated requests', () => {
  // 1. Missing token → 401
  it('returns 401 when getUserFromRequest returns null (no token present)', async () => {
    mockGetUserFromRequest.mockReturnValue(null);

    const wrapped = requireAuth(async () => NextResponse.json({ ok: true }));
    const res = await wrapped(makeRequest());

    expect(res.status).toBe(401);
  });

  // 2. Invalid / expired token → 401
  it('returns 401 when getUserFromRequest returns null (invalid token)', async () => {
    mockGetUserFromRequest.mockReturnValue(null); // expired / tampered

    const wrapped = requireAuth(async () => NextResponse.json({ ok: true }));
    const res = await wrapped(makeRequest({ authHeader: 'Bearer expired.token' }));

    expect(res.status).toBe(401);
  });

  // 9. 401 body is JSON with an "error" property
  it('includes an "error" property in the 401 JSON body', async () => {
    mockGetUserFromRequest.mockReturnValue(null);

    const wrapped = requireAuth(async () => NextResponse.json({ ok: true }));
    const res = await wrapped(makeRequest());
    const body = await res.json();

    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  // 10. 401 response is JSON (Content-Type contains application/json)
  it('returns a JSON Content-Type on the 401 response', async () => {
    mockGetUserFromRequest.mockReturnValue(null);

    const wrapped = requireAuth(async () => NextResponse.json({ ok: true }));
    const res = await wrapped(makeRequest());

    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toMatch(/application\/json/);
  });

  // 11. Handler is NOT called when authentication fails
  it('does not invoke the inner handler when authentication fails', async () => {
    mockGetUserFromRequest.mockReturnValue(null);

    const innerHandler = jest.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = requireAuth(innerHandler);
    await wrapped(makeRequest());

    expect(innerHandler).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 500 — configuration error path
// ===========================================================================

describe('requireAuth() — configuration errors', () => {
  // 12. getUserFromRequest throwing → 500
  it('returns 500 when getUserFromRequest throws (e.g. JWT_SECRET not set)', async () => {
    mockGetUserFromRequest.mockImplementation(() => {
      throw new Error('JWT_SECRET environment variable is not set.');
    });

    const wrapped = requireAuth(async () => NextResponse.json({ ok: true }));
    const res = await wrapped(makeRequest());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ===========================================================================
// Authenticated paths
// ===========================================================================

describe('requireAuth() — authenticated requests', () => {
  beforeEach(() => {
    mockGetUserFromRequest.mockReturnValue(MOCK_PAYLOAD);
  });

  // 3. Valid token → handler is invoked
  it('calls the inner handler when the token is valid', async () => {
    const innerHandler = jest.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const wrapped = requireAuth(innerHandler);
    await wrapped(makeRequest({ authHeader: `Bearer valid.token` }));

    expect(innerHandler).toHaveBeenCalledTimes(1);
  });

  // 4. ctx.auth.userId is populated
  it('injects userId into ctx.auth', async () => {
    const { handler, getCapturedCtx } = makeCaptureHandler();
    const wrapped = requireAuth(handler);
    await wrapped(makeRequest());

    expect(getCapturedCtx()?.auth.userId).toBe(MOCK_PAYLOAD.userId);
  });

  // 5. ctx.auth.email is populated
  it('injects email into ctx.auth', async () => {
    const { handler, getCapturedCtx } = makeCaptureHandler();
    const wrapped = requireAuth(handler);
    await wrapped(makeRequest());

    expect(getCapturedCtx()?.auth.email).toBe(MOCK_PAYLOAD.email);
  });

  // 6. ctx.auth.name is populated
  it('injects name into ctx.auth', async () => {
    const { handler, getCapturedCtx } = makeCaptureHandler();
    const wrapped = requireAuth(handler);
    await wrapped(makeRequest());

    expect(getCapturedCtx()?.auth.name).toBe(MOCK_PAYLOAD.name);
  });

  // 7. Handler return value is forwarded
  it('forwards the handler response to the caller unchanged', async () => {
    const expectedBody = { message: 'hello from protected route' };
    const wrapped = requireAuth(async () => NextResponse.json(expectedBody, { status: 200 }));
    const res = await wrapped(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(expectedBody);
  });

  // 8. Auth context does not expose unexpected extra fields at the top level
  it('does not expose raw token properties outside of ctx.auth', async () => {
    const { handler, getCapturedCtx } = makeCaptureHandler();
    const wrapped = requireAuth(handler);
    await wrapped(makeRequest());

    const ctx = getCapturedCtx() as Record<string, unknown>;
    // userId, email, name must be under ctx.auth — not directly on ctx
    expect(ctx).not.toHaveProperty('userId');
    expect(ctx).not.toHaveProperty('email');
    expect(ctx).not.toHaveProperty('name');
    // But ctx.auth must exist and have the expected shape
    expect(ctx.auth).toEqual({
      userId: MOCK_PAYLOAD.userId,
      email: MOCK_PAYLOAD.email,
      name: MOCK_PAYLOAD.name,
    });
  });

  // 13. Existing route context (params) is merged with auth context
  it('merges the existing route context with the auth context', async () => {
    type Params = { params: { id: string } };

    let capturedCtx: (AuthContext & Params) | null = null;

    const handler = async (_req: NextRequest, ctx: AuthContext & Params): Promise<NextResponse> => {
      capturedCtx = ctx;
      return NextResponse.json({ ok: true });
    };

    const wrapped = requireAuth<Params>(handler);
    const existingParams: Params = { params: { id: 'doc-123' } };
    await wrapped(makeRequest(), existingParams);

    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx!.params.id).toBe('doc-123');
    expect(capturedCtx!.auth.userId).toBe(MOCK_PAYLOAD.userId);
  });

  // 14. email is null when absent from the token
  it('sets ctx.auth.email to null when the token payload has no email', async () => {
    mockGetUserFromRequest.mockReturnValue({ userId: 1, email: null, name: 'Alice' });

    const { handler, getCapturedCtx } = makeCaptureHandler();
    const wrapped = requireAuth(handler);
    await wrapped(makeRequest());

    expect(getCapturedCtx()?.auth.email).toBeNull();
  });

  // 15. name is null when absent from the token
  it('sets ctx.auth.name to null when the token payload has no name', async () => {
    mockGetUserFromRequest.mockReturnValue({ userId: 1, email: 'a@b.com', name: null });

    const { handler, getCapturedCtx } = makeCaptureHandler();
    const wrapped = requireAuth(handler);
    await wrapped(makeRequest());

    expect(getCapturedCtx()?.auth.name).toBeNull();
  });

  // 16. Handler errors propagate naturally
  it('propagates errors thrown by the inner handler', async () => {
    const wrapped = requireAuth(async () => {
      throw new Error('Unexpected handler error');
    });

    await expect(wrapped(makeRequest())).rejects.toThrow('Unexpected handler error');
  });

  // 17. Works with async handlers
  it('works with async handlers (awaits the handler promise)', async () => {
    const wrapped = requireAuth(async () => {
      await Promise.resolve(); // simulate async work
      return NextResponse.json({ async: true });
    });

    const res = await wrapped(makeRequest());
    const body = await res.json();
    expect(body).toEqual({ async: true });
  });

  // 18. Works with sync (non-async) handlers
  it('works with synchronous (non-async) handlers', async () => {
    const wrapped = requireAuth((_req, _ctx) =>
      NextResponse.json({ sync: true })
    );

    const res = await wrapped(makeRequest());
    const body = await res.json();
    expect(body).toEqual({ sync: true });
  });

  // Handler receives the original NextRequest unchanged
  it('passes the original NextRequest to the inner handler', async () => {
    let capturedReq: NextRequest | null = null;

    const wrapped = requireAuth(async (req) => {
      capturedReq = req;
      return NextResponse.json({ ok: true });
    });

    const req = makeRequest({ authHeader: 'Bearer valid.token' });
    await wrapped(req);

    expect(capturedReq).toBe(req);
  });
});
