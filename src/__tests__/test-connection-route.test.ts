/**
 * Unit tests for POST /api/settings/test-connection
 *
 * Verifies that the route:
 *
 * — Auth enforcement (shared across providers) —
 *  1.  Returns 401 when no valid session is present (requireAuth enforcement)
 *  2.  Returns 401 body with an "error" property
 *  3.  Does NOT call any provider SDK when the request is unauthenticated
 *  4.  Returns 401 regardless of whether an API key is present or absent
 *
 * — OpenAI (provider = "openai" or omitted) —
 *  5.  Returns 400 when the OpenAI API key header/body is missing
 *  6.  Returns 200 { success: true, provider: "openai" } when the OpenAI call succeeds
 *  7.  Calls openai.models.list() when a valid OpenAI key is provided
 *  8.  Returns 401 when OpenAI reports an invalid API key (error.status === 401)
 *  9.  Returns 429 when OpenAI reports rate-limit exceeded (error.status === 429)
 * 10.  Returns 500 when OpenAI throws an unexpected error
 * 11.  Includes the error message in the 500 response body (OpenAI)
 * 12.  Returns 500 with a fallback message when a non-Error value is thrown (OpenAI)
 *
 * — Anthropic (provider = "anthropic") —
 * 13.  Returns 400 when the Anthropic API key is missing
 * 14.  Returns 200 { success: true, provider: "anthropic" } when the Anthropic call succeeds
 * 15.  Calls anthropic.messages.create() with max_tokens=1 and a user message
 * 16.  Returns 401 when Anthropic reports an invalid API key (error.status === 401)
 * 17.  Returns 429 when Anthropic reports rate-limit exceeded (error.status === 429)
 * 18.  Returns 500 when Anthropic throws an unexpected error
 * 19.  Includes the error message in the 500 response body (Anthropic)
 * 20.  Returns 500 with a fallback message when a non-Error value is thrown (Anthropic)
 * 21.  success:false is included in all non-200 error responses
 * 22.  Error message references the provider by name in the fallback message (Anthropic)
 *
 * — Provider routing —
 * 23.  Unsupported provider value returns 400 with a descriptive error
 * 24.  Omitting the provider field defaults to "openai" behaviour
 *
 * — Content-Type —
 * 25.  Response Content-Type is always application/json
 *
 * — Auth context —
 * 26.  Successfully processes a request for any authenticated userId (no hardcoded ID)
 */

import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Mock @/lib/middleware/requireAuth — controls auth state per test
// ---------------------------------------------------------------------------

let mockAuthPayload: { userId: number; email: string | null; name: string | null } | null = null;

jest.mock('@/lib/middleware/requireAuth', () => ({
  requireAuth: (
    handler: (req: NextRequest, ctx: { auth: typeof mockAuthPayload }) => Promise<NextResponse>
  ) => {
    return async (req: NextRequest) => {
      if (!mockAuthPayload) {
        return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
      }
      return handler(req, { auth: mockAuthPayload });
    };
  },
}));

// ---------------------------------------------------------------------------
// Mock openai — we control what models.list() does per test
// ---------------------------------------------------------------------------

const mockModelsList = jest.fn();

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      models: {
        list: mockModelsList,
      },
    })),
  };
});

// ---------------------------------------------------------------------------
// Mock @anthropic-ai/sdk — we control what messages.create() does per test
// ---------------------------------------------------------------------------

const mockMessagesCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: {
        create: mockMessagesCreate,
      },
    })),
  };
});

// ---------------------------------------------------------------------------
// Import handler AFTER mocks
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/settings/test-connection/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_AUTH = { userId: 42, email: 'owner@example.com', name: 'Test Owner' };
const VALID_OPENAI_KEY = 'sk-test-valid-openai-key-1234567890';
const VALID_ANTHROPIC_KEY = 'sk-ant-api03-valid-anthropic-key-xyz';

