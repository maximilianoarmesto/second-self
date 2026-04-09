import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware/requireAuth';
import type { AuthContext } from '@/lib/middleware/requireAuth';

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

/**
 * The shape returned by GET /api/auth/me.
 *
 * Consumed by the frontend AuthProvider to restore session state on app load
 * (e.g. populate the sidebar username and avatar, redirect unauthenticated
 * users to /login).
 */
export interface MeResponse {
  /** Database primary key of the authenticated owner row. */
  id: number;
  /** Owner's email address, or `null` when not set. */
  email: string | null;
  /** Owner's display name (`cloneName`). */
  name: string;
  /** Avatar URL fetched from the linked Settings record, or `null` when absent. */
  avatarUrl: string | null;
}

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

/**
 * Returns the identity of the currently authenticated user.
 *
 * The session cookie (or Authorization: Bearer header) is validated by the
 * `requireAuth` wrapper before this handler is called. On success it looks up
 * the owner row and its linked Settings record to resolve the avatar URL, then
 * returns a typed `{ id, email, name, avatarUrl }` payload.
 *
 * Responses:
 *  - 200  { id, email, name, avatarUrl }  — authenticated user found
 *  - 401  { error }                       — no valid session token (from requireAuth)
 *  - 401  { error }                       — owner row not found (deleted account)
 *  - 500  { error }                       — unexpected database error
 */
export const GET = requireAuth(async (_request: NextRequest, ctx: AuthContext) => {
  try {
    const { userId } = ctx.auth;

    // ------------------------------------------------------------------
    // 1. Fetch the owner row
    // ------------------------------------------------------------------
    const owner = await prisma.owner.findUnique({
      where: { id: userId },
      select: { id: true, email: true, cloneName: true },
    });

    // The token was valid but the owner row no longer exists (deleted account).
    if (!owner) {
      return NextResponse.json(
        { error: 'Not authenticated.' },
        { status: 401 }
      );
    }

    // ------------------------------------------------------------------
    // 2. Fetch avatarUrl from the linked Settings record (may not exist yet)
    // ------------------------------------------------------------------
    const settings = await prisma.settings.findUnique({
      where: { ownerId: owner.id },
      select: { avatarUrl: true },
    });

    // ------------------------------------------------------------------
    // 3. Return the typed response
    // ------------------------------------------------------------------
    const body: MeResponse = {
      id: owner.id,
      email: owner.email ?? null,
      name: owner.cloneName,
      avatarUrl: settings?.avatarUrl ?? null,
    };

    return NextResponse.json(body);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch session';
    console.error('[GET /api/auth/me] Unexpected error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
