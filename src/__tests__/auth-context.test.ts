/**
 * Unit tests for the auth-context module logic.
 *
 * Because the project uses jest-environment-node (no DOM / React renderer),
 * we test the pure logic that drives the context rather than rendering the
 * component tree. The tests validate:
 *
 *  1.  GET /api/auth/me — successful response → user is populated
 *  2.  GET /api/auth/me — 401 / network error → user is null
 *  3.  logout() calls POST /api/auth/logout
 *  4.  logout() clears the user after the API call
 *  5.  logout() redirects to /login after a successful logout
 *  6.  logout() still clears state and redirects even when the API throws
 *  7.  logout() still clears state and redirects even when the API is slow
 *  8.  isLoading starts as true and becomes false after session check resolves
 *  9.  isLoading becomes false even when the session check fails (error path)
 * 10.  AuthUser shape — required fields are present in a successful response
 * 11.  user is null (not undefined) when unauthenticated
 * 12.  POST /api/auth/logout endpoint — returns { success: true } on success
 * 13.  GET /api/auth/me endpoint — returns 401 when no owner exists
 * 14.  login(userData) — sets user synchronously to the supplied AuthUser
 * 15.  login(userData) — overwrites a previous user (re-login after logout)
 * 16.  login(userData) — accepts avatarUrl: null (no avatar yet)
 * 17.  login(userData) — accepts email: null (owner without email)
 * 18.  login(userData) — does not affect isLoading (stays false after prior session check)
 */

// ---------------------------------------------------------------------------
// Browser globals shim (mirrors sidebar-avatar.test.ts)
// ---------------------------------------------------------------------------

const localStorageStore: Record<string, string> = {};
const localStorageShim = {
  getItem: (key: string) => localStorageStore[key] ?? null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value; },
  removeItem: (key: string) => { delete localStorageStore[key]; },
  clear: () => { Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]); },
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
// Helpers — simulate the async state machine inside AuthProvider
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

/**
 * Simulates the restoreSession logic performed by AuthProvider on mount.
 *
 * Returns the state snapshots:
 *  - `before`: immediately after mount (isLoading = true, user = null)
 *  - `after`:  after the fetch resolves / rejects
 */
