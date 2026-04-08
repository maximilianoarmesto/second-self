/**
 * Unit tests for the public clone avatar feature.
 *
 * Acceptance criteria verified:
 *  1. GET /api/clone/[token]/validate includes `avatarUrl` in the response
 *  2. `avatarUrl` is taken from owner.settings.avatarUrl when set
 *  3. `avatarUrl` is null when no settings record exists
 *  4. `avatarUrl` is null when settings.avatarUrl is null
 *  5. Other response fields (valid, cloneName) are unaffected by the change
 *  6. Inactive / missing links still return 404 (no regression)
 *
 * All Prisma calls are mocked — no database access.
 */

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports
// ---------------------------------------------------------------------------

jest.mock('@/lib/prisma', () => ({
  prisma: {
    shareLink: {
      findUnique: jest.fn(),
    },
  },
}));

// crypto is a Node built-in; mock only the piece we need so the hash value
// is deterministic and the test doesn't depend on real SHA-256 output.
jest.mock('crypto', () => ({
  createHash: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('hashed-token'),
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/clone/[token]/validate/route';

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

const mockFindUnique = prisma.shareLink.findUnique as jest.Mock;

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/**
 * Builds a minimal NextRequest for the validate endpoint.
 * The actual URL doesn't affect route behaviour under test — params are
 * injected directly via the second argument.
 */
function buildRequest(): NextRequest {
  return new Request('http://localhost/api/clone/test-token/validate') as unknown as NextRequest;
}

/**
 * Resolves the `params` argument passed to the route handler.
 * The route receives `{ params: Promise<{ token: string }> }`.
 */
function buildParams(token = 'test-token') {
  return { params: Promise.resolve({ token }) };
}

/**
 * Returns a ShareLink fixture with the given settings.avatarUrl value.
 */
function buildLink({
  avatarUrl = '/uploads/avatar.jpg',
  cloneName = 'Alice',
  hasSettings = true,
  isActive = true,
}: {
  avatarUrl?: string | null;
  cloneName?: string;
  hasSettings?: boolean;
  isActive?: boolean;
} = {}) {
  return {
    isActive,
    owner: {
      cloneName: 'FallbackName',
      settings: hasSettings
        ? {
            cloneName,
            avatarUrl,
          }
        : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// 1. avatarUrl is included in successful responses
// ===========================================================================

describe('avatarUrl in validate response', () => {
  it('returns avatarUrl from settings when the owner has an avatar set', async () => {
    mockFindUnique.mockResolvedValue(
      buildLink({ avatarUrl: '/uploads/1717000000000-a3f9c2.jpg' })
    );

    const res = await GET(buildRequest(), buildParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty('avatarUrl', '/uploads/1717000000000-a3f9c2.jpg');
  });

  it('returns avatarUrl: null when settings.avatarUrl is null', async () => {
    mockFindUnique.mockResolvedValue(buildLink({ avatarUrl: null }));

    const res = await GET(buildRequest(), buildParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty('avatarUrl', null);
  });

  it('returns avatarUrl: null when the owner has no settings record', async () => {
    mockFindUnique.mockResolvedValue(buildLink({ hasSettings: false }));

    const res = await GET(buildRequest(), buildParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty('avatarUrl', null);
  });

  it('always includes the avatarUrl key in a successful response (not undefined)', async () => {
    mockFindUnique.mockResolvedValue(buildLink({ avatarUrl: null }));

    const res = await GET(buildRequest(), buildParams());
    const body = await res.json();

    // The key must be explicitly present (not just absent / undefined),
    // so client code can rely on `data.avatarUrl ?? null` without guarding.
    expect(Object.prototype.hasOwnProperty.call(body, 'avatarUrl')).toBe(true);
  });
});

// ===========================================================================
// 2. Existing fields are unaffected
// ===========================================================================

describe('existing response fields are not broken by the avatarUrl addition', () => {
  it('still returns valid: true for an active link', async () => {
    mockFindUnique.mockResolvedValue(buildLink());

    const res = await GET(buildRequest(), buildParams());
    const body = await res.json();

    expect(body.valid).toBe(true);
  });

  it('uses settings.cloneName over owner.cloneName when settings exist', async () => {
    mockFindUnique.mockResolvedValue(
      buildLink({ cloneName: 'AliceFromSettings' })
    );

    const res = await GET(buildRequest(), buildParams());
    const body = await res.json();

    expect(body.cloneName).toBe('AliceFromSettings');
  });

  it('falls back to owner.cloneName when settings record is absent', async () => {
    mockFindUnique.mockResolvedValue(buildLink({ hasSettings: false }));

    const res = await GET(buildRequest(), buildParams());
    const body = await res.json();

    expect(body.cloneName).toBe('FallbackName');
  });

  it('response body contains exactly { valid, cloneName, avatarUrl } keys', async () => {
    mockFindUnique.mockResolvedValue(buildLink());

    const res = await GET(buildRequest(), buildParams());
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(['avatarUrl', 'cloneName', 'valid'].sort());
  });
});

// ===========================================================================
// 3. Inactive / missing links — no regression
// ===========================================================================

describe('invalid / inactive link handling (regression)', () => {
  it('returns 404 when the share link does not exist', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await GET(buildRequest(), buildParams());

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body).not.toHaveProperty('avatarUrl');
  });

  it('returns 404 when the share link is inactive (isActive: false)', async () => {
    mockFindUnique.mockResolvedValue(buildLink({ isActive: false }));

    const res = await GET(buildRequest(), buildParams());

    expect(res.status).toBe(404);
  });

  it('returns 500 when the database throws', async () => {
    mockFindUnique.mockRejectedValue(new Error('DB connection lost'));

    const res = await GET(buildRequest(), buildParams());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/DB connection lost|Failed to validate token/i);
  });
});

// ===========================================================================
// 4. avatarUrl shape validation
// ===========================================================================

describe('avatarUrl value shape', () => {
  it('preserves a relative /uploads/ path exactly as stored', async () => {
    const stored = '/uploads/1700000000000-abc123.png';
    mockFindUnique.mockResolvedValue(buildLink({ avatarUrl: stored }));

    const res = await GET(buildRequest(), buildParams());
    const body = await res.json();

    expect(body.avatarUrl).toBe(stored);
  });

  it('preserves a PNG avatar URL', async () => {
    const stored = '/uploads/photo.png';
    mockFindUnique.mockResolvedValue(buildLink({ avatarUrl: stored }));

    const res = await GET(buildRequest(), buildParams());
    const body = await res.json();

    expect(body.avatarUrl).toBe(stored);
  });

  it('returns null (not undefined, not empty string) when no avatar is set', async () => {
    mockFindUnique.mockResolvedValue(buildLink({ avatarUrl: null }));

    const res = await GET(buildRequest(), buildParams());
    const body = await res.json();

    // JSON serialises both null and undefined to null, but an absent key would
    // not pass the hasOwnProperty check above. Here we assert the exact value.
    expect(body.avatarUrl).toBeNull();
  });
});
