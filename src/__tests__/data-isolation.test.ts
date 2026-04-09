/**
 * Data-isolation integration tests.
 *
 * Verifies that authenticated users can only access their own data across every
 * major resource type exposed by the API.  Two distinct users (User A and
 * User B) are created with separate documents, chat sessions, settings, and
 * share links.  All cross-user access attempts are then exercised and must
 * return 403, 404, or an empty collection — never the other user's data.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ DATABASE REQUIREMENT                                                     │
 * │                                                                          │
 * │ These tests require a running PostgreSQL instance.  The connection URL   │
 * │ is read from PRISMA_DATABASE_URL (or DATABASE_URL) — the same variable  │
 * │ that the application itself reads.                                       │
 * │                                                                          │
 * │ When no database is reachable the entire suite is skipped so it does    │
 * │ not block other tests or CI pipelines that run without a database.       │
 * │                                                                          │
 * │ Start the database with:  docker compose up -d postgres                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Acceptance criteria verified (when DB is available):
 *
 *  SETUP
 *  AC-1   Two users can be created independently — each receives a session token
 *  AC-2   Each user's resources are created and only appear in their own collections
 *
 *  DOCUMENTS
 *  AC-3   GET /api/documents only returns the authenticated user's own documents
 *  AC-4   User A's session cannot retrieve User B's document by ID (404)
 *  AC-5   User A's session cannot delete User B's document (404, document survives)
 *  AC-6   User B's session cannot retrieve User A's document by ID (404)
 *  AC-7   User B's session cannot delete User A's document (404, document survives)
 *
 *  SHARE LINKS
 *  AC-8   GET /api/share-links only returns the authenticated user's own links
 *  AC-9   User A's session cannot revoke User B's share link (404, link stays active)
 *  AC-10  User B's session cannot revoke User A's share link (404, link stays active)
 *
 *  CHAT SESSIONS
 *  AC-11  GET /api/chat/sessions only returns the authenticated user's own sessions
 *  AC-12  User A's session cannot read User B's chat session by ID (404)
 *  AC-13  User A's session cannot delete User B's chat session (404, session survives)
 *  AC-14  User B's session cannot read User A's chat session by ID (404)
 *  AC-15  User B's session cannot delete User A's chat session (404, session survives)
 *
 *  SETTINGS
 *  AC-16  GET /api/settings returns independent settings per user
 *  AC-17  Updating User A's settings via PUT does not affect User B's settings
 *  AC-18  Updating User B's settings via PUT does not affect User A's settings
 *
 *  DASHBOARD
 *  AC-19  GET /api/dashboard document / session / link counts are per-user
 *
 *  CLEANUP
 *  AC-20  All test rows are removed from the database after each test run
 */

import net from 'net';
import { NextRequest } from 'next/server';
import { Pool } from 'pg';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Determine the test database URL (same resolution as setup-env.ts).
// ---------------------------------------------------------------------------

const TEST_DB_URL =
  process.env.PRISMA_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://secondself_user:secondself_pass@localhost:5488/secondself_db';

// ---------------------------------------------------------------------------
// JWT secret — override once so all handlers in this suite use the same value.
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = 'data-isolation-integration-test-secret-2024';
const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
// Set early so the module-level mock factory captures it.
process.env.JWT_SECRET = TEST_JWT_SECRET;

// ---------------------------------------------------------------------------
// Provide a real Prisma client backed by the test database.
//
// jest.mock() is hoisted by ts-jest so the factory function runs before any
// `import` statement resolves.  We create the PrismaClient inside a getter so
// the constructor is called only after PRISMA_DATABASE_URL is available.
// ---------------------------------------------------------------------------

import { PrismaClient } from '@/generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';

let _testPrisma: PrismaClient | null = null;

function getTestPrisma(): PrismaClient {
  if (!_testPrisma) {
    const adapter = new PrismaPg({ connectionString: TEST_DB_URL });
    _testPrisma = new PrismaClient({ adapter });
  }
  return _testPrisma;
}

jest.mock('@/lib/prisma', () => ({
  get prisma() {
    return getTestPrisma();
  },
}));

// OpenAI is not exercised in this suite — stub it to prevent any accidental
// network call from a transitive import.
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    models: { list: jest.fn().mockResolvedValue({ data: [] }) },
  })),
}));

// ---------------------------------------------------------------------------
// Import route handlers AFTER the prisma mock is registered.
// ---------------------------------------------------------------------------

import { POST as signupPOST } from '@/app/api/auth/signup/route';
import { GET as documentsGET } from '@/app/api/documents/route';
import {
  GET as documentByIdGET,
  DELETE as documentDELETE,
} from '@/app/api/documents/[documentId]/route';
import {
  GET as shareLinksGET,
  POST as shareLinksPOST,
} from '@/app/api/share-links/route';
import { DELETE as shareLinkDELETE } from '@/app/api/share-links/[linkId]/route';
import {
  GET as chatSessionsGET,
  POST as chatSessionsPOST,
} from '@/app/api/chat/sessions/route';
import {
  GET as chatSessionByIdGET,
  DELETE as chatSessionDELETE,
} from '@/app/api/chat/sessions/[sessionId]/route';
import {
  GET as settingsGET,
  PUT as settingsPUT,
} from '@/app/api/settings/route';
import { GET as dashboardGET } from '@/app/api/dashboard/route';

