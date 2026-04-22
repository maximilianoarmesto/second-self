// ---------------------------------------------------------------------------
// localStorage helpers for the OpenAI API key
// ---------------------------------------------------------------------------

const OPENAI_API_KEY_STORAGE_KEY = 'openai-api-key';

/**
 * Reads the OpenAI API key from localStorage.
 * Returns `null` when no key has been stored or when called in a non-browser
 * environment (e.g. during SSR or in Jest with the node environment).
 */
export function getStoredApiKey(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(OPENAI_API_KEY_STORAGE_KEY);
}

/**
 * Persists the OpenAI API key to localStorage.
 * Passing an empty string or nullish value removes the stored key.
 */
export function setStoredApiKey(key: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  if (!key) {
    localStorage.removeItem(OPENAI_API_KEY_STORAGE_KEY);
  } else {
    localStorage.setItem(OPENAI_API_KEY_STORAGE_KEY, key);
  }
}

// ---------------------------------------------------------------------------
// Typed fetch wrapper
// ---------------------------------------------------------------------------

/**
 * Typed fetch wrapper used throughout the client-side application.
 *
 * - Automatically injects the `x-openai-api-key` header from localStorage
 *   when a key is stored, so all requests carry it without callers needing
 *   to handle it explicitly.
 * - Uses a `Headers` instance for header construction so consumers can
 *   inspect headers with the standard `.get()` / `.has()` API.
 * - Only sets `Content-Type: application/json` for non-FormData bodies
 *   (the browser must set the multipart boundary automatically for FormData).
 * - Throws an `Error` with the server's `error` message when the response
 *   status is >= 400, so callers can catch and surface a meaningful message.
 */
export async function apiFetch<T = unknown>(
  url: string,
  options?: RequestInit
): Promise<T> {
  // Build a Headers instance so callers (and tests) can use .get() / .has().
  const headers = new Headers(options?.headers);

  // Attach the stored OpenAI API key when present — this allows server-side
  // route handlers to read it without the caller needing to set it explicitly.
  const storedKey = getStoredApiKey();
  if (storedKey) {
    headers.set('x-openai-api-key', storedKey);
  }

  // Set Content-Type for JSON bodies; omit it for FormData so the browser
  // can append the correct multipart boundary automatically.
  if (!(options?.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers,
  });

  // Attempt to parse the response as JSON.  If parsing fails (e.g. the server
  // returned an HTML error page) we fall through to a generic status message.
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    // Successful response with non-JSON body — return undefined cast to T.
    return undefined as T;
  }

  if (!response.ok) {
    const message =
      (data as { error?: string })?.error ||
      `Request failed (${response.status})`;
    throw new Error(message);
  }

  return data as T;
}
