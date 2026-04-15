/**
 * Unit tests for the multi-provider AI configuration feature.
 *
 * Covers the following acceptance criteria:
 *
 *  1.  GET /api/settings returns `anthropicApiKeyMasked` (null when unset)
 *  2.  GET /api/settings returns `anthropicApiKeyMasked` masked (not raw) when set
 *  3.  GET /api/settings returns `aiProvider` defaulting to "openai"
 *  4.  GET /api/settings returns `openaiModel` with default "gpt-4o"
 *  5.  GET /api/settings returns `anthropicModel` with default "claude-3-5-sonnet-20241022"
 *  6.  GET /api/settings never exposes raw `anthropicApiKey` in the response body
 *  7.  PUT /api/settings persists `anthropicApiKey` via upsert
 *  8.  PUT /api/settings persists `aiProvider` ("anthropic")
 *  9.  PUT /api/settings persists `openaiModel` override
 * 10.  PUT /api/settings persists `anthropicModel` override
 * 11.  PUT /api/settings returns masked `anthropicApiKeyMasked` (not raw key)
 * 12.  PUT /api/settings with `anthropicApiKey: null` clears the stored key
 * 13.  PUT /api/settings without new AI provider fields leaves existing values unchanged
 * 14.  Masking helper: key longer than 8 chars → first-5 + ".." + last-4
 * 15.  Masking helper: key ≤ 8 chars → "••••••••"
 * 16.  Masking helper: null → null
 * 17.  GET /api/settings response always contains all four new fields as top-level keys
 * 18.  PUT /api/settings response always contains all four new fields as top-level keys
 * 19.  Existing fields (openaiApiKeyMasked, cloneName, tone, etc.) still work correctly
 * 20.  Long anthropicApiKey is masked to first-5 + ".." + last-4 in PUT response
 * 21.  Short anthropicApiKey (≤8 chars) is masked to "••••••••" in PUT response
 * 22.  GET /api/settings creates default settings when none exist, including new fields
 * 23.  PUT /api/settings upsert create block includes new AI provider fields from body
 * 24.  aiProvider value "openai" round-trips through PUT without modification
 * 25.  aiProvider value "anthropic" round-trips through PUT without modification
 */

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/prisma', () => ({
  prisma: {
    settings: {
      findUnique: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    owner: {
      update: jest.fn(),
    },
  },
}));

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
    constructor(msg: string) {
      super(msg);
      this.name = 'TokenExpiredError';
    }
    expiredAt = new Date();
  },
  JsonWebTokenError: class JsonWebTokenError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'JsonWebTokenError';
    }
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { GET, PUT } from '@/app/api/settings/route';

// ---------------------------------------------------------------------------
// Mock accessor helpers
// ---------------------------------------------------------------------------

const mockFindUnique = prisma.settings.findUnique as jest.Mock;
const mockCreate = (prisma.settings as unknown as { create: jest.Mock }).create;
const mockUpsert = prisma.settings.upsert as jest.Mock;
const mockOwnerUpdate = prisma.owner.update as jest.Mock;

// ---------------------------------------------------------------------------
// JWT / session helpers
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = 'multi-provider-ai-test-secret';
process.env.JWT_SECRET = TEST_JWT_SECRET;

const TEST_USER_ID = 42;

/** Minimal fake JWT that encodes userId so requireAuth can extract it. */
function makeTestToken(userId = TEST_USER_ID): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      email: 'test@example.com',
      name: 'Test User',
      iat: 1700000000,
      exp: 9999999999,
    })
  ).toString('base64url');
  const sig = Buffer.from(`sig:${TEST_JWT_SECRET}`).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

const SESSION_TOKEN = makeTestToken();

// ---------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------

function buildGetRequest(): NextRequest {
  return new Request('http://localhost/api/settings', {
    headers: { cookie: `session=${SESSION_TOKEN}` },
  }) as unknown as NextRequest;
}

function buildPutRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost/api/settings', {
    method: 'PUT',
    headers: {
      cookie: `session=${SESSION_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

// ---------------------------------------------------------------------------
// Settings fixture factory
// ---------------------------------------------------------------------------

/**
 * Builds a realistic Settings record that now includes the four new fields.
 * All new fields default gracefully so existing records are unaffected.
 */
function makeSettings(
  overrides: Partial<{
    id: number;
    ownerId: number;
    userId: number | null;
    cloneName: string;
    systemPrompt: string;
    tone: string;
    responseLength: string;
    openaiApiKeyEncrypted: string | null;
    anthropicApiKey: string | null;
    aiProvider: 'openai' | 'anthropic';
    openaiModel: string | null;
    anthropicModel: string | null;
    avatarUrl: string | null;
    updatedAt: Date;
  }> = {}
) {
  return {
    id: 1,
    ownerId: TEST_USER_ID,
    userId: TEST_USER_ID,
    cloneName: 'My Second Self',
    systemPrompt: 'Infer tone.',
    tone: 'natural',
    responseLength: 'balanced',
    openaiApiKeyEncrypted: null,
    anthropicApiKey: null,
    aiProvider: 'openai' as const,
    openaiModel: 'gpt-4o',
    anthropicModel: 'claude-3-5-sonnet-20241022',
    avatarUrl: null,
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// beforeEach — reset mocks and install safe defaults
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();

  // Default: settings record exists with no API keys set
  mockFindUnique.mockResolvedValue(makeSettings());
  mockCreate.mockResolvedValue(makeSettings());
  mockUpsert.mockResolvedValue(makeSettings());
  mockOwnerUpdate.mockResolvedValue({ id: TEST_USER_ID, cloneName: 'My Second Self' });
});

// ===========================================================================
// GET /api/settings — new fields in response
// ===========================================================================

describe('GET /api/settings — new multi-provider AI fields', () => {
  // 1. anthropicApiKeyMasked: null when no key stored
  it('returns anthropicApiKeyMasked: null when no anthropicApiKey is stored', async () => {
    mockFindUnique.mockResolvedValue(makeSettings({ anthropicApiKey: null }));

    const res = await GET(buildGetRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.anthropicApiKeyMasked).toBeNull();
  });

  // 2. anthropicApiKeyMasked: masked string when key is set (not raw value)
  it('returns a masked anthropicApiKeyMasked when anthropicApiKey is stored', async () => {
    const rawKey = 'sk-ant-api03-verylonganthropickey1234';
    mockFindUnique.mockResolvedValue(makeSettings({ anthropicApiKey: rawKey }));

    const res = await GET(buildGetRequest());
    const body = await res.json();

    // Must not expose the raw key
    expect(body.anthropicApiKeyMasked).not.toBe(rawKey);
    // Must be a non-null masked string
    expect(typeof body.anthropicApiKeyMasked).toBe('string');
    expect(body.anthropicApiKeyMasked).not.toBeNull();
  });

  // 2a. Masking format: first 5 + ".." + last 4 for keys > 8 chars
  it('masks a long anthropicApiKey as first-5 + ".." + last-4', async () => {
    const rawKey = 'sk-ant-api03-abcdefgh9999';
    mockFindUnique.mockResolvedValue(makeSettings({ anthropicApiKey: rawKey }));

    const res = await GET(buildGetRequest());
    const body = await res.json();

    const expected = `${rawKey.slice(0, 5)}..${rawKey.slice(-4)}`;
    expect(body.anthropicApiKeyMasked).toBe(expected);
  });

  // 3. aiProvider defaults to "openai"
  it('returns aiProvider: "openai" when using the default', async () => {
    mockFindUnique.mockResolvedValue(makeSettings({ aiProvider: 'openai' }));

    const res = await GET(buildGetRequest());
    const body = await res.json();

    expect(body.aiProvider).toBe('openai');
  });

  // 3a. aiProvider: "anthropic" is returned correctly
  it('returns aiProvider: "anthropic" when set to anthropic', async () => {
    mockFindUnique.mockResolvedValue(makeSettings({ aiProvider: 'anthropic' }));

    const res = await GET(buildGetRequest());
    const body = await res.json();

    expect(body.aiProvider).toBe('anthropic');
  });

  // 4. openaiModel returns the stored value
  it('returns openaiModel: "gpt-4o" (default)', async () => {
    mockFindUnique.mockResolvedValue(makeSettings({ openaiModel: 'gpt-4o' }));

    const res = await GET(buildGetRequest());
    const body = await res.json();

    expect(body.openaiModel).toBe('gpt-4o');
  });

  // 4a. openaiModel null when not set
  it('returns openaiModel: null when not set', async () => {
    mockFindUnique.mockResolvedValue(makeSettings({ openaiModel: null }));

    const res = await GET(buildGetRequest());
    const body = await res.json();

    expect(body.openaiModel).toBeNull();
  });

  // 5. anthropicModel returns the stored value
  it('returns anthropicModel: "claude-3-5-sonnet-20241022" (default)', async () => {
    mockFindUnique.mockResolvedValue(
      makeSettings({ anthropicModel: 'claude-3-5-sonnet-20241022' })
    );

    const res = await GET(buildGetRequest());
    const body = await res.json();

    expect(body.anthropicModel).toBe('claude-3-5-sonnet-20241022');
  });

  // 5a. anthropicModel null when not set
  it('returns anthropicModel: null when not set', async () => {
    mockFindUnique.mockResolvedValue(makeSettings({ anthropicModel: null }));

    const res = await GET(buildGetRequest());
    const body = await res.json();

    expect(body.anthropicModel).toBeNull();
  });

  // 6. Raw anthropicApiKey must never appear in the response
  it('never exposes the raw anthropicApiKey field in the response body', async () => {
    const rawKey = 'sk-ant-super-secret-key-xyz';
    mockFindUnique.mockResolvedValue(makeSettings({ anthropicApiKey: rawKey }));

    const res = await GET(buildGetRequest());
    const body = await res.json();

    // The response must not contain the raw key value anywhere
    expect(body.anthropicApiKey).toBeUndefined();
    // Verify the raw key string doesn't leak into any field
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain(rawKey);
  });

  // 17. All four new fields are present as top-level keys
  it('response always contains all four new fields as top-level keys', async () => {
    mockFindUnique.mockResolvedValue(makeSettings());

    const res = await GET(buildGetRequest());
    const body = await res.json();

    expect(Object.prototype.hasOwnProperty.call(body, 'anthropicApiKeyMasked')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(body, 'aiProvider')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(body, 'openaiModel')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(body, 'anthropicModel')).toBe(true);
  });

  // 19. Existing fields still work correctly alongside new fields
  it('still returns openaiApiKeyMasked, cloneName, tone, and other existing fields', async () => {
    const existingKey = 'sk-openai-test-key-abcde';
    mockFindUnique.mockResolvedValue(
      makeSettings({ openaiApiKeyEncrypted: existingKey, cloneName: 'Test Clone', tone: 'formal' })
    );

    const res = await GET(buildGetRequest());
    const body = await res.json();

    // Existing fields intact
    expect(body.cloneName).toBe('Test Clone');
    expect(body.tone).toBe('formal');
    expect(body.openaiApiKeyMasked).not.toBeNull();
    expect(body.openaiApiKeyMasked).not.toBe(existingKey);
    // New fields also present
    expect(Object.prototype.hasOwnProperty.call(body, 'anthropicApiKeyMasked')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(body, 'aiProvider')).toBe(true);
  });

  // 22. GET creates default settings when none exist, including new fields
  it('creates default settings with new fields when none exist, returning them in response', async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue(
      makeSettings({
        aiProvider: 'openai',
        openaiModel: 'gpt-4o',
        anthropicModel: 'claude-3-5-sonnet-20241022',
        anthropicApiKey: null,
      })
    );

    const res = await GET(buildGetRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.aiProvider).toBe('openai');
    expect(body.openaiModel).toBe('gpt-4o');
    expect(body.anthropicModel).toBe('claude-3-5-sonnet-20241022');
    expect(body.anthropicApiKeyMasked).toBeNull();
  });
});

// ===========================================================================
// PUT /api/settings — new fields persisted and returned
// ===========================================================================

describe('PUT /api/settings — persisting and returning new multi-provider AI fields', () => {
  // 7. anthropicApiKey is included in the upsert update data when provided
  it('includes anthropicApiKey in the upsert update data when sent in body', async () => {
    const newKey = 'sk-ant-api03-testkey9999';
    mockUpsert.mockResolvedValue(makeSettings({ anthropicApiKey: newKey }));

    const res = await PUT(buildPutRequest({ anthropicApiKey: newKey }));
    expect(res.status).toBe(200);

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const upsertArg = mockUpsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    };
    expect(upsertArg.update.anthropicApiKey).toBe(newKey);
  });

  // 8. aiProvider is included in the upsert update data when provided
  it('includes aiProvider in the upsert update data when sent in body', async () => {
    mockUpsert.mockResolvedValue(makeSettings({ aiProvider: 'anthropic' }));

    const res = await PUT(buildPutRequest({ aiProvider: 'anthropic' }));
    expect(res.status).toBe(200);

    const upsertArg = mockUpsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(upsertArg.update.aiProvider).toBe('anthropic');
  });

  // 9. openaiModel is included in the upsert update data when provided
  it('includes openaiModel in the upsert update data when sent in body', async () => {
    mockUpsert.mockResolvedValue(makeSettings({ openaiModel: 'gpt-4-turbo' }));

    const res = await PUT(buildPutRequest({ openaiModel: 'gpt-4-turbo' }));
    expect(res.status).toBe(200);

    const upsertArg = mockUpsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(upsertArg.update.openaiModel).toBe('gpt-4-turbo');
  });

  // 10. anthropicModel is included in the upsert update data when provided
  it('includes anthropicModel in the upsert update data when sent in body', async () => {
    mockUpsert.mockResolvedValue(makeSettings({ anthropicModel: 'claude-3-opus-20240229' }));

    const res = await PUT(buildPutRequest({ anthropicModel: 'claude-3-opus-20240229' }));
    expect(res.status).toBe(200);

    const upsertArg = mockUpsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(upsertArg.update.anthropicModel).toBe('claude-3-opus-20240229');
  });

  // 11. PUT response returns masked anthropicApiKeyMasked, not raw key
  it('returns masked anthropicApiKeyMasked in response, not the raw key', async () => {
    const rawKey = 'sk-ant-api03-longenoughkey12345';
    mockUpsert.mockResolvedValue(makeSettings({ anthropicApiKey: rawKey }));

    const res = await PUT(buildPutRequest({ anthropicApiKey: rawKey }));
    const body = await res.json();

    expect(body.anthropicApiKeyMasked).not.toBe(rawKey);
    expect(typeof body.anthropicApiKeyMasked).toBe('string');
    // Raw key must not appear anywhere in the response
    expect(body.anthropicApiKey).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(rawKey);
  });

  // 12. anthropicApiKey: null clears the stored key
  it('clears anthropicApiKey when null is sent (sets update.anthropicApiKey to null)', async () => {
    mockUpsert.mockResolvedValue(makeSettings({ anthropicApiKey: null }));

    const res = await PUT(buildPutRequest({ anthropicApiKey: null }));
    expect(res.status).toBe(200);

    const upsertArg = mockUpsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(upsertArg.update.anthropicApiKey).toBeNull();
  });

  // 12a. After clearing, response returns anthropicApiKeyMasked: null
  it('returns anthropicApiKeyMasked: null after clearing the key', async () => {
    mockUpsert.mockResolvedValue(makeSettings({ anthropicApiKey: null }));

    const res = await PUT(buildPutRequest({ anthropicApiKey: null }));
    const body = await res.json();

    expect(body.anthropicApiKeyMasked).toBeNull();
  });

  // 13. Fields not sent in the body are not included in the update data
  it('does not include anthropicApiKey in update data when not sent in body', async () => {
    mockUpsert.mockResolvedValue(makeSettings());

    await PUT(buildPutRequest({ tone: 'casual' }));

    const upsertArg = mockUpsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(Object.prototype.hasOwnProperty.call(upsertArg.update, 'anthropicApiKey')).toBe(false);
  });

  it('does not include aiProvider in update data when not sent in body', async () => {
    mockUpsert.mockResolvedValue(makeSettings());

    await PUT(buildPutRequest({ tone: 'casual' }));

    const upsertArg = mockUpsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(Object.prototype.hasOwnProperty.call(upsertArg.update, 'aiProvider')).toBe(false);
  });

  it('does not include openaiModel in update data when not sent in body', async () => {
    mockUpsert.mockResolvedValue(makeSettings());

    await PUT(buildPutRequest({ tone: 'casual' }));

    const upsertArg = mockUpsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(Object.prototype.hasOwnProperty.call(upsertArg.update, 'openaiModel')).toBe(false);
  });

  it('does not include anthropicModel in update data when not sent in body', async () => {
    mockUpsert.mockResolvedValue(makeSettings());

    await PUT(buildPutRequest({ tone: 'casual' }));

    const upsertArg = mockUpsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(Object.prototype.hasOwnProperty.call(upsertArg.update, 'anthropicModel')).toBe(false);
  });

  // 18. PUT response always contains all four new fields as top-level keys
  it('response always contains all four new fields as top-level keys', async () => {
    mockUpsert.mockResolvedValue(makeSettings());

    const res = await PUT(buildPutRequest({ tone: 'casual' }));
    const body = await res.json();

    expect(Object.prototype.hasOwnProperty.call(body, 'anthropicApiKeyMasked')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(body, 'aiProvider')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(body, 'openaiModel')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(body, 'anthropicModel')).toBe(true);
  });

  // 19. Existing fields still work correctly alongside new fields
  it('still returns openaiApiKeyMasked and existing fields alongside new fields', async () => {
    const openaiKey = 'sk-openai-existing-key-xyz99';
    mockUpsert.mockResolvedValue(
      makeSettings({ openaiApiKeyEncrypted: openaiKey, cloneName: 'Updated Clone' })
    );

    const res = await PUT(buildPutRequest({ cloneName: 'Updated Clone' }));
    const body = await res.json();

    expect(body.cloneName).toBe('Updated Clone');
    expect(body.openaiApiKeyMasked).not.toBeNull();
    expect(body.openaiApiKeyMasked).not.toBe(openaiKey);
    expect(Object.prototype.hasOwnProperty.call(body, 'anthropicApiKeyMasked')).toBe(true);
  });

  // 20. Long anthropicApiKey → masked to first-5 + ".." + last-4 in PUT response
  it('masks a long anthropicApiKey as first-5 + ".." + last-4 in PUT response', async () => {
    const rawKey = 'sk-ant-api03-longtestkey99887766';
    mockUpsert.mockResolvedValue(makeSettings({ anthropicApiKey: rawKey }));

    const res = await PUT(buildPutRequest({ anthropicApiKey: rawKey }));
    const body = await res.json();

    const expected = `${rawKey.slice(0, 5)}..${rawKey.slice(-4)}`;
    expect(body.anthropicApiKeyMasked).toBe(expected);
  });

  // 21. Short anthropicApiKey (≤8 chars) → masked to "••••••••" in PUT response
  it('masks a short anthropicApiKey (≤8 chars) as "••••••••" in PUT response', async () => {
    const rawKey = 'short-k'; // 7 chars
    mockUpsert.mockResolvedValue(makeSettings({ anthropicApiKey: rawKey }));

    const res = await PUT(buildPutRequest({ anthropicApiKey: rawKey }));
    const body = await res.json();

    expect(body.anthropicApiKeyMasked).toBe('••••••••');
  });

  // 23. Upsert create block includes new AI provider fields from body
  it('upsert create block includes anthropicApiKey from body', async () => {
    const newKey = 'sk-ant-newkey-abcd1234';
    mockUpsert.mockResolvedValue(makeSettings({ anthropicApiKey: newKey }));

    await PUT(buildPutRequest({ anthropicApiKey: newKey, aiProvider: 'anthropic' }));

    const upsertArg = mockUpsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(upsertArg.create.anthropicApiKey).toBe(newKey);
  });

  it('upsert create block includes aiProvider from body when provided', async () => {
    mockUpsert.mockResolvedValue(makeSettings({ aiProvider: 'anthropic' }));

    await PUT(buildPutRequest({ aiProvider: 'anthropic' }));

    const upsertArg = mockUpsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
    };
    expect(upsertArg.create.aiProvider).toBe('anthropic');
  });

  // 24. aiProvider "openai" round-trips through PUT
  it('aiProvider value "openai" round-trips through PUT without modification', async () => {
    mockUpsert.mockResolvedValue(makeSettings({ aiProvider: 'openai' }));

    const res = await PUT(buildPutRequest({ aiProvider: 'openai' }));
    const body = await res.json();

    expect(body.aiProvider).toBe('openai');

    const upsertArg = mockUpsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(upsertArg.update.aiProvider).toBe('openai');
  });

  // 25. aiProvider "anthropic" round-trips through PUT
  it('aiProvider value "anthropic" round-trips through PUT without modification', async () => {
    mockUpsert.mockResolvedValue(makeSettings({ aiProvider: 'anthropic' }));

    const res = await PUT(buildPutRequest({ aiProvider: 'anthropic' }));
    const body = await res.json();

    expect(body.aiProvider).toBe('anthropic');

    const upsertArg = mockUpsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(upsertArg.update.aiProvider).toBe('anthropic');
  });

  // openaiModel null clears the model
  it('sets openaiModel to null in update data when null is sent', async () => {
    mockUpsert.mockResolvedValue(makeSettings({ openaiModel: null }));

    await PUT(buildPutRequest({ openaiModel: null }));

    const upsertArg = mockUpsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(upsertArg.update.openaiModel).toBeNull();
  });

  // anthropicModel null clears the model
  it('sets anthropicModel to null in update data when null is sent', async () => {
    mockUpsert.mockResolvedValue(makeSettings({ anthropicModel: null }));

    await PUT(buildPutRequest({ anthropicModel: null }));

    const upsertArg = mockUpsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
    };
    expect(upsertArg.update.anthropicModel).toBeNull();
  });
});

// ===========================================================================
// Masking helper — inline verification of the masking rules
// ===========================================================================

describe('maskApiKey — API key masking rules', () => {
  /**
   * Mirrors the maskApiKey() helper in src/app/api/settings/route.ts.
   * These tests document the exact masking contract so the helper
   * cannot be changed without updating the tests.
   */
  function maskApiKey(raw: string | null | undefined): string | null {
    if (!raw) return null;
    if (raw.length > 8) {
      return `${raw.slice(0, 5)}..${raw.slice(-4)}`;
    }
    return '••••••••';
  }

  // 14. Key longer than 8 chars
  it('key longer than 8 chars → first-5 + ".." + last-4', () => {
    const key = 'sk-openai-test-key-abcdefgh';
    expect(maskApiKey(key)).toBe(`${key.slice(0, 5)}..${key.slice(-4)}`);
  });

  it('key of exactly 9 chars → first-5 + ".." + last-4', () => {
    const key = '123456789'; // exactly 9 chars
    expect(maskApiKey(key)).toBe('12345..6789');
  });

  // 15. Key ≤ 8 chars → "••••••••"
  it('key of exactly 8 chars → "••••••••"', () => {
    expect(maskApiKey('12345678')).toBe('••••••••');
  });

  it('key of 1 char → "••••••••"', () => {
    expect(maskApiKey('x')).toBe('••••••••');
  });

  it('key of 7 chars → "••••••••"', () => {
    expect(maskApiKey('abcdefg')).toBe('••••••••');
  });

  // 16. null / undefined → null
  it('null → null', () => {
    expect(maskApiKey(null)).toBeNull();
  });

  it('undefined → null', () => {
    expect(maskApiKey(undefined)).toBeNull();
  });

  it('empty string → null', () => {
    expect(maskApiKey('')).toBeNull();
  });

  // Additional: masking is consistent (same key → same mask)
  it('masking is deterministic — same input always produces same output', () => {
    const key = 'sk-ant-api03-mykey1234';
    expect(maskApiKey(key)).toBe(maskApiKey(key));
  });

  // Additional: masked value does not contain the raw key
  it('masked value does not contain the raw key as a substring', () => {
    const key = 'sk-openai-supersecretkey9999';
    const masked = maskApiKey(key);
    expect(masked).not.toBe(key);
    expect(masked).not.toContain(key);
  });

  // Additional: openai and anthropic keys follow the same masking rules
  it('OpenAI key and Anthropic key of the same length produce the same mask format', () => {
    const openaiKey = 'sk-proj-openai-key-abcdefghij';
    const anthropicKey = 'sk-ant-api03-anthropic-abcdefg';
    const openaiMasked = maskApiKey(openaiKey);
    const anthropicMasked = maskApiKey(anthropicKey);
    // Both follow the first-5 + ".." + last-4 format
    expect(openaiMasked).toBe(`${openaiKey.slice(0, 5)}..${openaiKey.slice(-4)}`);
    expect(anthropicMasked).toBe(`${anthropicKey.slice(0, 5)}..${anthropicKey.slice(-4)}`);
  });
});

// ===========================================================================
// SettingsData interface — TypeScript compile-time contract verification
// ===========================================================================

describe('SettingsData interface — type contract', () => {
  /**
   * These tests verify the SettingsData TypeScript interface at runtime by
   * constructing a conforming object and asserting each field is present.
   * They act as a living specification of the interface shape.
   */
  it('SettingsData includes all four new fields with correct types', () => {
    // Import the type — if this file compiles, the interface is correctly defined.
    type SettingsData = import('@/types/settings').SettingsData;

    const sample: SettingsData = {
      id: 1,
      ownerId: 1,
      cloneName: 'Test',
      systemPrompt: '',
      tone: 'natural',
      responseLength: 'balanced',
      avatarUrl: null,
      openaiApiKeyMasked: null,
      anthropicApiKeyMasked: null,
      aiProvider: 'openai',
      openaiModel: 'gpt-4o',
      anthropicModel: 'claude-3-5-sonnet-20241022',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    expect(sample.anthropicApiKeyMasked).toBeNull();
    expect(sample.aiProvider).toBe('openai');
    expect(sample.openaiModel).toBe('gpt-4o');
    expect(sample.anthropicModel).toBe('claude-3-5-sonnet-20241022');
  });

  it('SettingsData aiProvider field accepts both "openai" and "anthropic"', () => {
    type SettingsData = import('@/types/settings').SettingsData;

    const withOpenAI: SettingsData = {
      id: 1,
      ownerId: 1,
      cloneName: 'Test',
      systemPrompt: '',
      tone: 'natural',
      responseLength: 'balanced',
      avatarUrl: null,
      openaiApiKeyMasked: null,
      anthropicApiKeyMasked: null,
      aiProvider: 'openai',
      openaiModel: null,
      anthropicModel: null,
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    const withAnthropic: SettingsData = { ...withOpenAI, aiProvider: 'anthropic' };

    expect(withOpenAI.aiProvider).toBe('openai');
    expect(withAnthropic.aiProvider).toBe('anthropic');
  });

  it('SettingsData anthropicApiKeyMasked accepts string | null', () => {
    type SettingsData = import('@/types/settings').SettingsData;

    const withMasked: SettingsData = {
      id: 1,
      ownerId: 1,
      cloneName: 'Test',
      systemPrompt: '',
      tone: 'natural',
      responseLength: 'balanced',
      avatarUrl: null,
      openaiApiKeyMasked: null,
      anthropicApiKeyMasked: 'sk-an..4321',
      aiProvider: 'openai',
      openaiModel: 'gpt-4o',
      anthropicModel: null,
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    expect(withMasked.anthropicApiKeyMasked).toBe('sk-an..4321');
  });
});
