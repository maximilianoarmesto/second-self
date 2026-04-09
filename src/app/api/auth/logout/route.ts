import { NextResponse } from 'next/server';

/**
 * POST /api/auth/logout
 *
 * Clears the `session` HttpOnly cookie by overwriting it with an empty value
 * and `Max-Age=0`, which instructs the browser to delete it immediately.
 *
 * No authentication is required to call this endpoint — the user must always
 * be able to log out, even if their token has already expired.
 */
export async function POST() {
  const response = NextResponse.json({ success: true });

  // Expire the session cookie immediately.
  // Attributes mirror those that would be set on login:
  //   HttpOnly  — not accessible to JavaScript
  //   Path=/    — matches every route so the browser sends it on all requests
  //   SameSite=Lax — standard CSRF protection
  //   Secure    — only sent over HTTPS (omitted in development automatically
  //               because Next.js dev server runs on HTTP)
  response.headers.set(
    'Set-Cookie',
    'session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
  );

  return response;
}
