'use client';

import { useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RouteGuardProps {
  children: ReactNode;
}

// ---------------------------------------------------------------------------
// RouteGuard
// ---------------------------------------------------------------------------

/**
 * Protects client-side routes from unauthenticated access.
 *
 * Rendering rules:
 *  - While `isLoading === true`:  render a neutral blank div (no redirect).
 *    This covers the auth-hydration window on first render — including in
 *    Docker production builds where useEffect fires after the initial paint.
 *  - When `isLoading === false && user === null`: redirect to /login.
 *  - When `isLoading === false && user !== null`: render children normally.
 *
 * The redirect is performed inside a useEffect so it only runs client-side
 * and never during the loading phase.
 */
export function RouteGuard({ children }: RouteGuardProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Never redirect while the auth state is still being resolved.
    if (isLoading) return;

    // Only redirect once we know for certain the user is NOT authenticated.
    if (user === null) {
      router.push('/login');
    }
  }, [isLoading, user, router]);

  // ── Loading phase ────────────────────────────────────────────────────────
  // Render nothing (blank div) while auth state is still being resolved.
  // This prevents both the white flash and premature redirects.
  if (isLoading) {
    return <div aria-hidden="true" />;
  }

  // ── Unauthenticated ──────────────────────────────────────────────────────
  // The useEffect above has already triggered the redirect; return null here
  // so no page content flashes before the navigation completes.
  if (user === null) {
    return null;
  }

  // ── Authenticated ────────────────────────────────────────────────────────
  return <>{children}</>;
}