// ---------------------------------------------------------------------------
// Database availability probe
// ---------------------------------------------------------------------------

async function isDatabaseReachable(): Promise<boolean> {
  try {
    const url = new URL(TEST_DB_URL);
    const host = url.hostname;
    const port = parseInt(url.port || '5432', 10);

    return await new Promise<boolean>((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(3_000);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, host);
    });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Database cleanup — raw pg Pool used so we don't rely on Prisma cascade
// behaviour in teardown paths.
// ---------------------------------------------------------------------------

let pool: Pool;

/**
 * Emails of owners created during a test.  Collected so cleanup can target
 * only the rows this suite created.
 */
const createdEmails: string[] = [];

async function cleanupTestOwners(): Promise<void> {
  if (createdEmails.length === 0) return;
  const placeholders = createdEmails.map((_, i) => `$${i + 1}`).join(', ');
  // ON DELETE CASCADE on settings, documents, chat_sessions, and share_links
  // handles all child rows automatically.
  await pool.query(
    `DELETE FROM owners WHERE email IN (${placeholders})`,
    [...createdEmails],
  );
  createdEmails.length = 0;
}

// ---------------------------------------------------------------------------
// Unique email / name generators
// ---------------------------------------------------------------------------

function uniqueEmail(label: string): string {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 100_000);
  return `isolation+${label}+${ts}+${rand}@test.local`;
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/**
 * Build a NextRequest with an optional JSON body and optional session cookie.
 */
function makeRequest(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    sessionCookie?: string;
    headers?: Record<string, string>;
  } = {},
): NextRequest {
  const { method = 'GET', body, sessionCookie, headers = {} } = options;

  const allHeaders: Record<string, string> = { ...headers };
  if (body !== undefined) allHeaders['Content-Type'] = 'application/json';
  if (sessionCookie) allHeaders['cookie'] = `session=${sessionCookie}`;

  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: allHeaders,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/**
 * Extract the raw `session` cookie value from a response's Set-Cookie header.
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

// ---------------------------------------------------------------------------
// Higher-level helpers
// ---------------------------------------------------------------------------

/**
 * Create a new owner via the signup route and return the session cookie.
 * Also registers the email for cleanup.
 */
async function createUser(
  email: string,
  password: string,
  name: string,
): Promise<string> {
  const req = makeRequest('/api/auth/signup', {
    method: 'POST',
    body: { email, password, name },
  });
  const res = await signupPOST(req);
  expect(res.status).toBe(201);
  const cookie = extractSessionCookie(res);
  expect(cookie).not.toBeNull();
  return cookie!;
}

/**
 * Create a document for the given user via the Prisma client directly (we skip
 * the multipart upload handler to keep tests focused on data-isolation, not
 * upload mechanics).  Returns the created document's `id`.
 */
async function createDocumentForUser(
  ownerId: number,
  filename = 'test.pdf',
): Promise<number> {
  const doc = await getTestPrisma().document.create({
    data: {
      filename,
      originalFilename: filename,
      fileSize: 1_024,
      status: 'COMPLETED',
      ownerId,
    },
    select: { id: true },
  });
  return doc.id;
}

/**
 * Create a share link via the API and return `{ id, token }`.
 */
async function createShareLink(
  sessionCookie: string,
  label = 'Test link',
): Promise<{ id: number; token: string }> {
  const res = await shareLinksPOST(
    makeRequest('/api/share-links', {
      method: 'POST',
      body: { label },
      sessionCookie,
    }),
  );
  expect(res.status).toBe(201);
  const body = await res.json();
  return { id: body.id as number, token: body.token as string };
}

/**
 * Create a chat session via the API and return its `id`.
 */
async function createChatSession(
  sessionCookie: string,
  title = 'Test session',
): Promise<number> {
  const res = await chatSessionsPOST(
    makeRequest('/api/chat/sessions', {
      method: 'POST',
      body: { title },
      sessionCookie,
    }),
  );
  expect(res.status).toBe(201);
  const body = await res.json();
  return body.id as number;
}

/**
 * Retrieve the owner id from the JWT payload embedded in a session cookie.
 * The cookie is a three-segment base64url JWT; we decode the middle segment.
 */
function ownerIdFromCookie(sessionCookie: string): number {
  const parts = sessionCookie.split('.');
  if (parts.length !== 3) throw new Error(`Unexpected token shape: ${sessionCookie}`);
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as {
    userId: number;
  };
  return payload.userId;
}

// ---------------------------------------------------------------------------
// Availability guard — shared across all suites
// ---------------------------------------------------------------------------

let dbAvailable = false;

/**
 * Wraps `it()` to skip the test with a clear warning when the database is not
 * reachable.  Mirrors the helper used in signup-integration.test.ts.
 */
function maybeIt(
  name: string,
  fn: () => Promise<void> | void,
  timeoutMs?: number,
): void {
  it(
    name,
    async () => {
      if (!dbAvailable) {
        console.warn(
          `[data-isolation] SKIPPED — no database reachable at ${TEST_DB_URL}.\n` +
            `  Start the database with: docker compose up -d postgres`,
        );
        return;
      }
      await fn();
    },
    timeoutMs,
  );
}

// ---------------------------------------------------------------------------
// Global setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  dbAvailable = await isDatabaseReachable();
  if (dbAvailable) {
    pool = new Pool({ connectionString: TEST_DB_URL });
  }
});

