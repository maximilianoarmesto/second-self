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

    // Resolve the clone name and custom prompt from the owner's settings so
    // the public chat route uses the same persona as the private chat route.
    // Prefer settings-level cloneName; fall back to the Owner record value.
    const ownerSettings = link.owner.settings;
    const cloneName = ownerSettings?.cloneName || link.owner.cloneName;
    // Pass the operator-supplied system prompt as the custom-prompt extension.
    // buildSystemPrompt() in rag-service appends it after the strict
    // first-person base rules, so persona constraints are always enforced.
    const customPrompt = ownerSettings?.systemPrompt ?? null;

    const result = await generateResponse({
      message: message.trim(),
      sessionId: sessionId || undefined,
      apiKey,
      showSources: false,
      cloneName,
      customPrompt,
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
