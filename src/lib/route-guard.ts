/**
 * Route guard — pure logic helpers.
 *
 * These functions contain the entire decision-making logic for the client-side
 * route guard. They are kept in a plain `.ts` module (no JSX) so they can be
 * imported and tested directly under jest-environment-node without a DOM
 * renderer or Babel JSX transform.
 *
 * The `RouteGuard` React component (route-guard.tsx) imports from here and
 * delegates all branching to these functions so the component itself stays
 * thin and free of conditional complexity.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The three possible outcomes the route guard can produce on each render:
 *
 *  - 'loading'  — session fetch still in flight; render nothing.
 *  - 'redirect' — session resolved with no user; trigger /login redirect.
 *  - 'render'   — session resolved with a valid user; render children.
 */
export type GuardDecision = 'loading' | 'redirect' | 'render';

// ---------------------------------------------------------------------------
// deriveGuardDecision
// ---------------------------------------------------------------------------

/**
 * Derives the guard outcome from the current authentication state.
 *
 * Pure function — no side-effects, deterministically testable.
 *
 * @param isLoading  `true` while GET /api/auth/me is in flight.
 * @param user       The authenticated user object, or `null` when not
 *                   logged in.  Any non-null value is treated as a valid
 *                   session (full JWT verification happens server-side).
 * @param isPublic   When `true` the route bypasses auth entirely and
 *                   `children` are always rendered (e.g. /login, /signup,
 *                   /clone/*).
 */
export function deriveGuardDecision(
  isLoading: boolean,
  user: object | null,
  isPublic: boolean,
): GuardDecision {
  // Public routes always render their children immediately — no auth needed.
  if (isPublic) return 'render';

  // Session fetch still in flight — hold off rendering private content to
  // prevent a flash of the unauthenticated state.
  if (isLoading) return 'loading';

  // Fetch resolved, no authenticated user — redirect to login.
  if (user === null) return 'redirect';

  // Authenticated — render the protected content.
  return 'render';
}

// ---------------------------------------------------------------------------
// buildLoginRedirectUrl
// ---------------------------------------------------------------------------

/**
 * Constructs the redirect destination URL for unauthenticated access attempts.
 *
 * The `returnTo` parameter is validated to start with "/" before encoding to
 * prevent open-redirect attacks (an external URL cannot be injected as a
 * redirect target).
 *
 * @param returnTo  The path (+ optional query string) to bounce back to
 *                  after a successful login.  Must start with "/".
 *                  Defaults to "/" when blank or unsafe.
 */
export function buildLoginRedirectUrl(returnTo: string): string {
  const safePath =
    returnTo && returnTo.startsWith('/') ? returnTo : '/';
  return `/login?returnTo=${encodeURIComponent(safePath)}`;
}