afterAll(async () => {
  if (dbAvailable) {
    await cleanupTestOwners();
    if (_testPrisma) {
      await _testPrisma.$disconnect();
      _testPrisma = null;
    }
    await pool?.end();
  }

  if (ORIGINAL_JWT_SECRET === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  }
});

afterEach(async () => {
  if (dbAvailable) {
    await cleanupTestOwners();
  }
});

// ===========================================================================
// AC-1 & AC-2 — Setup: two independent users with separate resources
// ===========================================================================

describe('Setup — two independent users can be created', () => {
  maybeIt('AC-1: two different users can sign up and each receives a unique session cookie', async () => {
    const emailA = uniqueEmail('userA');
    const emailB = uniqueEmail('userB');
    createdEmails.push(emailA, emailB);

    const cookieA = await createUser(emailA, 'passwordA123', 'User A');
    const cookieB = await createUser(emailB, 'passwordB123', 'User B');

    // Cookies must be distinct JWT strings
    expect(cookieA).not.toBe(cookieB);

    // Decode owner IDs from the tokens — must be different rows
    const ownerIdA = ownerIdFromCookie(cookieA);
    const ownerIdB = ownerIdFromCookie(cookieB);
    expect(ownerIdA).not.toBe(ownerIdB);
  });

  maybeIt('AC-2: each user\'s document appears only in their own collection', async () => {
    const emailA = uniqueEmail('userA');
    const emailB = uniqueEmail('userB');
    createdEmails.push(emailA, emailB);

    const cookieA = await createUser(emailA, 'passwordA123', 'User A');
    const cookieB = await createUser(emailB, 'passwordB123', 'User B');
    const ownerIdA = ownerIdFromCookie(cookieA);
    const ownerIdB = ownerIdFromCookie(cookieB);

    const docIdA = await createDocumentForUser(ownerIdA, 'alice.pdf');
    const docIdB = await createDocumentForUser(ownerIdB, 'bob.pdf');

    // User A sees only their own document
    const resA = await documentsGET(makeRequest('/api/documents', { sessionCookie: cookieA }));
    expect(resA.status).toBe(200);
    const docsA = await resA.json();
    const docIdsA = (docsA as Array<{ id: number }>).map((d) => d.id);
    expect(docIdsA).toContain(docIdA);
    expect(docIdsA).not.toContain(docIdB);

    // User B sees only their own document
    const resB = await documentsGET(makeRequest('/api/documents', { sessionCookie: cookieB }));
    expect(resB.status).toBe(200);
    const docsB = await resB.json();
    const docIdsB = (docsB as Array<{ id: number }>).map((d) => d.id);
    expect(docIdsB).toContain(docIdB);
    expect(docIdsB).not.toContain(docIdA);
  });
});

// ===========================================================================
// AC-3 – AC-7 — Document isolation
// ===========================================================================

describe('Document isolation', () => {
  let cookieA: string;
  let cookieB: string;
  let docIdA: number;
  let docIdB: number;

  beforeEach(async () => {
    if (!dbAvailable) return;

    const emailA = uniqueEmail('docA');
    const emailB = uniqueEmail('docB');
    createdEmails.push(emailA, emailB);

    cookieA = await createUser(emailA, 'passwordA123', 'User A');
    cookieB = await createUser(emailB, 'passwordB123', 'User B');

    const ownerIdA = ownerIdFromCookie(cookieA);
    const ownerIdB = ownerIdFromCookie(cookieB);

    docIdA = await createDocumentForUser(ownerIdA, 'user-a-doc.pdf');
    docIdB = await createDocumentForUser(ownerIdB, 'user-b-doc.pdf');
  });

  // AC-3: GET /api/documents only returns the authenticated user's own documents
  maybeIt('AC-3: GET /api/documents returns only the requesting user\'s documents', async () => {
    // User A's list contains docA, not docB
    const resA = await documentsGET(makeRequest('/api/documents', { sessionCookie: cookieA }));
    expect(resA.status).toBe(200);
    const docsA = await resA.json() as Array<{ id: number }>;
    const idsA = docsA.map((d) => d.id);
    expect(idsA).toContain(docIdA);
    expect(idsA).not.toContain(docIdB);

    // User B's list contains docB, not docA
    const resB = await documentsGET(makeRequest('/api/documents', { sessionCookie: cookieB }));
    expect(resB.status).toBe(200);
    const docsB = await resB.json() as Array<{ id: number }>;
    const idsB = docsB.map((d) => d.id);
    expect(idsB).toContain(docIdB);
    expect(idsB).not.toContain(docIdA);
  });

  // AC-4: User A cannot read User B's document by ID
  maybeIt('AC-4: User A\'s session cannot GET User B\'s document by ID — returns 404', async () => {
    const req = makeRequest(`/api/documents/${docIdB}`, { sessionCookie: cookieA });
    const res = await documentByIdGET(req, {
      params: Promise.resolve({ documentId: String(docIdB) }),
    });
    expect(res.status).toBe(404);
  });

  // AC-5: User A cannot delete User B's document — document must survive
  maybeIt('AC-5: User A\'s session cannot DELETE User B\'s document — returns 404 and document survives', async () => {
    const req = makeRequest(`/api/documents/${docIdB}`, {
      method: 'DELETE',
      sessionCookie: cookieA,
    });
    const res = await documentDELETE(req, {
      params: Promise.resolve({ documentId: String(docIdB) }),
    });
    expect(res.status).toBe(404);

    // Confirm document B is still present in the database
    const surviving = await getTestPrisma().document.findUnique({ where: { id: docIdB } });
    expect(surviving).not.toBeNull();
  });

  // AC-6: User B cannot read User A's document by ID
  maybeIt('AC-6: User B\'s session cannot GET User A\'s document by ID — returns 404', async () => {
    const req = makeRequest(`/api/documents/${docIdA}`, { sessionCookie: cookieB });
    const res = await documentByIdGET(req, {
      params: Promise.resolve({ documentId: String(docIdA) }),
    });
    expect(res.status).toBe(404);
  });

  // AC-7: User B cannot delete User A's document — document must survive
  maybeIt('AC-7: User B\'s session cannot DELETE User A\'s document — returns 404 and document survives', async () => {
    const req = makeRequest(`/api/documents/${docIdA}`, {
      method: 'DELETE',
      sessionCookie: cookieB,
    });
    const res = await documentDELETE(req, {
      params: Promise.resolve({ documentId: String(docIdA) }),
    });
    expect(res.status).toBe(404);

    // Confirm document A is still present in the database
    const surviving = await getTestPrisma().document.findUnique({ where: { id: docIdA } });
    expect(surviving).not.toBeNull();
  });

  // Additional: random non-existent document ID returns 404 for both users
  maybeIt('non-existent document ID returns 404 for any authenticated user', async () => {
    const phantomId = 999_999_999;

    const resA = await documentByIdGET(
      makeRequest(`/api/documents/${phantomId}`, { sessionCookie: cookieA }),
      { params: Promise.resolve({ documentId: String(phantomId) }) },
    );
    expect(resA.status).toBe(404);

    const resB = await documentByIdGET(
      makeRequest(`/api/documents/${phantomId}`, { sessionCookie: cookieB }),
      { params: Promise.resolve({ documentId: String(phantomId) }) },
    );
    expect(resB.status).toBe(404);
  });
});

