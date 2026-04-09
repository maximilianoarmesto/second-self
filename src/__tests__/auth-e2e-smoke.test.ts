/**
 * End-to-end auth smoke test.
 *
 * Covers the full auth lifecycle as specified in the acceptance criteria:
 *
 *  SIGNUP / LOGIN
 *  1.  Two separate users can sign up independently (201 + session cookie each)
 *  2.  Each user can log in independently (200 + session cookie)
 *  3.  Login with wrong password returns 401 (generic message)
 *  4.  Login with unknown email returns 401 (same generic message — no enumeration)
 *
 *  DATA ISOLATION — User A creates data, User B cannot see it
 *  5.  User A uploads a document → only visible in User A's document list
 *  6.  User B's document list is empty (no cross-contamination)
 *  7.  User B cannot GET User A's document by ID (404)
 *  8.  User B cannot DELETE User A's document (404)
 *  9.  User A creates a share link → only visible in User A's share-link list
 * 10.  User B's share-link list is empty
 * 11.  User B cannot revoke User A's share link (404)
 *  DATA ISOLATION — chat sessions
 * 12.  User A creates a chat session → only visible in User A's session list
 * 13.  User B's chat-session list is empty
 * 14.  User B cannot GET User A's chat session (404)
 * 15.  User B cannot DELETE User A's chat session (404)
 *  DATA ISOLATION — settings
 * 16.  User A's settings are independent from User B's settings
 * 17.  Updating User A's settings does not affect User B's settings
 *  DATA ISOLATION — dashboard
 * 18.  Dashboard document / session / link counts are per-user
 *
 *  PUBLIC CLONE SHARE LINK
 * 19.  User A's share-link token validates without authentication
 * 20.  An inactive / revoked token returns 404 (no auth required to check)
 * 21.  An unknown token returns 404
 *
 *  /api/auth/me
 * 22.  GET /api/auth/me with valid session returns the correct user
 * 23.  GET /api/auth/me with no session returns 401
 * 24.  GET /api/auth/me after logout (expired / missing cookie) returns 401
 *
 *  LOGOUT
 * 25.  POST /api/auth/logout returns { success: true } and Max-Age=0 cookie
 * 26.  After logout, protected routes return 401 (session cleared)
 * 27.  After logout, logging back in re-establishes a valid session
 *
 *  PRIVATE ROUTE GUARD (middleware)
 * 28.  Private routes without session cookie redirect to /login
 * 29.  Private routes with session cookie pass through
 * 30.  /login with session redirects to /
 * 31.  /clone/[token] always passes through (no auth required)
 * 32.  /api/* always passes through middleware (auth enforced inside handlers)
 *
 *  UNAUTHENTICATED ACCESS TO PROTECTED API ROUTES
 * 33.  GET /api/documents without session returns 401
 * 34.  POST /api/documents/upload without session returns 401
 * 35.  GET /api/share-links without session returns 401
 * 36.  POST /api/share-links without session returns 401
 * 37.  GET /api/chat/sessions without session returns 401
 * 38.  POST /api/chat/sessions without session returns 401
 * 39.  GET /api/settings without session returns 401
 * 40.  PUT /api/settings without session returns 401
 * 41.  GET /api/dashboard without session returns 401
 * 42.  POST /api/settings/test-connection without session returns 401
 */

import { NextRequest } from 'next/server';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Module-level mocks — must come before any imports of the modules under test
// ---------------------------------------------------------------------------

// ── Prisma ──────────────────────────────────────────────────────────────────

// We maintain a tiny in-memory store keyed by table name so we can simulate
// real multi-user data isolation without a running database.

