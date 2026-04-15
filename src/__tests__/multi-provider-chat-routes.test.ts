/**
 * Unit tests for multi-provider AI adapter wiring in chat routes.
 *
 * Acceptance criteria verified:
 *
 * AI Provider Adapter (src/lib/ai-provider.ts)
 *  1.  getChatCompletion delegates to OpenAI when provider is "openai"
 *  2.  getChatCompletion delegates to Anthropic when provider is "anthropic"
 *  3.  OpenAI call passes the correct model and messages
 *  4.  Anthropic call passes the correct model
 *  5.  Anthropic call converts system message to the `system` parameter
 *  6.  getChatCompletion returns the assistant text from OpenAI response
 *  7.  getChatCompletion returns the assistant text from Anthropic response
 *  8.  getChatCompletion returns "" when OpenAI returns null content
 *  9.  getChatCompletion returns "" when Anthropic returns no text block
 * 10.  getChatCompletion re-throws errors from OpenAI
 * 11.  getChatCompletion re-throws errors from Anthropic
 *
 * Private chat route (POST /api/chat)
 * 12.  Returns 400 when the OpenAI API key is not configured in Settings
 * 13.  Returns 400 with a clear error when aiProvider is "anthropic" but anthropicApiKey is missing
 * 14.  Calls generateResponse with chatProvider="openai" and openaiApiKey when provider is "openai"
 * 15.  Calls generateResponse with chatProvider="anthropic" and anthropicApiKey when provider is "anthropic"
 * 16.  Resolves openaiModel from settings for the OpenAI provider
 * 17.  Resolves anthropicModel from settings for the Anthropic provider
 * 18.  Falls back to DEFAULT_OPENAI_MODEL when openaiModel is null
 * 19.  Falls back to DEFAULT_ANTHROPIC_MODEL when anthropicModel is null
 * 20.  Returns 400 "Message is required" when message is empty
 * 21.  Returns 200 with message and sessionId on success
 * 22.  Returns 401 when not authenticated
 * 23.  RAG OpenAI key (apiKey) is always the openaiApiKeyEncrypted field
 *
 * Public clone chat route (POST /api/clone/[token]/chat)
 * 24.  Returns 400 when the owner has no OpenAI API key configured
 * 25.  Returns 400 with Anthropic-specific error when provider is "anthropic" and key is missing
 * 26.  Calls generateResponse with chatProvider="openai" when owner's settings use OpenAI
 * 27.  Calls generateResponse with chatProvider="anthropic" when owner's settings use Anthropic
 * 28.  Returns 404 when the share link is invalid or inactive
 * 29.  Returns 400 when message is missing
 * 30.  Returns 200 with message and sessionId on success
 * 31.  RAG OpenAI key is always openaiApiKeyEncrypted regardless of active provider
 * 32.  Falls back to DEFAULT_ANTHROPIC_MODEL when owner's anthropicModel is null
 */

// ===========================================================================
// Part 1: AI Provider Adapter unit tests (isolated module environment)
// ===========================================================================

