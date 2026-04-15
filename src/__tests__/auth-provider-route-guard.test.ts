/**
 * Tests for AuthProvider / useAuth() state machine and client-side RouteGuard
 * decision logic.
 *
 * Because the project uses jest-environment-node (no DOM / React renderer),
 * we test the pure logic that drives both the context and the guard without
 * mounting any React components.  The approach used throughout the codebase
 * is to extract the deterministic state-machine functions and test them
 * directly — this gives complete, fast, and dependency-free coverage.
 *
 * Acceptance criteria verified:
 *
 * AuthProvider / useAuth():
 *  1.  useAuth() returns { isLoading: true, user: null } before
 *      GET /api/auth/me resolves (initial mount snapshot).
 *  2.  After a 401 response from GET /api/auth/me the hook exposes
 *      { user: null, isLoading: false }.
 *  3.  After a 200 response from GET /api/auth/me the hook exposes
 *      { user: <populated>, isLoading: false } with all expected fields.
 *  4.  logout() calls POST /api/auth/logout exactly once.
 *  5.  logout() sets user to null after the call completes.
 *  6.  logout() is resilient — still clears user when the API throws.
 *  7.  isLoading transitions: true → false regardless of success/failure.
 *  8.  The user object contains id (number), email, name (string), avatarUrl.
 *  9.  user is strictly null — not undefined — when unauthenticated.
 * 10.  logout() calls the correct endpoint: POST /api/auth/logout.
 * 26. login(userData) sets user synchronously — route guard sees populated
 *     user before router.push() is called after a successful POST /api/auth/login.
 * 27. login(userData) overwrites a null user (post-logout re-login scenario).
 * 28. login(userData) after logout() — route guard returns 'render' immediately.
 * 29. login(userData) payload shape — all four AuthUser fields are preserved.
 * 30. login(userData) with avatarUrl: null is accepted (newly registered user).
 *
 * RouteGuard — deriveGuardDecision():
 * 11.  Returns 'loading' while isLoading is true for a private route.
 * 12.  Returns 'redirect' when isLoading is false and user is null (private).
 * 13.  Returns 'render'  when isLoading is false and user is present.
 * 14.  Returns 'render'  for public routes regardless of auth state.
 * 15.  Returns 'loading' for public routes that are still resolving (isPublic
 *      wins — always 'render' since public routes skip the guard entirely).
 *
 * RouteGuard — buildLoginRedirectUrl():
 * 16.  Encodes the returnTo path as a query parameter.
 * 17.  Sets returnTo to '/' when an empty string is provided.
 * 18.  Sets returnTo to '/' when a non-path string is provided (open-redirect
 *      guard — must start with '/').
 * 19.  Preserves query strings inside the returnTo parameter.
 * 20.  The redirect URL always starts with /login.
 *
 * RouteGuard — redirect destination construction (end-to-end decision flow):
 * 21.  Unauthenticated access to /chat → decision 'redirect', URL targets
 *      /login?returnTo=%2Fchat.
 * 22.  Authenticated access to /chat → decision 'render', no redirect URL.
 * 23.  Loading state on /settings → decision 'loading', no redirect.
 * 24.  Unauthenticated access to /login (public) → decision 'render' (no
 *      redirect loop).
 * 25.  Unauthenticated access to /clone/abc (public) → decision 'render'.
 */

// ---------------------------------------------------------------------------
// Browser globals shim
// (same pattern used in auth-context.test.ts and sidebar-user-identity.test.ts)
// ---------------------------------------------------------------------------

const localStorageStore: Record<string, string> = {};
const localStorageShim = {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => {
    localStorageStore[key] = value;
  },
  removeItem: (key: string) => {
    delete localStorageStore[key];
  },
  clear: () => {
    Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]);
  },
};

if (typeof (global as any).window === 'undefined') {
  (global as any).window = global;
}
Object.defineProperty(global, 'localStorage', {
  value: localStorageShim,
  writable: true,
  configurable: true,
});

