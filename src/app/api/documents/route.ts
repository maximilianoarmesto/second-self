import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 1000);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const documents = await prisma.document.findMany({
      where: { ownerId: 1 },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        filename: true,
        originalFilename: true,
        fileSize: true,
        pageCount: true,
        status: true,
        errorMessage: true,
        ownerId: true,
        createdAt: true,
        updatedAt: true,
        // Select only whether fileData is present to derive canReprocess
        // without sending the full binary payload over the wire.
        fileData: true,
      },
    });

    // Map to the API shape: replace fileData with the boolean canReprocess
    // so the raw binary blob is never sent over the wire.
    const payload = documents.map(({ fileData, ...doc }) => ({
      ...doc,
      canReprocess: fileData !== null,
    }));

    return NextResponse.json(payload);
  } catch (error: any) {
    console.error('Error listing documents:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to list documents' },
      { status: 500 }
    );
  }
}
