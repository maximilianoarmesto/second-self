import { NextRequest, NextResponse } from 'next/server';
import { generateResponse } from '@/lib/services/rag-service';
// Retrieval constants are defined in src/lib/config/rag.ts for easy tuning.
// Importing them here keeps the route aware of the active configuration and
// makes them visible in route-level logging without touching the service layer.
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
      `Chat error [MAX_CHUNKS=${MAX_CHUNKS}, MIN_SIMILARITY_THRESHOLD=${MIN_SIMILARITY_THRESHOLD}]:`,
      error
    );
    return NextResponse.json(
      { error: error.message || 'Failed to generate response' },
      { status: 500 }
    );
  }
}