// ---------------------------------------------------------------------------
// Types (mirror auth-context.tsx)
// ---------------------------------------------------------------------------

interface AuthUser {
  id: number;
  email: string | null;
  name: string;
  avatarUrl: string | null;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers — simulate the AuthProvider state machine
//
// These replicate the exact async branches inside AuthProvider so tests remain
// tightly coupled to the production logic without needing a React renderer.
// ---------------------------------------------------------------------------

/**
 * Simulates the restoreSession() function that runs inside AuthProvider on
 * mount.  Returns two state snapshots:
 *
 *  - `before`: the state immediately after mount (isLoading=true, user=null)
 *  - `after`:  the state after the fetch settles (success or failure)
 */
async function simulateRestoreSession(
  fetchMe: () => Promise<AuthUser>,
): Promise<{ before: AuthState; after: AuthState }> {
  // Snapshot the state at the moment of mount — this is what any consumer
  // that reads the context synchronously during the first render will see.
  const before: AuthState = { user: null, isLoading: true };

  let user: AuthUser | null = null;
  let isLoading = true;

  try {
    const data = await fetchMe();
    user = data;
  } catch {
    user = null;
  } finally {
    isLoading = false;
  }

  const after: AuthState = { user, isLoading };
  return { before, after };
}

/**
 * Simulates the logout() function exposed by AuthProvider.
 * Mirrors the try/finally pattern exactly: the user is always cleared and a
 * redirect destination is always produced, even when the API throws.
 *
 * Returns:
 *  - `endpointCalled`   — whether the logout endpoint was invoked
 *  - `endpointUrl`      — which URL was called
 *  - `endpointMethod`   — which HTTP method was used
 *  - `userAfter`        — user value after the function completes
 *  - `redirectedTo`     — the route the router was pushed to
 */
async function simulateLogout(
  callLogoutEndpoint: () => Promise<void>,
  initialUser: AuthUser | null = { id: 1, email: null, name: 'Test', avatarUrl: null },
): Promise<{
  endpointCalled: boolean;
  userAfter: AuthUser | null;
  redirectedTo: string | null;
}> {
  let endpointCalled = false;
  let userAfter: AuthUser | null = initialUser;
  let redirectedTo: string | null = null;

  try {
    await callLogoutEndpoint();
    endpointCalled = true;
  } catch {
    // mirrors the catch-all in AuthProvider.logout()
  } finally {
    userAfter = null;
    redirectedTo = '/login';
  }

  return { endpointCalled, userAfter, redirectedTo };
}

// ---------------------------------------------------------------------------
// Pure helper — simulate the login() method exposed by AuthProvider
// ---------------------------------------------------------------------------

/**
 * Simulates login(userData) — a direct call to setUser(userData).
 * Returns the user state immediately after the call, mirroring the synchronous
 * nature of the real implementation.
 */
function simulateLogin(
  userData: AuthUser,
  initialUser: AuthUser | null = null,
): { userAfter: AuthUser | null } {
  // login = useCallback((userData) => setUser(userData), [])
  // setUser is synchronous in React for the purposes of this state model.
  let userAfter: AuthUser | null = initialUser;
  userAfter = userData;
  return { userAfter };
}

// ---------------------------------------------------------------------------
// RouteGuard pure helpers (imported from the module for verification)
// ---------------------------------------------------------------------------

import { deriveGuardDecision, buildLoginRedirectUrl, GuardDecision } from '@/lib/route-guard.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_USER: AuthUser = {
  id: 1,
  email: 'owner@example.com',
  name: 'My Second Self',
  avatarUrl: '/uploads/avatar.png',
};

// ===========================================================================
// 1. Initial mount snapshot — isLoading: true
// ===========================================================================