// ===========================================================================
// AC-8 – AC-10 — Share-link isolation
// ===========================================================================

describe('Share-link isolation', () => {
  let cookieA: string;
  let cookieB: string;
  let linkIdA: number;
  let linkIdB: number;

  beforeEach(async () => {
    if (!dbAvailable) return;

    const emailA = uniqueEmail('linkA');
    const emailB = uniqueEmail('linkB');
    createdEmails.push(emailA, emailB);

    cookieA = await createUser(emailA, 'passwordA123', 'User A');
    cookieB = await createUser(emailB, 'passwordB123', 'User B');

    const linkA = await createShareLink(cookieA, 'User A link');
    const linkB = await createShareLink(cookieB, 'User B link');
    linkIdA = linkA.id;
    linkIdB = linkB.id;
  });

  // AC-8: GET /api/share-links only returns the user's own links
  maybeIt('AC-8: GET /api/share-links returns only the requesting user\'s share links', async () => {
    const resA = await shareLinksGET(makeRequest('/api/share-links', { sessionCookie: cookieA }));
    expect(resA.status).toBe(200);
    const linksA = await resA.json() as Array<{ id: number }>;
    const idsA = linksA.map((l) => l.id);
    expect(idsA).toContain(linkIdA);
    expect(idsA).not.toContain(linkIdB);

    const resB = await shareLinksGET(makeRequest('/api/share-links', { sessionCookie: cookieB }));
    expect(resB.status).toBe(200);
    const linksB = await resB.json() as Array<{ id: number }>;
    const idsB = linksB.map((l) => l.id);
    expect(idsB).toContain(linkIdB);
    expect(idsB).not.toContain(linkIdA);
  });

  // AC-9: User A cannot revoke User B's share link
  maybeIt('AC-9: User A\'s session cannot DELETE (revoke) User B\'s share link — returns 404, link stays active', async () => {
    const req = makeRequest(`/api/share-links/${linkIdB}`, {
      method: 'DELETE',
      sessionCookie: cookieA,
    });
    const res = await shareLinkDELETE(req, {
      params: Promise.resolve({ linkId: String(linkIdB) }),
    });
    expect(res.status).toBe(404);

    // Confirm link B is still active in the database
    const surviving = await getTestPrisma().shareLink.findUnique({ where: { id: linkIdB } });
    expect(surviving).not.toBeNull();
    expect(surviving!.isActive).toBe(true);
  });

  // AC-10: User B cannot revoke User A's share link
  maybeIt('AC-10: User B\'s session cannot DELETE (revoke) User A\'s share link — returns 404, link stays active', async () => {
    const req = makeRequest(`/api/share-links/${linkIdA}`, {
      method: 'DELETE',
      sessionCookie: cookieB,
    });
    const res = await shareLinkDELETE(req, {
      params: Promise.resolve({ linkId: String(linkIdA) }),
    });
    expect(res.status).toBe(404);

    // Confirm link A is still active in the database
    const surviving = await getTestPrisma().shareLink.findUnique({ where: { id: linkIdA } });
    expect(surviving).not.toBeNull();
    expect(surviving!.isActive).toBe(true);
  });

  // Correct user can revoke their own link without affecting the other user's link
  maybeIt('a user can revoke their own share link without affecting the other user\'s link', async () => {
    // User A revokes their own link
    const revokeRes = await shareLinkDELETE(
      makeRequest(`/api/share-links/${linkIdA}`, { method: 'DELETE', sessionCookie: cookieA }),
      { params: Promise.resolve({ linkId: String(linkIdA) }) },
    );
    expect(revokeRes.status).toBe(204);

    // Link A is now inactive
    const linkAAfter = await getTestPrisma().shareLink.findUnique({ where: { id: linkIdA } });
    expect(linkAAfter!.isActive).toBe(false);

    // Link B is completely unaffected
    const linkBAfter = await getTestPrisma().shareLink.findUnique({ where: { id: linkIdB } });
    expect(linkBAfter!.isActive).toBe(true);
  });
});

