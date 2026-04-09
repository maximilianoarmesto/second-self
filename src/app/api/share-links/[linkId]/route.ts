import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware/requireAuth';
import type { AuthContext } from '@/lib/middleware/requireAuth';

type LinkParams = { params: Promise<{ linkId: string }> };

export const DELETE = requireAuth<LinkParams>(
  async (request: NextRequest, ctx: AuthContext & LinkParams) => {
    try {
      const { userId } = ctx.auth;
      const { linkId } = await ctx.params;
      const id = parseInt(linkId, 10);
      if (isNaN(id)) {
        return NextResponse.json({ error: 'Invalid link ID' }, { status: 400 });
      }

      const link = await prisma.shareLink.findUnique({ where: { id } });
      if (!link || link.ownerId !== userId) {
        return NextResponse.json({ error: 'Share link not found' }, { status: 404 });
      }

      await prisma.shareLink.update({
        where: { id },
        data: {
          isActive: false,
          revokedAt: new Date(),
        },
      });

      return new NextResponse(null, { status: 204 });
    } catch (error: any) {
      console.error('Error revoking share link:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to revoke share link' },
        { status: 500 }
      );
    }
  }
);