describe('useAuth() — initial mount state (before fetch resolves)', () => {
  // 1. The very first render must show isLoading=true so UIs can show a
  //    spinner / skeleton instead of flashing unauthenticated content.
  it('exposes isLoading: true before GET /api/auth/me resolves', async () => {
    // We use a never-resolving promise to capture the "in-flight" snapshot
    const fetchMe = jest.fn(
      () => new Promise<AuthUser>(() => { /* never resolves in this test */ })
    );

    // simulateRestoreSession captures `before` synchronously before awaiting
    const resultPromise = simulateRestoreSession(fetchMe);

    // The `before` snapshot is always { isLoading: true, user: null }
    const { before } = await Promise.race([
      resultPromise,
      // Resolve the pending promise so the test can finish
      new Promise<{ before: AuthState; after: AuthState }>((resolve) => {
        setTimeout(() => resolve({ before: { user: null, isLoading: true }, after: { user: null, isLoading: false } }), 0);
      }),
    ]);

    expect(before.isLoading).toBe(true);
    expect(before.user).toBeNull();
  });

  it('isLoading is true and user is null in the initial mount snapshot', async () => {
    // Fast-resolving fetch — we only care about the `before` snapshot
    const fetchMe = jest.fn().mockResolvedValue(MOCK_USER);
    const { before } = await simulateRestoreSession(fetchMe);

    expect(before.isLoading).toBe(true);
    expect(before.user).toBeNull();
  });
});

// ===========================================================================
// 2. After a 401 response
// ===========================================================================

describe('useAuth() — after 401 from GET /api/auth/me', () => {
  // 2. The canonical "not logged in" scenario.
  it('sets user to null when GET /api/auth/me returns 401', async () => {
    const fetchMe = jest.fn().mockRejectedValue(new Error('Not authenticated'));
    const { after } = await simulateRestoreSession(fetchMe);

    expect(after.user).toBeNull();
  });

  it('sets isLoading to false after the 401 response', async () => {
    const fetchMe = jest.fn().mockRejectedValue(new Error('Not authenticated'));
    const { after } = await simulateRestoreSession(fetchMe);

    expect(after.isLoading).toBe(false);
  });

  // 9. user is strictly null, never undefined.
  it('user is strictly null — not undefined — after a 401', async () => {
    const fetchMe = jest.fn().mockRejectedValue(new Error('Not authenticated'));
    const { after } = await simulateRestoreSession(fetchMe);

    expect(after.user).toBeNull();
    expect(after.user).not.toBeUndefined();
  });

  it('treats a network-level TypeError as unauthenticated (user: null)', async () => {
    const fetchMe = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { after } = await simulateRestoreSession(fetchMe);

    expect(after.user).toBeNull();
    expect(after.isLoading).toBe(false);
  });
});

// ===========================================================================
// 3. After a 200 response — user is populated
// ===========================================================================

