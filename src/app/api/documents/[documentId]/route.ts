import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ingestDocument } from '@/lib/services/document-service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await params;
    const id = parseInt(documentId, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 });
    }

    const document = await prisma.document.findUnique({
      where: { id },
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
        // Derive canReprocess without exposing the raw binary payload
        fileData: true,
        chunks: {
          orderBy: { chunkIndex: 'asc' },
          select: {
            id: true,
            chunkIndex: true,
            pageNumber: true,
            documentTitle: true,
            content: true,
            createdAt: true,
            documentId: true,
          },
        },
      },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    if (document.ownerId !== 1) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const { fileData, ...rest } = document;
    return NextResponse.json({ ...rest, canReprocess: fileData !== null });
  } catch (error: any) {
    console.error('Error fetching document:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch document' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const { documentId } = await params;
    const id = parseInt(documentId, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 });
    }

    const document = await prisma.document.findUnique({ where: { id } });
    if (!document || document.ownerId !== 1) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    await prisma.document.delete({ where: { id } });

    return new NextResponse(null, { status: 204 });
  } catch (error: any) {
    console.error('Error deleting document:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete document' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/documents/:documentId/reprocess
 *
 * Re-ingests an existing document using the current chunking strategy.
 * Requires the document to have been uploaded after the fileData column was
 * added (i.e. the raw PDF buffer must be stored on the document row).
 *
 * The OpenAI API key must be supplied via the `x-openai-api-key` header so
 * new embeddings can be generated.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  try {
    const apiKey = request.headers.get('x-openai-api-key');
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key is required. Please configure it in Settings.' },
        { status: 400 }
      );
    }

    const { documentId } = await params;
    const id = parseInt(documentId, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 });
    }

    const document = await prisma.document.findUnique({
      where: { id },
      select: { id: true, ownerId: true, fileData: true, status: true },
    });

    if (!document || document.ownerId !== 1) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    if (!document.fileData) {
      return NextResponse.json(
        {
          error:
            'This document was uploaded before re-processing support was added. ' +
            'Please delete it and re-upload the file to benefit from the updated chunking strategy.',
        },
        { status: 422 }
      );
    }

    if (document.status === 'PROCESSING') {
      return NextResponse.json(
        { error: 'Document is already being processed. Please wait for it to complete.' },
        { status: 409 }
      );
    }

    // Reset to PENDING so the UI reflects the queued state immediately
    const updated = await prisma.document.update({
      where: { id },
      data: { status: 'PENDING', errorMessage: null },
    });

    const buffer = Buffer.from(document.fileData);

    // Run ingestion asynchronously — same pattern as the upload route
    ingestDocument(id, buffer, apiKey).catch(console.error);

    return NextResponse.json(updated, { status: 202 });
  } catch (error: any) {
    console.error('Re-process error:', error);
    return NextResponse.json({ error: error.message || 'Re-processing failed' }, { status: 500 });
  }
}
