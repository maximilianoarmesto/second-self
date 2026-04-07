import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateResponse } from '@/lib/services/rag-service';
// Retrieval constants are defined in src/lib/config/rag.ts for easy tuning.
// Importing them here makes the active configuration visible in route-level
// request logs so operators can confirm the live values without needing to
// inspect the service layer or trigger an error.
import { MAX_CHUNKS, MIN_SIMILARITY_THRESHOLD } from '@/lib/config/rag';

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
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Log active retrieval config on every request so operators can confirm
    // the live values (MAX_CHUNKS, MIN_SIMILARITY_THRESHOLD) without needing
    // to inspect source code or wait for an error to occur.
    console.info(
      `[chat route] POST /api/chat — ` +
        `MAX_CHUNKS: ${MAX_CHUNKS}, MIN_SIMILARITY_THRESHOLD: ${MIN_SIMILARITY_THRESHOLD}`
    );

    // Resolve the clone name and custom prompt from Settings so the system
    // prompt is dynamically built with the operator's current configuration.
    // Both values are passed explicitly to generateResponse() — this makes
    // the persona construction visible at the route level and avoids relying
    // on the service's internal DB fallback for the normal private-chat path.
    const settings = await prisma.settings.findUnique({ where: { ownerId: 1 } });
    const cloneName = settings?.cloneName ?? undefined;
    // Pass null when no custom prompt is saved so generateResponse() knows
    // to skip its own DB fetch (explicit null ≠ undefined/missing).
    const customPrompt = settings?.systemPrompt ?? null;

    const result = await generateResponse({
      message: message.trim(),
      sessionId: sessionId || undefined,
      apiKey,
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
}