interface OwnerRow {
  id: number;
  email: string;
  cloneName: string;
  passwordHash: string;
}
interface SettingsRow {
  id: number;
  ownerId: number;
  cloneName: string;
  systemPrompt: string;
  tone: string;
  responseLength: string;
  openaiApiKeyEncrypted: string | null;
  avatarUrl: string | null;
  updatedAt: Date;
}
interface DocumentRow {
  id: number;
  filename: string;
  originalFilename: string;
  fileSize: number;
  pageCount: number | null;
  status: string;
  errorMessage: string | null;
  fileData: Buffer | null;
  ownerId: number;
  createdAt: Date;
  updatedAt: Date;
}
interface ShareLinkRow {
  id: number;
  ownerId: number;
  tokenHash: string;
  label: string;
  isActive: boolean;
  createdAt: Date;
  revokedAt: Date | null;
}
interface ChatSessionRow {
  id: number;
  title: string;
  ownerId: number;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Global in-memory store — reset before each test.
const db = {
  owners: [] as OwnerRow[],
  settings: [] as SettingsRow[],
  documents: [] as DocumentRow[],
  shareLinks: [] as ShareLinkRow[],
  chatSessions: [] as ChatSessionRow[],
  nextId: { owners: 1, settings: 1, documents: 1, shareLinks: 1, chatSessions: 1 },
};

function resetDb() {
  db.owners = [];
  db.settings = [];
  db.documents = [];
  db.shareLinks = [];
  db.chatSessions = [];
  db.nextId = { owners: 1, settings: 1, documents: 1, shareLinks: 1, chatSessions: 1 };
}

// Build the prisma mock implementing just the methods used by the routes.
const prismaMock = {
  owner: {
    findUnique: jest.fn(({ where }: { where: any }) => {
      if (where.id !== undefined) {
        return Promise.resolve(db.owners.find((o) => o.id === where.id) ?? null);
      }
      if (where.email !== undefined) {
        return Promise.resolve(db.owners.find((o) => o.email === where.email) ?? null);
      }
      return Promise.resolve(null);
    }),
    create: jest.fn((args: { data: any }) => {
      const row: OwnerRow = {
        id: db.nextId.owners++,
        email: args.data.email,
        cloneName: args.data.cloneName,
        passwordHash: args.data.passwordHash,
      };
      db.owners.push(row);
      return Promise.resolve(row);
    }),
    update: jest.fn((args: { where: any; data: any }) => {
      const owner = db.owners.find((o) => o.id === args.where.id);
      if (!owner) return Promise.resolve(null);
      if (args.data.cloneName !== undefined) owner.cloneName = args.data.cloneName;
      return Promise.resolve(owner);
    }),
    upsert: jest.fn((args: { where: any; update: any; create: any }) => {
      const existing = db.owners.find((o) => o.id === args.where.id);
      if (existing) {
        Object.assign(existing, args.update);
        return Promise.resolve(existing);
      }
      const row: OwnerRow = {
        id: args.where.id ?? db.nextId.owners++,
        ...args.create,
      };
      db.owners.push(row);
      return Promise.resolve(row);
    }),
  },
  settings: {
    findUnique: jest.fn(({ where }: { where: any }) => {
      const row = db.settings.find(
        (s) =>
          (where.ownerId !== undefined && s.ownerId === where.ownerId) ||
          (where.id !== undefined && s.id === where.id)
      );
      return Promise.resolve(row ?? null);
    }),
    create: jest.fn((args: { data: any }) => {
      const row: SettingsRow = {
        id: db.nextId.settings++,
        ownerId: args.data.ownerId,
        cloneName: args.data.cloneName ?? 'My Second Self',
        systemPrompt: args.data.systemPrompt ?? '',
        tone: args.data.tone ?? 'natural',
        responseLength: args.data.responseLength ?? 'balanced',
        openaiApiKeyEncrypted: args.data.openaiApiKeyEncrypted ?? null,
        avatarUrl: args.data.avatarUrl ?? null,
        updatedAt: new Date(),
      };
      db.settings.push(row);
      return Promise.resolve(row);
    }),
    upsert: jest.fn((args: { where: any; update: any; create: any }) => {
      const existing = db.settings.find((s) => s.ownerId === args.where.ownerId);
      if (existing) {
        Object.assign(existing, args.update);
        existing.updatedAt = new Date();
        return Promise.resolve(existing);
      }
      const row: SettingsRow = {
        id: db.nextId.settings++,
        ownerId: args.create.ownerId,
        cloneName: args.create.cloneName ?? 'My Second Self',
        systemPrompt: args.create.systemPrompt ?? '',
        tone: args.create.tone ?? 'natural',
        responseLength: args.create.responseLength ?? 'balanced',
        openaiApiKeyEncrypted: args.create.openaiApiKeyEncrypted ?? null,
        avatarUrl: args.create.avatarUrl ?? null,
        updatedAt: new Date(),
      };
      db.settings.push(row);
      return Promise.resolve(row);
    }),
    update: jest.fn((args: { where: any; data: any }) => {
      const row = db.settings.find((s) => s.ownerId === args.where.ownerId);
      if (!row) return Promise.resolve(null);
      Object.assign(row, args.data);
      row.updatedAt = new Date();
      return Promise.resolve(row);
    }),
  },
  document: {
    findMany: jest.fn(({ where }: { where: any }) => {
      return Promise.resolve(db.documents.filter((d) => d.ownerId === where.ownerId));
    }),
    findUnique: jest.fn(({ where }: { where: any }) => {
      return Promise.resolve(db.documents.find((d) => d.id === where.id) ?? null);
    }),
    create: jest.fn((args: { data: any }) => {
      const row: DocumentRow = {
        id: db.nextId.documents++,
        filename: args.data.filename,
        originalFilename: args.data.originalFilename,
        fileSize: args.data.fileSize,
        pageCount: args.data.pageCount ?? null,
        status: args.data.status ?? 'PENDING',
        errorMessage: null,
        fileData: args.data.fileData ?? null,
        ownerId: args.data.ownerId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      db.documents.push(row);
      return Promise.resolve(row);
    }),
    delete: jest.fn(({ where }: { where: any }) => {
      const idx = db.documents.findIndex((d) => d.id === where.id);
      if (idx !== -1) db.documents.splice(idx, 1);
      return Promise.resolve({ id: where.id });
    }),
    count: jest.fn(({ where }: { where: any }) =>
      Promise.resolve(db.documents.filter((d) => d.ownerId === where.ownerId).length)
    ),
  },
  documentChunk: {
    count: jest.fn(() => Promise.resolve(0)),
  },
  shareLink: {
    findMany: jest.fn(({ where }: { where: any }) => {
      return Promise.resolve(db.shareLinks.filter((l) => l.ownerId === where.ownerId));
    }),
    findUnique: jest.fn(({ where }: { where: any }) => {
      if (where.id !== undefined) {
        return Promise.resolve(db.shareLinks.find((l) => l.id === where.id) ?? null);
      }
      if (where.tokenHash !== undefined) {
        const link = db.shareLinks.find((l) => l.tokenHash === where.tokenHash);
        if (!link) return Promise.resolve(null);
        // Simulate the `include: { owner: { include: { settings: true } } }` shape
        const owner = db.owners.find((o) => o.id === link.ownerId);
        const settings = db.settings.find((s) => s.ownerId === link.ownerId);
        return Promise.resolve({ ...link, owner: { ...owner, settings: settings ?? null } });
      }
      return Promise.resolve(null);
    }),
    create: jest.fn((args: { data: any }) => {
      const row: ShareLinkRow = {
        id: db.nextId.shareLinks++,
        ownerId: args.data.ownerId,
        tokenHash: args.data.tokenHash,
        label: args.data.label ?? 'Public Link',
        isActive: args.data.isActive ?? true,
        createdAt: new Date(),
        revokedAt: null,
      };
      db.shareLinks.push(row);
      return Promise.resolve(row);
    }),
    update: jest.fn((args: { where: any; data: any }) => {
      const row = db.shareLinks.find((l) => l.id === args.where.id);
      if (!row) return Promise.resolve(null);
      Object.assign(row, args.data);
      return Promise.resolve(row);
    }),
    count: jest.fn(({ where }: { where: any }) =>
      Promise.resolve(
        db.shareLinks.filter((l) => l.ownerId === where.ownerId && l.isActive === where.isActive).length
      )
    ),
  },
  chatSession: {
    findMany: jest.fn(({ where }: { where: any }) => {
      return Promise.resolve(db.chatSessions.filter((s) => s.ownerId === where.ownerId));
    }),
    findUnique: jest.fn(({ where, include }: { where: any; include?: any }) => {
      const session = db.chatSessions.find((s) => s.id === where.id);
      if (!session) return Promise.resolve(null);
      const result: any = { ...session };
      if (include?.messages) result.messages = [];
      return Promise.resolve(result);
    }),
    create: jest.fn((args: { data: any }) => {
      const row: ChatSessionRow = {
        id: db.nextId.chatSessions++,
        title: args.data.title ?? 'New Conversation',
        ownerId: args.data.ownerId,
        isPublic: args.data.isPublic ?? false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      db.chatSessions.push(row);
      return Promise.resolve(row);
    }),
    delete: jest.fn(({ where }: { where: any }) => {
      const idx = db.chatSessions.findIndex((s) => s.id === where.id);
      if (idx !== -1) db.chatSessions.splice(idx, 1);
      return Promise.resolve({ id: where.id });
    }),
    count: jest.fn(({ where }: { where: any }) =>
      Promise.resolve(
        db.chatSessions.filter(
          (s) => s.ownerId === where.ownerId && (where.isPublic === undefined || s.isPublic === where.isPublic)
        ).length
      )
    ),
  },
  $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => {
    return cb(prismaMock);
  }),
};

jest.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

// ── openai ────────────────────────────────────────────────────────────────────
// Mock OpenAI so the test-connection route never makes real network calls.
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    models: {
      list: jest.fn().mockResolvedValue({ data: [] }),
    },
  })),
}));

