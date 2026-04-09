/**
 * Unit tests for POST /api/auth/signup route handler.
 *
 * All external dependencies (prisma, bcryptjs, jsonwebtoken) are mocked so
 * the tests remain deterministic and require no database or network.
 *
 * Tests validate:
 *  1.  Valid payload → 201 with { id, email, name }
 *  2.  Valid payload → Set-Cookie header sets `session` HttpOnly cookie
 *  3.  Valid payload → JWT in the cookie contains { userId, email, name }
 *  4.  Duplicate email → 409 Conflict
 *  5.  Missing name → 400 with descriptive message
 *  6.  Empty name (whitespace only) → 400
 *  7.  Missing email → 400
 *  8.  Invalid email format → 400
 *  9.  Missing password → 400
 * 10.  Short password (< 8 chars) → 400
 * 11.  Password is hashed with bcrypt (never stored in plaintext)
 * 12.  Settings record is auto-created for the new owner
 * 13.  Race-condition duplicate (P2002 from DB) → 409
 * 14.  Non-JSON body → 400
 * 15.  Email is normalised to lowercase before storage
 * 16.  Name is trimmed before storage
 */

import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Module-level mocks — declared before any imports that resolve the modules
// ---------------------------------------------------------------------------

// We capture the mock factories so individual tests can override return values.
const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockTransaction = jest.fn();

jest.mock('@/lib/prisma', () => ({
  prisma: {
    owner: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

const mockHash = jest.fn();
jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: { hash: (...args: unknown[]) => mockHash(...args) },
  hash: (...args: unknown[]) => mockHash(...args),
}));

const mockJwtSign = jest.fn();
jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: { sign: (...args: unknown[]) => mockJwtSign(...args) },
  sign: (...args: unknown[]) => mockJwtSign(...args),
}));

// ---------------------------------------------------------------------------
// Import the handler AFTER mocks are in place
// ---------------------------------------------------------------------------
import { POST } from '@/app/api/auth/signup/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a NextRequest with a JSON body for POST /api/auth/signup.
 */
function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Parse the Set-Cookie header string into a key→value map of directives.
 * e.g. "session=tok; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax"
 *   → { session: 'tok', Path: '/', 'Max-Age': '604800', HttpOnly: true, SameSite: 'Lax' }
 */
function parseCookieHeader(header: string): Record<string, string | boolean> {
  return header.split(';').map((p) => p.trim()).reduce<Record<string, string | boolean>>(
    (acc, part) => {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) {
        acc[part] = true; // flag directive, e.g. HttpOnly
      } else {
        acc[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim();
      }
      return acc;
    },
    {}
  );
}

// ---------------------------------------------------------------------------
// Default mock implementations for the "happy path"
// ---------------------------------------------------------------------------

const MOCK_OWNER = { id: 42, email: 'alice@example.com', cloneName: 'Alice' };
const MOCK_TOKEN = 'mock.jwt.token';

