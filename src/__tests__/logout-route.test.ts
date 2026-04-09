/**
 * Unit tests for POST /api/auth/logout route handler.
 *
 * Tests validate:
 *  1.  Returns HTTP 200 OK
 *  2.  Response body is { success: true }
 *  3.  Set-Cookie header is present
 *  4.  The `session` cookie is expired (Max-Age=0)
 *  5.  The cookie has the HttpOnly attribute
 *  6.  The cookie has Path=/
 *  7.  Works regardless of whether a valid session cookie is present
 *  8.  Works when the caller sends an expired / invalid token (no auth required)
 */

import { POST } from '@/app/api/auth/logout/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the Set-Cookie header string into a key→value map of directives.
 * Example: "session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"
 *   → { session: '', Path: '/', 'Max-Age': '0', HttpOnly: true, SameSite: 'Lax' }
 */
function parseCookieHeader(header: string): Record<string, string | boolean> {
  const parts = header.split(';').map((p) => p.trim());
  const result: Record<string, string | boolean> = {};

  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) {
      // Flag directive (e.g. HttpOnly)
      result[part] = true;
    } else {
      result[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim();
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/auth/logout', () => {
  let response: Response;
  let cookieDirectives: Record<string, string | boolean>;

  beforeEach(async () => {
    response = await POST();
    const setCookie = response.headers.get('Set-Cookie') ?? '';
    cookieDirectives = parseCookieHeader(setCookie);
  });

  // 1. HTTP status
  it('returns HTTP 200 OK', () => {
    expect(response.status).toBe(200);
  });

  // 2. Response body
  it('returns { success: true } in the response body', async () => {
    const body = await response.json();
    expect(body).toEqual({ success: true });
  });

  // 3. Set-Cookie header presence
  it('includes a Set-Cookie header in the response', () => {
    expect(response.headers.get('Set-Cookie')).not.toBeNull();
  });

  // 4. Cookie expiry — Max-Age=0 tells the browser to delete it immediately
  it('sets Max-Age=0 on the session cookie to expire it immediately', () => {
    expect(cookieDirectives['Max-Age']).toBe('0');
  });

  // 4b. The cookie name is `session` and its value is empty
  it('clears the `session` cookie value to an empty string', () => {
    expect(Object.prototype.hasOwnProperty.call(cookieDirectives, 'session')).toBe(true);
    expect(cookieDirectives['session']).toBe('');
  });

  // 5. HttpOnly attribute — prevents JavaScript access
  it('sets the HttpOnly attribute on the cookie', () => {
    expect(cookieDirectives['HttpOnly']).toBe(true);
  });

  // 6. Path=/ — ensures the cookie is cleared for all routes
  it('sets Path=/ so the cookie is cleared application-wide', () => {
    expect(cookieDirectives['Path']).toBe('/');
  });

  // 7. Idempotent — calling without a session cookie still succeeds
  it('returns 200 and { success: true } even when no session cookie is provided', async () => {
    // POST() takes no arguments (no auth check), so this is already verified
    // by the handler signature, but we assert it explicitly for clarity.
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
  });

  // 8. Expired / invalid token — endpoint requires no authentication
  it('succeeds regardless of whether the caller has a valid token', async () => {
    // The handler accepts no Request parameter and performs no token validation,
    // so even a caller with an expired token gets a clean logout response.
    const res = await POST();
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });
});
