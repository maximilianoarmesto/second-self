/**
 * Shape of the data returned by GET /api/settings and PUT /api/settings.
 *
 * `openaiApiKeyEncrypted` is never sent to the client; instead the server
 * returns a masked representation so the UI can show whether a key is stored
 * without exposing the raw value.
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
  updatedAt: string;
}
