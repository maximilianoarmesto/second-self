import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ linkId: string }> }
) {
  try {
    const { linkId } = await params;
    const id = parseInt(linkId, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid link ID' }, { status: 400 });
    }

    const link = await prisma.shareLink.findUnique({ where: { id } });
    if (!link || link.ownerId !== 1) {
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
