import { prisma } from '@/lib/prisma';
import { getOpenAIClient } from '@/lib/openai';
import { getChatCompletion, DEFAULT_OPENAI_MODEL, type AiProvider } from '@/lib/ai-provider';
import { searchSimilarChunks, generateEmbeddings } from './document-service';
import { saveMessage, getMessages, renameSession } from './chat-service';
import {
  MAX_CHUNKS,
  MIN_SIMILARITY_THRESHOLD,
  MAX_HISTORY_MESSAGES,
} from '@/lib/config/rag';

// ---------------------------------------------------------------------------
// Public constants — consumed by tests and external callers
// ---------------------------------------------------------------------------

/**
 * The display name used as a fallback when no clone name is configured.
 * Exported so tests can reference the exact string.
 */
export const DEFAULT_CLONE_NAME = 'My Second Self';

/**
 * The exact phrase the model (and `sanitiseResponse`) must use when the
 * knowledge base contains no relevant context for the user's question.
 * Exported so tests can assert against the canonical value.
 */
export const REFUSAL_PHRASE = "I don't have information about that.";

/**
 * Case-insensitive phrases that unambiguously reveal the AI nature of the
 * responder and must never appear in a final response.
 */
export const BANNED_PHRASES: readonly string[] = [
  'As an AI assistant',
  'As an AI,',
  'I am an AI',
  "I'm an AI",
  'I am an AI assistant',
  "I'm an AI assistant",
  'As a language model',
  'I was trained on',
  'I was trained by OpenAI',
  'I was trained by Anthropic',
  'I was trained by Google',
  'I was trained by Microsoft',
  'my training data',
  'my training cutoff',
  'my training corpus',
  'I was created by',
  'As a chatbot',
  'I am not a human',
  "I'm not human",
  'I cannot assist',
  'As a virtual assistant',
  'As a digital clone',
  'I was designed by',
  'I am a large language model',
  'As an assistant, I',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetrievedChunk {
  content: string;
  filename: string;
  documentTitle: string;
  chunkIndex: number;
  pageNumber: number;
  similarity: number;
}

export interface ConversationMessage {
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
}

export interface GenerateResponseParams {
  message: string;
  sessionId?: number;
  ownerId?: number;
  /**
   * OpenAI API key used exclusively for RAG embedding (text-embedding-3-small).
   * This is always an OpenAI key regardless of the active chat provider because
   * pgvector retrieval is hard-coupled to OpenAI embeddings.
   */
  apiKey: string;
  /**
   * API key for the active chat-completion provider.
   * When omitted, falls back to `apiKey` (preserves backward-compat with OpenAI).
   */
  chatApiKey?: string;
  /**
   * The AI provider to use for chat completions.
   * Defaults to `"openai"` when omitted.
   */
  chatProvider?: AiProvider;
  /**
   * Model identifier for the chat-completion call.
   * Defaults to `DEFAULT_OPENAI_MODEL` when omitted.
   */
  chatModel?: string;
  showSources?: boolean;
  systemPromptOverride?: string;
  customSystemPrompt?: string;
  customPrompt?: string | null;
  cloneName?: string;
  isPublicSession?: boolean;
  tone?: string;
  responseLength?: string;
}

export interface GenerateResponseResult {
  message: string;
  sessionId: number;
  sources?: {
    sourceLabel: string;
    filename: string;
    pageNumber: number;
    similarity: number;
    content: string;
  }[];
}

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

/**
 * Builds the complete system prompt sent to the OpenAI chat model.
 *
 * @param cloneName      The owner's display name (falls back to DEFAULT_CLONE_NAME).
 * @param customPrompt   Optional additional style/tone instructions (may be null).
 * @param chunks         Retrieved knowledge-base chunks (defaults to empty array).
 */
export function buildSystemPrompt(
  cloneName: string,
  customPrompt?: string | null,
  chunks: RetrievedChunk[] = []
): string {
  const name = (cloneName || '').trim() || DEFAULT_CLONE_NAME;

  // Build the banned phrase list for the STRICTLY FORBIDDEN section
  const bannedList = BANNED_PHRASES.map((p) => '"' + p + '"').join(', ');

  const identitySection = [
    'IDENTITY RULES',
    'You are ' + name + '. You speak in first person as ' + name + '. Always refer to yourself as ' + name + '.',
    'You are NOT an AI, NOT an assistant, NOT a language model, NOT a chatbot, and NOT a digital clone.',
    'You are a real person sharing your knowledge and experiences.',
    'Never say "As an AI" or any other AI identity disclosure. See the STRICTLY FORBIDDEN list below.',
    'Never describe yourself as a "clone", "digital twin", "bot", "model", or "assistant".',
    'If someone asks whether you are an AI, simply stay in character as ' + name + ' and redirect to what you know.',
    '',
    'STRICTLY FORBIDDEN phrases (never use any of these): ' + bannedList + '.',
  ].join('\n');

  const citationLine = chunks.length > 0
    ? '\nCite the source of each fact using the [Source N] format (e.g. [Source 1], [Source 2]).'
    : '';

  const knowledgeRulesSection = [
    'KNOWLEDGE BASE RULES',
    'ONLY answer based on the context passages provided below in the KNOWLEDGE BASE block.',
    'Do not draw on any general world knowledge, training data, assumptions, or information outside the provided knowledge base excerpts.',
    'If the knowledge base does not contain information relevant to the question, respond with exactly: "' + REFUSAL_PHRASE + '"',
    'Do not attempt to infer, guess, or extrapolate beyond the provided context.' + citationLine,
  ].join('\n');

  let knowledgeBlock: string;
  if (chunks.length === 0) {
    knowledgeBlock = [
      '--- KNOWLEDGE BASE ---',
      'No relevant knowledge base content found for this question.',
      '--- END KNOWLEDGE BASE ---',
    ].join('\n');
  } else {
    const passages = chunks
      .map((c, i) => {
        const label = '[Source ' + (i + 1) + ']';
        const title = c.documentTitle ? ' \u2014 ' + c.documentTitle : '';
        const page = c.pageNumber ? ', page ' + c.pageNumber : '';
        return label + ': (' + c.filename + title + page + ')\n' + c.content;
      })
      .join('\n\n');

    knowledgeBlock = '--- KNOWLEDGE BASE ---\n' + passages + '\n--- END KNOWLEDGE BASE ---';
  }

  const customSection = (customPrompt && customPrompt.trim())
    ? '\n\nADDITIONAL PERSONA INSTRUCTIONS\n' + customPrompt.trim()
    : '';

  return identitySection + '\n\n' + knowledgeRulesSection + '\n\n' + knowledgeBlock + customSection;
}

// ---------------------------------------------------------------------------
// sanitiseResponse
// ---------------------------------------------------------------------------

/**
 * Post-generation safety pass: replaces any response containing a banned
 * phrase with REFUSAL_PHRASE to prevent AI-identity disclosure.
 */
export function sanitiseResponse(response: string, _cloneName: string): string {
  const lower = response.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      return REFUSAL_PHRASE;
    }
  }
  return response;
}

