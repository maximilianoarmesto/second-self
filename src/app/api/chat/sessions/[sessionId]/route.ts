import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { renameSession } from '@/lib/services/chat-service';
import { requireAuth } from '@/lib/middleware/requireAuth';
import type { AuthContext } from '@/lib/middleware/requireAuth';

type SessionParams = { params: Promise<{ sessionId: string }> };

export const GET = requireAuth<SessionParams>(
  async (request: NextRequest, ctx: AuthContext & SessionParams) => {
    try {
      const { userId } = ctx.auth;
      const { sessionId } = await ctx.params;
      const id = parseInt(sessionId, 10);
      if (isNaN(id)) {
        return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
      }

      const session = await prisma.chatSession.findUnique({
        where: { id },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }

      // Enforce ownership
      if (session.ownerId !== userId) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }

      return NextResponse.json(session);
    } catch (error: any) {
      console.error('Error fetching session:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to fetch session' },
        { status: 500 }
      );
    }
  }
);

export const DELETE = requireAuth<SessionParams>(
  async (request: NextRequest, ctx: AuthContext & SessionParams) => {
    try {
      const { userId } = ctx.auth;
      const { sessionId } = await ctx.params;
      const id = parseInt(sessionId, 10);
      if (isNaN(id)) {
        return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
      }

      const session = await prisma.chatSession.findUnique({ where: { id } });
      if (!session || session.ownerId !== userId) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }

      await prisma.chatSession.delete({ where: { id } });

      return new NextResponse(null, { status: 204 });
    } catch (error: any) {
      console.error('Error deleting session:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to delete session' },
        { status: 500 }
      );
    }
  }
);

export const PATCH = requireAuth<SessionParams>(
  async (request: NextRequest, ctx: AuthContext & SessionParams) => {
    try {
      const { userId } = ctx.auth;
      const { sessionId } = await ctx.params;
      const id = parseInt(sessionId, 10);
      if (isNaN(id)) {
        return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
      }

      const session = await prisma.chatSession.findUnique({ where: { id } });
      if (!session || session.ownerId !== userId) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }

      const body = await request.json();
      const { title } = body;

      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return NextResponse.json({ error: 'Title is required' }, { status: 400 });
      }

      const updated = await renameSession(id, title.trim());
      return NextResponse.json(updated);
    } catch (error: any) {
      console.error('Error renaming session:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to rename session' },
        { status: 500 }
      );
    }
  }
);
