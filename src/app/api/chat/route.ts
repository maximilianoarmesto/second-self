import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateResponse } from '@/lib/services/rag-service';
import { buildCustomPrompt } from '@/lib/settings-prompt';
import { requireAuth } from '@/lib/middleware/requireAuth';
import type { AuthContext } from '@/lib/middleware/requireAuth';
import type { AiProvider } from '@/lib/ai-provider';
import { DEFAULT_OPENAI_MODEL, DEFAULT_ANTHROPIC_MODEL } from '@/lib/ai-provider';
// Retrieval constants are defined in src/lib/config/rag.ts for easy tuning.
// Importing them here makes the active configuration visible in route-level
// request logs so operators can confirm the live values without needing to
// inspect the service layer or trigger an error.
import { MAX_CHUNKS, MIN_SIMILARITY_THRESHOLD } from '@/lib/config/rag';

export const POST = requireAuth(async (request: NextRequest, ctx: AuthContext) => {
  try {
    const { userId } = ctx.auth;

    const body = await request.json();
    const { message, sessionId, showSources } = body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    // Log active retrieval config on every request so operators can confirm
    // the live values (MAX_CHUNKS, MIN_SIMILARITY_THRESHOLD) without needing
    // to inspect source code or wait for an error to occur.
    console.info(
      `[chat route] POST /api/chat — ` +
        `MAX_CHUNKS: ${MAX_CHUNKS}, MIN_SIMILARITY_THRESHOLD: ${MIN_SIMILARITY_THRESHOLD}`
    );

    // Resolve provider, model, and API keys from the authenticated user's
    // settings so that switching the provider in Settings takes effect on the
    // next request without any code change.
    const settings = await prisma.settings.findUnique({ where: { ownerId: userId } });

    const aiProvider: AiProvider = (settings?.aiProvider as AiProvider) ?? 'openai';

    // RAG embedding always uses OpenAI — require the OpenAI key unconditionally.
    const openaiApiKey = settings?.openaiApiKeyEncrypted ?? null;
    if (!openaiApiKey) {
      return NextResponse.json(
        {
          error:
            'OpenAI API key is required for document retrieval. Please configure it in Settings.',
        },
        { status: 400 }
      );
    }

    // Resolve the chat-completion API key for the active provider.
    const chatApiKey =
      aiProvider === 'anthropic'
        ? (settings?.anthropicApiKey ?? null)
        : openaiApiKey;

    if (!chatApiKey) {
      const providerLabel = aiProvider === 'anthropic' ? 'Anthropic' : 'OpenAI';
      return NextResponse.json(
        {
          error: `${providerLabel} API key is not configured. Please add it in Settings.`,
        },
        { status: 400 }
      );
    }

    // Resolve the model for the active provider, falling back to sensible defaults.
    const chatModel =
      aiProvider === 'anthropic'
        ? (settings?.anthropicModel ?? DEFAULT_ANTHROPIC_MODEL)
        : (settings?.openaiModel ?? DEFAULT_OPENAI_MODEL);

    const cloneName = settings?.cloneName ?? undefined;
    // Build a composite custom prompt that incorporates the operator's saved
    // systemPrompt together with tone and response-length preferences.
    const customPrompt = buildCustomPrompt(
      settings?.systemPrompt ?? null,
      settings?.tone ?? null,
      settings?.responseLength ?? null,
    );

    const result = await generateResponse({
      message: message.trim(),
      sessionId: sessionId || undefined,
      ownerId: userId,
      // OpenAI key for RAG embeddings (always OpenAI)
      apiKey: openaiApiKey,
      // Provider-specific key and model for chat completions
      chatApiKey,
      chatProvider: aiProvider,
      chatModel,
      showSources: showSources ?? false,
      cloneName,
      customPrompt,
    });

    return NextResponse.json({
      message: result.message,
      sessionId: result.sessionId,
      ...(showSources && result.sources ? { sources: result.sources } : {}),
    });
  } catch (error: any) {
    console.error(
      `[chat route] error [MAX_CHUNKS=${MAX_CHUNKS}, MIN_SIMILARITY_THRESHOLD=${MIN_SIMILARITY_THRESHOLD}]:`,
      error
    );
    return NextResponse.json(
      { error: error.message || 'Failed to generate response' },
      { status: 500 }
    );
  }
});
