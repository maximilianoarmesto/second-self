/**
 * Multi-provider AI chat completion adapter.
 *
 * Abstracts over OpenAI and Anthropic so that the rest of the application
 * can call a single function — `getChatCompletion` — without coupling to a
 * specific SDK.
 *
 * Design decisions:
 *  - The function signature mirrors the shape already used inside rag-service:
 *    a `model` string, an array of `messages`, an optional `systemPrompt`,
 *    and a provider-specific `apiKey`.
 *  - `systemPrompt` is an optional convenience parameter.  When supplied it is
 *    prepended to the `messages` array as a `{ role: "system" }` entry before
 *    dispatch, so callers can pass it either way.
 *  - Anthropic's API uses a separate `system` parameter rather than embedding
 *    the system prompt inside the `messages` array, so this adapter handles
 *    that translation transparently.
 *  - The return value is always a plain string (the assistant's reply content)
 *    so callers never touch provider-specific response objects.
 *  - RAG embedding calls (OpenAI text-embedding-3-small) are NOT routed through
 *    this adapter — they always use OpenAI regardless of the active chat provider.
 *  - Passing an unrecognised `provider` value throws a descriptive error
 *    immediately rather than silently falling back to a default.
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AiProvider = 'openai' | 'anthropic';

/**
 * A single chat message in the normalised format understood by both providers.
 * The `system` role is only valid as the first message; subsequent messages
 * must be `user` or `assistant`.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GetChatCompletionParams {
  /** Which AI provider to call (`"openai"` or `"anthropic"`). */
  provider: AiProvider;
  /** Raw API key for the chosen provider. */
  apiKey: string;
  /** Model identifier (e.g. `"gpt-4o"`, `"claude-3-5-sonnet-20241022"`). */
  model: string;
  /**
   * Optional system-level instruction.  When provided it is prepended to the
   * `messages` array as `{ role: "system", content: systemPrompt }` before
   * the request is dispatched, giving callers the flexibility to pass the
   * system prompt either inline (in `messages`) or separately (here).
   */
  systemPrompt?: string;
  /** Conversation messages (may include a leading system message). */
  messages: ChatMessage[];
}

// ---------------------------------------------------------------------------
// Default models — used when the stored model field is null/empty
// ---------------------------------------------------------------------------

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-3-5-sonnet-20241022';

/**
 * Maximum number of tokens to request from Anthropic.
 * OpenAI infers a sensible default, but Anthropic requires an explicit value.
 */
const ANTHROPIC_MAX_TOKENS = 2048;

// ---------------------------------------------------------------------------
// getChatCompletion
// ---------------------------------------------------------------------------

/**
 * Send a chat completion request to the active AI provider and return the
 * assistant's reply as a plain string.
 *
 * The return value is the normalised `content` string — callers never need
 * to unwrap a provider-specific response object.
 *
 * @param params.provider     - `"openai"` or `"anthropic"`
 * @param params.apiKey       - Raw API key for the chosen provider
 * @param params.model        - Model identifier (e.g. `"gpt-4o"`, `"claude-3-5-sonnet-20241022"`)
 * @param params.systemPrompt - Optional system instruction prepended to the message list
 * @param params.messages     - Conversation messages including an optional leading system message
 * @returns                     The assistant's reply content (never null — falls back to `""`)
 *
 * @throws {Error} If `provider` is not one of the supported values.
 * @throws         Will re-throw any SDK errors (invalid key, rate-limit, network failure).
 */
export async function getChatCompletion(
  params: GetChatCompletionParams
): Promise<string> {
  const { provider, apiKey, model, systemPrompt, messages } = params;

  // Merge the optional systemPrompt into the messages array so the rest of
  // the function operates on a single, unified list.
  const resolvedMessages: ChatMessage[] =
    systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

  if (provider === 'openai') {
    return callOpenAI(apiKey, model, resolvedMessages);
  }

  if (provider === 'anthropic') {
    return callAnthropic(apiKey, model, resolvedMessages);
  }

  // Exhaustive guard — throws a descriptive error for any unrecognised value.
  throw new Error(
    `Unsupported AI provider: "${provider as string}". Valid options are "openai" and "anthropic".`
  );
}

// ---------------------------------------------------------------------------
// Provider-specific implementations
// ---------------------------------------------------------------------------

async function callOpenAI(
  apiKey: string,
  model: string,
  messages: ChatMessage[]
): Promise<string> {
  const client = new OpenAI({ apiKey });

  const completion = await client.chat.completions.create({
    model,
    messages,
  });

  return completion.choices[0]?.message?.content ?? '';
}

async function callAnthropic(
  apiKey: string,
  model: string,
  messages: ChatMessage[]
): Promise<string> {
  const client = new Anthropic({ apiKey });

  // Anthropic's API separates the system prompt from the conversation turns.
  // Extract a leading system message (if present) and pass it via the dedicated
  // `system` parameter; remaining messages become the `messages` array.
  let system: string | undefined;
  let conversationMessages = messages;

  if (messages.length > 0 && messages[0].role === 'system') {
    system = messages[0].content;
    conversationMessages = messages.slice(1);
  }

  // Anthropic requires messages to alternate user/assistant and must start
  // with a user message.  The rag-service already constructs the array in
  // this shape (system → user/assistant history → user question), so non-user
  // and non-assistant roles are filtered out defensively.
  const anthropicMessages: Anthropic.MessageParam[] = conversationMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  const response = await client.messages.create({
    model,
    max_tokens: ANTHROPIC_MAX_TOKENS,
    ...(system ? { system } : {}),
    messages: anthropicMessages,
  });

  // Extract text from the first content block.
  const block = response.content[0];
  if (block && block.type === 'text') {
    return block.text;
  }

  return '';
}