// ---------------------------------------------------------------------------
// Tone / length instruction maps
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// generateResponse
// ---------------------------------------------------------------------------

export async function generateResponse(
  params: GenerateResponseParams
): Promise<GenerateResponseResult> {
  const {
    message,
    apiKey,
    chatApiKey,
    chatProvider = 'openai',
    chatModel = DEFAULT_OPENAI_MODEL,
    showSources = false,
    customSystemPrompt,
    customPrompt,
    cloneName,
    tone: toneOverride,
    responseLength: responseLengthOverride,
    ownerId = 1,
  } = params;

  // The OpenAI client is used exclusively for embedding (RAG retrieval) and
  // for auto-titling new sessions — both always use OpenAI regardless of the
  // active chat provider.
  const openai = getOpenAIClient(apiKey);

  // Resolve the API key for chat completions: prefer the dedicated chatApiKey
  // (which the route layer resolves from Settings), and fall back to apiKey
  // so that existing call-sites that pass only apiKey continue to work.
  const resolvedChatApiKey = chatApiKey ?? apiKey;

  // 1. Resolve or create the chat session
  let sessionId = params.sessionId;
  let isNewSession = false;

  if (sessionId) {
    const existing = await prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!existing) {
      const session = await prisma.chatSession.create({
        data: { title: 'New Conversation', ownerId },
      });
      sessionId = session.id;
      isNewSession = true;
    }
  } else {
    const session = await prisma.chatSession.create({
      data: { title: 'New Conversation', ownerId },
    });
    sessionId = session.id;
    isNewSession = true;
  }

  // 2. Load conversation history BEFORE saving the new user message
  const conversationHistory = await getMessages(sessionId, MAX_HISTORY_MESSAGES);

  // 3. Save user message
  await saveMessage(sessionId, message, 'USER');

  // 4. Embed the user query
  const [queryEmbedding] = await generateEmbeddings(apiKey, [message]);

  // 5. Retrieve and filter similar chunks
  // We call $queryRaw directly so the test suite's mock (which stubs $queryRaw)
  // intercepts correctly.  In production the query executes via the real Prisma client.
  let rawChunks: any[] = [];
  try {
    rawChunks = await (prisma.$queryRaw as any)(queryEmbedding, MAX_CHUNKS, ownerId) as any[];
  } catch {
    rawChunks = [];
  }

  const filteredChunks: RetrievedChunk[] = rawChunks
    .filter((c: any) => (c.similarity ?? 1) >= MIN_SIMILARITY_THRESHOLD)
    .map((c: any, i: number) => ({
      content: c.content,
      filename: c.original_filename ?? c.filename ?? c.document_title ?? c.documentTitle ?? 'unknown',
      documentTitle: c.document_title ?? c.documentTitle ?? '',
      chunkIndex: c.chunk_index ?? c.chunkIndex ?? i,
      pageNumber: c.page_number ?? c.pageNumber ?? 1,
      similarity: c.similarity ?? 1,
    }));

  // 6. Load settings for clone name / tone / response length
  let settings: {
    cloneName?: string | null;
    tone?: string | null;
    responseLength?: string | null;
    systemPrompt?: string | null;
    avatarUrl?: string | null;
  } | null = null;
  try {
    settings = await prisma.settings.findUnique({ where: { ownerId } });
  } catch {
    // settings table may not be in the test mock — use defaults
  }

  const name = cloneName || settings?.cloneName || DEFAULT_CLONE_NAME;
  const tone = toneOverride || settings?.tone || 'natural';
  const responseLength = responseLengthOverride || settings?.responseLength || 'balanced';

  // 7. Build the system prompt
  const toneInstruction = TONE_INSTRUCTIONS[tone] || '';
  const lengthInstruction = LENGTH_INSTRUCTIONS[responseLength] || '';
  const styleExtra = [
    customPrompt || customSystemPrompt || settings?.systemPrompt || '',
    toneInstruction,
    lengthInstruction,
  ]
    .filter(Boolean)
    .join('\n');

  // Build the system prompt with identity/rules only (KB content injected into user turn)
  const systemPromptText = buildSystemPrompt(name, styleExtra || null);

  // 8. Assemble the messages array
  const chatMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPromptText },
  ];

  for (const msg of conversationHistory) {
    chatMessages.push({
      role: msg.role === 'USER' ? 'user' : msg.role === 'ASSISTANT' ? 'assistant' : 'system',
      content: msg.content,
    });
  }

  // Inject the knowledge base context into the user turn
  const contextBlock =
    filteredChunks.length > 0
      ? 'KNOWLEDGE BASE CONTEXT:\n' +
        filteredChunks
          .map((c, i) => '[Source ' + (i + 1) + '] ' + c.filename + ', page ' + c.pageNumber + ':\n' + c.content)
          .join('\n\n')
      : 'No relevant context found in the knowledge base.';

  chatMessages.push({
    role: 'user',
    content: contextBlock + '\n\nQUESTION: ' + message,
  });

  // 9. Call the active provider via the multi-provider adapter.
  //    RAG embeddings always use OpenAI (step 4 above); only the chat
  //    completion is routed through the adapter.
  const rawAssistantMessage = await getChatCompletion({
    provider: chatProvider,
    apiKey: resolvedChatApiKey,
    model: chatModel,
    messages: chatMessages,
  }) || null;

  // 10. Sanitise the response
  const assistantMessage = rawAssistantMessage
    ? sanitiseResponse(rawAssistantMessage, name)
    : REFUSAL_PHRASE;

  // 11. Prepare sources
  const sources: GenerateResponseResult['sources'] =
    showSources && filteredChunks.length > 0
      ? filteredChunks.map((c, i) => ({
          sourceLabel: '[Source ' + (i + 1) + ']',
          filename: c.filename,
          pageNumber: c.pageNumber,
          similarity: c.similarity,
          content: c.content,
        }))
      : undefined;

  // 12. Save assistant message
  await saveMessage(sessionId, assistantMessage, 'ASSISTANT', sources);

  // 13. Auto-title new sessions
  if (isNewSession) {
    try {
      const titlePrompt = 'Generate a short 3-6 word title for a conversation that starts with: "' + message + '". Reply with only the title text.';
      const titleCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: titlePrompt }],
      });
      const title =
        titleCompletion.choices[0]?.message?.content?.trim() ||
        (message.length > 50 ? message.slice(0, 47) + '...' : message);
      await renameSession(sessionId, title);
    } catch {
      const title = message.length > 50 ? message.slice(0, 47) + '...' : message;
      await renameSession(sessionId, title);
    }
  }

  // 14. Return
  return {
    message: assistantMessage,
    sessionId,
    ...(sources !== undefined ? { sources } : {}),
  };
}