// ===========================================================================
// AC-11 – AC-15 — Chat-session isolation
// ===========================================================================

describe('Chat-session isolation', () => {
  let cookieA: string;
  let cookieB: string;
  let sessionIdA: number;
  let sessionIdB: number;

  beforeEach(async () => {
    if (!dbAvailable) return;

    const emailA = uniqueEmail('chatA');
    const emailB = uniqueEmail('chatB');
    createdEmails.push(emailA, emailB);

    cookieA = await createUser(emailA, 'passwordA123', 'User A');
    cookieB = await createUser(emailB, 'passwordB123', 'User B');

    sessionIdA = await createChatSession(cookieA, 'User A session');
    sessionIdB = await createChatSession(cookieB, 'User B session');
  });

  // AC-11: GET /api/chat/sessions returns only the user's own sessions
  maybeIt('AC-11: GET /api/chat/sessions returns only the requesting user\'s sessions', async () => {
    const resA = await chatSessionsGET(makeRequest('/api/chat/sessions', { sessionCookie: cookieA }));
    expect(resA.status).toBe(200);
    const sessionsA = await resA.json() as Array<{ id: number }>;
    const idsA = sessionsA.map((s) => s.id);
    expect(idsA).toContain(sessionIdA);
    expect(idsA).not.toContain(sessionIdB);

    const resB = await chatSessionsGET(makeRequest('/api/chat/sessions', { sessionCookie: cookieB }));
    expect(resB.status).toBe(200);
    const sessionsB = await resB.json() as Array<{ id: number }>;
    const idsB = sessionsB.map((s) => s.id);
    expect(idsB).toContain(sessionIdB);
    expect(idsB).not.toContain(sessionIdA);
  });

  // AC-12: User A cannot read User B's chat session by ID
  maybeIt('AC-12: User A\'s session cannot GET User B\'s chat session by ID — returns 404', async () => {
    const req = makeRequest(`/api/chat/sessions/${sessionIdB}`, { sessionCookie: cookieA });
    const res = await chatSessionByIdGET(req, {
      params: Promise.resolve({ sessionId: String(sessionIdB) }),
    });
    expect(res.status).toBe(404);
  });

  // AC-13: User A cannot delete User B's chat session — session must survive
  maybeIt('AC-13: User A\'s session cannot DELETE User B\'s chat session — returns 404 and session survives', async () => {
    const req = makeRequest(`/api/chat/sessions/${sessionIdB}`, {
      method: 'DELETE',
      sessionCookie: cookieA,
    });
    const res = await chatSessionDELETE(req, {
      params: Promise.resolve({ sessionId: String(sessionIdB) }),
    });
    expect(res.status).toBe(404);

    const surviving = await getTestPrisma().chatSession.findUnique({ where: { id: sessionIdB } });
    expect(surviving).not.toBeNull();
  });

  // AC-14: User B cannot read User A's chat session by ID
  maybeIt('AC-14: User B\'s session cannot GET User A\'s chat session by ID — returns 404', async () => {
    const req = makeRequest(`/api/chat/sessions/${sessionIdA}`, { sessionCookie: cookieB });
    const res = await chatSessionByIdGET(req, {
      params: Promise.resolve({ sessionId: String(sessionIdA) }),
    });
    expect(res.status).toBe(404);
  });

  // AC-15: User B cannot delete User A's chat session — session must survive
  maybeIt('AC-15: User B\'s session cannot DELETE User A\'s chat session — returns 404 and session survives', async () => {
    const req = makeRequest(`/api/chat/sessions/${sessionIdA}`, {
      method: 'DELETE',
      sessionCookie: cookieB,
    });
    const res = await chatSessionDELETE(req, {
      params: Promise.resolve({ sessionId: String(sessionIdA) }),
    });
    expect(res.status).toBe(404);

    const surviving = await getTestPrisma().chatSession.findUnique({ where: { id: sessionIdA } });
    expect(surviving).not.toBeNull();
  });

  // Correct user can delete their own session without affecting the other user's session
  maybeIt('a user can delete their own chat session without affecting the other user\'s session', async () => {
    // User B deletes their own session
    const deleteRes = await chatSessionDELETE(
      makeRequest(`/api/chat/sessions/${sessionIdB}`, { method: 'DELETE', sessionCookie: cookieB }),
      { params: Promise.resolve({ sessionId: String(sessionIdB) }) },
    );
    expect(deleteRes.status).toBe(204);

    // Session B is gone
    const sessionBAfter = await getTestPrisma().chatSession.findUnique({ where: { id: sessionIdB } });
    expect(sessionBAfter).toBeNull();

    // Session A is completely unaffected
    const sessionAAfter = await getTestPrisma().chatSession.findUnique({ where: { id: sessionIdA } });
    expect(sessionAAfter).not.toBeNull();
  });
});

