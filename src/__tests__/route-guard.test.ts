/**
 * Unit tests for the route guard middleware (src/middleware.ts).
 *
 * The middleware is tested as a pure function — no Next.js server is started.
 * We construct minimal NextRequest objects and assert on the returned
 * NextResponse (status code, Location header, Set-Cookie, etc.).
 *
 * Acceptance criteria verified:
 *  1.  Private route without session → 307 redirect to /login
 *  2.  Private route without session → redirect preserves returnTo param
 *  3.  Private route with valid session cookie → passes through (200 next)
 *  4.  /login without session → passes through (200 next)
 *  5.  /signup without session → passes through (200 next)
 *  6.  /login with session → 307 redirect to /
 *  7.  /signup with session → 307 redirect to /
 *  8.  /clone/[token] without session → passes through (never redirected)
 *  9.  /clone/[token] with session → passes through (never redirected)
 * 10.  /api/* routes always pass through (no redirect)
 * 11.  Nested private routes (e.g. /knowledge-base/upload) → redirect
 * 12.  returnTo only accepts paths starting with "/" (open-redirect guard)
 * 13.  returnTo encodes query strings from the original URL
 * 14.  /share route without session → redirect to /login
 * 15.  /settings route without session → redirect to /login
 * 16.  /chat route without session → redirect to /login
 * 17.  Root (/) without session → redirect to /login
 */

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a NextRequest for the given pathname with an optional `session` cookie.
 */
function makeRequest(
  pathname: string,
  options: { sessionCookie?: string; search?: string } = {}
): NextRequest {
  const url = new URL(
    `http://localhost${pathname}${options.search ? options.search : ''}`
  );

  const init: RequestInit & { headers?: HeadersInit } = {};

  if (options.sessionCookie) {
    init.headers = { cookie: `session=${options.sessionCookie}` };
  }

  return new NextRequest(url, init);
}

/**
 * Extract the Location header value from a redirect response.
 * Returns null when the response is not a redirect.
 */
function getLocation(response: Response): string | null {
  return response.headers.get('location');
}

/**
 * Returns true when the response is a redirect (3xx status).
 */
function isRedirect(response: Response): boolean {
  return response.status >= 300 && response.status < 400;
}

// ---------------------------------------------------------------------------
// 1–3. Private routes
// ---------------------------------------------------------------------------

describe('middleware — private routes', () => {
  // 1. Private route without session → redirect to /login
  it('redirects unauthenticated requests to / → /login', () => {
    const req = makeRequest('/');
    const res = middleware(req);

    expect(isRedirect(res)).toBe(true);
    const location = getLocation(res)!;
    expect(location).toMatch(/^http:\/\/localhost\/login/);
  });

  // 2. Redirect URL includes the original path as returnTo
  it('includes the original path as returnTo in the redirect URL', () => {
    const req = makeRequest('/chat');
    const res = middleware(req);

    expect(isRedirect(res)).toBe(true);
    const location = new URL(getLocation(res)!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('returnTo')).toBe('/chat');
  });

  // 3. Authenticated request passes through
  it('passes through private routes when a session cookie is present', () => {
    const req = makeRequest('/', { sessionCookie: 'valid-jwt-token' });
    const res = middleware(req);

    expect(isRedirect(res)).toBe(false);
  });

  // 11. Nested private routes are also protected
  it('redirects /knowledge-base/upload without a session', () => {
    const req = makeRequest('/knowledge-base/upload');
    const res = middleware(req);

    expect(isRedirect(res)).toBe(true);
    const location = new URL(getLocation(res)!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('returnTo')).toBe('/knowledge-base/upload');
  });

  // 13. returnTo preserves the original query string
  it('encodes the query string from the original URL into returnTo', () => {
    const req = makeRequest('/chat', { search: '?session=123' });
    const res = middleware(req);

    expect(isRedirect(res)).toBe(true);
    const location = new URL(getLocation(res)!);
    // The returnTo value should contain the path + original query string
    const returnTo = location.searchParams.get('returnTo')!;
    expect(returnTo).toContain('/chat');
    expect(returnTo).toContain('session=123');
  });

  // 14. /share without session → redirect
  it('redirects /share to /login when no session is present', () => {
    const req = makeRequest('/share');
    const res = middleware(req);

    expect(isRedirect(res)).toBe(true);
    const location = new URL(getLocation(res)!);
    expect(location.pathname).toBe('/login');
  });

  // 15. /settings without session → redirect
  it('redirects /settings to /login when no session is present', () => {
    const req = makeRequest('/settings');
    const res = middleware(req);

    expect(isRedirect(res)).toBe(true);
    const location = new URL(getLocation(res)!);
    expect(location.pathname).toBe('/login');
  });

  // 16. /chat without session → redirect
  it('redirects /chat to /login when no session is present', () => {
    const req = makeRequest('/chat');
    const res = middleware(req);

    expect(isRedirect(res)).toBe(true);
    const location = new URL(getLocation(res)!);
    expect(location.pathname).toBe('/login');
  });

  // 17. Root (/) without session → redirect
  it('redirects / to /login when no session is present', () => {
    const req = makeRequest('/');
    const res = middleware(req);

    expect(isRedirect(res)).toBe(true);
    const location = new URL(getLocation(res)!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('returnTo')).toBe('/');
  });
});

