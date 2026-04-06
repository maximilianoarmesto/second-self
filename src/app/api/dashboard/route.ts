import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const [
      documentCount,
      chunkCount,
      sessionCount,
      recentDocs,
      recentSessions,
      settings,
      activeLinks,
    ] = await Promise.all([
      prisma.document.count({ where: { ownerId: 1 } }),
      prisma.documentChunk.count({ where: { document: { ownerId: 1 } } }),
      prisma.chatSession.count({ where: { ownerId: 1 } }),
      prisma.document.findMany({
        where: { ownerId: 1 },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.chatSession.findMany({
        where: { ownerId: 1 },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        include: {
          _count: {
            select: { messages: true },
          },
        },
      }),
      prisma.settings.findUnique({ where: { ownerId: 1 } }),
      prisma.shareLink.count({ where: { ownerId: 1, isActive: true } }),
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
}
