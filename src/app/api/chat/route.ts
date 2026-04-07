import { NextRequest, NextResponse } from 'next/server';
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

    const result = await generateResponse({
      message: message.trim(),
      sessionId: sessionId || undefined,
      apiKey,
      showSources: showSources ?? false,
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
