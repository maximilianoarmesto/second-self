import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware/requireAuth';
import type { AuthContext } from '@/lib/middleware/requireAuth';

export const GET = requireAuth(async (_request: NextRequest, ctx: AuthContext) => {
  try {
    const { userId } = ctx.auth;

    const sessions = await prisma.chatSession.findMany({
      where: { ownerId: userId },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json(sessions);
  } catch (error: any) {
    console.error('Error listing sessions:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to list sessions' },
      { status: 500 }
    );
  }
});

export const POST = requireAuth(async (request: NextRequest, ctx: AuthContext) => {
  try {
    const { userId } = ctx.auth;

    const body = await request.json().catch(() => ({}));
    const { title } = body;

    const session = await prisma.chatSession.create({
      data: {
        title: title || 'New Conversation',
        ownerId: userId,
      },
    });

    return NextResponse.json(session, { status: 201 });
  } catch (error: any) {
    console.error('Error creating session:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create session' },
      { status: 500 }
    );
  }
});