// Minimal Anthropic messages.create success response
const ANTHROPIC_SUCCESS_RESPONSE = {
  id: 'msg_01XFDUDYJgAACzvnptvVoYEL',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'H' }],
  model: 'claude-3-haiku-20240307',
  stop_reason: 'max_tokens',
  usage: { input_tokens: 8, output_tokens: 1 },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOpenAIRequest(options: {
  apiKey?: string | null;
  sessionCookie?: string;
} = {}): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };

  if (options.apiKey !== undefined && options.apiKey !== null) {
    headers['x-openai-api-key'] = options.apiKey;
  }

  if (options.sessionCookie) {
    headers['cookie'] = `session=${options.sessionCookie}`;
  }

  return new NextRequest('http://localhost/api/settings/test-connection', {
    method: 'POST',
    headers,
    body: JSON.stringify({ provider: 'openai' }),
  });
}

function makeAnthropicRequest(options: {
  apiKey?: string | null;
} = {}): NextRequest {
  const body: Record<string, unknown> = { provider: 'anthropic' };
  if (options.apiKey !== undefined && options.apiKey !== null) {
    body.apiKey = options.apiKey;
  }

  return new NextRequest('http://localhost/api/settings/test-connection', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeRequestWithProvider(provider: string, apiKey?: string): NextRequest {
  const body: Record<string, unknown> = { provider };
  if (apiKey) body.apiKey = apiKey;

  return new NextRequest('http://localhost/api/settings/test-connection', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthPayload = null;
  mockModelsList.mockResolvedValue({ data: [] });
  mockMessagesCreate.mockResolvedValue(ANTHROPIC_SUCCESS_RESPONSE);
});

// ===========================================================================
// 1–4. Unauthenticated requests
// ===========================================================================

describe('POST /api/settings/test-connection — unauthenticated', () => {
  // 1. Missing / invalid session → 401
  it('returns 401 when no valid session is present', async () => {
    const req = makeOpenAIRequest({ apiKey: VALID_OPENAI_KEY });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  // 2. 401 body has an "error" property
  it('includes an "error" property in the 401 JSON body', async () => {
    const req = makeOpenAIRequest({ apiKey: VALID_OPENAI_KEY });
    const res = await POST(req);
    const body = await res.json();

    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  // 3. No provider SDK is contacted when the request is unauthenticated
  it('does not call OpenAI when authentication fails', async () => {
    const req = makeOpenAIRequest({ apiKey: VALID_OPENAI_KEY });
    await POST(req);

    expect(mockModelsList).not.toHaveBeenCalled();
  });

  it('does not call Anthropic when authentication fails', async () => {
    const req = makeAnthropicRequest({ apiKey: VALID_ANTHROPIC_KEY });
    await POST(req);

    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  // 4. Returns 401 regardless of whether an API key is present or absent
  it('returns 401 regardless of whether an API key header is present or absent', async () => {
    const withKey = await POST(makeOpenAIRequest({ apiKey: VALID_OPENAI_KEY }));
    const withoutKey = await POST(makeOpenAIRequest({ apiKey: null }));

    expect(withKey.status).toBe(401);
    expect(withoutKey.status).toBe(401);
  });
});

// ===========================================================================
// 5–12. OpenAI — authenticated requests
// ===========================================================================

describe('POST /api/settings/test-connection — OpenAI (authenticated)', () => {
  beforeEach(() => {
    mockAuthPayload = MOCK_AUTH;
  });

  // 5. Missing OpenAI API key → 400
  it('returns 400 when the OpenAI API key header is absent', async () => {
    const req = makeOpenAIRequest({ apiKey: null });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 body with a descriptive error message when OpenAI API key is missing', async () => {
    const req = makeOpenAIRequest({ apiKey: null });
    const res = await POST(req);
    const body = await res.json();

    expect(body.error).toMatch(/api key/i);
  });

  // 6. Successful OpenAI call → 200 { success: true, provider: "openai" }
  it('returns 200 with { success: true, provider: "openai" } when OpenAI models.list() succeeds', async () => {
    mockModelsList.mockResolvedValue({ data: [] });

    const req = makeOpenAIRequest({ apiKey: VALID_OPENAI_KEY });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, provider: 'openai' });
  });

  // 7. OpenAI is actually called
  it('calls openai.models.list() when a valid API key is provided', async () => {
    const req = makeOpenAIRequest({ apiKey: VALID_OPENAI_KEY });
    await POST(req);

    expect(mockModelsList).toHaveBeenCalledTimes(1);
  });

  // 8. OpenAI 401 → 401 with user-friendly message
  it('returns 401 with a user-friendly message when OpenAI rejects the API key', async () => {
    const apiError = Object.assign(new Error('Invalid API key'), { status: 401 });
    mockModelsList.mockRejectedValue(apiError);

    const req = makeOpenAIRequest({ apiKey: 'sk-invalid-key' });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/invalid api key/i);
  });

  // 9. OpenAI 429 → 429 with user-friendly message
  it('returns 429 with a user-friendly message when OpenAI rate-limits the request', async () => {
    const rateLimitError = Object.assign(new Error('Too many requests'), { status: 429 });
    mockModelsList.mockRejectedValue(rateLimitError);

    const req = makeOpenAIRequest({ apiKey: VALID_OPENAI_KEY });
    const res = await POST(req);

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/rate limit/i);
  });

  // 10. Unexpected OpenAI error → 500
  it('returns 500 when OpenAI throws an unexpected error', async () => {
    mockModelsList.mockRejectedValue(new Error('Network timeout'));

    const req = makeOpenAIRequest({ apiKey: VALID_OPENAI_KEY });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // 11. Unexpected OpenAI error message is forwarded
  it('includes the error message in the 500 response body', async () => {
    mockModelsList.mockRejectedValue(new Error('Unexpected connectivity issue'));

    const req = makeOpenAIRequest({ apiKey: VALID_OPENAI_KEY });
    const res = await POST(req);
    const body = await res.json();

    expect(body.error).toMatch(/Unexpected connectivity issue|Failed to connect/i);
  });

  // 12. Non-Error throw → 500 with fallback message
  it('returns 500 with a fallback message when a non-Error value is thrown', async () => {
    mockModelsList.mockRejectedValue('string rejection');

    const req = makeOpenAIRequest({ apiKey: VALID_OPENAI_KEY });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/Failed to connect/i);
  });

  // success:false on non-200
  it('includes success: false in all error responses for OpenAI', async () => {
    mockModelsList.mockRejectedValue(Object.assign(new Error('bad key'), { status: 401 }));

    const req = makeOpenAIRequest({ apiKey: 'sk-bad' });
    const res = await POST(req);
    const body = await res.json();

    expect(body.success).toBe(false);
  });
});

// ===========================================================================
// 13–22. Anthropic — authenticated requests
// ===========================================================================

describe('POST /api/settings/test-connection — Anthropic (authenticated)', () => {
  beforeEach(() => {
    mockAuthPayload = MOCK_AUTH;
  });

  // 13. Missing Anthropic API key → 400
  it('returns 400 when the Anthropic API key is absent', async () => {
    const req = makeAnthropicRequest({ apiKey: null });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.success).toBe(false);
  });

  it('returns 400 body with a descriptive error message when Anthropic API key is missing', async () => {
    const req = makeAnthropicRequest({ apiKey: null });
    const res = await POST(req);
    const body = await res.json();

    expect(body.error).toMatch(/api key/i);
  });

  // 14. Successful Anthropic call → 200 { success: true, provider: "anthropic" }
  it('returns 200 with { success: true, provider: "anthropic" } when Anthropic call succeeds', async () => {
    mockMessagesCreate.mockResolvedValue(ANTHROPIC_SUCCESS_RESPONSE);

    const req = makeAnthropicRequest({ apiKey: VALID_ANTHROPIC_KEY });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, provider: 'anthropic' });
  });

  // 15. Minimal Anthropic probe: messages.create called with max_tokens=1
  it('calls anthropic.messages.create() with max_tokens=1 and a single user message', async () => {
    const req = makeAnthropicRequest({ apiKey: VALID_ANTHROPIC_KEY });
    await POST(req);

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArg = mockMessagesCreate.mock.calls[0][0];
    expect(callArg.max_tokens).toBe(1);
    expect(callArg.messages).toHaveLength(1);
    expect(callArg.messages[0].role).toBe('user');
  });

  it('calls anthropic.messages.create() targeting the claude-3-haiku probe model', async () => {
    const req = makeAnthropicRequest({ apiKey: VALID_ANTHROPIC_KEY });
    await POST(req);

    const callArg = mockMessagesCreate.mock.calls[0][0];
    expect(callArg.model).toMatch(/claude-3-haiku/);
  });

  // 16. Anthropic 401 → 401 with user-friendly message
  it('returns 401 with a user-friendly message when Anthropic rejects the API key', async () => {
    const apiError = Object.assign(new Error('Authentication error'), { status: 401 });
    mockMessagesCreate.mockRejectedValue(apiError);

    const req = makeAnthropicRequest({ apiKey: 'sk-ant-invalid' });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/invalid api key/i);
    expect(body.success).toBe(false);
  });

  // 17. Anthropic 429 → 429 with user-friendly message
  it('returns 429 with a user-friendly message when Anthropic rate-limits the request', async () => {
    const rateLimitError = Object.assign(new Error('Too many requests'), { status: 429 });
    mockMessagesCreate.mockRejectedValue(rateLimitError);

    const req = makeAnthropicRequest({ apiKey: VALID_ANTHROPIC_KEY });
    const res = await POST(req);

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/rate limit/i);
    expect(body.success).toBe(false);
  });

  // 18. Unexpected Anthropic error → 500
  it('returns 500 when Anthropic throws an unexpected error', async () => {
    mockMessagesCreate.mockRejectedValue(new Error('Network timeout'));

    const req = makeAnthropicRequest({ apiKey: VALID_ANTHROPIC_KEY });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.success).toBe(false);
  });

  // 19. Unexpected Anthropic error message is forwarded
  it('includes the error message in the 500 response body (Anthropic)', async () => {
    mockMessagesCreate.mockRejectedValue(new Error('Service unavailable'));

    const req = makeAnthropicRequest({ apiKey: VALID_ANTHROPIC_KEY });
    const res = await POST(req);
    const body = await res.json();

    expect(body.error).toMatch(/Service unavailable|Failed to connect/i);
  });

  // 20. Non-Error throw → 500 with fallback mentioning the provider
  it('returns 500 with a fallback message when a non-Error value is thrown (Anthropic)', async () => {
    mockMessagesCreate.mockRejectedValue('string rejection');

    const req = makeAnthropicRequest({ apiKey: VALID_ANTHROPIC_KEY });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/Failed to connect/i);
  });

  // 21. success:false on all Anthropic non-200 responses
  it('always includes success: false in error responses for Anthropic', async () => {
    // 400 missing key
    const missingKeyRes = await POST(makeAnthropicRequest({ apiKey: null }));
    expect((await missingKeyRes.json()).success).toBe(false);

    // 401 invalid key
    mockMessagesCreate.mockRejectedValue(Object.assign(new Error('auth'), { status: 401 }));
    const invalidKeyRes = await POST(makeAnthropicRequest({ apiKey: 'sk-ant-bad' }));
    expect((await invalidKeyRes.json()).success).toBe(false);
  });

  // 22. Fallback error message names the provider
  it('includes "anthropic" in the fallback 500 error message when no message is available', async () => {
    mockMessagesCreate.mockRejectedValue({ noMessage: true }); // no .message property

    const req = makeAnthropicRequest({ apiKey: VALID_ANTHROPIC_KEY });
    const res = await POST(req);
    const body = await res.json();

    expect(body.error).toMatch(/anthropic/i);
  });
});