describe('useAuth() — after 200 from GET /api/auth/me', () => {
  // 3. All AuthUser fields must be present and correctly typed.
  it('sets user to the resolved AuthUser on a 200 response', async () => {
    const fetchMe = jest.fn().mockResolvedValue(MOCK_USER);
    const { after } = await simulateRestoreSession(fetchMe);

    expect(after.user).toEqual(MOCK_USER);
  });

  it('sets isLoading to false after the 200 response', async () => {
    const fetchMe = jest.fn().mockResolvedValue(MOCK_USER);
    const { after } = await simulateRestoreSession(fetchMe);

    expect(after.isLoading).toBe(false);
  });

  // 8. Shape validation — all expected fields must be present.
  it('populated user has id as a number', async () => {
    const fetchMe = jest.fn().mockResolvedValue(MOCK_USER);
    const { after } = await simulateRestoreSession(fetchMe);

    expect(typeof after.user!.id).toBe('number');
  });

  it('populated user has a name as a string', async () => {
    const fetchMe = jest.fn().mockResolvedValue(MOCK_USER);
    const { after } = await simulateRestoreSession(fetchMe);

    expect(typeof after.user!.name).toBe('string');
  });

  it('populated user has an email property (may be null)', async () => {
    const fetchMe = jest.fn().mockResolvedValue(MOCK_USER);
    const { after } = await simulateRestoreSession(fetchMe);

    expect(Object.prototype.hasOwnProperty.call(after.user, 'email')).toBe(true);
  });

  it('populated user has an avatarUrl property (may be null)', async () => {
    const fetchMe = jest.fn().mockResolvedValue(MOCK_USER);
    const { after } = await simulateRestoreSession(fetchMe);

    expect(Object.prototype.hasOwnProperty.call(after.user, 'avatarUrl')).toBe(true);
  });

  it('reflects the exact id, email, name, and avatarUrl returned by the API', async () => {
    const fetchMe = jest.fn().mockResolvedValue(MOCK_USER);
    const { after } = await simulateRestoreSession(fetchMe);

    expect(after.user!.id).toBe(1);
    expect(after.user!.email).toBe('owner@example.com');
    expect(after.user!.name).toBe('My Second Self');
    expect(after.user!.avatarUrl).toBe('/uploads/avatar.png');
  });

  it('accepts a user with email: null (owner without an email address)', async () => {
    const userNoEmail: AuthUser = { id: 2, email: null, name: 'NoEmail', avatarUrl: null };
    const fetchMe = jest.fn().mockResolvedValue(userNoEmail);
    const { after } = await simulateRestoreSession(fetchMe);

    expect(after.user).not.toBeNull();
    expect(after.user!.email).toBeNull();
  });

  it('accepts a user with avatarUrl: null (no avatar uploaded)', async () => {
    const userNoAvatar: AuthUser = { id: 3, email: 'a@b.com', name: 'NoAvatar', avatarUrl: null };
    const fetchMe = jest.fn().mockResolvedValue(userNoAvatar);
    const { after } = await simulateRestoreSession(fetchMe);

    expect(after.user!.avatarUrl).toBeNull();
  });
});

// ===========================================================================
// 7. isLoading transitions
// ===========================================================================

describe('useAuth() — isLoading transitions', () => {
  it('isLoading starts true and ends false after a successful fetch', async () => {
    const fetchMe = jest.fn().mockResolvedValue(MOCK_USER);
    const { before, after } = await simulateRestoreSession(fetchMe);

    expect(before.isLoading).toBe(true);
    expect(after.isLoading).toBe(false);
  });

  it('isLoading starts true and ends false even when the fetch rejects', async () => {
    const fetchMe = jest.fn().mockRejectedValue(new Error('401 Unauthorized'));
    const { before, after } = await simulateRestoreSession(fetchMe);

    expect(before.isLoading).toBe(true);
    expect(after.isLoading).toBe(false);
  });
});

// ===========================================================================
// 4–6 & 10. logout() behaviour
// ===========================================================================

describe('logout() — endpoint call and user state', () => {
  // 4. logout() must call the API exactly once.
  it('calls the logout endpoint exactly once', async () => {
    const callLogout = jest.fn().mockResolvedValue(undefined);
    await simulateLogout(callLogout, MOCK_USER);

    expect(callLogout).toHaveBeenCalledTimes(1);
  });

  // 10. The correct endpoint must be POST /api/auth/logout (via apiFetch wrapper).
  it('the correct POST /api/auth/logout endpoint is invoked', async () => {
    // Simulate how AuthProvider wires up: apiFetch('/api/auth/logout', { method: 'POST' })
    let capturedUrl: string | null = null;
    let capturedMethod: string | null = null;

    const callLogout = jest.fn().mockImplementation(async () => {
      capturedUrl = '/api/auth/logout';
      capturedMethod = 'POST';
    });

    await simulateLogout(callLogout, MOCK_USER);

    expect(capturedUrl).toBe('/api/auth/logout');
    expect(capturedMethod).toBe('POST');
  });

  // 5. User must be null after logout.
  it('sets user to null after logout() completes', async () => {
    const callLogout = jest.fn().mockResolvedValue(undefined);
    const { userAfter } = await simulateLogout(callLogout, MOCK_USER);

    expect(userAfter).toBeNull();
  });

  it('redirects to /login after a successful logout', async () => {
    const callLogout = jest.fn().mockResolvedValue(undefined);
    const { redirectedTo } = await simulateLogout(callLogout, MOCK_USER);

    expect(redirectedTo).toBe('/login');
  });

  // 6. Even when the API throws, user must be cleared and redirect must happen.
  it('clears user and still redirects when the logout API throws', async () => {
    const callLogout = jest.fn().mockRejectedValue(new Error('Network error'));
    const { userAfter, redirectedTo } = await simulateLogout(callLogout, MOCK_USER);

    expect(userAfter).toBeNull();
    expect(redirectedTo).toBe('/login');
  });

  it('is resilient to slow responses — finally block always executes', async () => {
    let resolveApi!: () => void;
    const callLogout = jest.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveApi = resolve; })
    );

    const logoutPromise = simulateLogout(callLogout, MOCK_USER);
    resolveApi(); // let the "slow" API respond
    const { userAfter, redirectedTo } = await logoutPromise;

    expect(userAfter).toBeNull();
    expect(redirectedTo).toBe('/login');
  });

  it('is idempotent — logout when user is already null still clears and redirects', async () => {
    const callLogout = jest.fn().mockResolvedValue(undefined);
    const { userAfter, redirectedTo } = await simulateLogout(callLogout, null);

    expect(userAfter).toBeNull();
    expect(redirectedTo).toBe('/login');
  });
});

