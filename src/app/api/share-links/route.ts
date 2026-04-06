import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

export async function GET() {
  try {
    const links = await prisma.shareLink.findMany({
      where: { ownerId: 1 },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(links);
  } catch (error: any) {
    console.error('Error listing share links:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to list share links' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { label } = body;

    // Generate a random token
    const token = crypto.randomBytes(32).toString('hex');

    // Store the SHA-256 hash of the token
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const link = await prisma.shareLink.create({
      data: {
        ownerId: 1,
        tokenHash,
        label: label || 'Public Link',
        isActive: true,
      },
    });

    // Return the raw token only at creation time (it cannot be retrieved later)
    return NextResponse.json(
      {
        id: link.id,
        token,
        label: link.label,
        isActive: link.isActive,
        createdAt: link.createdAt,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Error creating share link:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create share link' },
      { status: 500 }
    );
  }
}
