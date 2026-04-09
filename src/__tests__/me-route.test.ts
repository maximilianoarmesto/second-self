/**
 * Unit tests for GET /api/auth/me route handler.
 *
 * All external dependencies (prisma, requireAuth / getUserFromRequest) are
 * mocked so the tests remain deterministic and require no database or network.
 *
 * Tests validate:
 *
 *  Authenticated — happy path
 *  1.  Valid session → 200 with { id, email, name, avatarUrl }
 *  2.  Response body shape matches the MeResponse type exactly
 *  3.  avatarUrl is fetched from the linked Settings record
 *  4.  avatarUrl is null when no Settings row exists
 *  5.  avatarUrl is null when the Settings row has avatarUrl = null
 *  6.  email may be null (nullable on the Owner model)
 *  7.  Response Content-Type is application/json
 *
 *  Unauthenticated
 *  8.  Missing / invalid session → 401 from requireAuth (handler not called)
 *  9.  Missing / invalid session → response body has an "error" property
 * 10.  Missing / invalid session → Content-Type is application/json
 *
 *  Owner row not found (deleted account)
 * 11.  Valid token but owner row deleted → 401 with error
 * 12.  Handler does NOT call prisma.settings when owner row is missing
 *
 *  Database errors
 * 13.  prisma.owner.findUnique throws → 500 with error message
 * 14.  prisma.settings.findUnique throws → 500 with error message
 * 15.  500 response body has an "error" property
 *
 *  Response fields
 * 16.  id is a number
 * 17.  name is a string (owner.cloneName)
 * 18.  avatarUrl is present in the response body (even when null)
 * 19.  email is present in the response body (even when null)
 */

import { NextRequest, NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Mock @/lib/prisma BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockOwnerFindUnique = jest.fn();
const mockSettingsFindUnique = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    owner: {
      findUnique: (...args: unknown[]) => mockOwnerFindUnique(...args),
    },
    settings: {
      findUnique: (...args: unknown[]) => mockSettingsFindUnique(...args),
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock requireAuth so we can control auth state in each test
//
// The mock injects a fixed auth context when `mockAuthPayload` is not null,
// and short-circuits with a 401 when it is null — mirroring real requireAuth
// behaviour without needing a real JWT_SECRET.
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
// Import the handler AFTER mocks are in place
// ---------------------------------------------------------------------------
import { GET } from '@/app/api/auth/me/route';
import type { MeResponse } from '@/app/api/auth/me/route';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_AUTH = { userId: 7, email: 'alice@example.com', name: 'Alice' };

const MOCK_OWNER = {
  id: 7,
  email: 'alice@example.com',
  cloneName: 'Alice',
};

const MOCK_SETTINGS = {
  avatarUrl: '/uploads/avatars/alice.png',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/auth/me', {
    headers: { cookie: 'session=mock.token' },
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  // Default: authenticated with an owner row and a settings row
  mockAuthPayload = MOCK_AUTH;
  mockOwnerFindUnique.mockResolvedValue(MOCK_OWNER);
  mockSettingsFindUnique.mockResolvedValue(MOCK_SETTINGS);
});

// ===========================================================================
// Authenticated — happy path
// ===========================================================================

describe('GET /api/auth/me — authenticated', () => {
  // 1. Returns 200 with the correct body
  it('returns HTTP 200 with { id, email, name, avatarUrl } for an authenticated user', async () => {
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);

    const body: MeResponse = await res.json();
    expect(body).toEqual({
      id: MOCK_OWNER.id,
      email: MOCK_OWNER.email,
      name: MOCK_OWNER.cloneName,
      avatarUrl: MOCK_SETTINGS.avatarUrl,
    });
  });

  // 2. Response shape matches MeResponse exactly — no extra / missing fields
  it('returns exactly { id, email, name, avatarUrl } — no extra fields', async () => {
    const res = await GET(makeRequest());
    const body = await res.json();

    const keys = Object.keys(body).sort();
    expect(keys).toEqual(['avatarUrl', 'email', 'id', 'name']);
  });

  // 3. avatarUrl is fetched from the linked Settings record
  it('fetches avatarUrl from prisma.settings.findUnique with the correct ownerId', async () => {
    await GET(makeRequest());

    expect(mockSettingsFindUnique).toHaveBeenCalledWith({
      where: { ownerId: MOCK_OWNER.id },
      select: { avatarUrl: true },
    });
  });

  // 4. avatarUrl is null when no Settings row exists
  it('returns avatarUrl: null when there is no Settings row for the owner', async () => {
    mockSettingsFindUnique.mockResolvedValue(null);

    const res = await GET(makeRequest());
    const body: MeResponse = await res.json();

    expect(res.status).toBe(200);
    expect(body.avatarUrl).toBeNull();
  });

  // 5. avatarUrl is null when Settings.avatarUrl is null
  it('returns avatarUrl: null when the Settings row has avatarUrl = null', async () => {
    mockSettingsFindUnique.mockResolvedValue({ avatarUrl: null });

    const res = await GET(makeRequest());
    const body: MeResponse = await res.json();

    expect(res.status).toBe(200);
    expect(body.avatarUrl).toBeNull();
  });

  // 6. email can be null (Owner.email is nullable)
  it('returns email: null when the owner row has no email', async () => {
    mockOwnerFindUnique.mockResolvedValue({ ...MOCK_OWNER, email: null });

    const res = await GET(makeRequest());
    const body: MeResponse = await res.json();

    expect(res.status).toBe(200);
    expect(body.email).toBeNull();
  });

  // 7. Content-Type is application/json
  it('returns a JSON Content-Type header', async () => {
    const res = await GET(makeRequest());

    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toMatch(/application\/json/);
  });

  // 16. id is a number
  it('returns id as a number', async () => {
    const res = await GET(makeRequest());
    const body: MeResponse = await res.json();

    expect(typeof body.id).toBe('number');
  });

  // 17. name is owner.cloneName
  it('maps owner.cloneName to the name field in the response', async () => {
    mockOwnerFindUnique.mockResolvedValue({ ...MOCK_OWNER, cloneName: 'My Clone Name' });

    const res = await GET(makeRequest());
    const body: MeResponse = await res.json();

    expect(body.name).toBe('My Clone Name');
  });

  // 18. avatarUrl key is always present in the response body
  it('always includes the avatarUrl key, even when null', async () => {
    mockSettingsFindUnique.mockResolvedValue(null);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(Object.prototype.hasOwnProperty.call(body, 'avatarUrl')).toBe(true);
    expect(body.avatarUrl).toBeNull();
  });

  // 19. email key is always present in the response body
  it('always includes the email key, even when null', async () => {
    mockOwnerFindUnique.mockResolvedValue({ ...MOCK_OWNER, email: null });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(Object.prototype.hasOwnProperty.call(body, 'email')).toBe(true);
    expect(body.email).toBeNull();
  });

  // prisma.owner.findUnique is called with the userId from the token
  it('looks up the owner using the userId from the auth context', async () => {
    await GET(makeRequest());

    expect(mockOwnerFindUnique).toHaveBeenCalledWith({
      where: { id: MOCK_AUTH.userId },
      select: { id: true, email: true, cloneName: true },
    });
  });
});