describe('getChatCompletion adapter', () => {
  // We test the REAL getChatCompletion implementation in isolation.
  // Each test clears the module registry so OpenAI / Anthropic constructor mocks
  // are fresh and the module-level jest.mock() in the rest of this file does not
  // interfere.

  const MESSAGES = [
    { role: 'system' as const, content: 'You are Jane.' },
    { role: 'user' as const, content: 'Who are you?' },
  ];

  // 1. OpenAI delegation
  it('delegates to OpenAI when provider is "openai"', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'I am Jane.' } }],
    });

    jest.isolateModules(() => {
      jest.mock('openai', () => ({
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
          chat: { completions: { create: mockCreate } },
        })),
      }));
    });

    // Re-require inside isolateModules to get the fresh version
    let realGetChatCompletion: any;
    jest.isolateModules(() => {
      jest.mock('openai', () => ({
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
          chat: { completions: { create: mockCreate } },
        })),
      }));
      realGetChatCompletion = require('@/lib/ai-provider').getChatCompletion;
    });

    const result = await realGetChatCompletion({
      provider: 'openai',
      apiKey: 'sk-openai-key',
      model: 'gpt-4o',
      messages: MESSAGES,
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result).toBe('I am Jane.');
  });

  // 2. Anthropic delegation
  it('delegates to Anthropic when provider is "anthropic"', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'I am Jane, an Anthropic response.' }],
    });

    let realGetChatCompletion: any;
    jest.isolateModules(() => {
      jest.mock('@anthropic-ai/sdk', () => ({
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
          messages: { create: mockCreate },
        })),
      }));
      realGetChatCompletion = require('@/lib/ai-provider').getChatCompletion;
    });

    const result = await realGetChatCompletion({
      provider: 'anthropic',
      apiKey: 'sk-ant-key',
      model: 'claude-3-5-sonnet-20241022',
      messages: MESSAGES,
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result).toBe('I am Jane, an Anthropic response.');
  });

  // 3. OpenAI receives correct model and messages
  it('passes the correct model and full messages array to OpenAI', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'reply' } }],
    });

    let realGetChatCompletion: any;
    jest.isolateModules(() => {
      jest.mock('openai', () => ({
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
          chat: { completions: { create: mockCreate } },
        })),
      }));
      realGetChatCompletion = require('@/lib/ai-provider').getChatCompletion;
    });

    await realGetChatCompletion({
      provider: 'openai',
      apiKey: 'sk-key',
      model: 'gpt-4o-mini',
      messages: MESSAGES,
    });

    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.model).toBe('gpt-4o-mini');
    expect(callArg.messages).toEqual(MESSAGES);
  });

  // 4. Anthropic receives correct model
  it('passes the correct model to Anthropic', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    let realGetChatCompletion: any;
    jest.isolateModules(() => {
      jest.mock('@anthropic-ai/sdk', () => ({
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
          messages: { create: mockCreate },
        })),
      }));
      realGetChatCompletion = require('@/lib/ai-provider').getChatCompletion;
    });

    await realGetChatCompletion({
      provider: 'anthropic',
      apiKey: 'sk-ant-key',
      model: 'claude-3-opus-20240229',
      messages: MESSAGES,
    });

    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.model).toBe('claude-3-opus-20240229');
  });

  // 5. Anthropic: system message is extracted into the `system` parameter
  it('extracts leading system message into the Anthropic `system` param', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });

    let realGetChatCompletion: any;
    jest.isolateModules(() => {
      jest.mock('@anthropic-ai/sdk', () => ({
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
          messages: { create: mockCreate },
        })),
      }));
      realGetChatCompletion = require('@/lib/ai-provider').getChatCompletion;
    });

    await realGetChatCompletion({
      provider: 'anthropic',
      apiKey: 'sk-ant-key',
      model: 'claude-3-5-sonnet-20241022',
      messages: MESSAGES,
    });

    const callArg = mockCreate.mock.calls[0][0];
    // System message is extracted into `system`
    expect(callArg.system).toBe('You are Jane.');
    // The messages array must NOT contain the system role
    const roles = callArg.messages.map((m: any) => m.role);
    expect(roles).not.toContain('system');
    // Only the user message remains
    expect(callArg.messages).toEqual([{ role: 'user', content: 'Who are you?' }]);
  });

  // 6. Returns OpenAI assistant text
  it('returns the assistant content from an OpenAI response', async () => {
    const expected = 'I am Jane, specialising in distributed systems.';
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: expected } }],
    });

    let realGetChatCompletion: any;
    jest.isolateModules(() => {
      jest.mock('openai', () => ({
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
          chat: { completions: { create: mockCreate } },
        })),
      }));
      realGetChatCompletion = require('@/lib/ai-provider').getChatCompletion;
    });

    const result = await realGetChatCompletion({
      provider: 'openai',
      apiKey: 'sk-key',
      model: 'gpt-4o',
      messages: MESSAGES,
    });

    expect(result).toBe(expected);
  });

  // 7. Returns Anthropic text block content
  it('returns the text block content from an Anthropic response', async () => {
    const expected = 'I am Jane, here via Anthropic.';
    const mockCreate = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: expected }],
    });

    let realGetChatCompletion: any;
    jest.isolateModules(() => {
      jest.mock('@anthropic-ai/sdk', () => ({
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
          messages: { create: mockCreate },
        })),
      }));
      realGetChatCompletion = require('@/lib/ai-provider').getChatCompletion;
    });

    const result = await realGetChatCompletion({
      provider: 'anthropic',
      apiKey: 'sk-ant-key',
      model: 'claude-3-5-sonnet-20241022',
      messages: MESSAGES,
    });

    expect(result).toBe(expected);
  });

  // 8. OpenAI null content → ""
  it('returns empty string when OpenAI returns null content', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: null } }],
    });

    let realGetChatCompletion: any;
    jest.isolateModules(() => {
      jest.mock('openai', () => ({
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
          chat: { completions: { create: mockCreate } },
        })),
      }));
      realGetChatCompletion = require('@/lib/ai-provider').getChatCompletion;
    });

    const result = await realGetChatCompletion({
      provider: 'openai',
      apiKey: 'sk-key',
      model: 'gpt-4o',
      messages: MESSAGES,
    });

    expect(result).toBe('');
  });

  // 9. Anthropic no text block → ""
  it('returns empty string when Anthropic returns no text block', async () => {
    const mockCreate = jest.fn().mockResolvedValue({ content: [] });

    let realGetChatCompletion: any;
    jest.isolateModules(() => {
      jest.mock('@anthropic-ai/sdk', () => ({
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
          messages: { create: mockCreate },
        })),
      }));
      realGetChatCompletion = require('@/lib/ai-provider').getChatCompletion;
    });

    const result = await realGetChatCompletion({
      provider: 'anthropic',
      apiKey: 'sk-ant-key',
      model: 'claude-3-5-sonnet-20241022',
      messages: MESSAGES,
    });

    expect(result).toBe('');
  });

  // 10. Re-throws OpenAI errors
  it('re-throws errors from the OpenAI SDK', async () => {
    const sdkError = Object.assign(new Error('Invalid API key'), { status: 401 });
    const mockCreate = jest.fn().mockRejectedValue(sdkError);

    let realGetChatCompletion: any;
    jest.isolateModules(() => {
      jest.mock('openai', () => ({
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
          chat: { completions: { create: mockCreate } },
        })),
      }));
      realGetChatCompletion = require('@/lib/ai-provider').getChatCompletion;
    });

    await expect(
      realGetChatCompletion({
        provider: 'openai',
        apiKey: 'sk-bad-key',
        model: 'gpt-4o',
        messages: MESSAGES,
      })
    ).rejects.toThrow('Invalid API key');
  });

  // 11. Re-throws Anthropic errors
  it('re-throws errors from the Anthropic SDK', async () => {
    const sdkError = Object.assign(new Error('Authentication error'), { status: 401 });
    const mockCreate = jest.fn().mockRejectedValue(sdkError);

    let realGetChatCompletion: any;
    jest.isolateModules(() => {
      jest.mock('@anthropic-ai/sdk', () => ({
        __esModule: true,
        default: jest.fn().mockImplementation(() => ({
          messages: { create: mockCreate },
        })),
      }));
      realGetChatCompletion = require('@/lib/ai-provider').getChatCompletion;
    });

    await expect(
      realGetChatCompletion({
        provider: 'anthropic',
        apiKey: 'sk-ant-bad',
        model: 'claude-3-5-sonnet-20241022',
        messages: MESSAGES,
      })
    ).rejects.toThrow('Authentication error');
  });

  // Additional: DEFAULT_OPENAI_MODEL and DEFAULT_ANTHROPIC_MODEL exported correctly
  it('exports DEFAULT_OPENAI_MODEL as a gpt- prefixed string', () => {
    const { DEFAULT_OPENAI_MODEL } = require('@/lib/ai-provider');
    expect(typeof DEFAULT_OPENAI_MODEL).toBe('string');
    expect(DEFAULT_OPENAI_MODEL).toMatch(/^gpt-/);
  });

  it('exports DEFAULT_ANTHROPIC_MODEL as a claude- prefixed string', () => {
    const { DEFAULT_ANTHROPIC_MODEL } = require('@/lib/ai-provider');
    expect(typeof DEFAULT_ANTHROPIC_MODEL).toBe('string');
    expect(DEFAULT_ANTHROPIC_MODEL).toMatch(/^claude-/);
  });

  it('DEFAULT_OPENAI_MODEL and DEFAULT_ANTHROPIC_MODEL are distinct', () => {
    const { DEFAULT_OPENAI_MODEL, DEFAULT_ANTHROPIC_MODEL } = require('@/lib/ai-provider');
    expect(DEFAULT_OPENAI_MODEL).not.toBe(DEFAULT_ANTHROPIC_MODEL);
  });
});

