'use client';

/**
 * RouteGuard — client-side authentication guard.
 *
 * Wraps page content and redirects to /login when the user is definitively
 * unauthenticated (i.e. the auth context has finished loading AND user is null).
 *
 * Key invariant that prevents redirect loops:
 *  - We NEVER redirect while `isLoading === true`.
 *    During the initial page load, AuthProvider is fetching /api/auth/me.
 *    Redirecting before that fetch completes would cause a loop when the user
 *    IS authenticated (cookie present, but context not yet populated).
 *
 *  - We only redirect when `isLoading === false && user === null`.
 *    This is the only state where we are certain the user is unauthenticated.
 *
 * Coordination with middleware.ts:
 *  - Middleware acts on the server before the page is rendered, redirecting
 *    requests that have no `session` cookie to /login.
 *  - This guard acts on the client after hydration for cases where the cookie
 *    disappears mid-session (e.g. logout in another tab).
 *  - Because middleware excludes /login and /signup from its matcher, there is
 *    no risk of middleware redirecting while the guard is also redirecting.
 */

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/context/auth-context';

interface RouteGuardProps {
  children: React.ReactNode;
}

export function RouteGuard({ children }: RouteGuardProps): React.ReactElement | null {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // CRITICAL: Do not redirect while the auth state is still being determined.
    // Redirecting during loading causes a race condition with the middleware and
    // results in blank pages or redirect loops.
    if (isLoading) return;

    // Only redirect when we are CERTAIN the user is unauthenticated.
    if (user === null) {
      // Pass the current path so the login page can redirect back after login.
      router.replace(`/login?from=${encodeURIComponent(pathname)}`);
    }
  }, [isLoading, user, router, pathname]);

  // While loading: render nothing to avoid a flash of protected content.
  // This does NOT cause a redirect — we just withhold the UI until the
  // auth state is known.
  if (isLoading) {
    return null;
  }

  // If the auth check is complete and the user is null, we are in the middle
  // of redirecting. Return null to avoid a flash of protected content.
  if (user === null) {
    return null;
  }

  // Authenticated — render the protected content.
  return <>{children}</>;
}
