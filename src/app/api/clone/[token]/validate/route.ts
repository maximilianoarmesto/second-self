import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    // Hash the incoming token to compare against stored hashes
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const link = await prisma.shareLink.findUnique({
      where: { tokenHash },
      include: {
        owner: {
          include: {
            settings: true,
          },
        },
      },
    });

    if (!link || !link.isActive) {
      return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 });
    }

    const cloneName = link.owner.settings?.cloneName || link.owner.cloneName;

    return NextResponse.json({
      valid: true,
      cloneName,
    });
  } catch (error: any) {
    console.error('Token validation error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to validate token' },
      { status: 500 }
    );
  }
}