// ===========================================================================
// Parts 2 & 3: Route tests (module-level mocks)
// ===========================================================================

// ---- Auth middleware -------------------------------------------------------
let mockAuthPayload: { userId: number; email: string | null; name: string | null } | null = null;

jest.mock('@/lib/middleware/requireAuth', () => ({
  requireAuth: (handler: (req: any, ctx: any) => Promise<any>) => {
    return async (req: any) => {
      if (!mockAuthPayload) {
        const { NextResponse } = require('next/server');
        return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
      }
      return handler(req, { auth: mockAuthPayload });
    };
  },
}));

// ---- Prisma ----------------------------------------------------------------
jest.mock('@/lib/prisma', () => ({
  prisma: {
    settings: { findUnique: jest.fn() },
    shareLink: { findUnique: jest.fn() },
  },
}));

// ---- RAG service -----------------------------------------------------------
jest.mock('@/lib/services/rag-service', () => ({
  generateResponse: jest.fn(),
}));

// ---- crypto ----------------------------------------------------------------
jest.mock('crypto', () => ({
  createHash: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('hashed-token'),
  }),
}));

// ---- Imports after module-level mocks -------------------------------------
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateResponse } from '@/lib/services/rag-service';
import { DEFAULT_OPENAI_MODEL, DEFAULT_ANTHROPIC_MODEL } from '@/lib/ai-provider';

