import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware/requireAuth';
import type { AuthContext } from '@/lib/middleware/requireAuth';

export const GET = requireAuth(async (_request: NextRequest, ctx: AuthContext) => {
  try {
    const { userId } = ctx.auth;

    const [
      documentCount,
      chunkCount,
      sessionCount,
      recentDocs,
      recentSessions,
      settings,
      activeLinks,
    ] = await Promise.all([
      prisma.document.count({ where: { ownerId: userId } }),
      prisma.documentChunk.count({ where: { document: { ownerId: userId } } }),
      // Only count private sessions in the owner's chat-session stat.
      prisma.chatSession.count({ where: { ownerId: userId, isPublic: false } }),
      prisma.document.findMany({
        where: { ownerId: userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      // Only list private sessions in the recent-chats panel.
      prisma.chatSession.findMany({
        where: { ownerId: userId, isPublic: false },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        include: {
          _count: {
            select: { messages: true },
          },
        },
      }),
      prisma.settings.findUnique({ where: { ownerId: userId } }),
      prisma.shareLink.count({ where: { ownerId: userId, isActive: true } }),
    ]);

    return NextResponse.json({
      cloneName: settings?.cloneName || 'My Second Self',
      documentCount,
      chunkCount,
      chatSessionCount: sessionCount,
      publicLinkCount: activeLinks,
      recentDocuments: recentDocs.map((d: any) => ({
        id: d.id,
        original_filename: d.originalFilename,
        status: d.status.toLowerCase(),
        created_at: d.createdAt,
      })),
      recentSessions: recentSessions.map((s: any) => ({
        id: s.id,
        title: s.title,
        messageCount: s._count?.messages || 0,
        created_at: s.createdAt,
      })),
    });
  } catch (error: any) {
    console.error('Dashboard error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to load dashboard data' },
      { status: 500 }
    );
  }
});
