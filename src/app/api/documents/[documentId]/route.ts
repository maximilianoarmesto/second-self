import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { reingestDocument } from '@/lib/services/document-service';
import { requireAuth } from '@/lib/middleware/requireAuth';
import type { AuthContext } from '@/lib/middleware/requireAuth';

type DocumentParams = { params: Promise<{ documentId: string }> };

export const GET = requireAuth<DocumentParams>(
  async (request: NextRequest, ctx: AuthContext & DocumentParams) => {
    try {
      const { userId } = ctx.auth;
      const { documentId } = await ctx.params;
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

      // Enforce ownership — users can only access their own documents
      if (document.ownerId !== userId) {
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
);

export const DELETE = requireAuth<DocumentParams>(
  async (request: NextRequest, ctx: AuthContext & DocumentParams) => {
    try {
      const { userId } = ctx.auth;
      const { documentId } = await ctx.params;
      const id = parseInt(documentId, 10);
      if (isNaN(id)) {
        return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 });
      }

      const document = await prisma.document.findUnique({ where: { id } });
      if (!document || document.ownerId !== userId) {
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
);

/**
 * POST /api/documents/[documentId]
 *
 * Re-processes an existing document using the provided PDF file.  Clears all
 * previous chunks and re-runs the full ingestion pipeline (sentence-aware
 * overlapping chunking → embeddings → persistence) so the document benefits
 * from any improvements to the chunking strategy.
 *
 * Expects a `multipart/form-data` body with a single `file` field containing
 * the PDF to re-ingest.  The OpenAI API key must be supplied via the
 * `x-openai-api-key` request header.
 *
 * Returns 202 Accepted immediately; ingestion continues asynchronously.
 */
export const POST = requireAuth<DocumentParams>(
  async (request: NextRequest, ctx: AuthContext & DocumentParams) => {
    try {
      const { userId } = ctx.auth;
      const { documentId } = await ctx.params;
      const id = parseInt(documentId, 10);
      if (isNaN(id)) {
        return NextResponse.json({ error: 'Invalid document ID' }, { status: 400 });
      }

      const apiKey = request.headers.get('x-openai-api-key');
      if (!apiKey) {
        return NextResponse.json(
          { error: 'OpenAI API key is required. Please configure it in Settings.' },
          { status: 400 }
        );
      }

      const document = await prisma.document.findUnique({ where: { id } });
      if (!document || document.ownerId !== userId) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }

      // A document already being processed should not be started again.
      if (document.status === 'PROCESSING') {
        return NextResponse.json(
          { error: 'Document is already being processed. Please wait for it to finish.' },
          { status: 409 }
        );
      }

      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 });
      }

      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        return NextResponse.json(
          { error: 'Only PDF files are accepted' },
          { status: 400 }
        );
      }

      const MAX_SIZE = 50 * 1024 * 1024;
      if (file.size > MAX_SIZE) {
        return NextResponse.json(
          { error: 'File size exceeds 50MB limit' },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      // Fire-and-forget — ingestion may take tens of seconds for large PDFs.
      reingestDocument(id, document.originalFilename, buffer, apiKey).catch(console.error);

      return NextResponse.json(
        { message: 'Re-processing started', documentId: id },
        { status: 202 }
      );
    } catch (error: any) {
      console.error('Re-process error:', error);
      return NextResponse.json(
        { error: error.message || 'Re-processing failed' },
        { status: 500 }
      );
    }
  }
);
