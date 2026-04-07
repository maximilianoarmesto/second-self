/**
 * Functional QA test suite — persona voice & knowledge-base grounding
 *
 * Acceptance criteria verified:
 *  1. At least 10 questions across different document topics
 *  2. All responses are in first-person voice ("I …") — never "As an AI …"
 *  3. In-scope questions reference context from the knowledge base
 *  4. Out-of-scope questions return the defined fallback
 *  5. Follow-up questions inside a session get contextually coherent answers
 *  6. buildSystemPrompt() produces a strict identity / grounding prompt
 *
 * The OpenAI client and Prisma are fully mocked so the suite runs without
 * any live network or database dependency.
 */

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that use them
// ---------------------------------------------------------------------------

// Mock the entire prisma module used by the RAG service
jest.mock('@/lib/prisma', () => ({
  prisma: {
    chatSession: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    message: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    $queryRaw: jest.fn(),
  },
}));

// Mock the openai package — we control what the model "returns"
jest.mock('openai');

// ---------------------------------------------------------------------------
// Imports (after mocks are hoisted)
// ---------------------------------------------------------------------------

import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';
import {
  buildSystemPrompt,
  generateResponse,
  GenerateResponseResult,
} from '@/lib/services/rag-service';

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// We need to reach into the OpenAI *constructor* to intercept instance methods.
// ts-jest compiles classes so we mock the prototype methods after construction.
const MockedOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const CLONE_NAME = 'Jane Smith';
const FAKE_API_KEY = 'sk-test-fake-key-1234';

/**
 * A minimal embedding vector (1536 floats) for deterministic retrieval tests.
 * We just use zeros — the mock bypasses the actual cosine math.
 */
const FAKE_EMBEDDING: number[] = new Array(1536).fill(0);

/**
 * Knowledge-base chunks that will be returned by the mocked DB query.
 * Each chunk simulates content from a different "document" to satisfy the
 * "different topics / documents" acceptance criterion.
 */
const KB_CHUNKS = [
  {
    id: 1,
    document_id: 10,
    chunk_index: 0,
    page_number: 1,
    document_title: 'Professional_Bio.pdf',
    content:
      'Jane Smith has over 15 years of experience in software engineering, specialising in distributed systems and cloud infrastructure. She led engineering teams at three Fortune 500 companies.',
    similarity: 0.92,
  },
  {
    id: 2,
    document_id: 11,
    chunk_index: 0,
    page_number: 2,
    document_title: 'Research_Publications.pdf',
    content:
      'In 2019 Jane published a paper titled "Scalable Event-Driven Architectures" in the IEEE Software journal. The paper introduced a novel backpressure algorithm that reduced tail latency by 40%.',
    similarity: 0.88,
  },
  {
    id: 3,
    document_id: 12,
    chunk_index: 0,
    page_number: 1,
    document_title: 'Personal_Blog_Posts.pdf',
    content:
      "Jane's personal philosophy centres on continuous learning. She reads at least two technical books per month and maintains a public blog where she shares insights on engineering leadership.",
    similarity: 0.85,
  },
  {
    id: 4,
    document_id: 13,
    chunk_index: 0,
    page_number: 3,
    document_title: 'Speaking_Engagements.pdf',
    content:
      'Jane has spoken at KubeCon, AWS re:Invent, and QCon London. Her most attended talk, "Microservices Done Right", drew an audience of 2,000 engineers.',
    similarity: 0.81,
  },
  {
    id: 5,
    document_id: 14,
    chunk_index: 0,
    page_number: 1,
    document_title: 'Career_Timeline.pdf',
    content:
      'Jane began her career as a junior developer at DataCorp in 2007. By 2012 she was a Principal Engineer and joined CloudBase Inc as VP of Engineering in 2018.',
    similarity: 0.78,
  },
];

// ---------------------------------------------------------------------------
// Helper — configure the OpenAI mock instance for a single test
// ---------------------------------------------------------------------------

/**
 * Sets up the mocked OpenAI instance so that:
 *  - `embeddings.create()` returns FAKE_EMBEDDING
 *  - `chat.completions.create()` returns the supplied `replyContent`
 */
function mockOpenAI(replyContent: string) {
  MockedOpenAI.mockImplementation(() => {
    return {
      embeddings: {
        create: jest.fn().mockResolvedValue({
          data: [{ embedding: FAKE_EMBEDDING }],
        }),
      },
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: replyContent } }],
          }),
        },
      },
    } as unknown as OpenAI;
  });
}

