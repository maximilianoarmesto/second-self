'use client';

/**
 * RouteGuard — client-side authentication gate for private pages.
 *
 * Wraps any component tree and enforces the following contract:
 *
 *  - While the session is being restored (`isLoading === true`): renders
 *    nothing to prevent a flash of private content.
 *  - After the session resolves with `user === null`: calls
 *    `router.replace('/login?returnTo=<current-path>')` and renders nothing.
 *  - After the session resolves with a valid user: renders `children`.
 *
 * The decision logic lives in the companion `route-guard.ts` module as pure
 * functions so it can be unit-tested without a DOM renderer.
 *
 * Usage:
 *   <RouteGuard>
 *     <PrivatePage />
 *   </RouteGuard>
 *
 * The component must be rendered inside an `<AuthProvider>` tree.
 */

import React, { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { deriveGuardDecision, buildLoginRedirectUrl } from '@/lib/route-guard';

// Re-export the types and pure helpers so consumers can import from a single
// location without knowing about the split between .ts and .tsx files.
export type { GuardDecision } from '@/lib/route-guard';
export { deriveGuardDecision, buildLoginRedirectUrl } from '@/lib/route-guard';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RouteGuardProps {
  children: React.ReactNode;
  /**
   * When `true`, the guard is bypassed and `children` are always rendered.
   * Use this for public routes like /login, /signup, /clone/[token].
   * Defaults to `false`.
   */
  isPublic?: boolean;
}

export function RouteGuard({ children, isPublic = false }: RouteGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading } = useAuth();

  const decision = deriveGuardDecision(isLoading, user, isPublic);

  useEffect(() => {
    if (decision === 'redirect') {
      const destination = buildLoginRedirectUrl(pathname ?? '/');
      router.replace(destination);
    }
  }, [decision, pathname, router]);

  if (decision === 'render') {
    // eslint-disable-next-line react/jsx-no-useless-fragment
    return <>{children}</>;
  }

  // 'loading' or 'redirect' — render nothing while transitioning.
  return null;
}
