import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/auth/me
 *
 * Returns the current session user derived from the single owner row.
 * In this single-owner application, owner id=1 is always the authenticated
 * user. The endpoint returns a 401 when no owner row exists (i.e. the app
 * has not been initialised yet), which the client treats as "not logged in".
 */
export async function GET() {
  try {
    const owner = await prisma.owner.findUnique({ where: { id: 1 } });

    if (!owner) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Fetch avatar from the related settings row (may not exist yet)
    const settings = await prisma.settings.findUnique({ where: { ownerId: 1 } });

    return NextResponse.json({
      id: owner.id,
      email: (owner as any).email ?? null,
      name: owner.cloneName,
      avatarUrl: settings?.avatarUrl ?? null,
    });
  } catch (error: any) {
    console.error('Error fetching session user:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch session' },
      { status: 500 }
    );
  }
}
