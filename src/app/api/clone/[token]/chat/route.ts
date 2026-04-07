import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateResponse } from '@/lib/services/rag-service';
import crypto from 'crypto';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    // Validate token
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
      return NextResponse.json(
        { error: 'Invalid or expired link' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { message, sessionId } = body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Get API key: prefer stored key from settings, fall back to header
    let apiKey = link.owner.settings?.openaiApiKeyEncrypted || null;
    if (!apiKey) {
      apiKey = request.headers.get('x-openai-api-key');
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: 'No OpenAI API key configured for this clone' },
        { status: 400 }
      );
    }

    // Resolve the clone identity from the owner's settings. The settings row
    // is the single source of truth for both the display name and the custom
    // persona prompt.
    const cloneName =
      link.owner.settings?.cloneName ?? link.owner.cloneName ?? 'My Second Self';
    const customSystemPrompt = link.owner.settings?.systemPrompt ?? undefined;

    const result = await generateResponse({
      message: message.trim(),
      sessionId: sessionId || undefined,
      apiKey,
      showSources: false,
      cloneName,
      customSystemPrompt,
    });

    return NextResponse.json({
      message: result.message,
      sessionId: result.sessionId,
    });
  } catch (error: any) {
    console.error('Public chat error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate response' },
      { status: 500 }
    );
  }
}
