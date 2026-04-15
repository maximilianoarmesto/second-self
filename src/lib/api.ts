/**
 * Typed fetch wrapper used throughout the client-side application.
 *
 * Throws an Error with the server's `error` message when the response is
 * not OK (status >= 400), so callers can catch it and surface a message.
 */
export async function apiFetch<T = unknown>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      // Only set Content-Type to JSON when we are not sending FormData
      // (the browser must set the boundary automatically for multipart).
      ...(options?.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...options?.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    const message =
      (data as { error?: string })?.error ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}