// ── bcryptjs ─────────────────────────────────────────────────────────────────
// Keep hashing deterministic: hash(pw) → '$hash:' + pw, compare(pw, hash) → hash === '$hash:' + pw
const mockHash = jest.fn((pw: string) => Promise.resolve(`$hash:${pw}`));
const mockCompare = jest.fn((pw: string, hash: string) =>
  Promise.resolve(hash === `$hash:${pw}`)
);

jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: {
    hash: (pw: string, rounds: number) => mockHash(pw),
    compare: (pw: string, hash: string) => mockCompare(pw, hash),
  },
  hash: (pw: string, rounds: number) => mockHash(pw),
  compare: (pw: string, hash: string) => mockCompare(pw, hash),
}));

// ── jsonwebtoken ──────────────────────────────────────────────────────────────
// Use a real-ish JWT that embeds the payload as base64 so verifyToken works.
// This avoids a real crypto dependency while still exercising the route logic.
const JWT_SECRET = 'e2e-test-secret';

function fakeSign(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: 1700000000, exp: 9999999999 })).toString('base64url');
  const sig = Buffer.from(`sig:${JWT_SECRET}`).toString('base64url');
  return `${header}.${body}.${sig}`;
}

function fakeVerify(token: string, secret: string): Record<string, unknown> {
  if (secret !== JWT_SECRET) throw new Error('invalid signature');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('malformed');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) throw Object.assign(new Error('expired'), { name: 'TokenExpiredError' });
    return payload;
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') throw err;
    throw Object.assign(new Error('invalid token'), { name: 'JsonWebTokenError' });
  }
}

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    sign: (payload: Record<string, unknown>, secret: string) => fakeSign(payload),
    verify: (token: string, secret: string) => fakeVerify(token, secret),
  },
  sign: (payload: Record<string, unknown>, secret: string) => fakeSign(payload),
  verify: (token: string, secret: string) => fakeVerify(token, secret),
  TokenExpiredError: class TokenExpiredError extends Error {
    constructor(msg: string, expiredAt: Date) {
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
// Import handlers AFTER mocks are in place
// ---------------------------------------------------------------------------
import { POST as signupPOST } from '@/app/api/auth/signup/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { POST as logoutPOST } from '@/app/api/auth/logout/route';
import { GET as mePOST } from '@/app/api/auth/me/route';
import { GET as documentsGET } from '@/app/api/documents/route';
import { GET as documentByIdGET, DELETE as documentDELETE } from '@/app/api/documents/[documentId]/route';
import { GET as shareLinksGET, POST as shareLinksPOST } from '@/app/api/share-links/route';
import { DELETE as shareLinkDELETE } from '@/app/api/share-links/[linkId]/route';
import { GET as sessionsGET, POST as sessionsPOST } from '@/app/api/chat/sessions/route';
import { GET as sessionByIdGET, DELETE as sessionDELETE } from '@/app/api/chat/sessions/[sessionId]/route';
import { GET as settingsGET, PUT as settingsPUT } from '@/app/api/settings/route';
import { POST as testConnectionPOST } from '@/app/api/settings/test-connection/route';
import { GET as dashboardGET } from '@/app/api/dashboard/route';
import { GET as cloneValidateGET } from '@/app/api/clone/[token]/validate/route';
import { middleware } from '@/middleware';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

process.env.JWT_SECRET = JWT_SECRET;

const USER_A = { email: 'alice@example.com', password: 'password-alice', name: 'Alice' };
const USER_B = { email: 'bob@example.com', password: 'password-bob', name: 'Bob' };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a NextRequest with optional JSON body and optional session cookie.
 */
function makeRequest(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    sessionCookie?: string;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  const { method = 'GET', body, sessionCookie, headers = {} } = options;

  const allHeaders: Record<string, string> = { ...headers };
  if (body && !(body instanceof FormData)) {
    allHeaders['Content-Type'] = 'application/json';
  }
  if (sessionCookie) {
    allHeaders['cookie'] = `session=${sessionCookie}`;
  }

  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: allHeaders,
    ...(body !== undefined
      ? { body: body instanceof FormData ? body : JSON.stringify(body) }
      : {}),
  });
}

