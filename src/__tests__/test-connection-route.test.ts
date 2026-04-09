/**
 * Unit tests for POST /api/settings/test-connection
 *
 * Verifies that the route:
 *  1.  Returns 401 when no valid session is present (requireAuth enforcement)
 *  2.  Returns 401 body with an "error" property
 *  3.  Does NOT call OpenAI when the request is unauthenticated
 *  4.  Returns 400 when the x-openai-api-key header is missing (authenticated)
 *  5.  Returns 200 { success: true } when the OpenAI call succeeds (authenticated)
 *  6.  Returns 401 when OpenAI reports an invalid API key (error.status === 401)
 *  7.  Returns 429 when OpenAI reports rate-limit exceeded (error.status === 429)
 *  8.  Returns 500 when OpenAI throws an unexpected error
 *  9.  Response Content-Type is always application/json
 * 10.  Handler is not invoked when authentication fails (requireAuth short-circuits)
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
// Import handler AFTER mocks
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/settings/test-connection/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_AUTH = { userId: 42, email: 'owner@example.com', name: 'Test Owner' };
const VALID_API_KEY = 'sk-test-valid-key-1234567890';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(options: {
  apiKey?: string | null;
  sessionCookie?: string;
} = {}): NextRequest {
  const headers: Record<string, string> = {};

  if (options.apiKey !== undefined && options.apiKey !== null) {
    headers['x-openai-api-key'] = options.apiKey;
  }

  if (options.sessionCookie) {
    headers['cookie'] = `session=${options.sessionCookie}`;
  }

  return new NextRequest('http://localhost/api/settings/test-connection', {
    method: 'POST',
    headers,
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthPayload = null;
  mockModelsList.mockResolvedValue({ data: [] });
});

// ===========================================================================
// 1–3. Unauthenticated requests
// ===========================================================================

describe('POST /api/settings/test-connection — unauthenticated', () => {
  // 1. Missing / invalid session → 401
  it('returns 401 when no valid session is present', async () => {
    const req = makeRequest({ apiKey: VALID_API_KEY });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  // 2. 401 body has an "error" property
  it('includes an "error" property in the 401 JSON body', async () => {
    const req = makeRequest({ apiKey: VALID_API_KEY });
    const res = await POST(req);
    const body = await res.json();

    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  // 3. OpenAI is NOT contacted when the request is unauthenticated
  it('does not call OpenAI when authentication fails', async () => {
    const req = makeRequest({ apiKey: VALID_API_KEY });
    await POST(req);

    expect(mockModelsList).not.toHaveBeenCalled();
  });

  // 10. The inner handler is never reached
  it('returns 401 regardless of whether an API key header is present or absent', async () => {
    const withKey = await POST(makeRequest({ apiKey: VALID_API_KEY }));
    const withoutKey = await POST(makeRequest({ apiKey: null }));

    expect(withKey.status).toBe(401);
    expect(withoutKey.status).toBe(401);
  });
});

// ===========================================================================
// Authenticated requests
// ===========================================================================

describe('POST /api/settings/test-connection — authenticated', () => {
  beforeEach(() => {
    mockAuthPayload = MOCK_AUTH;
  });

  // 4. Missing x-openai-api-key → 400
  it('returns 400 when the x-openai-api-key header is absent', async () => {
    const req = makeRequest({ apiKey: null });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 body with a descriptive error message when API key is missing', async () => {
    const req = makeRequest({ apiKey: null });
    const res = await POST(req);
    const body = await res.json();

    expect(body.error).toMatch(/api key/i);
  });

  // 5. Successful OpenAI call → 200 { success: true }
  it('returns 200 with { success: true } when OpenAI models.list() succeeds', async () => {
    mockModelsList.mockResolvedValue({ data: [] });

    const req = makeRequest({ apiKey: VALID_API_KEY });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
  });

  it('calls openai.models.list() when a valid API key is provided', async () => {
    const req = makeRequest({ apiKey: VALID_API_KEY });
    await POST(req);

    expect(mockModelsList).toHaveBeenCalledTimes(1);
  });

  // 6. OpenAI 401 → 401 with user-friendly message
  it('returns 401 with a user-friendly message when OpenAI rejects the API key', async () => {
    const apiError = Object.assign(new Error('Invalid API key'), { status: 401 });
    mockModelsList.mockRejectedValue(apiError);

    const req = makeRequest({ apiKey: 'sk-invalid-key' });
    const res = await POST(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/invalid api key/i);
  });

  // 7. OpenAI 429 → 429 with user-friendly message
  it('returns 429 with a user-friendly message when OpenAI rate-limits the request', async () => {
    const rateLimitError = Object.assign(new Error('Too many requests'), { status: 429 });
    mockModelsList.mockRejectedValue(rateLimitError);

    const req = makeRequest({ apiKey: VALID_API_KEY });
    const res = await POST(req);

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/rate limit/i);
  });

  // 8. Unexpected OpenAI error → 500
  it('returns 500 when OpenAI throws an unexpected error', async () => {
    mockModelsList.mockRejectedValue(new Error('Network timeout'));

    const req = makeRequest({ apiKey: VALID_API_KEY });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('includes the error message in the 500 response body', async () => {
    mockModelsList.mockRejectedValue(new Error('Unexpected connectivity issue'));

    const req = makeRequest({ apiKey: VALID_API_KEY });
    const res = await POST(req);
    const body = await res.json();

    expect(body.error).toMatch(/Unexpected connectivity issue|Failed to connect/i);
  });

  it('returns 500 with a fallback message when a non-Error value is thrown', async () => {
    mockModelsList.mockRejectedValue('string rejection');

    const req = makeRequest({ apiKey: VALID_API_KEY });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/Failed to connect/i);
  });

  // 9. Content-Type is always application/json
  it('returns application/json Content-Type for a 200 response', async () => {
    const req = makeRequest({ apiKey: VALID_API_KEY });
    const res = await POST(req);

    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toMatch(/application\/json/);
  });

  it('returns application/json Content-Type for a 400 response (missing key)', async () => {
    const req = makeRequest({ apiKey: null });
    const res = await POST(req);

    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toMatch(/application\/json/);
  });

  it('returns application/json Content-Type for a 500 response (OpenAI error)', async () => {
    mockModelsList.mockRejectedValue(new Error('Network error'));

    const req = makeRequest({ apiKey: VALID_API_KEY });
    const res = await POST(req);

    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toMatch(/application\/json/);
  });
});

// ===========================================================================
// Auth is scoped to the authenticated user (userId is available in ctx)
// ===========================================================================

describe('POST /api/settings/test-connection — auth context is available', () => {
  it('successfully processes a request for any authenticated userId (not hardcoded to 1)', async () => {
    // Use a userId that is explicitly NOT 1 to confirm there is no hardcoded ownerId
    mockAuthPayload = { userId: 99, email: 'other@example.com', name: 'Other' };
    mockModelsList.mockResolvedValue({ data: [] });

    const req = makeRequest({ apiKey: VALID_API_KEY });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
  });
});