const mockGenerateResponse = generateResponse as jest.Mock;
const mockSettingsFindUnique = prisma.settings.findUnique as jest.Mock;
const mockShareLinkFindUnique = prisma.shareLink.findUnique as jest.Mock;

// ---------------------------------------------------------------------------
// JWT setup
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = 'multi-provider-chat-test-secret';
process.env.JWT_SECRET = TEST_JWT_SECRET;

const TEST_USER_ID = 7;

function makeTestToken(userId = TEST_USER_ID): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ userId, email: 'owner@test.com', name: 'Test', iat: 1700000000, exp: 9999999999 })
  ).toString('base64url');
  const sig = Buffer.from(`sig:${TEST_JWT_SECRET}`).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

const SESSION_TOKEN = makeTestToken();

// ---------------------------------------------------------------------------
// Settings fixture
// ---------------------------------------------------------------------------

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    ownerId: TEST_USER_ID,
    cloneName: 'Jane Doe',
    systemPrompt: null,
    tone: 'natural',
    responseLength: 'balanced',
    openaiApiKeyEncrypted: 'sk-openai-test-key',
    anthropicApiKey: null,
    aiProvider: 'openai',
    openaiModel: 'gpt-4o',
    anthropicModel: 'claude-3-5-sonnet-20241022',
    avatarUrl: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------

