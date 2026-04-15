import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateResponse } from '@/lib/services/rag-service';
import { buildCustomPrompt } from '@/lib/settings-prompt';
import type { AiProvider } from '@/lib/ai-provider';
import { DEFAULT_OPENAI_MODEL, DEFAULT_ANTHROPIC_MODEL } from '@/lib/ai-provider';
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
      return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 });
    }

    const body = await request.json();
    const { message, sessionId } = body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const ownerSettings = link.owner.settings;

    // Resolve the active AI provider from owner's settings (defaults to openai).
    const aiProvider: AiProvider = (ownerSettings?.aiProvider as AiProvider) ?? 'openai';

    // RAG embedding always uses OpenAI — the OpenAI key is required regardless
    // of which provider is active for chat completions.
    const openaiApiKey = ownerSettings?.openaiApiKeyEncrypted ?? null;
    if (!openaiApiKey) {
      return NextResponse.json(
        {
          error:
            'No OpenAI API key configured for this clone. The owner must add one in Settings.',
        },
        { status: 400 }
      );
    }

    // Resolve the chat-completion API key for the active provider.
    const chatApiKey =
      aiProvider === 'anthropic'
        ? (ownerSettings?.anthropicApiKey ?? null)
        : openaiApiKey;

    if (!chatApiKey) {
      const providerLabel = aiProvider === 'anthropic' ? 'Anthropic' : 'OpenAI';
      return NextResponse.json(
        {
          error: `${providerLabel} API key is not configured for this clone. The owner must add it in Settings.`,
        },
        { status: 400 }
      );
    }

    // Resolve the model for the active provider, falling back to sensible defaults.
    const chatModel =
      aiProvider === 'anthropic'
        ? (ownerSettings?.anthropicModel ?? DEFAULT_ANTHROPIC_MODEL)
        : (ownerSettings?.openaiModel ?? DEFAULT_OPENAI_MODEL);

    // Resolve the clone name and custom prompt from the owner's Settings so
    // the public chat route produces an identical strict first-person persona
    // to the private chat route.
    //
    // Resolution order for cloneName (nullish — never swallows empty string):
    //   1. settings.cloneName  — most up-to-date; set on the Settings row
    //   2. owner.cloneName     — legacy fallback on the Owner record itself
    //   3. undefined           — lets buildSystemPrompt() use DEFAULT_CLONE_NAME
    const cloneName = ownerSettings?.cloneName ?? link.owner.cloneName ?? undefined;

    // Build the composite custom prompt that incorporates systemPrompt, tone,
    // and responseLength from the owner's Settings.
    const customPrompt = buildCustomPrompt(
      ownerSettings?.systemPrompt ?? null,
      ownerSettings?.tone ?? null,
      ownerSettings?.responseLength ?? null,
    );

    const result = await generateResponse({
      message: message.trim(),
      sessionId: sessionId || undefined,
      // OpenAI key for RAG embeddings (always OpenAI)
      apiKey: openaiApiKey,
      // Provider-specific key and model for chat completions
      chatApiKey,
      chatProvider: aiProvider,
      chatModel,
      showSources: false,
      cloneName,
      customPrompt,
      // Mark sessions created via the public clone link so the owner can
      // distinguish them from their own private-chat sessions.
      isPublicSession: true,
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
