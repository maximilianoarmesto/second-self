import { NextResponse } from 'next/server';

/**
 * POST /api/auth/logout
 *
 * Terminates the current session. In this single-owner application there is
 * no server-side session store, so the response simply instructs the client
 * to redirect to `/login`. Any future session-cookie / JWT invalidation
 * logic should be added here.
 */
export async function POST() {
  return NextResponse.json({ success: true });
}