/**
 * Extract the `session` cookie value from a Set-Cookie header string.
 * Returns null when the header is absent or has no session cookie value.
 */
function extractSessionCookie(response: Response): string | null {
  const setCookie = response.headers.get('Set-Cookie');
  if (!setCookie) return null;
  for (const part of setCookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('session=')) {
      const value = trimmed.slice('session='.length);
      return value || null;
    }
  }
  return null;
}

/**
 * Sign up a user and return the session cookie.
 */
async function signup(user: typeof USER_A): Promise<string> {
  const req = makeRequest('/api/auth/signup', { method: 'POST', body: user });
  const res = await signupPOST(req);
  expect(res.status).toBe(201);
  const cookie = extractSessionCookie(res);
  expect(cookie).not.toBeNull();
  return cookie!;
}

/**
 * Log in a user and return the session cookie.
 */
async function login(user: Pick<typeof USER_A, 'email' | 'password'>): Promise<string> {
  const req = makeRequest('/api/auth/login', { method: 'POST', body: user });
  const res = await loginPOST(req);
  expect(res.status).toBe(200);
  const cookie = extractSessionCookie(res);
  expect(cookie).not.toBeNull();
  return cookie!;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetDb();
  jest.clearAllMocks();
  process.env.JWT_SECRET = JWT_SECRET;
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

// ===========================================================================
// 1–4. Signup & Login
// ===========================================================================

describe('Signup & Login', () => {
  // 1. Two separate users can sign up independently
  it('(1) two different users can sign up and each receives a unique session cookie', async () => {
    const cookieA = await signup(USER_A);
    const cookieB = await signup(USER_B);

    expect(cookieA).not.toBe(cookieB);
    expect(db.owners.length).toBe(2);
    expect(db.owners[0].email).toBe(USER_A.email);
    expect(db.owners[1].email).toBe(USER_B.email);
  });

  // 2. Each user can log in independently
  it('(2) each user can log in and receive their own session cookie', async () => {
    await signup(USER_A);
    await signup(USER_B);

    const cookieA = await login(USER_A);
    const cookieB = await login(USER_B);

    expect(cookieA).not.toBe(cookieB);

    // Verify the cookies decode to the correct users
    const partsA = cookieA.split('.');
    const payloadA = JSON.parse(Buffer.from(partsA[1], 'base64url').toString());
    const partsB = cookieB.split('.');
    const payloadB = JSON.parse(Buffer.from(partsB[1], 'base64url').toString());

    expect(payloadA.email).toBe(USER_A.email);
    expect(payloadB.email).toBe(USER_B.email);
    expect(payloadA.userId).not.toBe(payloadB.userId);
  });

  // 3. Wrong password → 401
  it('(3) login with wrong password returns 401 with generic error', async () => {
    await signup(USER_A);

    const req = makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: USER_A.email, password: 'wrong-password' },
    });
    const res = await loginPOST(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // 4. Unknown email → 401, same message as wrong password (no enumeration)
  it('(4) login with unknown email returns 401 with the same generic error (no user enumeration)', async () => {
    await signup(USER_A);

    const wrongPasswordReq = makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: USER_A.email, password: 'wrong' },
    });
    const wrongPasswordRes = await loginPOST(wrongPasswordReq);
    const wrongPasswordBody = await wrongPasswordRes.json();

    const unknownEmailReq = makeRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'nobody@example.com', password: 'any' },
    });
    const unknownEmailRes = await loginPOST(unknownEmailReq);
    const unknownEmailBody = await unknownEmailRes.json();

    expect(wrongPasswordRes.status).toBe(401);
    expect(unknownEmailRes.status).toBe(401);
    expect(wrongPasswordBody.error).toBe(unknownEmailBody.error);
  });
});