// ===========================================================================
// AC-16 – AC-18 — Settings isolation
// ===========================================================================

describe('Settings isolation', () => {
  let cookieA: string;
  let cookieB: string;

  beforeEach(async () => {
    if (!dbAvailable) return;

    const emailA = uniqueEmail('settingsA');
    const emailB = uniqueEmail('settingsB');
    createdEmails.push(emailA, emailB);

    cookieA = await createUser(emailA, 'passwordA123', 'User A');
    cookieB = await createUser(emailB, 'passwordB123', 'User B');
  });

  // AC-16: GET /api/settings returns independent settings per user
  maybeIt('AC-16: GET /api/settings returns independent settings for each user', async () => {
    const resA = await settingsGET(makeRequest('/api/settings', { sessionCookie: cookieA }));
    expect(resA.status).toBe(200);
    const settingsA = await resA.json() as { ownerId: number; cloneName: string };

    const resB = await settingsGET(makeRequest('/api/settings', { sessionCookie: cookieB }));
    expect(resB.status).toBe(200);
    const settingsB = await resB.json() as { ownerId: number; cloneName: string };

    // Separate rows — different ownerId values
    expect(settingsA.ownerId).not.toBe(settingsB.ownerId);
  });

  // AC-17: Updating User A's settings does not affect User B's settings
  maybeIt('AC-17: updating User A\'s settings does not affect User B\'s settings', async () => {
    // Seed both users' settings rows by reading them
    await settingsGET(makeRequest('/api/settings', { sessionCookie: cookieA }));
    await settingsGET(makeRequest('/api/settings', { sessionCookie: cookieB }));

    // Capture User B's clone name before the update
    const bBefore = await settingsGET(makeRequest('/api/settings', { sessionCookie: cookieB }));
    const settingsBBefore = await bBefore.json() as { cloneName: string };
    const originalCloneNameB = settingsBBefore.cloneName;

    // Update User A's clone name to something unique
    const uniqueName = `Alice-Updated-${Date.now()}`;
    const updateRes = await settingsPUT(
      makeRequest('/api/settings', {
        method: 'PUT',
        body: { cloneName: uniqueName },
        sessionCookie: cookieA,
      }),
    );
    expect(updateRes.status).toBe(200);
    const updatedA = await updateRes.json() as { cloneName: string };
    expect(updatedA.cloneName).toBe(uniqueName);

    // User B's settings must be unchanged
    const bAfter = await settingsGET(makeRequest('/api/settings', { sessionCookie: cookieB }));
    const settingsBAfter = await bAfter.json() as { cloneName: string };
    expect(settingsBAfter.cloneName).toBe(originalCloneNameB);
    expect(settingsBAfter.cloneName).not.toBe(uniqueName);
  });

  // AC-18: Updating User B's settings does not affect User A's settings
  maybeIt('AC-18: updating User B\'s settings does not affect User A\'s settings', async () => {
    await settingsGET(makeRequest('/api/settings', { sessionCookie: cookieA }));
    await settingsGET(makeRequest('/api/settings', { sessionCookie: cookieB }));

    // Capture User A's system prompt before the update
    const aBefore = await settingsGET(makeRequest('/api/settings', { sessionCookie: cookieA }));
    const settingsABefore = await aBefore.json() as { systemPrompt: string };
    const originalPromptA = settingsABefore.systemPrompt;

    // Update User B's system prompt
    const uniquePrompt = `Bob prompt ${Date.now()}`;
    const updateRes = await settingsPUT(
      makeRequest('/api/settings', {
        method: 'PUT',
        body: { systemPrompt: uniquePrompt },
        sessionCookie: cookieB,
      }),
    );
    expect(updateRes.status).toBe(200);
    const updatedB = await updateRes.json() as { systemPrompt: string };
    expect(updatedB.systemPrompt).toBe(uniquePrompt);

    // User A's settings must be unchanged
    const aAfter = await settingsGET(makeRequest('/api/settings', { sessionCookie: cookieA }));
    const settingsAAfter = await aAfter.json() as { systemPrompt: string };
    expect(settingsAAfter.systemPrompt).toBe(originalPromptA);
    expect(settingsAAfter.systemPrompt).not.toBe(uniquePrompt);
  });

  // Each user's settings contain only their own ownerId
  maybeIt('settings ownerId matches the authenticated user\'s owner ID', async () => {
    const ownerIdA = ownerIdFromCookie(cookieA);
    const ownerIdB = ownerIdFromCookie(cookieB);

    const resA = await settingsGET(makeRequest('/api/settings', { sessionCookie: cookieA }));
    const resB = await settingsGET(makeRequest('/api/settings', { sessionCookie: cookieB }));

    const sA = await resA.json() as { ownerId: number };
    const sB = await resB.json() as { ownerId: number };

    expect(sA.ownerId).toBe(ownerIdA);
    expect(sB.ownerId).toBe(ownerIdB);
  });
});

// ===========================================================================
// AC-19 — Dashboard isolation
// ===========================================================================