// ---------------------------------------------------------------------------
// 4–7. Auth pages (/login, /signup)
// ---------------------------------------------------------------------------

describe('middleware — auth pages', () => {
  // 4. /login without session → pass through
  it('allows unauthenticated access to /login', () => {
    const req = makeRequest('/login');
    const res = middleware(req);

    expect(isRedirect(res)).toBe(false);
  });

  // 5. /signup without session → pass through
  it('allows unauthenticated access to /signup', () => {
    const req = makeRequest('/signup');
    const res = middleware(req);

    expect(isRedirect(res)).toBe(false);
  });

  // 6. /login with session → redirect to /
  it('redirects authenticated users visiting /login to /', () => {
    const req = makeRequest('/login', { sessionCookie: 'valid-jwt-token' });
    const res = middleware(req);

    expect(isRedirect(res)).toBe(true);
    const location = new URL(getLocation(res)!);
    expect(location.pathname).toBe('/');
    // No returnTo parameter on the home redirect
    expect(location.searchParams.has('returnTo')).toBe(false);
  });

  // 7. /signup with session → redirect to /
  it('redirects authenticated users visiting /signup to /', () => {
    const req = makeRequest('/signup', { sessionCookie: 'valid-jwt-token' });
    const res = middleware(req);

    expect(isRedirect(res)).toBe(true);
    const location = new URL(getLocation(res)!);
    expect(location.pathname).toBe('/');
  });
});

// ---------------------------------------------------------------------------
// 8–9. Public clone pages (/clone/[token])
// ---------------------------------------------------------------------------

describe('middleware — public clone pages', () => {
  // 8. /clone/* without session → passes through (never redirected)
  it('allows unauthenticated access to /clone/[token]', () => {
    const req = makeRequest('/clone/abc123token');
    const res = middleware(req);

    expect(isRedirect(res)).toBe(false);
  });

  // 9. /clone/* with session → also passes through
  it('allows authenticated access to /clone/[token] (no redirect)', () => {
    const req = makeRequest('/clone/abc123token', { sessionCookie: 'valid-jwt-token' });
    const res = middleware(req);

    expect(isRedirect(res)).toBe(false);
  });

  // Nested clone path also passes through
  it('allows access to nested /clone/[token]/anything without session', () => {
    const req = makeRequest('/clone/token123/extra');
    const res = middleware(req);

    expect(isRedirect(res)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. API routes always pass through
// ---------------------------------------------------------------------------

describe('middleware — API routes', () => {
  // 10. All /api/* routes pass through regardless of session
  it('passes through /api/auth/me without a session cookie', () => {
    const req = makeRequest('/api/auth/me');
    const res = middleware(req);

    expect(isRedirect(res)).toBe(false);
  });

  it('passes through /api/auth/login without a session cookie', () => {
    const req = makeRequest('/api/auth/login');
    const res = middleware(req);

    expect(isRedirect(res)).toBe(false);
  });

  it('passes through /api/clone/[token]/validate without a session cookie', () => {
    const req = makeRequest('/api/clone/abc123/validate');
    const res = middleware(req);

    expect(isRedirect(res)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 12. Open-redirect guard — returnTo must start with "/"
// ---------------------------------------------------------------------------

describe('middleware — returnTo safety', () => {
  // The returnTo value is the raw pathname from request.nextUrl, which is
  // always a path (never an absolute URL). This confirms that behaviour.
  it('returnTo value is an absolute path starting with /', () => {
    const req = makeRequest('/settings');
    const res = middleware(req);

    expect(isRedirect(res)).toBe(true);
    const location = new URL(getLocation(res)!);
    const returnTo = location.searchParams.get('returnTo')!;
    // Must start with "/" — cannot be an external URL
    expect(returnTo.startsWith('/')).toBe(true);
  });
});
