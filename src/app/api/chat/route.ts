import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateResponse } from '@/lib/services/rag-service';

export async function POST(request: NextRequest) {
  try {
    const apiKey = request.headers.get('x-openai-api-key');
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key is required. Please configure it in Settings.' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { message, sessionId, showSources } = body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Load the owner's settings so the system prompt is personalised with the
    // configured clone name and any custom prompt they have written.
    const settings = await prisma.settings.findUnique({
      where: { ownerId: 1 },
      select: { cloneName: true, systemPrompt: true },
    });

    const result = await generateResponse({
      message: message.trim(),
      sessionId: sessionId || undefined,
      apiKey,
      showSources: showSources ?? false,
      cloneName: settings?.cloneName ?? 'My Second Self',
      customSystemPrompt: settings?.systemPrompt ?? undefined,
    });

    return NextResponse.json({
      message: result.message,
      sessionId: result.sessionId,
      ...(showSources && result.sources ? { sources: result.sources } : {}),
    });
  } catch (error: any) {
    console.error('Chat error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate response' },
      { status: 500 }
    );
  }
}