describe('Dashboard isolation', () => {
  let cookieA: string;
  let cookieB: string;

  beforeEach(async () => {
    if (!dbAvailable) return;

    const emailA = uniqueEmail('dashA');
    const emailB = uniqueEmail('dashB');
    createdEmails.push(emailA, emailB);

    cookieA = await createUser(emailA, 'passwordA123', 'User A');
    cookieB = await createUser(emailB, 'passwordB123', 'User B');
  });

  // AC-19: Dashboard counts are scoped to the authenticated user
  maybeIt('AC-19: GET /api/dashboard document / session / link counts are per-user', async () => {
    const ownerIdA = ownerIdFromCookie(cookieA);

    // Create resources for User A only
    await createDocumentForUser(ownerIdA, 'dashboard-test.pdf');
    await createChatSession(cookieA, 'Dashboard session A');
    await createShareLink(cookieA, 'Dashboard link A');

    // User A dashboard must reflect all three created resources
    const dashARes = await dashboardGET(makeRequest('/api/dashboard', { sessionCookie: cookieA }));
    expect(dashARes.status).toBe(200);
    const dashA = await dashARes.json() as {
      documentCount: number;
      chatSessionCount: number;
      publicLinkCount: number;
    };
    expect(dashA.documentCount).toBeGreaterThanOrEqual(1);
    expect(dashA.chatSessionCount).toBeGreaterThanOrEqual(1);
    expect(dashA.publicLinkCount).toBeGreaterThanOrEqual(1);

    // User B dashboard must show zero for every resource type (no cross-contamination)
    const dashBRes = await dashboardGET(makeRequest('/api/dashboard', { sessionCookie: cookieB }));
    expect(dashBRes.status).toBe(200);
    const dashB = await dashBRes.json() as {
      documentCount: number;
      chatSessionCount: number;
      publicLinkCount: number;
    };
    expect(dashB.documentCount).toBe(0);
    expect(dashB.chatSessionCount).toBe(0);
    expect(dashB.publicLinkCount).toBe(0);
  });

  // Dashboard recentDocuments and recentSessions contain only the user's own data
  maybeIt('dashboard recentDocuments and recentSessions belong only to the requesting user', async () => {
    const ownerIdA = ownerIdFromCookie(cookieA);
    const ownerIdB = ownerIdFromCookie(cookieB);

    // Give each user a resource
    const docIdA = await createDocumentForUser(ownerIdA, 'recent-a.pdf');
    const sessionIdB = await createChatSession(cookieB, 'Recent session B');

    // User A's dashboard must not include User B's session
    const dashARes = await dashboardGET(makeRequest('/api/dashboard', { sessionCookie: cookieA }));
    const dashA = await dashARes.json() as {
      recentDocuments: Array<{ id: number }>;
      recentSessions: Array<{ id: number }>;
    };
    const dashADocIds = dashA.recentDocuments.map((d) => d.id);
    const dashASessionIds = dashA.recentSessions.map((s) => s.id);
    expect(dashADocIds).toContain(docIdA);
    expect(dashASessionIds).not.toContain(sessionIdB);

    // User B's dashboard must not include User A's document
    const dashBRes = await dashboardGET(makeRequest('/api/dashboard', { sessionCookie: cookieB }));
    const dashB = await dashBRes.json() as {
      recentDocuments: Array<{ id: number }>;
      recentSessions: Array<{ id: number }>;
    };
    const dashBDocIds = dashB.recentDocuments.map((d) => d.id);
    const dashBSessionIds = dashB.recentSessions.map((s) => s.id);
    expect(dashBDocIds).not.toContain(docIdA);
    expect(dashBSessionIds).toContain(sessionIdB);
  });
});

// ===========================================================================
// AC-20 — Cleanup verification
// ===========================================================================

describe('Cleanup — test data is removed after each run (AC-20)', () => {
  maybeIt('AC-20: owners created in this suite are deleted after the test completes', async () => {
    const emailA = uniqueEmail('cleanupA');
    const emailB = uniqueEmail('cleanupB');
    createdEmails.push(emailA, emailB);

    await createUser(emailA, 'passwordA123', 'Cleanup User A');
    await createUser(emailB, 'passwordB123', 'Cleanup User B');

    // Both owners must be present right now
    const { rows: before } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM owners WHERE email = ANY($1::text[])`,
      [[emailA, emailB]],
    );
    expect(Number(before[0].count)).toBe(2);

    // Simulate cleanup (afterEach will fire automatically; calling it
    // explicitly here verifies the mechanism works within the test itself)
    await cleanupTestOwners();

    // Both owners must be gone
    const { rows: after } = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM owners WHERE email = ANY($1::text[])`,
      [[emailA, emailB]],
    );
    expect(Number(after[0].count)).toBe(0);
  });

  maybeIt('AC-20: child resources are removed via CASCADE when their owner is deleted', async () => {
    const email = uniqueEmail('cascadeCleanup');
    createdEmails.push(email);

    const cookie = await createUser(email, 'passwordA123', 'Cascade User');
    const ownerId = ownerIdFromCookie(cookie);

    // Create one of each resource type
    const docId = await createDocumentForUser(ownerId, 'cascade.pdf');
    const chatSessionId = await createChatSession(cookie, 'Cascade session');
    const { id: shareLinkId } = await createShareLink(cookie, 'Cascade link');

    // Delete the owner (cleanup path) — child rows must disappear via CASCADE
    await cleanupTestOwners();

    const [doc, session, link] = await Promise.all([
      getTestPrisma().document.findUnique({ where: { id: docId } }),
      getTestPrisma().chatSession.findUnique({ where: { id: chatSessionId } }),
      getTestPrisma().shareLink.findUnique({ where: { id: shareLinkId } }),
    ]);

    expect(doc).toBeNull();
    expect(session).toBeNull();
    expect(link).toBeNull();
  });
});