// ===========================================================================
// 23–24. Provider routing
// ===========================================================================

describe('POST /api/settings/test-connection — provider routing', () => {
  beforeEach(() => {
    mockAuthPayload = MOCK_AUTH;
  });

  // 23. Unsupported provider → 400
  it('returns 400 with a descriptive error for an unsupported provider value', async () => {
    const req = makeRequestWithProvider('gemini', 'some-key');
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/unsupported provider/i);
    expect(body.success).toBe(false);
  });

  // 24. Omitting provider defaults to "openai"
  it('defaults to OpenAI behaviour when the provider field is omitted', async () => {
    mockModelsList.mockResolvedValue({ data: [] });

    // Body without a provider field — OpenAI key supplied via header
    const req = new NextRequest('http://localhost/api/settings/test-connection', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-openai-api-key': VALID_OPENAI_KEY,
      },
      body: JSON.stringify({}), // no provider
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBe('openai');
    expect(mockModelsList).toHaveBeenCalledTimes(1);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 25. Content-Type is always application/json
// ===========================================================================

describe('POST /api/settings/test-connection — Content-Type', () => {
  beforeEach(() => {
    mockAuthPayload = MOCK_AUTH;
  });

  it('returns application/json Content-Type for a 200 OpenAI response', async () => {
    const req = makeOpenAIRequest({ apiKey: VALID_OPENAI_KEY });
    const res = await POST(req);

    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toMatch(/application\/json/);
  });

  it('returns application/json Content-Type for a 200 Anthropic response', async () => {
    const req = makeAnthropicRequest({ apiKey: VALID_ANTHROPIC_KEY });
    const res = await POST(req);

    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toMatch(/application\/json/);
  });

  it('returns application/json Content-Type for a 400 response (missing OpenAI key)', async () => {
    const req = makeOpenAIRequest({ apiKey: null });
    const res = await POST(req);

    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toMatch(/application\/json/);
  });

  it('returns application/json Content-Type for a 400 response (missing Anthropic key)', async () => {
    const req = makeAnthropicRequest({ apiKey: null });
    const res = await POST(req);

    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toMatch(/application\/json/);
  });

  it('returns application/json Content-Type for a 500 response (OpenAI error)', async () => {
    mockModelsList.mockRejectedValue(new Error('Network error'));

    const req = makeOpenAIRequest({ apiKey: VALID_OPENAI_KEY });
    const res = await POST(req);

    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toMatch(/application\/json/);
  });

  it('returns application/json Content-Type for a 500 response (Anthropic error)', async () => {
    mockMessagesCreate.mockRejectedValue(new Error('Network error'));

    const req = makeAnthropicRequest({ apiKey: VALID_ANTHROPIC_KEY });
    const res = await POST(req);

    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toMatch(/application\/json/);
  });

  it('returns application/json Content-Type for a 401 (unauthenticated) response', async () => {
    mockAuthPayload = null;

    const req = makeOpenAIRequest({ apiKey: VALID_OPENAI_KEY });
    const res = await POST(req);

    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toMatch(/application\/json/);
  });
});

// ===========================================================================
// 26. Auth context is available (any userId, not hardcoded)
// ===========================================================================

describe('POST /api/settings/test-connection — auth context', () => {
  // 26a. OpenAI — any userId works
  it('successfully processes an OpenAI request for any authenticated userId (not hardcoded to 1)', async () => {
    mockAuthPayload = { userId: 99, email: 'other@example.com', name: 'Other' };
    mockModelsList.mockResolvedValue({ data: [] });

    const req = makeOpenAIRequest({ apiKey: VALID_OPENAI_KEY });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, provider: 'openai' });
  });

  // 26b. Anthropic — any userId works
  it('successfully processes an Anthropic request for any authenticated userId (not hardcoded to 1)', async () => {
    mockAuthPayload = { userId: 99, email: 'other@example.com', name: 'Other' };
    mockMessagesCreate.mockResolvedValue(ANTHROPIC_SUCCESS_RESPONSE);

    const req = makeAnthropicRequest({ apiKey: VALID_ANTHROPIC_KEY });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, provider: 'anthropic' });
  });
});
