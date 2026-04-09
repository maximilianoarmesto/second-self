/**
 * Builds a composite custom prompt string from the user's Settings fields.
 * Combines systemPrompt, tone, and responseLength into a single string
 * that can be appended after the base persona rules in the RAG service.
 */

const TONE_INSTRUCTIONS: Record<string, string> = {
  natural: '',
  professional: 'Respond in a professional tone.',
  casual: 'Respond casually.',
  academic: 'Respond in an academic tone.',
  friendly: 'Respond in a warm, friendly tone.',
};

const LENGTH_INSTRUCTIONS: Record<string, string> = {
  concise: 'Keep responses brief and to the point.',
  balanced: '',
  detailed: 'Provide detailed, thorough responses.',
};

export function buildCustomPrompt(
  systemPrompt: string | null,
  tone: string | null,
  responseLength: string | null,
): string | null {
  const parts: string[] = [];

  if (systemPrompt) {
    parts.push(systemPrompt);
  }

  const toneInstruction = tone ? TONE_INSTRUCTIONS[tone] || '' : '';
  if (toneInstruction) {
    parts.push(toneInstruction);
  }

  const lengthInstruction = responseLength ? LENGTH_INSTRUCTIONS[responseLength] || '' : '';
  if (lengthInstruction) {
    parts.push(lengthInstruction);
  }

  return parts.length > 0 ? parts.join('\n') : null;
}