// ===========================================================================
// Cross-cutting: unauthenticated requests to all resource endpoints → 401
// ===========================================================================

describe('Unauthenticated access returns 401 for every protected resource', () => {
  const noAuth = (url: string, method = 'GET') => makeRequest(url, { method });

  maybeIt('GET /api/documents without session → 401', async () => {
    const res = await documentsGET(noAuth('/api/documents'));
    expect(res.status).toBe(401);
  });

  maybeIt('GET /api/documents/:id without session → 401', async () => {
    const res = await documentByIdGET(noAuth('/api/documents/1'), {
      params: Promise.resolve({ documentId: '1' }),
    });
    expect(res.status).toBe(401);
  });

  maybeIt('DELETE /api/documents/:id without session → 401', async () => {
    const res = await documentDELETE(noAuth('/api/documents/1', 'DELETE'), {
      params: Promise.resolve({ documentId: '1' }),
    });
    expect(res.status).toBe(401);
  });

  maybeIt('GET /api/share-links without session → 401', async () => {
    const res = await shareLinksGET(noAuth('/api/share-links'));
    expect(res.status).toBe(401);
  });

  maybeIt('POST /api/share-links without session → 401', async () => {
    const res = await shareLinksPOST(
      makeRequest('/api/share-links', { method: 'POST', body: { label: 'x' } }),
    );
    expect(res.status).toBe(401);
  });

  maybeIt('DELETE /api/share-links/:id without session → 401', async () => {
    const res = await shareLinkDELETE(noAuth('/api/share-links/1', 'DELETE'), {
      params: Promise.resolve({ linkId: '1' }),
    });
    expect(res.status).toBe(401);
  });

  maybeIt('GET /api/chat/sessions without session → 401', async () => {
    const res = await chatSessionsGET(noAuth('/api/chat/sessions'));
    expect(res.status).toBe(401);
  });

  maybeIt('POST /api/chat/sessions without session → 401', async () => {
    const res = await chatSessionsPOST(
      makeRequest('/api/chat/sessions', { method: 'POST', body: { title: 'x' } }),
    );
    expect(res.status).toBe(401);
  });

  maybeIt('GET /api/chat/sessions/:id without session → 401', async () => {
    const res = await chatSessionByIdGET(noAuth('/api/chat/sessions/1'), {
      params: Promise.resolve({ sessionId: '1' }),
    });
    expect(res.status).toBe(401);
  });

  maybeIt('DELETE /api/chat/sessions/:id without session → 401', async () => {
    const res = await chatSessionDELETE(noAuth('/api/chat/sessions/1', 'DELETE'), {
      params: Promise.resolve({ sessionId: '1' }),
    });
    expect(res.status).toBe(401);
  });

  maybeIt('GET /api/settings without session → 401', async () => {
    const res = await settingsGET(noAuth('/api/settings'));
    expect(res.status).toBe(401);
  });

  maybeIt('PUT /api/settings without session → 401', async () => {
    const res = await settingsPUT(
      makeRequest('/api/settings', { method: 'PUT', body: {} }),
    );
    expect(res.status).toBe(401);
  });

  maybeIt('GET /api/dashboard without session → 401', async () => {
    const res = await dashboardGET(noAuth('/api/dashboard'));
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// Forged-token cross-user access attempt
// ===========================================================================

describe('Forged-token cross-user access attempts', () => {
  maybeIt('a token signed with a wrong secret cannot access protected endpoints', async () => {
    // Build a structurally valid-looking JWT signed with the wrong secret.
    const forgedToken = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(
        JSON.stringify({ userId: 1, email: 'hacker@evil.com', exp: 9_999_999_999 }),
      ).toString('base64url'),
      Buffer.from('sig:wrong-secret').toString('base64url'),
    ].join('.');

    const res = await documentsGET(
      makeRequest('/api/documents', { sessionCookie: forgedToken }),
    );
    // requireAuth must reject the forged token — 401, not a list of documents
    expect(res.status).toBe(401);
  });

  maybeIt('a token with a tampered userId payload is rejected', async () => {
    if (!dbAvailable) return;

    const email = uniqueEmail('tamper');
    createdEmails.push(email);

    // Create a real user to get a real token
    const realCookie = await createUser(email, 'password123', 'Tamper Test');
    const realOwnerIdFromToken = ownerIdFromCookie(realCookie);

    // Parse the real token's payload, change userId to a different owner's ID,
    // and re-assemble with a wrong signature.
    const realParts = realCookie.split('.');
    const realPayload = JSON.parse(
      Buffer.from(realParts[1], 'base64url').toString(),
    ) as Record<string, unknown>;

    const tamperedPayload = {
      ...realPayload,
      userId: realOwnerIdFromToken + 999_999, // a different, non-existent owner
    };
    const tamperedToken = [
      realParts[0],
      Buffer.from(JSON.stringify(tamperedPayload)).toString('base64url'),
      Buffer.from('sig:wrong-secret').toString('base64url'), // wrong sig
    ].join('.');

    // The tampered token must be rejected — cannot read documents
    const res = await documentsGET(
      makeRequest('/api/documents', { sessionCookie: tamperedToken }),
    );
    expect(res.status).toBe(401);
  });
});