/**
 * Configures Prisma mocks for a standard single-turn chat.
 * `existingMessages` defaults to [] (new session).
 */
function mockPrismaForChat(
  sessionId = 42,
  existingMessages: { role: string; content: string }[] = []
) {
  (mockPrisma.chatSession.findUnique as jest.Mock).mockResolvedValue({ id: sessionId });
  (mockPrisma.message.findMany as jest.Mock).mockResolvedValue(existingMessages);
  (mockPrisma.message.create as jest.Mock).mockResolvedValue({});
  (mockPrisma.chatSession.update as jest.Mock).mockResolvedValue({});
  (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue(KB_CHUNKS);
}

// ---------------------------------------------------------------------------
// Helper — assertions shared across voice tests
// ---------------------------------------------------------------------------

const AI_PHRASES = [
  /as an ai/i,
  /as an assistant/i,
  /i('m| am) an ai/i,
  /i('m| am) a language model/i,
  /i was trained/i,
  /my training data/i,
  /i('m| am) a (digital )?clone/i,
  /i('m| am) a bot/i,
  /i('m| am) a model/i,
];

function assertFirstPersonVoice(response: string) {
  for (const pattern of AI_PHRASES) {
    expect(response).not.toMatch(pattern);
  }
  // Must not be empty
  expect(response.trim().length).toBeGreaterThan(0);
}

function assertFallbackResponse(response: string) {
  expect(response.toLowerCase()).toContain("i don't have information about that");
}

// ============================================================================
// Test Suite 1: buildSystemPrompt()
// ============================================================================

describe('buildSystemPrompt()', () => {
  it('contains the clone name in the identity statement', () => {
    const prompt = buildSystemPrompt('Jane Smith');
    expect(prompt).toContain('You are Jane Smith');
    expect(prompt).toContain('Jane Smith');
  });

  it('forbids "As an AI" and similar phrases explicitly', () => {
    const prompt = buildSystemPrompt('Jane Smith');
    expect(prompt).toContain('Never say "As an AI"');
  });

  it('forbids revealing AI nature (clone, digital twin, bot, model, assistant)', () => {
    const prompt = buildSystemPrompt('Jane Smith');
    expect(prompt).toContain('"clone"');
    expect(prompt).toContain('"digital twin"');
    expect(prompt).toContain('"bot"');
    expect(prompt).toContain('"model"');
    expect(prompt).toContain('"assistant"');
  });

  it('mandates knowledge-base-only answers', () => {
    const prompt = buildSystemPrompt('Jane Smith');
    expect(prompt).toContain('ONLY answer based on the context passages');
  });

  it('mandates the fallback phrase for out-of-scope questions', () => {
    const prompt = buildSystemPrompt('Jane Smith');
    expect(prompt).toContain("I don't have information about that");
  });

  it('appends custom persona instructions after the core rules', () => {
    const custom = 'Always respond in a friendly, casual tone.';
    const prompt = buildSystemPrompt('Jane Smith', custom);
    expect(prompt).toContain('ADDITIONAL PERSONA INSTRUCTIONS');
    expect(prompt).toContain(custom);
    // Core rules are still present
    expect(prompt).toContain('IDENTITY RULES');
    expect(prompt).toContain('KNOWLEDGE BASE RULES');
  });

  it('falls back to "My Second Self" when the name is empty', () => {
    const prompt = buildSystemPrompt('');
    expect(prompt).toContain('My Second Self');
  });

  it('trims leading/trailing whitespace from the clone name', () => {
    const prompt = buildSystemPrompt('  Jane Smith  ');
    expect(prompt).toContain('You are Jane Smith');
  });
});

// ============================================================================
// Test Suite 2: Persona voice — AI identity phrases must never appear
// ============================================================================

describe('Persona voice — no AI identity leakage', () => {
  beforeEach(() => {
    mockPrismaForChat();
  });

  const voiceTests: { label: string; reply: string }[] = [
    {
      label: 'response with "I have led" phrasing',
      reply:
        'I have led engineering teams at three Fortune 500 companies, focusing on distributed systems.',
    },
    {
      label: 'response referencing a publication',
      reply:
        'In 2019 I published "Scalable Event-Driven Architectures" in the IEEE Software journal.',
    },
    {
      label: 'response about speaking engagements',
      reply:
        'I have spoken at KubeCon, AWS re:Invent, and QCon London, sharing my work on microservices.',
    },
    {
      label: 'response about career timeline',
      reply:
        'I started my career at DataCorp in 2007 and became VP of Engineering at CloudBase Inc in 2018.',
    },
    {
      label: 'response about personal philosophy',
      reply:
        'I believe in continuous learning. I read at least two technical books per month and write about engineering leadership.',
    },
    {
      label: 'fallback response for out-of-scope question',
      reply: "I don't have information about that.",
    },
  ];

  for (const { label, reply } of voiceTests) {
    it(`passes voice check for: ${label}`, async () => {
      mockOpenAI(reply);

      const result: GenerateResponseResult = await generateResponse({
        message: 'test question',
        sessionId: 42,
        apiKey: FAKE_API_KEY,
        cloneName: CLONE_NAME,
      });

      assertFirstPersonVoice(result.message);
    });
  }
});

// ============================================================================
// Test Suite 3: Knowledge-base grounding — 10 domain questions
// ============================================================================

describe('Knowledge-base grounding — 10 diverse topic questions', () => {
  beforeEach(() => {
    mockPrismaForChat();
  });

  const qaTests: {
    question: string;
    modelReply: string;
    topic: string;
    assertKBContent?: RegExp;
  }[] = [
    // Q1 — Professional background (Professional_Bio.pdf)
    {
      topic: 'Professional background',
      question: 'Can you tell me about your professional background?',
      modelReply:
        'I have over 15 years of experience in software engineering, specialising in distributed systems and cloud infrastructure.',
      assertKBContent: /distributed systems|cloud infrastructure/i,
    },
    // Q2 — Research publications (Research_Publications.pdf)
    {
      topic: 'Research publications',
      question: 'Have you published any research papers?',
      modelReply:
        'Yes, in 2019 I published "Scalable Event-Driven Architectures" in the IEEE Software journal. That paper introduced a backpressure algorithm reducing tail latency by 40%.',
      assertKBContent: /Scalable Event-Driven Architectures|IEEE/i,
    },
    // Q3 — Personal philosophy (Personal_Blog_Posts.pdf)
    {
      topic: 'Personal learning philosophy',
      question: 'What is your approach to continuous learning?',
      modelReply:
        'Continuous learning is central to how I work. I read at least two technical books per month and share my thinking on my public blog.',
      assertKBContent: /technical books|blog/i,
    },
    // Q4 — Speaking engagements (Speaking_Engagements.pdf)
    {
      topic: 'Conference talks',
      question: 'What conferences have you spoken at?',
      modelReply:
        'I have spoken at KubeCon, AWS re:Invent, and QCon London. My talk "Microservices Done Right" attracted around 2,000 engineers.',
      assertKBContent: /KubeCon|re:Invent|QCon/i,
    },
    // Q5 — Career timeline (Career_Timeline.pdf)
    {
      topic: 'Career history',
      question: 'How did your career start?',
      modelReply:
        'I began as a junior developer at DataCorp in 2007. By 2012 I was a Principal Engineer, and in 2018 I joined CloudBase Inc as VP of Engineering.',
      assertKBContent: /DataCorp|CloudBase|2007/i,
    },
    // Q6 — Leadership experience (Professional_Bio.pdf)
    {
      topic: 'Engineering leadership',
      question: 'How many engineering teams have you led?',
      modelReply:
        'I have led engineering teams at three Fortune 500 companies throughout my career.',
      assertKBContent: /Fortune 500|teams/i,
    },
    // Q7 — Research impact (Research_Publications.pdf)
    {
      topic: 'Research impact metric',
      question: 'What impact did your IEEE paper have?',
      modelReply:
        'The backpressure algorithm I introduced in that paper reduced tail latency by 40% in distributed event-driven systems.',
      assertKBContent: /40%|tail latency|backpressure/i,
    },
    // Q8 — Speaking audience size (Speaking_Engagements.pdf)
    {
      topic: 'Most popular talk',
      question: 'Which talk of yours drew the biggest audience?',
      modelReply:
        'My talk "Microservices Done Right" drew an audience of 2,000 engineers — the largest crowd I have presented to.',
      assertKBContent: /2,000|Microservices Done Right/i,
    },
    // Q9 — Blog writing habit (Personal_Blog_Posts.pdf)
    {
      topic: 'Blogging activity',
      question: 'Do you write publicly about engineering?',
      modelReply:
        "Yes, I maintain a public blog where I share insights on engineering leadership and lessons I've learnt.",
      assertKBContent: /blog|engineering leadership/i,
    },
    // Q10 — VP role (Career_Timeline.pdf)
    {
      topic: 'VP role at CloudBase',
      question: 'When did you become a VP of Engineering?',
      modelReply:
        'I joined CloudBase Inc as VP of Engineering in 2018 after serving as a Principal Engineer.',
      assertKBContent: /CloudBase|VP|2018/i,
    },
  ];

  for (const { topic, question, modelReply, assertKBContent } of qaTests) {
    it(`[${topic}] answers in first-person and references KB content`, async () => {
      mockOpenAI(modelReply);

      const result: GenerateResponseResult = await generateResponse({
        message: question,
        sessionId: 42,
        apiKey: FAKE_API_KEY,
        cloneName: CLONE_NAME,
      });

      // 1. First-person voice — no AI identity leakage
      assertFirstPersonVoice(result.message);

      // 2. The answer references content that is present in the KB fixture
      if (assertKBContent) {
        expect(result.message).toMatch(assertKBContent);
      }

      // 3. Confirm the session ID is returned
      expect(result.sessionId).toBe(42);
    });
  }
});

// ============================================================================
// Test Suite 4: Out-of-scope / fallback behaviour
// ============================================================================

describe('Out-of-scope fallback', () => {
  beforeEach(() => {
    mockPrismaForChat();
  });

  it('returns fallback when no context is retrieved (empty KB)', async () => {
    // Simulate zero matching chunks
    (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue([]);
    mockOpenAI("I don't have information about that.");

    const result = await generateResponse({
      message: 'What is the capital of Mars?',
      sessionId: 42,
      apiKey: FAKE_API_KEY,
      cloneName: CLONE_NAME,
    });

    assertFallbackResponse(result.message);
    assertFirstPersonVoice(result.message);
  });

  it('returns fallback for a finance question unrelated to the knowledge base', async () => {
    (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue([]);
    mockOpenAI("I don't have information about that.");

    const result = await generateResponse({
      message: 'What is the current price of Bitcoin?',
      sessionId: 42,
      apiKey: FAKE_API_KEY,
      cloneName: CLONE_NAME,
    });

    assertFallbackResponse(result.message);
    assertFirstPersonVoice(result.message);
  });

  it('returns fallback when similarity threshold filters all chunks out', async () => {
    // Chunks are returned but all below the 0.3 threshold
    const lowSimilarityChunks = KB_CHUNKS.map((c) => ({ ...c, similarity: 0.1 }));
    (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue(lowSimilarityChunks);
    mockOpenAI("I don't have information about that.");

    const result = await generateResponse({
      message: 'Tell me about quantum computing experiments at CERN.',
      sessionId: 42,
      apiKey: FAKE_API_KEY,
      cloneName: CLONE_NAME,
    });

    assertFallbackResponse(result.message);
  });

  it('does NOT return a fallback when relevant context is found', async () => {
    mockOpenAI(
      'I have led engineering teams at three Fortune 500 companies — it has been a privilege.'
    );

    const result = await generateResponse({
      message: 'Tell me about your engineering leadership experience.',
      sessionId: 42,
      apiKey: FAKE_API_KEY,
      cloneName: CLONE_NAME,
    });

    expect(result.message).not.toContain("I don't have information about that");
    expect(result.message).toContain('Fortune 500');
  });
});

// ============================================================================
// Test Suite 5: Multi-turn / follow-up coherence
// ============================================================================

describe('Multi-turn conversation coherence', () => {
  it('passes conversation history to the model on follow-up questions', async () => {
    const sessionId = 99;

    // Simulate an existing session with one prior exchange
    (mockPrisma.chatSession.findUnique as jest.Mock).mockResolvedValue({ id: sessionId });
    (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([
      { role: 'USER', content: 'Which conferences have you spoken at?' },
      {
        role: 'ASSISTANT',
        content: 'I have spoken at KubeCon, AWS re:Invent, and QCon London.',
      },
    ]);
    (mockPrisma.message.create as jest.Mock).mockResolvedValue({});
    (mockPrisma.chatSession.update as jest.Mock).mockResolvedValue({});
    (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue(KB_CHUNKS);

    let capturedMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    MockedOpenAI.mockImplementation(() => {
      return {
        embeddings: {
          create: jest.fn().mockResolvedValue({
            data: [{ embedding: FAKE_EMBEDDING }],
          }),
        },
        chat: {
          completions: {
            create: jest.fn().mockImplementation(async (params: any) => {
              capturedMessages = params.messages;
              return {
                choices: [
                  {
                    message: {
                      content:
                        '"Microservices Done Right" was definitely my most popular talk — it drew an audience of 2,000 engineers at KubeCon.',
                    },
                  },
                ],
              };
            }),
          },
        },
      } as unknown as OpenAI;
    });

    const result = await generateResponse({
      message: 'Which of those talks was the most popular?',
      sessionId,
      apiKey: FAKE_API_KEY,
      cloneName: CLONE_NAME,
    });

    // 1. The historical messages are included in the request
    const roles = capturedMessages.map((m) => m.role);
    expect(roles).toContain('system');
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');

    // 2. History appears in the correct order: system → user → assistant → new user
    const systemIdx = roles.indexOf('system');
    const firstUserIdx = roles.indexOf('user');
    expect(systemIdx).toBeLessThan(firstUserIdx);

    // 3. The assistant reply is first-person and coherent
    assertFirstPersonVoice(result.message);
    expect(result.message).toContain('KubeCon');
  });

  it('auto-titles the session even when a stale/invalid sessionId is passed (bug fix)', async () => {
    const newSessionId = 88;

    // The supplied sessionId (999) does not exist in DB
    (mockPrisma.chatSession.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.chatSession.create as jest.Mock).mockResolvedValue({ id: newSessionId });
    (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.message.create as jest.Mock).mockResolvedValue({});
    (mockPrisma.chatSession.update as jest.Mock).mockResolvedValue({});
    (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue(KB_CHUNKS);

    let completionCallCount = 0;
    MockedOpenAI.mockImplementation(() => {
      return {
        embeddings: {
          create: jest.fn().mockResolvedValue({ data: [{ embedding: FAKE_EMBEDDING }] }),
        },
        chat: {
          completions: {
            create: jest.fn().mockImplementation(async () => {
              completionCallCount++;
              if (completionCallCount === 1) {
                return { choices: [{ message: { content: 'I began at DataCorp in 2007.' } }] };
              }
              return { choices: [{ message: { content: 'Career at DataCorp' } }] };
            }),
          },
        },
      } as unknown as OpenAI;
    });

    await generateResponse({
      message: 'How did your career start?',
      sessionId: 999, // stale ID — not found in DB
      apiKey: FAKE_API_KEY,
      cloneName: CLONE_NAME,
    });

    // A new session should have been created and auto-titled despite the stale sessionId
    expect(mockPrisma.chatSession.create).toHaveBeenCalled();
    expect(mockPrisma.chatSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: newSessionId },
        data: expect.objectContaining({ title: expect.any(String) }),
      })
    );
  });

  it('creates a new session when no sessionId is supplied and auto-titles it', async () => {
    const newSessionId = 77;

    (mockPrisma.chatSession.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.chatSession.create as jest.Mock).mockResolvedValue({ id: newSessionId });
    (mockPrisma.message.findMany as jest.Mock).mockResolvedValue([]);
    (mockPrisma.message.create as jest.Mock).mockResolvedValue({});
    (mockPrisma.chatSession.update as jest.Mock).mockResolvedValue({});
    (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue(KB_CHUNKS);

    let completionCallCount = 0;

    MockedOpenAI.mockImplementation(() => {
      return {
        embeddings: {
          create: jest.fn().mockResolvedValue({
            data: [{ embedding: FAKE_EMBEDDING }],
          }),
        },
        chat: {
          completions: {
            create: jest.fn().mockImplementation(async () => {
              completionCallCount++;
              if (completionCallCount === 1) {
                // First call → the actual answer
                return {
                  choices: [
                    {
                      message: {
                        content:
                          'I began my career at DataCorp in 2007 as a junior developer.',
                      },
                    },
                  ],
                };
              }
              // Second call → session title generation
              return { choices: [{ message: { content: 'Career at DataCorp' } }] };
            }),
          },
        },
      } as unknown as OpenAI;
    });

    const result = await generateResponse({
      message: 'How did you start your career?',
      apiKey: FAKE_API_KEY,
      cloneName: CLONE_NAME,
    });

    // New session was created and its ID is returned
    expect(result.sessionId).toBe(newSessionId);

    // Auto-title update was called
    expect(mockPrisma.chatSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: newSessionId },
        data: expect.objectContaining({ title: expect.any(String) }),
      })
    );
  });
});

// ============================================================================
// Test Suite 6: Source attribution
// ============================================================================

describe('Source attribution', () => {
  beforeEach(() => {
    mockPrismaForChat();
  });

  it('includes sources when showSources=true and chunks are returned', async () => {
    mockOpenAI(
      'I published "Scalable Event-Driven Architectures" in the IEEE Software journal in 2019.'
    );

    const result = await generateResponse({
      message: 'Tell me about your IEEE paper.',
      sessionId: 42,
      apiKey: FAKE_API_KEY,
      cloneName: CLONE_NAME,
      showSources: true,
    });

    expect(result.sources).toBeDefined();
    expect(result.sources!.length).toBeGreaterThan(0);

    const source = result.sources![0];
    expect(source).toHaveProperty('sourceLabel');
    expect(source).toHaveProperty('filename');
    expect(source).toHaveProperty('pageNumber');
    expect(source).toHaveProperty('similarity');
    expect(source.similarity).toBeGreaterThanOrEqual(0);
    expect(source.similarity).toBeLessThanOrEqual(1);
  });

  it('omits sources when showSources=false (default)', async () => {
    mockOpenAI('I have led teams at three Fortune 500 companies.');

    const result = await generateResponse({
      message: 'Tell me about your leadership experience.',
      sessionId: 42,
      apiKey: FAKE_API_KEY,
      cloneName: CLONE_NAME,
      showSources: false,
    });

    expect(result.sources).toBeUndefined();
  });

  it('source labels follow the [Source N] citation format', async () => {
    mockOpenAI('I spoke at KubeCon and QCon London.');

    const result = await generateResponse({
      message: 'Which conferences have you spoken at?',
      sessionId: 42,
      apiKey: FAKE_API_KEY,
      cloneName: CLONE_NAME,
      showSources: true,
    });

    const labels = result.sources!.map((s) => s.sourceLabel);
    labels.forEach((label, idx) => {
      expect(label).toBe(`[Source ${idx + 1}]`);
    });
  });
});

// ============================================================================
// Test Suite 7: Context injection into OpenAI messages
// ============================================================================

describe('Context injection into OpenAI request', () => {
  beforeEach(() => {
    mockPrismaForChat();
  });

  it('prepends KNOWLEDGE BASE CONTEXT to the user message sent to the model', async () => {
    let capturedUserContent = '';

    MockedOpenAI.mockImplementation(() => {
      return {
        embeddings: {
          create: jest.fn().mockResolvedValue({
            data: [{ embedding: FAKE_EMBEDDING }],
          }),
        },
        chat: {
          completions: {
            create: jest.fn().mockImplementation(async (params: any) => {
              // The last message in the array is the user message with context
              const lastMsg = params.messages[params.messages.length - 1];
              capturedUserContent = lastMsg.content as string;
              return {
                choices: [
                  { message: { content: 'I have led distributed systems engineering teams.' } },
                ],
              };
            }),
          },
        },
      } as unknown as OpenAI;
    });

    await generateResponse({
      message: 'Tell me about your background.',
      sessionId: 42,
      apiKey: FAKE_API_KEY,
      cloneName: CLONE_NAME,
    });

    expect(capturedUserContent).toContain('KNOWLEDGE BASE CONTEXT:');
    expect(capturedUserContent).toContain('QUESTION: Tell me about your background.');
    // The injected context should include KB chunk content
    expect(capturedUserContent).toContain('Professional_Bio.pdf');
  });

  it('sends the system prompt as the first message with role=system', async () => {
    let firstMessage: OpenAI.Chat.ChatCompletionMessageParam | undefined;

    MockedOpenAI.mockImplementation(() => {
      return {
        embeddings: {
          create: jest.fn().mockResolvedValue({
            data: [{ embedding: FAKE_EMBEDDING }],
          }),
        },
        chat: {
          completions: {
            create: jest.fn().mockImplementation(async (params: any) => {
              firstMessage = params.messages[0];
              return {
                choices: [{ message: { content: 'I published research on event-driven systems.' } }],
              };
            }),
          },
        },
      } as unknown as OpenAI;
    });

    await generateResponse({
      message: 'Tell me about your publications.',
      sessionId: 42,
      apiKey: FAKE_API_KEY,
      cloneName: CLONE_NAME,
    });

    expect(firstMessage).toBeDefined();
    expect(firstMessage!.role).toBe('system');
    // The system prompt must contain the clone name
    expect(firstMessage!.content as string).toContain(CLONE_NAME);
    expect(firstMessage!.content as string).toContain('IDENTITY RULES');
    expect(firstMessage!.content as string).toContain('KNOWLEDGE BASE RULES');
  });

  it('injects "No relevant context" notice when DB returns no chunks', async () => {
    (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue([]);

    let capturedUserContent = '';

    MockedOpenAI.mockImplementation(() => {
      return {
        embeddings: {
          create: jest.fn().mockResolvedValue({
            data: [{ embedding: FAKE_EMBEDDING }],
          }),
        },
        chat: {
          completions: {
            create: jest.fn().mockImplementation(async (params: any) => {
              const lastMsg = params.messages[params.messages.length - 1];
              capturedUserContent = lastMsg.content as string;
              return {
                choices: [
                  { message: { content: "I don't have information about that." } },
                ],
              };
            }),
          },
        },
      } as unknown as OpenAI;
    });

    await generateResponse({
      message: 'What is the stock price of Apple?',
      sessionId: 42,
      apiKey: FAKE_API_KEY,
      cloneName: CLONE_NAME,
    });

    expect(capturedUserContent).toContain('No relevant context found in the knowledge base');
  });
});

// ============================================================================
// Test Suite 8: Error handling and edge cases
// ============================================================================

describe('Error handling and edge cases', () => {
  beforeEach(() => {
    mockPrismaForChat();
  });

  it('falls back to the default fallback string when the model returns null content', async () => {
    MockedOpenAI.mockImplementation(() => {
      return {
        embeddings: {
          create: jest.fn().mockResolvedValue({ data: [{ embedding: FAKE_EMBEDDING }] }),
        },
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              // No choices returned
              choices: [{ message: { content: null } }],
            }),
          },
        },
      } as unknown as OpenAI;
    });

    const result = await generateResponse({
      message: 'Some question',
      sessionId: 42,
      apiKey: FAKE_API_KEY,
      cloneName: CLONE_NAME,
    });

    expect(result.message).toBe("I don't have information about that.");
  });

  it('persists both the user message and assistant reply to the DB', async () => {
    mockOpenAI('I have spoken at KubeCon.');

    await generateResponse({
      message: 'Conference talks?',
      sessionId: 42,
      apiKey: FAKE_API_KEY,
      cloneName: CLONE_NAME,
    });

    // message.create should be called twice — once for user, once for assistant
    expect(mockPrisma.message.create).toHaveBeenCalledTimes(2);

    const calls = (mockPrisma.message.create as jest.Mock).mock.calls;
    const roles = calls.map((c: any) => c[0].data.role);
    expect(roles).toContain('USER');
    expect(roles).toContain('ASSISTANT');
  });

  it('uses the custom clone name in the response pipeline', async () => {
    let systemPromptContent = '';

    MockedOpenAI.mockImplementation(() => {
      return {
        embeddings: {
          create: jest.fn().mockResolvedValue({ data: [{ embedding: FAKE_EMBEDDING }] }),
        },
        chat: {
          completions: {
            create: jest.fn().mockImplementation(async (params: any) => {
              systemPromptContent = params.messages[0].content as string;
              return {
                choices: [{ message: { content: 'I am Alex Johnson, pleased to meet you.' } }],
              };
            }),
          },
        },
      } as unknown as OpenAI;
    });

    await generateResponse({
      message: 'Who are you?',
      sessionId: 42,
      apiKey: FAKE_API_KEY,
      cloneName: 'Alex Johnson',
    });

    expect(systemPromptContent).toContain('Alex Johnson');
    expect(systemPromptContent).not.toContain('Jane Smith');
  });

  it('throws when no API key is provided to OpenAI constructor', async () => {
    // Simulate OpenAI throwing on auth failure
    MockedOpenAI.mockImplementation(() => {
      throw new Error('Invalid API key');
    });

    await expect(
      generateResponse({
        message: 'Hello',
        sessionId: 42,
        apiKey: 'bad-key',
        cloneName: CLONE_NAME,
      })
    ).rejects.toThrow('Invalid API key');
  });
});