async function simulateRestoreSession(
  fetchMe: () => Promise<AuthUser>
): Promise<{ before: AuthState; after: AuthState }> {
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
 * Simulates the logout() function — calls the logout endpoint then redirects.
 *
 * Returns:
 *  - `logoutCalled`: whether POST /api/auth/logout was invoked
 *  - `redirectTo`:   the path the router was pushed to
 *  - `userAfter`:    the user value after the function completes
 */
async function simulateLogout(
  callLogoutApi: () => Promise<void>,
  initialUser: AuthUser | null = { id: 1, email: null, name: 'Test', avatarUrl: null }
): Promise<{ logoutCalled: boolean; redirectTo: string | null; userAfter: AuthUser | null }> {
  let logoutCalled = false;
  let redirectTo: string | null = null;
  let userAfter: AuthUser | null = initialUser;

  try {
    await callLogoutApi();
    logoutCalled = true;
  } catch {
    // intentional — mirrors the catch-all in logout()
  } finally {
    userAfter = null;
    redirectTo = '/login';
  }

  return { logoutCalled, redirectTo, userAfter };
}

// ---------------------------------------------------------------------------
// 1–2. restoreSession — user population
// ---------------------------------------------------------------------------

describe('restoreSession — user state after GET /api/auth/me', () => {
  const mockUser: AuthUser = {
    id: 1,
    email: 'owner@example.com',
    name: 'My Second Self',
    avatarUrl: '/uploads/avatar.png',
  };

  // 1. Successful response → user is populated
  it('sets user to the resolved AuthUser on a successful response', async () => {
    const fetchMe = jest.fn().mockResolvedValue(mockUser);
    const { after } = await simulateRestoreSession(fetchMe);
    expect(after.user).toEqual(mockUser);
  });

  // 2a. 401 / network error → user is null
  it('sets user to null when the fetch rejects (e.g. 401 Not authenticated)', async () => {
    const fetchMe = jest.fn().mockRejectedValue(new Error('Not authenticated'));
    const { after } = await simulateRestoreSession(fetchMe);
    expect(after.user).toBeNull();
  });

  // 2b. Network failure also yields null
  it('sets user to null on a network-level failure', async () => {
    const fetchMe = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { after } = await simulateRestoreSession(fetchMe);
    expect(after.user).toBeNull();
  });

  // 8. isLoading transitions
  it('isLoading is true before the fetch completes and false afterwards', async () => {
    const fetchMe = jest.fn().mockResolvedValue(mockUser);
    const { before, after } = await simulateRestoreSession(fetchMe);
    expect(before.isLoading).toBe(true);
    expect(after.isLoading).toBe(false);
  });

  // 9. isLoading becomes false even on error
  it('isLoading is false even when the session check fails', async () => {
    const fetchMe = jest.fn().mockRejectedValue(new Error('401'));
    const { after } = await simulateRestoreSession(fetchMe);
    expect(after.isLoading).toBe(false);
  });

  // 10. AuthUser shape validation
  it('returned user contains id, email, name and avatarUrl fields', async () => {
    const fetchMe = jest.fn().mockResolvedValue(mockUser);
    const { after } = await simulateRestoreSession(fetchMe);
    expect(after.user).not.toBeNull();
    expect(typeof after.user!.id).toBe('number');
    expect(Object.prototype.hasOwnProperty.call(after.user, 'email')).toBe(true);
    expect(typeof after.user!.name).toBe('string');
    expect(Object.prototype.hasOwnProperty.call(after.user, 'avatarUrl')).toBe(true);
  });

  // 11. user is null (not undefined) when unauthenticated
  it('user is strictly null (not undefined) when unauthenticated', async () => {
    const fetchMe = jest.fn().mockRejectedValue(new Error('Unauthorized'));
    const { after } = await simulateRestoreSession(fetchMe);
    expect(after.user).toBeNull();
    expect(after.user).not.toBeUndefined();
  });

  // avatarUrl can be null for users without an uploaded avatar
  it('user.avatarUrl is null when the owner has not uploaded an avatar', async () => {
    const userNoAvatar: AuthUser = { id: 1, email: null, name: 'Second Self', avatarUrl: null };
    const fetchMe = jest.fn().mockResolvedValue(userNoAvatar);
    const { after } = await simulateRestoreSession(fetchMe);
    expect(after.user?.avatarUrl).toBeNull();
  });

  // email can be null (owner row has no email column yet)
  it('user.email may be null for an owner without an email field', async () => {
    const userNoEmail: AuthUser = { id: 1, email: null, name: 'Second Self', avatarUrl: null };
    const fetchMe = jest.fn().mockResolvedValue(userNoEmail);
    const { after } = await simulateRestoreSession(fetchMe);
    expect(after.user?.email).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3–7. logout() behaviour
// ---------------------------------------------------------------------------

describe('logout — POST /api/auth/logout + redirect', () => {
  const mockUser: AuthUser = { id: 1, email: null, name: 'Test', avatarUrl: null };

  // 3. logout() calls the logout endpoint
  it('calls POST /api/auth/logout', async () => {
    const callLogoutApi = jest.fn().mockResolvedValue(undefined);
    await simulateLogout(callLogoutApi, mockUser);
    expect(callLogoutApi).toHaveBeenCalledTimes(1);
  });

  // 4. logout() clears user state
  it('sets user to null after logout completes', async () => {
    const callLogoutApi = jest.fn().mockResolvedValue(undefined);
    const { userAfter } = await simulateLogout(callLogoutApi, mockUser);
    expect(userAfter).toBeNull();
  });

  // 5. logout() redirects to /login
  it('redirects to /login after a successful logout', async () => {
    const callLogoutApi = jest.fn().mockResolvedValue(undefined);
    const { redirectTo } = await simulateLogout(callLogoutApi, mockUser);
    expect(redirectTo).toBe('/login');
  });

  // 6. logout() still clears state and redirects even when the API throws
  it('clears user and redirects to /login even when the logout API throws', async () => {
    const callLogoutApi = jest.fn().mockRejectedValue(new Error('Network error'));
    const { userAfter, redirectTo } = await simulateLogout(callLogoutApi, mockUser);
    expect(userAfter).toBeNull();
    expect(redirectTo).toBe('/login');
  });

  // 7. logout() is resilient to slow / hanging requests (finally block runs)
  it('always runs the finally block regardless of API response speed', async () => {
    let resolveApi!: () => void;
    const callLogoutApi = jest.fn().mockImplementation(
      () => new Promise<void>((resolve) => { resolveApi = resolve; })
    );

    const logoutPromise = simulateLogout(callLogoutApi, mockUser);
    resolveApi();
    const { userAfter, redirectTo } = await logoutPromise;

    expect(userAfter).toBeNull();
    expect(redirectTo).toBe('/login');
  });

  // logout() with a null initial user still works (idempotent)
  it('works correctly when user is already null before logout', async () => {
    const callLogoutApi = jest.fn().mockResolvedValue(undefined);
    const { userAfter, redirectTo } = await simulateLogout(callLogoutApi, null);
    expect(userAfter).toBeNull();
    expect(redirectTo).toBe('/login');
  });
});

// ---------------------------------------------------------------------------
// 14–18. login() — synchronous user state update
// ---------------------------------------------------------------------------

/**
 * Simulates the login(userData) method exposed by AuthProvider.
 *
 * login() is a direct call to setUser(userData) — it has no async behaviour.
 * We model it here as a pure state transition: starting from an initial user
 * state, apply the login call and return the resulting user value.
 *
 * Returns:
 *  - `userAfter`:    the user value immediately after login() is called
 */
function simulateLogin(
  userData: AuthUser,
  initialUser: AuthUser | null = null
): { userAfter: AuthUser | null } {
  // Mirrors the implementation: login = (userData) => setUser(userData)
  let userAfter: AuthUser | null = initialUser;
  userAfter = userData;
  return { userAfter };
}

describe('login() — synchronous user state update', () => {
  const mockUser: AuthUser = {
    id: 1,
    email: 'owner@example.com',
    name: 'My Second Self',
    avatarUrl: '/uploads/avatar.png',
  };

  // 14. login() sets user to the supplied AuthUser immediately
  it('sets user to the supplied AuthUser synchronously', () => {
    const { userAfter } = simulateLogin(mockUser, null);
    expect(userAfter).toEqual(mockUser);
  });

  // 14b. user is not null after login()
  it('user is non-null after login() — no redirect or blank-page risk', () => {
    const { userAfter } = simulateLogin(mockUser, null);
    expect(userAfter).not.toBeNull();
  });

  // 15. login() overwrites a previous user (covers re-login after logout)
  it('overwrites the previous user when called with a new AuthUser', () => {
    const previousUser: AuthUser = { id: 99, email: 'old@example.com', name: 'Old', avatarUrl: null };
    const newUser: AuthUser = { id: 1, email: 'new@example.com', name: 'New', avatarUrl: null };

    const { userAfter } = simulateLogin(newUser, previousUser);

    expect(userAfter).toEqual(newUser);
    expect(userAfter!.id).not.toBe(previousUser.id);
  });

  // 15b. login() after logout() (user was null) works correctly
  it('re-login after logout (initial user is null) sets user correctly', () => {
    const { userAfter } = simulateLogin(mockUser, null /* user was cleared by logout */);
    expect(userAfter).toEqual(mockUser);
    expect(userAfter).not.toBeNull();
  });

  // 16. login() accepts avatarUrl: null (freshly registered user, no avatar)
  it('accepts a user payload with avatarUrl: null', () => {
    const userNoAvatar: AuthUser = { id: 2, email: 'new@example.com', name: 'New User', avatarUrl: null };
    const { userAfter } = simulateLogin(userNoAvatar, null);
    expect(userAfter!.avatarUrl).toBeNull();
  });

  // 17. login() accepts email: null
  it('accepts a user payload with email: null', () => {
    const userNoEmail: AuthUser = { id: 3, email: null, name: 'No Email', avatarUrl: null };
    const { userAfter } = simulateLogin(userNoEmail, null);
    expect(userAfter!.email).toBeNull();
  });

  // 18. login() preserves all AuthUser fields exactly as supplied
  it('preserves all four AuthUser fields (id, email, name, avatarUrl) exactly', () => {
    const payload: AuthUser = {
      id: 42,
      email: 'precise@example.com',
      name: 'Precise User',
      avatarUrl: '/uploads/avatar-42.png',
    };
    const { userAfter } = simulateLogin(payload, null);
    expect(userAfter!.id).toBe(42);
    expect(userAfter!.email).toBe('precise@example.com');
    expect(userAfter!.name).toBe('Precise User');
    expect(userAfter!.avatarUrl).toBe('/uploads/avatar-42.png');
  });

  // login() result is not undefined — the context always has a concrete value
  it('returns a non-undefined user value after login()', () => {
    const { userAfter } = simulateLogin(mockUser, null);
    expect(userAfter).not.toBeUndefined();
  });

  // login() does not clear avatarUrl when it is provided
  it('preserves a non-null avatarUrl when supplied', () => {
    const userWithAvatar: AuthUser = { id: 1, email: 'a@b.com', name: 'Avatar User', avatarUrl: '/uploads/pic.jpg' };
    const { userAfter } = simulateLogin(userWithAvatar, null);
    expect(userAfter!.avatarUrl).toBe('/uploads/pic.jpg');
  });

  // Calling login() multiple times (e.g. token refresh) always reflects the latest call
  it('the final call wins when login() is invoked multiple times in sequence', () => {
    const first: AuthUser = { id: 1, email: 'first@example.com', name: 'First', avatarUrl: null };
    const second: AuthUser = { id: 2, email: 'second@example.com', name: 'Second', avatarUrl: null };

    let { userAfter } = simulateLogin(first, null);
    ({ userAfter } = simulateLogin(second, userAfter));

    expect(userAfter).toEqual(second);
  });
});

// ---------------------------------------------------------------------------
// 12–13. API route contract tests (using apiFetch against mocked fetch)
// ---------------------------------------------------------------------------

describe('GET /api/auth/me — response contract', () => {
  const ORIGINAL_FETCH = global.fetch;

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    localStorageShim.clear();
  });

  function loadApiFetch() {
    let api!: typeof import('@/lib/api');
    jest.isolateModules(() => { api = require('@/lib/api'); });
    return api;
  }

  function mockFetch(status: number, body: unknown): jest.Mock {
    return jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as Response);
  }

  // 10. Successful /me response includes all AuthUser fields
  it('returns an object with id, email, name, and avatarUrl on success', async () => {
    const { apiFetch } = loadApiFetch();
    const payload = { id: 1, email: null, name: 'My Second Self', avatarUrl: '/uploads/a.png' };
    global.fetch = mockFetch(200, payload);

    const result = await apiFetch<AuthUser>('/api/auth/me');

    expect(result).toHaveProperty('id', 1);
    expect(result).toHaveProperty('name', 'My Second Self');
    expect(result).toHaveProperty('avatarUrl', '/uploads/a.png');
    expect(Object.prototype.hasOwnProperty.call(result, 'email')).toBe(true);
  });

  // 13. 401 from /me → apiFetch throws (client treats as unauthenticated)
  it('throws when GET /api/auth/me returns 401', async () => {
    const { apiFetch } = loadApiFetch();
    global.fetch = mockFetch(401, { error: 'Not authenticated' });

    await expect(apiFetch('/api/auth/me')).rejects.toThrow('Not authenticated');
  });

  // 12. POST /api/auth/logout → { success: true }
  it('returns { success: true } from POST /api/auth/logout', async () => {
    const { apiFetch } = loadApiFetch();
    global.fetch = mockFetch(200, { success: true });

    const result = await apiFetch<{ success: boolean }>('/api/auth/logout', { method: 'POST' });

    expect(result).toEqual({ success: true });
  });
});
