import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ingestDocument } from '@/lib/services/document-service';
import { requireAuth } from '@/lib/middleware/requireAuth';
import type { AuthContext } from '@/lib/middleware/requireAuth';

export const POST = requireAuth(async (request: NextRequest, ctx: AuthContext) => {
  try {
    const { userId } = ctx.auth;

    const apiKey = request.headers.get('x-openai-api-key');
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key is required. Please configure it in Settings.' },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Only PDF files are accepted' }, { status: 400 });
    }

    const MAX_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File size exceeds 50MB limit' }, { status: 400 });
    }

    const filename = `${Date.now()}-${file.name}`;

    const document = await prisma.document.create({
      data: {
        filename,
        originalFilename: file.name,
        fileSize: file.size,
        ownerId: userId,
        status: 'PENDING',
      },
    });

    const buffer = Buffer.from(await file.arrayBuffer());

    // Run ingestion (don't await in production for long files, but for MVP we await)
    ingestDocument(document.id, buffer, apiKey).catch(console.error);

    return NextResponse.json(document, { status: 201 });
  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 });
  }
});
