import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserFromRequest } from '@/lib/auth';

/**
 * GET /api/auth/me
 *
 * Returns the current session user derived from the JWT session cookie or
 * Authorization header. Returns 401 when no valid session token is present.
 */
export async function GET(request: NextRequest) {
  try {
    const payload = getUserFromRequest(request);

    if (!payload) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const owner = await prisma.owner.findUnique({
      where: { id: payload.userId },
      select: { id: true, email: true, cloneName: true },
    });

    if (!owner) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Fetch avatar from the related settings row (may not exist yet)
    const settings = await prisma.settings.findUnique({
      where: { ownerId: owner.id },
      select: { avatarUrl: true },
    });

    return NextResponse.json({
      id: owner.id,
      email: owner.email ?? null,
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
