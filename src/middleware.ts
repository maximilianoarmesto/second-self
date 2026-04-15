/**
 * Next.js Edge Middleware
 *
 * Responsibilities:
 *  - Protect server-rendered routes that require authentication
 *  - Read the `session` cookie from the incoming request
 *  - Redirect unauthenticated visitors to /login
 *
 * Non-responsibilities (handled by client-side route guard):
 *  - Do NOT intercept /login, /signup, /api/auth/*, /clone/*, /_next/*, or static assets
 *  - Do NOT perform any redirect when a valid `session` cookie is present
 *
 * Why no JWT verification in middleware?
 *  Next.js middleware runs in the Edge Runtime which does not support all
 *  Node.js crypto APIs. JWT verification via `jsonwebtoken` (or similar
 *  Node-only libraries) will crash in Edge Runtime. The actual JWT verification
 *  is delegated to the API route (/api/auth/me). Middleware only checks for
 *  cookie presence — a missing cookie is the definitive signal that no session
 *  exists, while the API route catches expired/tampered tokens on the next call.
 *
 * This design prevents double-redirect loops:
 *  1. Middleware only acts when the cookie is absent — it never races with the
 *     client-side guard after a successful login.
 *  2. The matcher config below ensures auth/public pages are never intercepted,
 *     so a freshly-set cookie on POST /api/auth/login is always visible to the
 *     browser before any middleware-protected page is loaded.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Public path detection — belt-and-suspenders guard in addition to matcher
// ---------------------------------------------------------------------------

/**
 * Returns true for paths that should never be intercepted by auth middleware.
 * This is a belt-and-suspenders check; primary exclusion is via `config.matcher`.
 * It protects against matcher regressions if the config is changed in the future.
 */
function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/clone/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/images/') ||
    // Static file extensions
    /\.(?:ico|png|jpg|jpeg|gif|svg|webp|css|js|woff|woff2|ttf|eot|map)$/.test(pathname)
  );
}

// ---------------------------------------------------------------------------
// Middleware function
// ---------------------------------------------------------------------------

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Belt-and-suspenders: explicitly allow public paths even if the matcher
  // config is ever inadvertently changed to include them.
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Read the session cookie directly from the incoming request headers.
  // In Docker / production, cookies set by POST /api/auth/login are available
  // on the very next request because the browser attaches them in the Cookie
  // header before the response is fully rendered — no timing issue here.
  //
  // request.cookies.get() is the correct Next.js edge API for reading cookies;
  // it reads from the incoming Cookie header directly, not from any cache.
  const sessionCookie = request.cookies.get('session');
  const hasSession = sessionCookie !== undefined && sessionCookie.value.length > 0;

  if (hasSession) {
    // Session cookie present — allow the request through without any redirect.
    // The API route (/api/auth/me) will perform actual JWT verification;
    // middleware intentionally avoids JWT crypto to stay lightweight and
    // compatible with the Next.js Edge Runtime.
    return NextResponse.next();
  }

  // No session cookie — redirect to /login.
  // Preserve the originally-requested URL as a `from` param so the login page
  // can redirect back after a successful authentication.
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('from', encodeURIComponent(pathname));

  return NextResponse.redirect(loginUrl);
}

// ---------------------------------------------------------------------------
// Matcher configuration
// ---------------------------------------------------------------------------

/**
 * Matcher configuration.
 *
 * Rules (in priority order):
 *  1. Exclude all Next.js internals (_next/static, _next/image)
 *  2. Exclude public / auth pages: /login, /signup
 *  3. Exclude all auth API routes: /api/auth/**
 *  4. Exclude the public clone viewer: /clone/**
 *  5. Exclude /favicon.ico and common static asset directories
 *  6. Exclude files with known static extensions
 *  7. Match everything else — i.e., protected app pages.
 *
 * The negative lookahead approach is the most reliable pattern for Next.js 14
 * because it is evaluated against the raw pathname before any rewriting occurs.
 */
export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     *  - /_next/static  (static files)
     *  - /_next/image   (image optimisation)
     *  - /favicon.ico   (browser favicon)
     *  - /login         (public auth page)
     *  - /signup        (public auth page)
     *  - /api/auth/**   (auth API routes — login, logout, me)
     *  - /clone/**      (public clone viewer)
     *  - /icons/        (icon assets)
     *  - /images/       (image assets)
     *  - Files with a known static extension
     */
    '/((?!_next/static|_next/image|favicon\.ico|login|signup|api/auth|clone|icons/|images/|.*\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|eot|css|js|map)$).*)',
  ],
};