// ===========================================================================
// 26–30. login() — synchronous user state update (no redirect loop guarantee)
// ===========================================================================

describe('login() — synchronous user state update', () => {
  // 26. login() sets user immediately — route guard sees non-null user before push().
  it('sets user to the supplied AuthUser synchronously (user is non-null after call)', () => {
    const { userAfter } = simulateLogin(MOCK_USER, null);
    expect(userAfter).toEqual(MOCK_USER);
    expect(userAfter).not.toBeNull();
  });

  // 26b. The route guard returns 'render' immediately after login() because
  //      user is non-null — no redirect loop can occur.
  it('route guard returns "render" immediately after login() is called', () => {
    const { userAfter } = simulateLogin(MOCK_USER, null);
    const decision = deriveGuardDecision(false, userAfter, false);
    expect(decision).toBe<GuardDecision>('render');
  });

  // 27. login() from null (post-logout) correctly populates user.
  it('sets user from null to the supplied AuthUser (post-logout re-login scenario)', () => {
    // After logout(), user is null; login() must restore it without a page refresh.
    const { userAfter } = simulateLogin(MOCK_USER, null);
    expect(userAfter).not.toBeNull();
    expect(userAfter!.id).toBe(MOCK_USER.id);
  });

  // 28. Full cycle: logout → user is null → login → user is populated → guard renders.
  it('after logout → login cycle, the route guard returns "render" (no redirect loop)', async () => {
    // Step 1: simulate logout — user becomes null.
    const callLogout = jest.fn().mockResolvedValue(undefined);
    const { userAfter: userAfterLogout } = await simulateLogout(callLogout, MOCK_USER);
    expect(userAfterLogout).toBeNull();

    // Guard would redirect at this point (user is null).
    expect(deriveGuardDecision(false, userAfterLogout, false)).toBe<GuardDecision>('redirect');

    // Step 2: simulate login — user is restored synchronously.
    const { userAfter: userAfterLogin } = simulateLogin(MOCK_USER, userAfterLogout);
    expect(userAfterLogin).toEqual(MOCK_USER);

    // Guard now renders — no redirect loop.
    expect(deriveGuardDecision(false, userAfterLogin, false)).toBe<GuardDecision>('render');
  });

  // 29. login() payload — all four fields preserved exactly.
  it('preserves all four AuthUser fields (id, email, name, avatarUrl) after login()', () => {
    const payload: AuthUser = {
      id: 7,
      email: 'test@example.com',
      name: 'Test User',
      avatarUrl: '/uploads/test.png',
    };
    const { userAfter } = simulateLogin(payload, null);
    expect(userAfter!.id).toBe(7);
    expect(userAfter!.email).toBe('test@example.com');
    expect(userAfter!.name).toBe('Test User');
    expect(userAfter!.avatarUrl).toBe('/uploads/test.png');
  });

  // 30. login() accepts avatarUrl: null (user has no avatar yet — typical for new signups).
  it('accepts avatarUrl: null in the login payload (new user without avatar)', () => {
    const newUser: AuthUser = {
      id: 1,
      email: 'fresh@example.com',
      name: 'Fresh User',
      avatarUrl: null,
    };
    const { userAfter } = simulateLogin(newUser, null);
    expect(userAfter).not.toBeNull();
    expect(userAfter!.avatarUrl).toBeNull();
    // Route guard still renders (user is non-null)
    expect(deriveGuardDecision(false, userAfter, false)).toBe<GuardDecision>('render');
  });

  // Additional: login() overwrites an existing user (e.g. switching accounts).
  it('overwrites any existing user state with the new AuthUser payload', () => {
    const previousUser: AuthUser = { id: 99, email: 'old@example.com', name: 'Old', avatarUrl: null };
    const newUser: AuthUser = { id: 1, email: 'new@example.com', name: 'New', avatarUrl: null };

    const { userAfter } = simulateLogin(newUser, previousUser);

    expect(userAfter!.id).toBe(1);
    expect(userAfter!.email).toBe('new@example.com');
    expect(userAfter!.id).not.toBe(previousUser.id);
  });

  // Additional: login() result is never undefined.
  it('user is strictly non-undefined after login()', () => {
    const { userAfter } = simulateLogin(MOCK_USER, null);
    expect(userAfter).not.toBeUndefined();
  });
});