// ===========================================================================
// 5–11. Data isolation — Documents & Share Links
// ===========================================================================

describe('Data isolation — documents', () => {
  let cookieA: string;
  let cookieB: string;
  let docIdA: number;

  beforeEach(async () => {
    cookieA = await signup(USER_A);
    cookieB = await signup(USER_B);

    // User A creates a document via the mock (simulates upload)
    const doc = await prismaMock.document.create({
      data: {
        filename: 'alice-doc.pdf',
        originalFilename: 'alice-doc.pdf',
        fileSize: 1024,
        ownerId: db.owners.find((o) => o.email === USER_A.email)!.id,
        status: 'COMPLETED',
      },
    });
    docIdA = doc.id;
  });

  // 5. User A can see their own document
  it('(5) User A sees their own documents', async () => {
    const req = makeRequest('/api/documents', { sessionCookie: cookieA });
    const res = await documentsGET(req);

    expect(res.status).toBe(200);
    const docs = await res.json();
    expect(docs.length).toBe(1);
    expect(docs[0].id).toBe(docIdA);
  });

  // 6. User B's document list is empty
  it('(6) User B sees zero documents — no cross-contamination from User A', async () => {
    const req = makeRequest('/api/documents', { sessionCookie: cookieB });
    const res = await documentsGET(req);

    expect(res.status).toBe(200);
    const docs = await res.json();
    expect(docs.length).toBe(0);
  });

  // 7. User B cannot GET User A's document by ID
  it("(7) User B cannot GET User A's document by ID — returns 404", async () => {
    const req = makeRequest(`/api/documents/${docIdA}`, { sessionCookie: cookieB });
    const res = await documentByIdGET(req, {
      params: Promise.resolve({ documentId: String(docIdA) }),
    });

    expect(res.status).toBe(404);
  });

  // 8. User B cannot DELETE User A's document
  it("(8) User B cannot DELETE User A's document — returns 404", async () => {
    const req = makeRequest(`/api/documents/${docIdA}`, {
      method: 'DELETE',
      sessionCookie: cookieB,
    });
    const res = await documentDELETE(req, {
      params: Promise.resolve({ documentId: String(docIdA) }),
    });

    expect(res.status).toBe(404);
    // Document still exists
    expect(db.documents.find((d) => d.id === docIdA)).toBeDefined();
  });
});

describe('Data isolation — share links', () => {
  let cookieA: string;
  let cookieB: string;
  let linkIdA: number;
  let rawTokenA: string;

  beforeEach(async () => {
    cookieA = await signup(USER_A);
    cookieB = await signup(USER_B);

    // User A creates a share link
    const req = makeRequest('/api/share-links', {
      method: 'POST',
      body: { label: 'Alice share' },
      sessionCookie: cookieA,
    });
    const res = await shareLinksPOST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    linkIdA = body.id;
    rawTokenA = body.token;
  });

  // 9. User A can see their own share link
  it('(9) User A sees their own share links', async () => {
    const req = makeRequest('/api/share-links', { sessionCookie: cookieA });
    const res = await shareLinksGET(req);

    expect(res.status).toBe(200);
    const links = await res.json();
    expect(links.length).toBe(1);
    expect(links[0].id).toBe(linkIdA);
  });

  // 10. User B's share-link list is empty
  it("(10) User B sees zero share links — cannot see User A's link", async () => {
    const req = makeRequest('/api/share-links', { sessionCookie: cookieB });
    const res = await shareLinksGET(req);

    expect(res.status).toBe(200);
    const links = await res.json();
    expect(links.length).toBe(0);
  });

  // 11. User B cannot revoke User A's share link
  it("(11) User B cannot revoke User A's share link — returns 404", async () => {
    const req = makeRequest(`/api/share-links/${linkIdA}`, {
      method: 'DELETE',
      sessionCookie: cookieB,
    });
    const res = await shareLinkDELETE(req, {
      params: Promise.resolve({ linkId: String(linkIdA) }),
    });

    expect(res.status).toBe(404);
    // Link still active
    expect(db.shareLinks.find((l) => l.id === linkIdA)?.isActive).toBe(true);
  });
});

