/**
 * Shape of the data returned by GET /api/settings and PUT /api/settings.
 *
 * `openaiApiKeyEncrypted` is never sent to the client; instead the server
 * returns a masked representation so the UI can show whether a key is stored
 * without exposing the raw value.
 *
 * `anthropicApiKey` is similarly masked — the raw value is never returned;
 * the client receives `anthropicApiKeyMasked` instead.
 */
export interface SettingsData {
  id: number;
  ownerId: number;
  cloneName: string;
  systemPrompt: string;
  tone: string;
  responseLength: string;
  /** Relative URL of the owner's uploaded avatar image, or null when unset. */
  avatarUrl: string | null;
  openaiApiKeyMasked: string | null;
  /** Masked representation of the stored Anthropic API key, or null when unset. */
  anthropicApiKeyMasked: string | null;
  /** Which AI provider to use for chat completions. */
  aiProvider: 'openai' | 'anthropic';
  /** OpenAI model identifier, e.g. "gpt-4o". */
  openaiModel: string | null;
  /** Anthropic model identifier, e.g. "claude-3-5-sonnet-20241022". */
  anthropicModel: string | null;
  updatedAt: string;
}