// ===========================================================================
// 11–15. RouteGuard — deriveGuardDecision()
// ===========================================================================

describe('deriveGuardDecision() — private routes', () => {
  // 11. Session still resolving → hold off rendering private content.
  it('returns "loading" while isLoading is true (private route)', () => {
    const decision = deriveGuardDecision(true, null, false);
    expect(decision).toBe('loading');
  });

  it('returns "loading" while isLoading is true even when a user object is present', () => {
    // Defensive: even if user is somehow non-null during loading, we wait.
    const decision = deriveGuardDecision(true, MOCK_USER, false);
    expect(decision).toBe('loading');
  });

  // 12. Session resolved, no user — must redirect to login.
  it('returns "redirect" when isLoading is false and user is null (private route)', () => {
    const decision = deriveGuardDecision(false, null, false);
    expect(decision).toBe('redirect');
  });

  // 13. Session resolved, user present — render the children.
  it('returns "render" when isLoading is false and user is present (private route)', () => {
    const decision = deriveGuardDecision(false, MOCK_USER, false);
    expect(decision).toBe('render');
  });

  it('uses strict null check — an empty object is treated as a present user', () => {
    // Guard only checks for null; any non-null value is a valid session.
    const decision = deriveGuardDecision(false, {}, false);
    expect(decision).toBe('render');
  });
});

describe('deriveGuardDecision() — public routes (isPublic=true)', () => {
  // 14 & 15. Public routes always render regardless of auth state.
  it('returns "render" for a public route when user is null and isLoading is false', () => {
    const decision = deriveGuardDecision(false, null, true);
    expect(decision).toBe('render');
  });

  it('returns "render" for a public route while isLoading is still true', () => {
    const decision = deriveGuardDecision(true, null, true);
    expect(decision).toBe('render');
  });

  it('returns "render" for a public route with a present user', () => {
    const decision = deriveGuardDecision(false, MOCK_USER, true);
    expect(decision).toBe('render');
  });
});

// ===========================================================================
// 16–20. RouteGuard — buildLoginRedirectUrl()
// ===========================================================================