function setupHappyPath() {
  // No existing owner with this email
  mockFindUnique.mockResolvedValue(null);

  // bcrypt returns a stable hash string
  mockHash.mockResolvedValue('$2b$12$hashedpassword');

  // $transaction executes the callback and resolves with the new owner
  mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
    const txOwnerCreate = jest.fn().mockResolvedValue(MOCK_OWNER);
    const txSettingsCreate = jest.fn().mockResolvedValue({ id: 1, ownerId: MOCK_OWNER.id });
    return cb({ owner: { create: txOwnerCreate }, settings: { create: txSettingsCreate } });
  });

  // jwt.sign returns a deterministic token
  mockJwtSign.mockReturnValue(MOCK_TOKEN);

  // Set JWT_SECRET so the handler can sign tokens
  process.env.JWT_SECRET = 'test-secret-value';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/auth/signup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupHappyPath();
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  // -------------------------------------------------------------------------
  // 1. Successful signup → 201 with user info
  // -------------------------------------------------------------------------
  it('returns HTTP 201 with { id, email, name } on a valid payload', async () => {
    const req = makeRequest({ email: 'alice@example.com', password: 'securepass', name: 'Alice' });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ id: MOCK_OWNER.id, email: MOCK_OWNER.email, name: MOCK_OWNER.cloneName });
  });

  // -------------------------------------------------------------------------
  // 2. Session cookie is present and HttpOnly
  // -------------------------------------------------------------------------
  it('sets an HttpOnly `session` cookie containing the JWT token', async () => {
    const req = makeRequest({ email: 'alice@example.com', password: 'securepass', name: 'Alice' });
    const res = await POST(req);

    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).not.toBeNull();

    const directives = parseCookieHeader(setCookie!);
    expect(directives['session']).toBe(MOCK_TOKEN);
    expect(directives['HttpOnly']).toBe(true);
    expect(directives['Path']).toBe('/');
    expect(directives['SameSite']).toBe('Lax');
  });

  // -------------------------------------------------------------------------
  // 3. JWT payload contains userId, email, name
  // -------------------------------------------------------------------------
  it('signs a JWT with { userId, email, name } as the payload', async () => {
    const req = makeRequest({ email: 'alice@example.com', password: 'securepass', name: 'Alice' });
    await POST(req);

    expect(mockJwtSign).toHaveBeenCalledTimes(1);
    const [payload] = mockJwtSign.mock.calls[0] as [Record<string, unknown>, ...unknown[]];
    expect(payload).toMatchObject({
      userId: MOCK_OWNER.id,
      email: MOCK_OWNER.email,
      name: MOCK_OWNER.cloneName,
    });
  });

  // -------------------------------------------------------------------------
  // 4. Duplicate email → 409 Conflict
  // -------------------------------------------------------------------------
  it('returns 409 Conflict when an owner with the same email already exists', async () => {
    mockFindUnique.mockResolvedValue({ id: 1 }); // existing owner

    const req = makeRequest({ email: 'alice@example.com', password: 'securepass', name: 'Alice' });
    const res = await POST(req);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 5. Missing name → 400
  // -------------------------------------------------------------------------
  it('returns 400 when name is missing', async () => {
    const req = makeRequest({ email: 'alice@example.com', password: 'securepass' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // -------------------------------------------------------------------------
  // 6. Whitespace-only name → 400
  // -------------------------------------------------------------------------
  it('returns 400 when name is an empty/whitespace-only string', async () => {
    const req = makeRequest({ email: 'alice@example.com', password: 'securepass', name: '   ' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // -------------------------------------------------------------------------
  // 7. Missing email → 400
  // -------------------------------------------------------------------------
  it('returns 400 when email is missing', async () => {
    const req = makeRequest({ password: 'securepass', name: 'Alice' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // -------------------------------------------------------------------------
  // 8. Invalid email format → 400
  // -------------------------------------------------------------------------
  it.each([
    'notanemail',
    'missing@tld',
    '@nodomain.com',
    'spaces in@email.com',
    '',
  ])('returns 400 for invalid email format: %s', async (invalidEmail) => {
    const req = makeRequest({ email: invalidEmail, password: 'securepass', name: 'Alice' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/email/i);
  });

  // -------------------------------------------------------------------------
  // 9. Missing password → 400
  // -------------------------------------------------------------------------
  it('returns 400 when password is missing', async () => {
    const req = makeRequest({ email: 'alice@example.com', name: 'Alice' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // -------------------------------------------------------------------------
  // 10. Password too short → 400
  // -------------------------------------------------------------------------
  it.each(['', 'abc', '1234567'])('returns 400 for password shorter than 8 chars: "%s"', async (shortPass) => {
    const req = makeRequest({ email: 'alice@example.com', password: shortPass, name: 'Alice' });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toMatch(/password/i);
  });

  // -------------------------------------------------------------------------
  // 11. Password is hashed with bcrypt, never stored in plaintext
  // -------------------------------------------------------------------------
  it('hashes the password with bcrypt (12 rounds) before storing it', async () => {
    const plainPassword = 'securepass';
    const req = makeRequest({ email: 'alice@example.com', password: plainPassword, name: 'Alice' });
    await POST(req);

    // bcrypt.hash must have been called with the plain password and 12 rounds
    expect(mockHash).toHaveBeenCalledWith(plainPassword, 12);

    // The plain password must NOT appear anywhere in the owner.create data
    const txCall = mockTransaction.mock.calls[0];
    expect(txCall).toBeDefined();

    // Intercept what owner.create was called with inside the transaction
    let ownerCreateArg: Record<string, unknown> | undefined;
    mockTransaction.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => {
      const txOwnerCreate = jest.fn().mockImplementation((args: unknown) => {
        ownerCreateArg = args as Record<string, unknown>;
        return Promise.resolve(MOCK_OWNER);
      });
      const txSettingsCreate = jest.fn().mockResolvedValue({});
      return cb({ owner: { create: txOwnerCreate }, settings: { create: txSettingsCreate } });
    });

    const req2 = makeRequest({ email: 'bob@example.com', password: plainPassword, name: 'Bob' });
    await POST(req2);

    expect(ownerCreateArg).toBeDefined();
    const data = (ownerCreateArg as { data: Record<string, unknown> }).data;
    expect(data.passwordHash).not.toBe(plainPassword);
    expect(data.passwordHash).toBe('$2b$12$hashedpassword'); // the mocked hash
  });

  // -------------------------------------------------------------------------
  // 12. Settings record is auto-created
  // -------------------------------------------------------------------------
  it('creates a Settings record linked to the new owner inside the transaction', async () => {
    let settingsCreateArg: Record<string, unknown> | undefined;

    mockTransaction.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => {
      const txOwnerCreate = jest.fn().mockResolvedValue(MOCK_OWNER);
      const txSettingsCreate = jest.fn().mockImplementation((args: unknown) => {
        settingsCreateArg = args as Record<string, unknown>;
        return Promise.resolve({ id: 1, ownerId: MOCK_OWNER.id });
      });
      return cb({ owner: { create: txOwnerCreate }, settings: { create: txSettingsCreate } });
    });

    const req = makeRequest({ email: 'alice@example.com', password: 'securepass', name: 'Alice' });
    await POST(req);

    expect(settingsCreateArg).toBeDefined();
    const data = (settingsCreateArg as { data: Record<string, unknown> }).data;
    expect(data.ownerId).toBe(MOCK_OWNER.id);
  });

  // -------------------------------------------------------------------------
  // 13. Race-condition duplicate (P2002 DB error) → 409
  // -------------------------------------------------------------------------
  it('returns 409 when the database raises a P2002 unique-constraint error', async () => {
    // Duplicate check passes (race condition), but DB rejects with P2002
    mockFindUnique.mockResolvedValue(null);
    const dbError = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    mockTransaction.mockRejectedValue(dbError);

    const req = makeRequest({ email: 'alice@example.com', password: 'securepass', name: 'Alice' });
    const res = await POST(req);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // -------------------------------------------------------------------------
  // 14. Non-JSON body → 400
  // -------------------------------------------------------------------------
  it('returns 400 when the request body is not valid JSON', async () => {
    const req = new NextRequest('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not json',
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // -------------------------------------------------------------------------
  // 15. Email is normalised to lowercase
  // -------------------------------------------------------------------------
  it('normalises the email to lowercase before checking for duplicates and storing', async () => {
    const req = makeRequest({ email: 'Alice@EXAMPLE.COM', password: 'securepass', name: 'Alice' });
    await POST(req);

    // findUnique must have been called with the lowercased email
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'alice@example.com' } })
    );
  });

  // -------------------------------------------------------------------------
  // 16. Name is trimmed
  // -------------------------------------------------------------------------
  it('trims leading and trailing whitespace from the name before storing it', async () => {
    let ownerCreateData: Record<string, unknown> | undefined;

    mockTransaction.mockImplementationOnce(async (cb: (tx: unknown) => Promise<unknown>) => {
      const txOwnerCreate = jest.fn().mockImplementation((args: unknown) => {
        ownerCreateData = (args as { data: Record<string, unknown> }).data;
        return Promise.resolve({ ...MOCK_OWNER, cloneName: 'Alice' });
      });
      const txSettingsCreate = jest.fn().mockResolvedValue({});
      return cb({ owner: { create: txOwnerCreate }, settings: { create: txSettingsCreate } });
    });

    const req = makeRequest({ email: 'alice@example.com', password: 'securepass', name: '  Alice  ' });
    await POST(req);

    expect(ownerCreateData).toBeDefined();
    expect(ownerCreateData!.cloneName).toBe('Alice');
  });

  // -------------------------------------------------------------------------
  // Cookie — Max-Age is set to a positive value (not 0/expired)
  // -------------------------------------------------------------------------
  it('sets a positive Max-Age on the session cookie so it persists across requests', async () => {
    const req = makeRequest({ email: 'alice@example.com', password: 'securepass', name: 'Alice' });
    const res = await POST(req);

    const setCookie = res.headers.get('Set-Cookie')!;
    const directives = parseCookieHeader(setCookie);
    expect(Number(directives['Max-Age'])).toBeGreaterThan(0);
  });
});
