/**
 * Unit tests for the Sidebar avatar feature.
 *
 * Acceptance criteria verified:
 *  1. getAvatarUrl() returns null before any value is set
 *  2. setAvatarUrl() updates the stored value and notifies listeners
 *  3. subscribeAvatarUrl() receives the URL on every subsequent setAvatarUrl call
 *  4. The unsubscribe function stops future notifications
 *  5. Multiple listeners are all notified independently
 *  6. Setting null clears the store and notifies listeners with null
 *  7. getAvatarUrl() seeds the initial state (reflects the last set value)
 *  8. apiFetch injects x-openai-api-key header when a key is stored
 *  9. apiFetch throws on non-2xx responses with the server error message
 * 10. apiFetch falls back to a generic message when the body is not parseable
 * 11. apiFetch does not set Content-Type for FormData bodies
 * 12. apiFetch sets Content-Type: application/json for plain-object bodies
 */

// ---------------------------------------------------------------------------
// Browser globals shim for the Node test environment
// ---------------------------------------------------------------------------
//
// jest-environment-node does not provide window or localStorage.
// We install minimal shims on `global` so that code guarded by
// `typeof window === 'undefined'` behaves as it would in a browser.

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

// Provide `window` so the `typeof window === 'undefined'` guards in api.ts
// behave as they would in a browser context.
if (typeof (global as any).window === 'undefined') {
  (global as any).window = global;
}

Object.defineProperty(global, 'localStorage', {
  value: localStorageShim,
  writable: true,
  configurable: true,
});

// ---------------------------------------------------------------------------
// avatar-store tests
// ---------------------------------------------------------------------------
//
// The store is a module-level singleton.  We re-import it fresh inside each
// test via jest.isolateModules() to guarantee a clean slate and prevent
// inter-test pollution (shared `listeners` Set and `currentUrl` variable).