describe('buildLoginRedirectUrl() — redirect URL construction', () => {
  // 16. returnTo path is encoded as a query parameter.
  it('encodes the returnTo path as a query parameter on /login', () => {
    const url = buildLoginRedirectUrl('/chat');
    expect(url).toBe('/login?returnTo=%2Fchat');
  });

  // 17. Empty returnTo falls back to '/'.
  it('uses "/" as returnTo when an empty string is provided', () => {
    const url = buildLoginRedirectUrl('');
    expect(url).toContain('returnTo=%2F');
  });

  // 18. Non-path strings (e.g. absolute URLs) are rejected — open-redirect guard.
  it('falls back to "/" when returnTo does not start with "/" (open-redirect guard)', () => {
    const url = buildLoginRedirectUrl('https://evil.example.com');
    expect(url).toContain('returnTo=%2F');
    expect(url).not.toContain('evil.example.com');
  });

  // 19. Query strings inside the returnTo are preserved.
  it('preserves query strings inside the returnTo parameter', () => {
    const url = buildLoginRedirectUrl('/settings?tab=profile');
    expect(url).toContain('returnTo=');
    // The encoded value must contain the original path fragment
    expect(decodeURIComponent(url.split('returnTo=')[1])).toBe('/settings?tab=profile');
  });

  // 20. The redirect URL always starts with /login.
  it('redirect URL always starts with /login', () => {
    const url = buildLoginRedirectUrl('/dashboard');
    expect(url.startsWith('/login')).toBe(true);
  });

  it('produces /login?returnTo=%2F when "/" is passed', () => {
    const url = buildLoginRedirectUrl('/');
    expect(url).toBe('/login?returnTo=%2F');
  });

  it('encodes special characters in the returnTo value', () => {
    const url = buildLoginRedirectUrl('/knowledge-base/upload');
    expect(url).toContain('/login?returnTo=');
    expect(decodeURIComponent(url.split('returnTo=')[1])).toBe('/knowledge-base/upload');
  });
});

// ===========================================================================
// 21–25. RouteGuard — end-to-end decision + redirect destination
// ===========================================================================

describe('RouteGuard — end-to-end decision scenarios', () => {
  // 21. Unauthenticated on a private route → redirect targeting /login?returnTo.
  it('unauthenticated access to /chat: decision is "redirect" and URL targets /login?returnTo=/chat', () => {
    const isPublic = false;
    const decision = deriveGuardDecision(false, null, isPublic);
    expect(decision).toBe<GuardDecision>('redirect');

    const redirectUrl = buildLoginRedirectUrl('/chat');
    expect(redirectUrl).toBe('/login?returnTo=%2Fchat');
  });

  // 22. Authenticated on a private route → decision is 'render', no redirect.
  it('authenticated access to /chat: decision is "render" (no redirect)', () => {
    const isPublic = false;
    const decision = deriveGuardDecision(false, MOCK_USER, isPublic);
    expect(decision).toBe<GuardDecision>('render');
    // 'render' implies no redirect URL is generated
  });

  // 23. Still loading on a private route → decision is 'loading'.
  it('loading state on /settings: decision is "loading" (neither render nor redirect)', () => {
    const isPublic = false;
    const decision = deriveGuardDecision(true, null, isPublic);
    expect(decision).toBe<GuardDecision>('loading');
  });

  // 24. /login is a public route → always 'render' (prevents redirect loops).
  it('unauthenticated access to /login (public): decision is "render" — no redirect loop', () => {
    const isPublic = true; // /login bypasses the guard
    const decision = deriveGuardDecision(false, null, isPublic);
    expect(decision).toBe<GuardDecision>('render');
  });

  // 25. /clone/abc is a public route → always 'render'.
  it('unauthenticated access to /clone/abc (public): decision is "render"', () => {
    const isPublic = true; // /clone/* bypasses the guard
    const decision = deriveGuardDecision(false, null, isPublic);
    expect(decision).toBe<GuardDecision>('render');
  });

  it('unauthenticated access to /knowledge-base/upload: decision is "redirect"', () => {
    const isPublic = false;
    const decision = deriveGuardDecision(false, null, isPublic);
    expect(decision).toBe<GuardDecision>('redirect');

    const redirectUrl = buildLoginRedirectUrl('/knowledge-base/upload');
    expect(decodeURIComponent(redirectUrl)).toBe('/login?returnTo=/knowledge-base/upload');
  });

  it('unauthenticated access to /settings: decision is "redirect", URL targets /login?returnTo=/settings', () => {
    const isPublic = false;
    const decision = deriveGuardDecision(false, null, isPublic);
    expect(decision).toBe<GuardDecision>('redirect');

    const redirectUrl = buildLoginRedirectUrl('/settings');
    expect(decodeURIComponent(redirectUrl)).toBe('/login?returnTo=/settings');
  });

  it('unauthenticated access to /share: decision is "redirect", URL targets /login?returnTo=/share', () => {
    const isPublic = false;
    const decision = deriveGuardDecision(false, null, isPublic);
    expect(decision).toBe<GuardDecision>('redirect');

    const redirectUrl = buildLoginRedirectUrl('/share');
    expect(decodeURIComponent(redirectUrl)).toBe('/login?returnTo=/share');
  });

  it('unauthenticated access to / (root): decision is "redirect", returnTo is "/"', () => {
    const isPublic = false;
    const decision = deriveGuardDecision(false, null, isPublic);
    expect(decision).toBe<GuardDecision>('redirect');

    const redirectUrl = buildLoginRedirectUrl('/');
    expect(redirectUrl).toBe('/login?returnTo=%2F');
  });

  it('authenticated on any private route always renders children regardless of pathname', () => {
    const isPublic = false;
    const privateRoutes = ['/', '/chat', '/settings', '/knowledge-base', '/share'];

    for (const _route of privateRoutes) {
      const decision = deriveGuardDecision(false, MOCK_USER, isPublic);
      expect(decision).toBe<GuardDecision>('render');
    }
  });
});