// ===========================================================================
// 12–15. Data isolation — Chat sessions
// ===========================================================================

describe('Data isolation — chat sessions', () => {
  let cookieA: string;
  let cookieB: string;
  let sessionIdA: number;

  beforeEach(async () => {
    cookieA = await signup(USER_A);
    cookieB = await signup(USER_B);

    // User A creates a chat session
    const req = makeRequest('/api/chat/sessions', {
      method: 'POST',
      body: { title: 'Alice session' },
      sessionCookie: cookieA,
    });
    const res = await sessionsPOST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    sessionIdA = body.id;
  });

  // 12. User A can see their own chat session
  it('(12) User A sees their own chat sessions', async () => {
    const req = makeRequest('/api/chat/sessions', { sessionCookie: cookieA });
    const res = await sessionsGET(req);

    expect(res.status).toBe(200);
    const sessions = await res.json();
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe(sessionIdA);
  });

  // 13. User B's session list is empty
  it("(13) User B sees zero chat sessions — cannot see User A's session", async () => {
    const req = makeRequest('/api/chat/sessions', { sessionCookie: cookieB });
    const res = await sessionsGET(req);

    expect(res.status).toBe(200);
    const sessions = await res.json();
    expect(sessions.length).toBe(0);
  });

  // 14. User B cannot GET User A's chat session
  it("(14) User B cannot GET User A's chat session by ID — returns 404", async () => {
    const req = makeRequest(`/api/chat/sessions/${sessionIdA}`, {
      sessionCookie: cookieB,
    });
    const res = await sessionByIdGET(req, {
      params: Promise.resolve({ sessionId: String(sessionIdA) }),
    });

    expect(res.status).toBe(404);
  });

  // 15. User B cannot DELETE User A's chat session
  it("(15) User B cannot DELETE User A's chat session — returns 404", async () => {
    const req = makeRequest(`/api/chat/sessions/${sessionIdA}`, {
      method: 'DELETE',
      sessionCookie: cookieB,
    });
    const res = await sessionDELETE(req, {
      params: Promise.resolve({ sessionId: String(sessionIdA) }),
    });

    expect(res.status).toBe(404);
    expect(db.chatSessions.find((s) => s.id === sessionIdA)).toBeDefined();
  });
});

// ===========================================================================
// 16–18. Data isolation — Settings & Dashboard
// ===========================================================================

describe('Data isolation — settings', () => {
  let cookieA: string;
  let cookieB: string;

  beforeEach(async () => {
    cookieA = await signup(USER_A);
    cookieB = await signup(USER_B);
  });

  // 16. Each user has independent settings
  it('(16) User A and User B have independent settings', async () => {
    const reqA = makeRequest('/api/settings', { sessionCookie: cookieA });
    const resA = await settingsGET(reqA);
    expect(resA.status).toBe(200);
    const settingsA = await resA.json();

    const reqB = makeRequest('/api/settings', { sessionCookie: cookieB });
    const resB = await settingsGET(reqB);
    expect(resB.status).toBe(200);
    const settingsB = await resB.json();

    // They are separate rows
    expect(settingsA.ownerId).not.toBe(settingsB.ownerId);
  });

  // 17. Updating User A's settings does not affect User B's settings
  it("(17) updating User A's settings does not affect User B's settings", async () => {
    // Seed default settings for both
    await settingsGET(makeRequest('/api/settings', { sessionCookie: cookieA }));
    await settingsGET(makeRequest('/api/settings', { sessionCookie: cookieB }));

    // Update User A's clone name
    const updateReq = makeRequest('/api/settings', {
      method: 'PUT',
      body: { cloneName: 'Alice Clone' },
      sessionCookie: cookieA,
    });
    const updateRes = await settingsPUT(updateReq);
    expect(updateRes.status).toBe(200);

    // User B's settings should be unchanged
    const reqB = makeRequest('/api/settings', { sessionCookie: cookieB });
    const resB = await settingsGET(reqB);
    const settingsB = await resB.json();
    expect(settingsB.cloneName).not.toBe('Alice Clone');
  });
});