function buildPrivateChatRequest(body: Record<string, unknown> = {}): NextRequest {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: {
      cookie: `session=${SESSION_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ message: 'Hello', ...body }),
  }) as unknown as NextRequest;
}

function buildPublicChatRequest(body: Record<string, unknown> = {}): NextRequest {
  return new Request('http://localhost/api/clone/test-token/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Hello', ...body }),
  }) as unknown as NextRequest;
}

function buildPublicChatParams(token = 'test-token') {
  return { params: Promise.resolve({ token }) };
}

function buildShareLink(overrides: Record<string, unknown> = {}) {
  return {
    isActive: true,
    owner: {
      cloneName: 'Jane (Legacy)',
      settings: makeSettings(),
    },
    ...overrides,
  };
}

// Default generateResponse mock result
const DEFAULT_RESPONSE = { message: 'I have 15 years of experience.', sessionId: 42 };

// ---------------------------------------------------------------------------
// JWT mock (mirrors other test files)
// ---------------------------------------------------------------------------

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    sign: jest.fn(),
    verify: (token: string, _secret: string) => {
      try {
        const parts = token.split('.');
        if (parts.length !== 3) throw new Error('malformed');
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      } catch {
        throw Object.assign(new Error('invalid token'), { name: 'JsonWebTokenError' });
      }
    },
  },
  sign: jest.fn(),
  verify: (token: string, _secret: string) => {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('malformed');
      return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    } catch {
      throw Object.assign(new Error('invalid token'), { name: 'JsonWebTokenError' });
    }
  },
  TokenExpiredError: class TokenExpiredError extends Error {
    constructor(msg: string) { super(msg); this.name = 'TokenExpiredError'; }
    expiredAt = new Date();
  },
  JsonWebTokenError: class JsonWebTokenError extends Error {
    constructor(msg: string) { super(msg); this.name = 'JsonWebTokenError'; }
  },
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthPayload = { userId: TEST_USER_ID, email: 'owner@test.com', name: 'Test' };
  mockSettingsFindUnique.mockResolvedValue(makeSettings());
  mockShareLinkFindUnique.mockResolvedValue(buildShareLink());
  mockGenerateResponse.mockResolvedValue(DEFAULT_RESPONSE);
});

// ===========================================================================
// Part 2: Private chat route — POST /api/chat
// ===========================================================================

describe('POST /api/chat — multi-provider wiring', () => {
  const getHandler = () => require('@/app/api/chat/route').POST;

  // 12. Missing OpenAI key → 400
  it('returns 400 when openaiApiKeyEncrypted is not configured', async () => {
    mockSettingsFindUnique.mockResolvedValue(makeSettings({ openaiApiKeyEncrypted: null }));

    const res = await getHandler()(buildPrivateChatRequest());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/OpenAI API key is required/i);
  });

  // 13. Anthropic provider with no Anthropic key → 400
  it('returns 400 with Anthropic error when provider is "anthropic" but key is missing', async () => {
    mockSettingsFindUnique.mockResolvedValue(
      makeSettings({ aiProvider: 'anthropic', anthropicApiKey: null })
    );

    const res = await getHandler()(buildPrivateChatRequest());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Anthropic API key is not configured/i);
    expect(body.error).toMatch(/Settings/i);
  });

  // 14. OpenAI provider: generateResponse called with correct provider params
  it('calls generateResponse with chatProvider="openai" and openaiApiKey for OpenAI', async () => {
    mockSettingsFindUnique.mockResolvedValue(
      makeSettings({ aiProvider: 'openai', openaiApiKeyEncrypted: 'sk-openai-abc' })
    );

    await getHandler()(buildPrivateChatRequest({ message: 'Tell me about yourself.' }));

    expect(mockGenerateResponse).toHaveBeenCalledTimes(1);
    const callArg = mockGenerateResponse.mock.calls[0][0];
    expect(callArg.chatProvider).toBe('openai');
    expect(callArg.chatApiKey).toBe('sk-openai-abc');
    // RAG embedding key is also the OpenAI key
    expect(callArg.apiKey).toBe('sk-openai-abc');
  });

  // 15. Anthropic provider: generateResponse called with Anthropic key
  it('calls generateResponse with chatProvider="anthropic" and anthropicApiKey', async () => {
    mockSettingsFindUnique.mockResolvedValue(
      makeSettings({
        aiProvider: 'anthropic',
        openaiApiKeyEncrypted: 'sk-openai-for-rag',
        anthropicApiKey: 'sk-ant-api03-xyz',
      })
    );

    await getHandler()(buildPrivateChatRequest({ message: 'Tell me about yourself.' }));

    const callArg = mockGenerateResponse.mock.calls[0][0];
    expect(callArg.chatProvider).toBe('anthropic');
    expect(callArg.chatApiKey).toBe('sk-ant-api03-xyz');
    // RAG embedding key stays as OpenAI
    expect(callArg.apiKey).toBe('sk-openai-for-rag');
  });

  // 16. openaiModel from settings is forwarded
  it('passes openaiModel from settings to generateResponse for OpenAI provider', async () => {
    mockSettingsFindUnique.mockResolvedValue(
      makeSettings({ aiProvider: 'openai', openaiModel: 'gpt-4-turbo' })
    );

    await getHandler()(buildPrivateChatRequest());

    const callArg = mockGenerateResponse.mock.calls[0][0];
    expect(callArg.chatModel).toBe('gpt-4-turbo');
  });

  // 17. anthropicModel from settings is forwarded
  it('passes anthropicModel from settings to generateResponse for Anthropic provider', async () => {
    mockSettingsFindUnique.mockResolvedValue(
      makeSettings({
        aiProvider: 'anthropic',
        anthropicApiKey: 'sk-ant-key',
        anthropicModel: 'claude-3-opus-20240229',
      })
    );

    await getHandler()(buildPrivateChatRequest());

    const callArg = mockGenerateResponse.mock.calls[0][0];
    expect(callArg.chatModel).toBe('claude-3-opus-20240229');
  });

  // 18. Falls back to DEFAULT_OPENAI_MODEL when openaiModel is null
  it('falls back to DEFAULT_OPENAI_MODEL when openaiModel is null', async () => {
    mockSettingsFindUnique.mockResolvedValue(
      makeSettings({ aiProvider: 'openai', openaiModel: null })
    );

    await getHandler()(buildPrivateChatRequest());

    const callArg = mockGenerateResponse.mock.calls[0][0];
    expect(callArg.chatModel).toBe(DEFAULT_OPENAI_MODEL);
  });

  // 19. Falls back to DEFAULT_ANTHROPIC_MODEL when anthropicModel is null
  it('falls back to DEFAULT_ANTHROPIC_MODEL when anthropicModel is null', async () => {
    mockSettingsFindUnique.mockResolvedValue(
      makeSettings({
        aiProvider: 'anthropic',
        anthropicApiKey: 'sk-ant-key',
        anthropicModel: null,
      })
    );

    await getHandler()(buildPrivateChatRequest());

    const callArg = mockGenerateResponse.mock.calls[0][0];
    expect(callArg.chatModel).toBe(DEFAULT_ANTHROPIC_MODEL);
  });

  // 20. Empty message → 400
  it('returns 400 when the message body is empty', async () => {
    const res = await getHandler()(buildPrivateChatRequest({ message: '' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Message is required/i);
  });

  // 21. Success → 200 with message and sessionId
  it('returns 200 with message and sessionId on success', async () => {
    const res = await getHandler()(buildPrivateChatRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe(DEFAULT_RESPONSE.message);
    expect(body.sessionId).toBe(DEFAULT_RESPONSE.sessionId);
  });

  // 22. Unauthenticated → 401
  it('returns 401 when not authenticated', async () => {
    mockAuthPayload = null;

    const res = await getHandler()(buildPrivateChatRequest());

    expect(res.status).toBe(401);
  });

  // 23. The RAG apiKey is always the OpenAI key, even with Anthropic active
  it('always passes openaiApiKeyEncrypted as the RAG apiKey regardless of active provider', async () => {
    const openaiKey = 'sk-openai-for-embeddings-only';
    mockSettingsFindUnique.mockResolvedValue(
      makeSettings({
        aiProvider: 'anthropic',
        openaiApiKeyEncrypted: openaiKey,
        anthropicApiKey: 'sk-ant-chat-key',
      })
    );

    await getHandler()(buildPrivateChatRequest());

    const callArg = mockGenerateResponse.mock.calls[0][0];
    expect(callArg.apiKey).toBe(openaiKey);
    expect(callArg.chatApiKey).toBe('sk-ant-chat-key');
    expect(callArg.chatProvider).toBe('anthropic');
  });

  // Additional: showSources is forwarded correctly
  it('forwards showSources=true to generateResponse when requested', async () => {
    mockGenerateResponse.mockResolvedValue({
      ...DEFAULT_RESPONSE,
      sources: [{ sourceLabel: '[Source 1]', filename: 'bio.pdf', pageNumber: 1, similarity: 0.9, content: 'text' }],
    });

    const res = await getHandler()(buildPrivateChatRequest({ showSources: true }));

    const callArg = mockGenerateResponse.mock.calls[0][0];
    expect(callArg.showSources).toBe(true);

    const body = await res.json();
    expect(body.sources).toBeDefined();
    expect(body.sources).toHaveLength(1);
  });

  // Additional: settings not found → 400 for missing OpenAI key
  it('returns 400 when settings record does not exist (null keys)', async () => {
    mockSettingsFindUnique.mockResolvedValue(null);

    const res = await getHandler()(buildPrivateChatRequest());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/OpenAI API key is required/i);
  });

  // Additional: ownerId is forwarded to generateResponse
  it('passes the authenticated userId as ownerId to generateResponse', async () => {
    await getHandler()(buildPrivateChatRequest());

    const callArg = mockGenerateResponse.mock.calls[0][0];
    expect(callArg.ownerId).toBe(TEST_USER_ID);
  });

  // Additional: whitespace-only message → 400
  it('returns 400 when the message is only whitespace', async () => {
    const res = await getHandler()(buildPrivateChatRequest({ message: '   ' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Message is required/i);
  });
});

// ===========================================================================
// Part 3: Public clone chat route — POST /api/clone/[token]/chat
// ===========================================================================

describe('POST /api/clone/[token]/chat — multi-provider wiring', () => {
  const getHandler = () => require('@/app/api/clone/[token]/chat/route').POST;

  // 24. No OpenAI key on owner → 400
  it('returns 400 when the owner has no OpenAI API key configured', async () => {
    mockShareLinkFindUnique.mockResolvedValue(
      buildShareLink({
        owner: {
          cloneName: 'Jane',
          settings: makeSettings({ openaiApiKeyEncrypted: null }),
        },
      })
    );

    const res = await getHandler()(buildPublicChatRequest(), buildPublicChatParams());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/No OpenAI API key configured/i);
  });

  // 25. Anthropic provider, no Anthropic key → 400 with Anthropic-specific message
  it('returns 400 with Anthropic error when owner uses Anthropic but has no key', async () => {
    mockShareLinkFindUnique.mockResolvedValue(
      buildShareLink({
        owner: {
          cloneName: 'Jane',
          settings: makeSettings({ aiProvider: 'anthropic', anthropicApiKey: null }),
        },
      })
    );

    const res = await getHandler()(buildPublicChatRequest(), buildPublicChatParams());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Anthropic API key is not configured/i);
  });

  // 26. OpenAI provider: correct params forwarded
  it('calls generateResponse with chatProvider="openai" for OpenAI owner settings', async () => {
    mockShareLinkFindUnique.mockResolvedValue(
      buildShareLink({
        owner: {
          cloneName: 'Jane (Legacy)',
          settings: makeSettings({
            aiProvider: 'openai',
            openaiApiKeyEncrypted: 'sk-owner-openai',
            openaiModel: 'gpt-4o',
          }),
        },
      })
    );

    await getHandler()(buildPublicChatRequest(), buildPublicChatParams());

    const callArg = mockGenerateResponse.mock.calls[0][0];
    expect(callArg.chatProvider).toBe('openai');
    expect(callArg.chatApiKey).toBe('sk-owner-openai');
    expect(callArg.apiKey).toBe('sk-owner-openai');
    expect(callArg.chatModel).toBe('gpt-4o');
  });

  // 27. Anthropic provider: correct Anthropic key and model forwarded
  it('calls generateResponse with chatProvider="anthropic" for Anthropic owner settings', async () => {
    mockShareLinkFindUnique.mockResolvedValue(
      buildShareLink({
        owner: {
          cloneName: 'Jane (Legacy)',
          settings: makeSettings({
            aiProvider: 'anthropic',
            openaiApiKeyEncrypted: 'sk-owner-openai-rag',
            anthropicApiKey: 'sk-ant-owner-key',
            anthropicModel: 'claude-3-5-sonnet-20241022',
          }),
        },
      })
    );

    await getHandler()(buildPublicChatRequest(), buildPublicChatParams());

    const callArg = mockGenerateResponse.mock.calls[0][0];
    expect(callArg.chatProvider).toBe('anthropic');
    expect(callArg.chatApiKey).toBe('sk-ant-owner-key');
    // RAG key is always the OpenAI key
    expect(callArg.apiKey).toBe('sk-owner-openai-rag');
    expect(callArg.chatModel).toBe('claude-3-5-sonnet-20241022');
  });

  // 28. Invalid / inactive link → 404
  it('returns 404 when the share link is invalid or inactive', async () => {
    mockShareLinkFindUnique.mockResolvedValue(null);

    const res = await getHandler()(buildPublicChatRequest(), buildPublicChatParams());

    expect(res.status).toBe(404);
  });

  it('returns 404 when the share link is inactive', async () => {
    mockShareLinkFindUnique.mockResolvedValue(buildShareLink({ isActive: false }));

    const res = await getHandler()(buildPublicChatRequest(), buildPublicChatParams());

    expect(res.status).toBe(404);
  });

  // 29. Missing message → 400
  it('returns 400 when the message is missing', async () => {
    const res = await getHandler()(buildPublicChatRequest({ message: '' }), buildPublicChatParams());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Message is required/i);
  });

  // 30. Success → 200
  it('returns 200 with message and sessionId on success', async () => {
    const res = await getHandler()(buildPublicChatRequest(), buildPublicChatParams());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe(DEFAULT_RESPONSE.message);
    expect(body.sessionId).toBe(DEFAULT_RESPONSE.sessionId);
  });

  // 31. RAG apiKey is always the OpenAI key, even with Anthropic active
  it('always passes openaiApiKeyEncrypted as the RAG apiKey regardless of active provider', async () => {
    const openaiKey = 'sk-rag-openai-key';
    mockShareLinkFindUnique.mockResolvedValue(
      buildShareLink({
        owner: {
          cloneName: 'Jane',
          settings: makeSettings({
            aiProvider: 'anthropic',
            openaiApiKeyEncrypted: openaiKey,
            anthropicApiKey: 'sk-ant-chat',
          }),
        },
      })
    );

    await getHandler()(buildPublicChatRequest(), buildPublicChatParams());

    const callArg = mockGenerateResponse.mock.calls[0][0];
    expect(callArg.apiKey).toBe(openaiKey);
    expect(callArg.chatApiKey).toBe('sk-ant-chat');
  });

  // 32. Falls back to DEFAULT_ANTHROPIC_MODEL when anthropicModel is null
  it('falls back to DEFAULT_ANTHROPIC_MODEL when owner anthropicModel is null', async () => {
    mockShareLinkFindUnique.mockResolvedValue(
      buildShareLink({
        owner: {
          cloneName: 'Jane',
          settings: makeSettings({
            aiProvider: 'anthropic',
            anthropicApiKey: 'sk-ant-key',
            anthropicModel: null,
          }),
        },
      })
    );

    await getHandler()(buildPublicChatRequest(), buildPublicChatParams());

    const callArg = mockGenerateResponse.mock.calls[0][0];
    expect(callArg.chatModel).toBe(DEFAULT_ANTHROPIC_MODEL);
  });

  // Additional: isPublicSession is always true
  it('always passes isPublicSession=true to generateResponse', async () => {
    await getHandler()(buildPublicChatRequest(), buildPublicChatParams());

    const callArg = mockGenerateResponse.mock.calls[0][0];
    expect(callArg.isPublicSession).toBe(true);
  });

  // Additional: public response does not include sources field
  it('response body never includes a sources field for public chat', async () => {
    mockGenerateResponse.mockResolvedValue({
      ...DEFAULT_RESPONSE,
      sources: [{ sourceLabel: '[Source 1]', filename: 'bio.pdf', pageNumber: 1, similarity: 0.9, content: 'x' }],
    });

    const res = await getHandler()(buildPublicChatRequest(), buildPublicChatParams());

    const body = await res.json();
    expect(body).not.toHaveProperty('sources');
  });

  // Additional: cloneName resolved from settings before legacy owner field
  it('passes settings.cloneName to generateResponse (preferred over owner.cloneName)', async () => {
    mockShareLinkFindUnique.mockResolvedValue(
      buildShareLink({
        owner: {
          cloneName: 'Legacy Name',
          settings: makeSettings({ cloneName: 'Settings Name' }),
        },
      })
    );

    await getHandler()(buildPublicChatRequest(), buildPublicChatParams());

    const callArg = mockGenerateResponse.mock.calls[0][0];
    expect(callArg.cloneName).toBe('Settings Name');
  });

  // Additional: falls back to DEFAULT_OPENAI_MODEL when owner's openaiModel is null
  it('falls back to DEFAULT_OPENAI_MODEL when owner openaiModel is null', async () => {
    mockShareLinkFindUnique.mockResolvedValue(
      buildShareLink({
        owner: {
          cloneName: 'Jane',
          settings: makeSettings({ aiProvider: 'openai', openaiModel: null }),
        },
      })
    );

    await getHandler()(buildPublicChatRequest(), buildPublicChatParams());

    const callArg = mockGenerateResponse.mock.calls[0][0];
    expect(callArg.chatModel).toBe(DEFAULT_OPENAI_MODEL);
  });

  // Additional: 400 for missing link token
  it('returns 400 when token is falsy', async () => {
    const res = await getHandler()(buildPublicChatRequest(), { params: Promise.resolve({ token: '' }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Token is required/i);
  });

  // Additional: 500 on DB error
  it('returns 500 when the database throws an error', async () => {
    mockShareLinkFindUnique.mockRejectedValue(new Error('DB connection lost'));

    const res = await getHandler()(buildPublicChatRequest(), buildPublicChatParams());

    expect(res.status).toBe(500);
  });
});