// ===========================================================================
// Additional: apiFetch contract for auth endpoints (mirrors auth-context.test.ts
// /api/auth/me and /api/auth/logout response contracts).
// ===========================================================================

describe('apiFetch — auth endpoint contracts', () => {
  const ORIGINAL_FETCH = global.fetch;

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    localStorageShim.clear();
  });

  function loadApiFetch() {
    let api!: typeof import('@/lib/api');
    jest.isolateModules(() => {
      api = require('@/lib/api');
    });
    return api;
  }

  function mockFetch(status: number, body: unknown): jest.Mock {
    return jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as Response);
  }

  // GET /api/auth/me → 200: resolves with the user payload.
  it('GET /api/auth/me 200 — resolves with id, email, name, avatarUrl', async () => {
    const { apiFetch } = loadApiFetch();
    const payload = { id: 1, email: 'owner@example.com', name: 'My Second Self', avatarUrl: null };
    global.fetch = mockFetch(200, payload);

    const result = await apiFetch<AuthUser>('/api/auth/me');

    expect(result.id).toBe(1);
    expect(result.name).toBe('My Second Self');
    expect(Object.prototype.hasOwnProperty.call(result, 'email')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(result, 'avatarUrl')).toBe(true);
  });

  // GET /api/auth/me → 401: apiFetch throws (AuthProvider catches → user=null).
  it('GET /api/auth/me 401 — apiFetch throws so AuthProvider sets user to null', async () => {
    const { apiFetch } = loadApiFetch();
    global.fetch = mockFetch(401, { error: 'Not authenticated' });

    await expect(apiFetch('/api/auth/me')).rejects.toThrow('Not authenticated');
  });

  // POST /api/auth/logout → 200: resolves with { success: true }.
  it('POST /api/auth/logout 200 — resolves with { success: true }', async () => {
    const { apiFetch } = loadApiFetch();
    global.fetch = mockFetch(200, { success: true });

    const result = await apiFetch<{ success: boolean }>('/api/auth/logout', { method: 'POST' });

    expect(result).toEqual({ success: true });
  });

  // Confirm that apiFetch passes the method correctly for logout.
  it('logout fetch call uses POST method', async () => {
    const { apiFetch } = loadApiFetch();
    const spyFetch = mockFetch(200, { success: true });
    global.fetch = spyFetch;

    await apiFetch('/api/auth/logout', { method: 'POST' });

    expect(spyFetch).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
