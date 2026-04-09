import { prisma } from '@/lib/prisma';
import { getOpenAIClient } from '@/lib/openai';
import { searchSimilarChunks, generateEmbeddings } from './document-service';
import { createSession, saveMessage, getMessages, renameSession } from './chat-service';

interface GenerateResponseParams {
  message: string;
  sessionId?: number;
  apiKey: string;
  showSources?: boolean;
  systemPromptOverride?: string;
  customSystemPrompt?: string;
  customPrompt?: string | null;
  cloneName?: string;
  isPublicSession?: boolean;
  tone?: string;
  responseLength?: string;
}

interface GenerateResponseResult {
  message: string;
  sessionId: number;
  sources?: {
    filename: string;
    pageNumber: number;
    content: string;
  }[];
}

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

/**
 * RAG pipeline: embed query, retrieve context, generate response via OpenAI.
 */
export async function generateResponse(
  params: GenerateResponseParams
): Promise<GenerateResponseResult> {
  const {
    message,
    apiKey,
    showSources = true,
    systemPromptOverride,
    customSystemPrompt,
    customPrompt,
    cloneName,
    tone: toneOverride,
    responseLength: responseLengthOverride,
  } = params;

  const openai = getOpenAIClient(apiKey);

  // 1. Get or create session
  let sessionId = params.sessionId;
  let isNewSession = false;
  if (!sessionId) {
    const session = await createSession();
    sessionId = session.id;
    isNewSession = true;
  }

  // 2. Load conversation history BEFORE saving the new user message (last 20 messages)
  const conversationHistory = await getMessages(sessionId, 20);

  // 3. Save user message
  await saveMessage(sessionId, message, 'USER');

  // 4. Embed the user query
  const [queryEmbedding] = await generateEmbeddings(apiKey, [message]);

  // 5. Search for similar chunks
  const chunks = await searchSimilarChunks(queryEmbedding, 5);

  // 6. Load settings from DB
  const settings = await prisma.settings.findUnique({
    where: { ownerId: 1 },
  });

  const name = cloneName || settings?.cloneName || 'the user';
  const basePrompt = `You are ${name}'s Second Self. Speak in first person as if you are ${name}. Infer tone, style, and manner of expression from the provided knowledge base context. Be natural, personal, and human. Do not sound robotic. Only make claims supported by the retrieved knowledge. If something is unknown or unsupported, say so honestly and naturally. Do not mention that you are an AI unless explicitly asked.`;
  // customPrompt (from buildCustomPrompt) already includes tone + length instructions.
  // Fall back to the legacy per-field overrides if customPrompt is not provided.
  const extra = customPrompt || systemPromptOverride || customSystemPrompt || settings?.systemPrompt || '';
  const systemPrompt = extra ? `${basePrompt}\n\n${extra}` : basePrompt;
  const tone = toneOverride || settings?.tone || 'natural';
  const responseLength =
    responseLengthOverride || settings?.responseLength || 'balanced';

  // 7. Build the system prompt with knowledge context
  // If customPrompt was provided, tone/length are already baked in — skip duplicating.
  const toneInstruction = customPrompt ? '' : (TONE_INSTRUCTIONS[tone] || '');
  const lengthInstruction = customPrompt ? '' : (LENGTH_INSTRUCTIONS[responseLength] || '');

  let knowledgeContext: string;
  if (chunks.length > 0) {
    const contextParts = chunks.map(
      (c) =>
        `[Source: ${c.original_filename}, Page ${c.page_number}]\n${c.content}`
    );
    knowledgeContext = `Knowledge base context:\n---\n${contextParts.join('\n\n')}\n---`;
  } else {
    knowledgeContext =
      'Note: No relevant information was found in the knowledge base for this query.';
  }

  const fullSystemPrompt = [
    systemPrompt,
    '',
    toneInstruction,
    lengthInstruction,
    '',
    knowledgeContext,
    '',
    'If the knowledge base context does not contain relevant information to answer the question, say so naturally. Do not make up information.',
  ]
    .filter((line) => line !== undefined)
    .join('\n')
    .trim();

  // 8. Build the messages array for OpenAI from history loaded before saving
  const openaiMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: fullSystemPrompt },
  ];

  // Add conversation history (loaded before the new user message was saved, so no deduplication needed)
  for (const msg of conversationHistory) {
    openaiMessages.push({
      role: msg.role === 'USER' ? 'user' : msg.role === 'ASSISTANT' ? 'assistant' : 'system',
      content: msg.content,
    });
  }

  // Add the new user message
  openaiMessages.push({ role: 'user', content: message });

  // 9. Call OpenAI chat completion
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: openaiMessages,
  });

  const assistantMessage =
    completion.choices[0]?.message?.content || 'I was unable to generate a response.';

  // 10. Prepare sources
  const sources = showSources && chunks.length > 0
    ? chunks.map((c) => ({
        filename: c.original_filename,
        pageNumber: c.page_number,
        content: c.content,
      }))
    : undefined;

  // 11. Save assistant message with sources
  await saveMessage(sessionId, assistantMessage, 'ASSISTANT', sources);

  // 12. Auto-title new sessions based on first message
  if (isNewSession) {
    const title = message.length > 50 ? message.slice(0, 47) + '...' : message;
    await renameSession(sessionId, title);
  }

  // 13. Return result
  return {
    message: assistantMessage,
    sessionId,
    sources,
  };
}