describe('avatar-store — getAvatarUrl / setAvatarUrl / subscribeAvatarUrl', () => {
  /** Load the store in an isolated module registry so state is always fresh. */
  function loadStore() {
    let store!: typeof import('@/lib/avatar-store');
    jest.isolateModules(() => {
      store = require('@/lib/avatar-store');
    });
    return store;
  }

  // 1. Initial state is null
  it('getAvatarUrl() returns null before any value is set', () => {
    const { getAvatarUrl } = loadStore();
    expect(getAvatarUrl()).toBeNull();
  });

  // 2. setAvatarUrl updates stored value
  it('setAvatarUrl() updates the stored value', () => {
    const { getAvatarUrl, setAvatarUrl } = loadStore();
    setAvatarUrl('/uploads/avatar.jpg');
    expect(getAvatarUrl()).toBe('/uploads/avatar.jpg');
  });

  // 2. setAvatarUrl notifies a subscribed listener
  it('setAvatarUrl() notifies a subscribed listener with the new URL', () => {
    const { setAvatarUrl, subscribeAvatarUrl } = loadStore();
    const listener = jest.fn();
    subscribeAvatarUrl(listener);
    setAvatarUrl('/uploads/new.png');
    expect(listener).toHaveBeenCalledWith('/uploads/new.png');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  // 3. Listener receives all subsequent updates
  it('subscribeAvatarUrl() listener is called on every setAvatarUrl call', () => {
    const { setAvatarUrl, subscribeAvatarUrl } = loadStore();
    const listener = jest.fn();
    subscribeAvatarUrl(listener);

    setAvatarUrl('/uploads/first.jpg');
    setAvatarUrl('/uploads/second.jpg');

    expect(listener).toHaveBeenNthCalledWith(1, '/uploads/first.jpg');
    expect(listener).toHaveBeenNthCalledWith(2, '/uploads/second.jpg');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  // 4. Unsubscribe stops future notifications
  it('the unsubscribe function stops further notifications', () => {
    const { setAvatarUrl, subscribeAvatarUrl } = loadStore();
    const listener = jest.fn();
    const unsubscribe = subscribeAvatarUrl(listener);

    setAvatarUrl('/uploads/before.jpg');
    unsubscribe();
    setAvatarUrl('/uploads/after.jpg');

    // Listener should only have been called once (before unsubscribe)
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('/uploads/before.jpg');
  });

  // 5. Multiple listeners all notified
  it('notifies multiple independent listeners', () => {
    const { setAvatarUrl, subscribeAvatarUrl } = loadStore();
    const listenerA = jest.fn();
    const listenerB = jest.fn();
    subscribeAvatarUrl(listenerA);
    subscribeAvatarUrl(listenerB);

    setAvatarUrl('/uploads/shared.png');

    expect(listenerA).toHaveBeenCalledWith('/uploads/shared.png');
    expect(listenerB).toHaveBeenCalledWith('/uploads/shared.png');
  });

  // 6. Setting null clears the store and notifies with null
  it('setAvatarUrl(null) clears the stored URL and notifies listeners with null', () => {
    const { getAvatarUrl, setAvatarUrl, subscribeAvatarUrl } = loadStore();
    const listener = jest.fn();
    subscribeAvatarUrl(listener);

    setAvatarUrl('/uploads/avatar.jpg');
    setAvatarUrl(null);

    expect(getAvatarUrl()).toBeNull();
    expect(listener).toHaveBeenLastCalledWith(null);
  });

  // 7. getAvatarUrl reflects the last set value
  it('getAvatarUrl() reflects the last value set by setAvatarUrl()', () => {
    const { getAvatarUrl, setAvatarUrl } = loadStore();
    setAvatarUrl('/uploads/first.jpg');
    setAvatarUrl('/uploads/second.jpg');
    expect(getAvatarUrl()).toBe('/uploads/second.jpg');
  });

  // Calling unsubscribe twice is a safe no-op
  it('calling an unsubscribe function twice does not throw', () => {
    const { setAvatarUrl, subscribeAvatarUrl } = loadStore();
    const listener = jest.fn();
    const unsubscribe = subscribeAvatarUrl(listener);
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });

  // Unsubscribing one listener does not affect others
  it('unsubscribing one listener does not affect sibling listeners', () => {
    const { setAvatarUrl, subscribeAvatarUrl } = loadStore();
    const listenerA = jest.fn();
    const listenerB = jest.fn();
    const unsubA = subscribeAvatarUrl(listenerA);
    subscribeAvatarUrl(listenerB);

    unsubA();
    setAvatarUrl('/uploads/only-b.jpg');

    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalledWith('/uploads/only-b.jpg');
  });
});

// ---------------------------------------------------------------------------
// apiFetch tests
// ---------------------------------------------------------------------------
//
// We mock the global fetch and use our localStorage shim (installed above).

describe('apiFetch', () => {
  const ORIGINAL_FETCH = global.fetch;

  afterEach(() => {
    // Restore fetch and clear localStorage after each test
    global.fetch = ORIGINAL_FETCH;
    localStorageShim.clear();
  });

  /** Load apiFetch in an isolated module registry to avoid stale localStorage state. */
  function loadApiFetch() {
    let api!: typeof import('@/lib/api');
    jest.isolateModules(() => {
      api = require('@/lib/api');
    });
    return api;
  }

  /** Build a mock fetch that resolves with the given status and body. */
  function mockFetch(status: number, body: unknown): jest.Mock {
    return jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as Response);
  }

  // 8. API key header is injected
  it('sets x-openai-api-key header when a key is stored in localStorage', async () => {
    const { apiFetch, setStoredApiKey } = loadApiFetch();
    setStoredApiKey('sk-test-key');

    const fetchMock = mockFetch(200, { ok: true });
    global.fetch = fetchMock;

    await apiFetch('/api/test');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get('x-openai-api-key')).toBe('sk-test-key');
  });

  it('does NOT set x-openai-api-key header when no key is stored', async () => {
    const { apiFetch } = loadApiFetch();
    // localStorage is already clear (afterEach handles it; fresh run starts empty)

    const fetchMock = mockFetch(200, {});
    global.fetch = fetchMock;

    await apiFetch('/api/test');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.has('x-openai-api-key')).toBe(false);
  });

  // 9. Throws on non-2xx using server error message
  it('throws with the server error message on a 400 response', async () => {
    const { apiFetch } = loadApiFetch();

    global.fetch = mockFetch(400, { error: 'File too large' });

    await expect(apiFetch('/api/upload')).rejects.toThrow('File too large');
  });

  it('throws with the server error message on a 500 response', async () => {
    const { apiFetch } = loadApiFetch();

    global.fetch = mockFetch(500, { error: 'Internal server error' });

    await expect(apiFetch('/api/fail')).rejects.toThrow('Internal server error');
  });

  // 10. Falls back to generic message when body is not parseable JSON
  it('throws a generic message when the error response body is not valid JSON', async () => {
    const { apiFetch } = loadApiFetch();

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    } as unknown as Response);

    await expect(apiFetch('/api/fail')).rejects.toThrow('Request failed (503)');
  });

  // 11. FormData bodies — no Content-Type override
  it('does NOT set Content-Type header for FormData bodies', async () => {
    const { apiFetch } = loadApiFetch();

    const fetchMock = mockFetch(200, { avatarUrl: '/uploads/x.jpg' });
    global.fetch = fetchMock;

    const formData = new FormData();
    formData.append('image', new Blob(['data'], { type: 'image/jpeg' }), 'photo.jpg');

    await apiFetch('/api/settings/avatar', { method: 'POST', body: formData });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    // The browser must set Content-Type with the multipart boundary automatically
    expect(headers.has('content-type')).toBe(false);
  });

  // 12. JSON bodies — Content-Type is set automatically
  it('sets Content-Type: application/json for stringified JSON bodies', async () => {
    const { apiFetch } = loadApiFetch();

    const fetchMock = mockFetch(200, { ok: true });
    global.fetch = fetchMock;

    await apiFetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ cloneName: 'Alice' }),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get('content-type')).toBe('application/json');
  });

  // Returns parsed response body on success
  it('returns the parsed JSON body on a successful response', async () => {
    const { apiFetch } = loadApiFetch();

    const payload = { avatarUrl: '/uploads/result.png' };
    global.fetch = mockFetch(200, payload);

    const result = await apiFetch<{ avatarUrl: string }>('/api/settings/avatar', {
      method: 'POST',
    });

    expect(result).toEqual(payload);
  });

  // getStoredApiKey returns null when nothing is stored
  it('getStoredApiKey() returns null when localStorage is empty', () => {
    const { getStoredApiKey } = loadApiFetch();
    expect(getStoredApiKey()).toBeNull();
  });

  // setStoredApiKey persists value readable by getStoredApiKey
  it('setStoredApiKey() persists and getStoredApiKey() reads the value', () => {
    const { getStoredApiKey, setStoredApiKey } = loadApiFetch();
    setStoredApiKey('sk-my-key');
    expect(getStoredApiKey()).toBe('sk-my-key');
  });
});