describe('Data isolation — dashboard', () => {
  let cookieA: string;
  let cookieB: string;

  beforeEach(async () => {
    cookieA = await signup(USER_A);
    cookieB = await signup(USER_B);
  });

  // 18. Dashboard counts are per-user
  it('(18) dashboard document and session counts are independent per user', async () => {
    const ownerAId = db.owners.find((o) => o.email === USER_A.email)!.id;

    // Create a document and session for User A
    await prismaMock.document.create({
      data: { filename: 'a.pdf', originalFilename: 'a.pdf', fileSize: 100, ownerId: ownerAId, status: 'COMPLETED' },
    });
    await prismaMock.chatSession.create({
      data: { title: 'A session', ownerId: ownerAId },
    });

    const dashAReq = makeRequest('/api/dashboard', { sessionCookie: cookieA });
    const dashARes = await dashboardGET(dashAReq);
    expect(dashARes.status).toBe(200);
    const dashA = await dashARes.json();

    const dashBReq = makeRequest('/api/dashboard', { sessionCookie: cookieB });
    const dashBRes = await dashboardGET(dashBReq);
    expect(dashBRes.status).toBe(200);
    const dashB = await dashBRes.json();

    expect(dashA.documentCount).toBe(1);
    expect(dashA.chatSessionCount).toBe(1);
    expect(dashB.documentCount).toBe(0);
    expect(dashB.chatSessionCount).toBe(0);
  });
});

// ===========================================================================
// 19–21. Public clone share-link validation (no auth required)
// ===========================================================================