// ===========================================================================
// Unauthenticated — requireAuth short-circuits with 401
// ===========================================================================

describe('GET /api/auth/me — unauthenticated', () => {
  beforeEach(() => {
    // Simulate a missing or invalid session token
    mockAuthPayload = null;
  });

  // 8. Missing / invalid session → 401
  it('returns 401 when no valid session is present', async () => {
    const req = new NextRequest('http://localhost/api/auth/me');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  // 9. 401 body has an "error" property
  it('includes an "error" property in the 401 JSON body', async () => {
    const req = new NextRequest('http://localhost/api/auth/me');
    const res = await GET(req);
    const body = await res.json();

    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  // 10. 401 response Content-Type is application/json
  it('returns a JSON Content-Type on the 401 response', async () => {
    const req = new NextRequest('http://localhost/api/auth/me');
    const res = await GET(req);

    const contentType = res.headers.get('content-type') ?? '';
    expect(contentType).toMatch(/application\/json/);
  });

  // The database must NOT be queried when there is no valid session
  it('does not query the database when authentication fails', async () => {
    const req = new NextRequest('http://localhost/api/auth/me');
    await GET(req);

    expect(mockOwnerFindUnique).not.toHaveBeenCalled();
    expect(mockSettingsFindUnique).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Owner row not found — token valid but account deleted
// ===========================================================================

describe('GET /api/auth/me — owner not found', () => {
  beforeEach(() => {
    mockAuthPayload = MOCK_AUTH;
    mockOwnerFindUnique.mockResolvedValue(null); // row no longer exists
  });

  // 11. Owner row missing → 401
  it('returns 401 when the owner row no longer exists in the database', async () => {
    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // 12. settings.findUnique must NOT be called when the owner row is missing
  it('does not query Settings when the owner row is not found', async () => {
    await GET(makeRequest());

    expect(mockSettingsFindUnique).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Database errors — 500 responses
// ===========================================================================

describe('GET /api/auth/me — database errors', () => {
  beforeEach(() => {
    mockAuthPayload = MOCK_AUTH;
  });

  // 13. owner.findUnique throws → 500
  it('returns 500 when prisma.owner.findUnique throws an unexpected error', async () => {
    mockOwnerFindUnique.mockRejectedValue(new Error('DB connection lost'));

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
  });

  // 14. settings.findUnique throws → 500
  it('returns 500 when prisma.settings.findUnique throws an unexpected error', async () => {
    mockOwnerFindUnique.mockResolvedValue(MOCK_OWNER);
    mockSettingsFindUnique.mockRejectedValue(new Error('Settings table error'));

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
  });

  // 15. 500 body has an "error" property
  it('includes an "error" property in the 500 JSON body', async () => {
    mockOwnerFindUnique.mockRejectedValue(new Error('Unexpected DB failure'));

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  // Non-Error throws are handled gracefully
  it('returns 500 with a fallback message when a non-Error value is thrown', async () => {
    mockOwnerFindUnique.mockRejectedValue('string error');

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toHaveProperty('error');
  });
});
