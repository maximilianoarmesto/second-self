/**
 * POST /api/settings/test-connection
 *
 * Tests connectivity to a given AI provider using the stored API key.
 *
 * Request body:
 *   { provider: 'openai' | 'anthropic' }
 *
 * Legacy behaviour (OpenAI via x-openai-api-key header) is preserved for
 * backward-compatibility but the canonical path is the JSON body + provider.
 *
 * Responses:
 *   200 { success: true, provider }     — key is valid
 *   400 { success: false, error }       — missing key or bad request
 *   401 { success: false, error }       — invalid API key reported by provider
 *   429 { success: false, error }       — rate-limit reported by provider
 *   500 { success: false, error }       — unexpected / network error
 *
 * The endpoint is protected by requireAuth — unauthenticated requests are
 * rejected with 401 before any provider logic runs.
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '@/lib/middleware/requireAuth';
import type { AuthContext } from '@/lib/middleware/requireAuth';
import type { AiProvider } from '@/lib/ai-provider';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The Anthropic model used for the minimal connectivity probe.
 * claude-3-haiku is the fastest and cheapest model — ideal for a health-check
 * that sends a single token and discards the response.
 */
const ANTHROPIC_PROBE_MODEL = 'claude-3-haiku-20240307';

// ---------------------------------------------------------------------------
// Provider-specific testers
// ---------------------------------------------------------------------------

async function testOpenAI(apiKey: string): Promise<NextResponse> {
  try {
    const client = new OpenAI({ apiKey });
    await client.models.list();

    return NextResponse.json({ success: true, provider: 'openai' as AiProvider });
  } catch (error: unknown) {
    return handleProviderError(error, 'openai');
  }
}

async function testAnthropic(apiKey: string): Promise<NextResponse> {
  try {
    const client = new Anthropic({ apiKey });

    // Send the smallest possible request to verify the key is accepted.
    // max_tokens=1 minimises cost; we discard the response content entirely.
    await client.messages.create({
      model: ANTHROPIC_PROBE_MODEL,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'Hi' }],
    });

    return NextResponse.json({ success: true, provider: 'anthropic' as AiProvider });
  } catch (error: unknown) {
    return handleProviderError(error, 'anthropic');
  }
}

// ---------------------------------------------------------------------------
// Shared error handler
// ---------------------------------------------------------------------------

function handleProviderError(error: unknown, provider: AiProvider): NextResponse {
  const err = error as { status?: number; message?: string };

  console.error(`${provider} connection test failed:`, error);

  if (err?.status === 401) {
    return NextResponse.json(
      { success: false, error: 'Invalid API key. Please check your API key and try again.' },
      { status: 401 }
    );
  }

  if (err?.status === 429) {
    return NextResponse.json(
      { success: false, error: 'Rate limit exceeded. Please try again later.' },
      { status: 429 }
    );
  }

  return NextResponse.json(
    { success: false, error: err?.message || `Failed to connect to ${provider}` },
    { status: 500 }
  );
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const POST = requireAuth(async (request: NextRequest, _ctx: AuthContext) => {
  // ------------------------------------------------------------------
  // Parse request body
  // ------------------------------------------------------------------
  let body: { provider?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Body is not JSON — fall through with an empty object so the legacy
    // header-based path (provider defaults to 'openai') still works.
  }

  const provider = (body?.provider ?? 'openai') as AiProvider;

  // ------------------------------------------------------------------
  // Validate provider value
  // ------------------------------------------------------------------
  if (provider !== 'openai' && provider !== 'anthropic') {
    return NextResponse.json(
      { success: false, error: `Unsupported provider "${provider}". Valid options are "openai" and "anthropic".` },
      { status: 400 }
    );
  }

  // ------------------------------------------------------------------
  // OpenAI path
  // ------------------------------------------------------------------
  if (provider === 'openai') {
    const apiKey =
      request.headers.get('x-openai-api-key') ??
      (body as { provider?: string; apiKey?: string }).apiKey ??
      null;

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'OpenAI API key is required' },
        { status: 400 }
      );
    }

    return testOpenAI(apiKey);
  }

  // ------------------------------------------------------------------
  // Anthropic path
  // ------------------------------------------------------------------
  const anthropicKey =
    (body as { provider?: string; apiKey?: string }).apiKey ??
    request.headers.get('x-anthropic-api-key') ??
    null;

  if (!anthropicKey) {
    return NextResponse.json(
      { success: false, error: 'Anthropic API key is required' },
      { status: 400 }
    );
  }

  return testAnthropic(anthropicKey);
});
