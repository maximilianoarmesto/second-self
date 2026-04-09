import { NextRequest, NextResponse } from 'next/server';

/**
 * Route guard middleware — runs on the Edge Runtime before a page is rendered.
 *
 * Rules:
 *  - Private pages (/, /chat, /knowledge-base, /settings, /share, …):
 *      redirect to /login?returnTo=<original-path> when no `session` cookie
 *      is present.
 *  - Auth pages (/login, /signup):
 *      redirect to / when a `session` cookie IS present (already logged in).
 *  - Public pages (/clone/[token], /api/**, static assets):
 *      always pass through without any redirect.
 *
 * Note: the middleware only inspects the *presence* of the cookie, not its
 * validity. Full JWT verification happens in the API routes and in the
 * client-side `AuthProvider` (which calls GET /api/auth/me on mount). An
 * expired or tampered cookie will therefore render the page briefly before
 * the client redirect kicks in — this is acceptable for a client-rendered
 * Next.js app.
 */

// ---------------------------------------------------------------------------
// Route classification helpers
// ---------------------------------------------------------------------------

/** Paths that require an authenticated session. */
const PRIVATE_PREFIXES = ['/', '/chat', '/knowledge-base', '/settings', '/share'];

/** Paths that are only accessible to unauthenticated users (auth pages). */
const AUTH_PATHS = ['/login', '/signup'];

/**
 * Returns true when the pathname belongs to an auth page (/login, /signup).
 */
function isAuthPage(pathname: string): boolean {
  return AUTH_PATHS.includes(pathname);
}

/**
 * Returns true when the pathname is public (accessible without auth).
 * Covers: /clone/* routes, all /api/* routes, and Next.js internals.
 */
function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith('/clone/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/uploads/')
  );
}

/**
 * Returns true when the pathname is a private page that requires auth.
 * Everything that is not public and not an auth page is treated as private.
 */
function isPrivatePath(pathname: string): boolean {
  return !isPublicPath(pathname) && !isAuthPage(pathname);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Pass through all public paths without inspection.
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const hasSession = Boolean(request.cookies.get('session')?.value);

  // ── Private pages ──────────────────────────────────────────────────────────
  // Unauthenticated visitors are sent to /login.  We encode the originally
  // requested URL as `returnTo` so the login page can redirect back after a
  // successful sign-in.
  if (isPrivatePath(pathname) && !hasSession) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    // Preserve the original path + search string so we can bounce back after login.
    loginUrl.searchParams.set('returnTo', pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  // ── Auth pages ─────────────────────────────────────────────────────────────
  // Authenticated users visiting /login or /signup are bounced to the dashboard.
  if (isAuthPage(pathname) && hasSession) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/';
    homeUrl.search = '';
    return NextResponse.redirect(homeUrl);
  }

  return NextResponse.next();
}

// ---------------------------------------------------------------------------
// Matcher — run the middleware on page routes only (skip static files, etc.)
// ---------------------------------------------------------------------------

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     *   - _next/static  (static files)
     *   - _next/image   (image optimisation)
     *   - favicon.ico   (favicon)
     *   - public root files (.svg, .png, .ico, …)
     *
     * The remaining paths are evaluated inside the middleware function, which
     * explicitly passes through /api/**, /clone/**, and other public paths.
     */
    '/((?!_next/static|_next/image|favicon|.*\\.(?:svg|png|ico|jpg|jpeg|gif|webp)$).*)',
  ],
};