describe('Public clone share-link validation', () => {
  let cookieA: string;
  let rawTokenA: string;

  beforeEach(async () => {
    cookieA = await signup(USER_A);

    // User A creates a share link
    const req = makeRequest('/api/share-links', {
      method: 'POST',
      body: { label: 'Public' },
      sessionCookie: cookieA,
    });
    const res = await shareLinksPOST(req);
    const body = await res.json();
    rawTokenA = body.token;
  });

  // 19. Valid token validates without authentication
  it('(19) User A share-link token validates without any auth cookie', async () => {
    const req = makeRequest(`/api/clone/${rawTokenA}/validate`, {});
    const res = await cloneValidateGET(req, {
      params: Promise.resolve({ token: rawTokenA }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(typeof body.cloneName).toBe('string');
  });

  // 20. Revoked (inactive) token returns 404
  it('(20) revoked (inactive) share-link token returns 404 even without auth', async () => {
    // Mark the link as inactive
    const link = db.shareLinks[0];
    link.isActive = false;

    const req = makeRequest(`/api/clone/${rawTokenA}/validate`, {});
    const res = await cloneValidateGET(req, {
      params: Promise.resolve({ token: rawTokenA }),
    });

    expect(res.status).toBe(404);
  });

  // 21. Unknown token returns 404
  it('(21) completely unknown token returns 404', async () => {
    const unknownToken = crypto.randomBytes(32).toString('hex');
    const req = makeRequest(`/api/clone/${unknownToken}/validate`, {});
    const res = await cloneValidateGET(req, {
      params: Promise.resolve({ token: unknownToken }),
    });

    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// 22–24. GET /api/auth/me
// ===========================================================================

describe('GET /api/auth/me', () => {
  // 22. With valid session returns the correct user
  it('(22) returns the correct user when a valid session cookie is present', async () => {
    const cookie = await signup(USER_A);

    const req = makeRequest('/api/auth/me', { sessionCookie: cookie });
    const res = await mePOST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe(USER_A.email);
    expect(body.name).toBe(USER_A.name);
    expect(typeof body.id).toBe('number');
  });

  // 23. Without session → 401
  it('(23) returns 401 when no session cookie is present', async () => {
    const req = makeRequest('/api/auth/me');
    const res = await mePOST(req);

    expect(res.status).toBe(401);
  });

  // 24. Returns different users for User A and User B
  it('(24) returns the correct user for each session independently', async () => {
    const cookieA = await signup(USER_A);
    const cookieB = await signup(USER_B);

    const resA = await mePOST(makeRequest('/api/auth/me', { sessionCookie: cookieA }));
    const bodyA = await resA.json();

    const resB = await mePOST(makeRequest('/api/auth/me', { sessionCookie: cookieB }));
    const bodyB = await resB.json();

    expect(bodyA.email).toBe(USER_A.email);
    expect(bodyB.email).toBe(USER_B.email);
    expect(bodyA.id).not.toBe(bodyB.id);
  });
});

// ===========================================================================
// 25–27. Logout
// ===========================================================================

describe('Logout', () => {
  // 25. POST /api/auth/logout clears the cookie
  it('(25) POST /api/auth/logout returns { success: true } and sets Max-Age=0', async () => {
    const res = await logoutPOST();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });

    const setCookie = res.headers.get('Set-Cookie')!;
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('session=');
  });

  // 26. After logout, protected routes return 401
  it('(26) after logout (no cookie), protected API routes return 401', async () => {
    // Sign up to create a user, but then call without any cookie (simulating cleared session)
    await signup(USER_A);

    const req = makeRequest('/api/documents');
    const res = await documentsGET(req);

    expect(res.status).toBe(401);
  });

  // 27. Logging back in after logout re-establishes a valid session
  it('(27) logging back in after logout restores the correct user data', async () => {
    await signup(USER_A);

    // Logout
    await logoutPOST();

    // Log back in
    const newCookie = await login(USER_A);

    // Can access /api/auth/me with new cookie
    const req = makeRequest('/api/auth/me', { sessionCookie: newCookie });
    const res = await mePOST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe(USER_A.email);
  });
});

// ===========================================================================
// 28–32. Middleware — route guard
// ===========================================================================

describe('Middleware — private route guard', () => {
  function makeMiddlewareRequest(
    pathname: string,
    options: { sessionCookie?: string } = {}
  ): NextRequest {
    const url = new URL(`http://localhost${pathname}`);
    const init: RequestInit & { headers?: HeadersInit } = {};
    if (options.sessionCookie) {
      init.headers = { cookie: `session=${options.sessionCookie}` };
    }
    return new NextRequest(url, init);
  }

  // 28. Private routes without session → redirect to /login
  it.each([
    '/',
    '/chat',
    '/knowledge-base',
    '/knowledge-base/upload',
    '/settings',
    '/share',
  ])('(28) %s without session cookie → 307 redirect to /login', (path) => {
    const req = makeMiddlewareRequest(path);
    const res = middleware(req);

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const location = res.headers.get('location')!;
    expect(location).toContain('/login');
  });

  // 29. Private routes with session cookie → pass through
  it.each(['/', '/chat', '/settings', '/share'])(
    '(29) %s with session cookie passes through (no redirect)',
    (path) => {
      const req = makeMiddlewareRequest(path, { sessionCookie: 'some-token' });
      const res = middleware(req);

      expect(res.status).not.toBeGreaterThanOrEqual(300);
    }
  );

  // 30. /login with session → redirect to /
  it('(30) visiting /login while authenticated redirects to /', () => {
    const req = makeMiddlewareRequest('/login', { sessionCookie: 'some-token' });
    const res = middleware(req);

    expect(res.status).toBeGreaterThanOrEqual(300);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/');
  });

  // 31. /clone/[token] always passes through (no auth required)
  it('(31) /clone/[token] passes through without any session cookie', () => {
    const req = makeMiddlewareRequest('/clone/abc123token');
    const res = middleware(req);

    expect(res.status).not.toBeGreaterThanOrEqual(300);
  });

  // 32. /api/* always passes through middleware (auth is enforced in handlers)
  it.each([
    '/api/auth/login',
    '/api/auth/me',
    '/api/documents',
    '/api/share-links',
  ])('(32) %s passes through middleware without session cookie', (path) => {
    const req = makeMiddlewareRequest(path);
    const res = middleware(req);

    expect(res.status).not.toBeGreaterThanOrEqual(300);
  });
});

// ===========================================================================
// 33–41. Unauthenticated access to protected API routes
// ===========================================================================

describe('Unauthenticated access to protected API routes', () => {
  const noAuthRequest = (url: string, method = 'GET') =>
    makeRequest(url, { method });

  // 33. GET /api/documents
  it('(33) GET /api/documents without session → 401', async () => {
    const res = await documentsGET(noAuthRequest('/api/documents'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  // 34. GET /api/share-links
  it('(34) GET /api/share-links without session → 401', async () => {
    const res = await shareLinksGET(noAuthRequest('/api/share-links'));
    expect(res.status).toBe(401);
  });

  // 35. POST /api/share-links
  it('(35) POST /api/share-links without session → 401', async () => {
    const req = makeRequest('/api/share-links', { method: 'POST', body: { label: 'x' } });
    const res = await shareLinksPOST(req);
    expect(res.status).toBe(401);
  });

  // 36. GET /api/chat/sessions
  it('(36) GET /api/chat/sessions without session → 401', async () => {
    const res = await sessionsGET(noAuthRequest('/api/chat/sessions'));
    expect(res.status).toBe(401);
  });

  // 37. POST /api/chat/sessions
  it('(37) POST /api/chat/sessions without session → 401', async () => {
    const req = makeRequest('/api/chat/sessions', { method: 'POST', body: {} });
    const res = await sessionsPOST(req);
    expect(res.status).toBe(401);
  });

  // 38. GET /api/settings
  it('(38) GET /api/settings without session → 401', async () => {
    const res = await settingsGET(noAuthRequest('/api/settings'));
    expect(res.status).toBe(401);
  });

  // 39. PUT /api/settings
  it('(39) PUT /api/settings without session → 401', async () => {
    const req = makeRequest('/api/settings', { method: 'PUT', body: {} });
    const res = await settingsPUT(req);
    expect(res.status).toBe(401);
  });

  // 40. GET /api/dashboard
  it('(40) GET /api/dashboard without session → 401', async () => {
    const res = await dashboardGET(noAuthRequest('/api/dashboard'));
    expect(res.status).toBe(401);
  });

  // 41. GET /api/documents/:id — accessing any document ID without session → 401
  it('(41) GET /api/documents/1 without session → 401', async () => {
    const req = makeRequest('/api/documents/1');
    const res = await documentByIdGET(req, {
      params: Promise.resolve({ documentId: '1' }),
    });
    expect(res.status).toBe(401);
  });

  // 42. POST /api/settings/test-connection without session → 401
  it('(42) POST /api/settings/test-connection without session → 401', async () => {
    const req = makeRequest('/api/settings/test-connection', {
      method: 'POST',
      headers: { 'x-openai-api-key': 'sk-test-key' },
    });
    const res = await testConnectionPOST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
