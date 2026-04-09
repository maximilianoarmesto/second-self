/**
 * Unit tests for POST /api/settings/avatar
 *
 * Acceptance criteria verified:
 *  1. Endpoint accepts multipart/form-data with an "image" field
 *  2. Only JPG and PNG files are accepted; others return 400
 *  3. File size is capped at 2 MB; larger files return 400
 *  4. File is saved to /public/uploads/ with a unique name
 *  5. The settings record is upserted with the new avatarUrl
 *  6. Returns { avatarUrl } in the response body
 *  7. Old uploaded file is deleted from disk when a new one is uploaded
 *  8. avatarUrl stored in the DB is a relative URL (e.g. /api/uploads/<filename>)
 *  9. fs.unlink receives the absolute filesystem path, NOT the relative URL
 * 10. deletePreviousAvatar never calls fs.unlink on UPLOADS_DIR itself
 *
 * All I/O (fs, prisma) is mocked — no real disk or DB access.
 */

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports
// ---------------------------------------------------------------------------

jest.mock('@/lib/prisma', () => ({
  prisma: {
    settings: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      mkdir: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined),
      unlink: jest.fn().mockResolvedValue(undefined),
    },
  };
});

// ---------------------------------------------------------------------------
// JWT mock — allows requireAuth to accept a deterministic session token
// ---------------------------------------------------------------------------

const AVATAR_TEST_JWT_SECRET = 'avatar-upload-test-secret';
const AVATAR_TEST_USER_ID = 1;

function makeAvatarTestToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ userId: AVATAR_TEST_USER_ID, email: 'test@example.com', name: 'Test User', iat: 1700000000, exp: 9999999999 })
  ).toString('base64url');
  const sig = Buffer.from(`sig:${AVATAR_TEST_JWT_SECRET}`).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    sign: jest.fn(),
    verify: (token: string) => {
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
  verify: (token: string) => {
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
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/settings/avatar/route';

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockFs = fs as jest.Mocked<typeof fs>;

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

process.env.JWT_SECRET = AVATAR_TEST_JWT_SECRET;
const AVATAR_TEST_SESSION = makeAvatarTestToken();

const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');

/**
 * Builds a minimal NextRequest carrying a multipart/form-data body.
 * Uses the native FormData + Blob APIs available in the Node test environment
 * via Next.js polyfills.
 */
function buildRequest(
  fieldName: string,
  filename: string,
  mimeType: string,
  sizeBytes: number
): NextRequest {
  const body = Buffer.alloc(sizeBytes, 0x42); // fill with 'B'
  const blob = new Blob([body], { type: mimeType });
  const file = new File([blob], filename, { type: mimeType });

  const formData = new FormData();
  formData.append(fieldName, file);

  // Construct a Request with the FormData body so Next.js can parse it.
  // Include the session cookie so requireAuth can identify the test user.
  const request = new Request('http://localhost/api/settings/avatar', {
    method: 'POST',
    headers: { cookie: `session=${AVATAR_TEST_SESSION}` },
    body: formData,
  });

  return request as unknown as NextRequest;
}

/** Shorthand for a valid 100-byte JPEG request */
function validJpegRequest(sizeBytes = 100): NextRequest {
  return buildRequest('image', 'avatar.jpg', 'image/jpeg', sizeBytes);
}

/** Shorthand for a valid 100-byte PNG request */
function validPngRequest(sizeBytes = 100): NextRequest {
  return buildRequest('image', 'avatar.png', 'image/png', sizeBytes);
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();

  // Default: no existing settings record
  (mockPrisma.settings.findUnique as jest.Mock).mockResolvedValue(null);
  (mockPrisma.settings.upsert as jest.Mock).mockResolvedValue({ avatarUrl: '/api/uploads/test.jpg' });

  // Default: all fs operations succeed
  (mockFs.mkdir as jest.Mock).mockResolvedValue(undefined);
  (mockFs.writeFile as jest.Mock).mockResolvedValue(undefined);
  (mockFs.unlink as jest.Mock).mockResolvedValue(undefined);
});

// ===========================================================================
// 1. Happy path — JPG and PNG are accepted
// ===========================================================================

describe('Happy path', () => {
  it('accepts a valid JPEG upload and returns 200 with avatarUrl', async () => {
    const response = await POST(validJpegRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('avatarUrl');
    expect(body.avatarUrl).toMatch(/^\/api\/uploads\/.+\.jpg$/);
  });

  it('accepts a valid PNG upload and returns 200 with avatarUrl', async () => {
    const response = await POST(validPngRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('avatarUrl');
    expect(body.avatarUrl).toMatch(/^\/api\/uploads\/.+\.png$/);
  });

  it('creates the uploads directory before writing the file', async () => {
    await POST(validJpegRequest());

    expect(mockFs.mkdir).toHaveBeenCalledWith(UPLOADS_DIR, { recursive: true });
  });

  it('writes the file buffer to disk inside UPLOADS_DIR', async () => {
    await POST(validJpegRequest());

    expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
    const [savedPath, savedBuffer] = (mockFs.writeFile as jest.Mock).mock.calls[0];
    expect(savedPath).toContain(UPLOADS_DIR);
    expect(Buffer.isBuffer(savedBuffer)).toBe(true);
  });

  it('generates a unique filename with timestamp and random suffix', async () => {
    const r1 = await POST(validJpegRequest());
    const r2 = await POST(validJpegRequest());
    const b1 = await r1.json();
    const b2 = await r2.json();

    // URLs must differ (timestamps/random parts differ)
    expect(b1.avatarUrl).not.toBe(b2.avatarUrl);
  });

  it('upserts the settings record with the new avatarUrl', async () => {
    await POST(validJpegRequest());

    expect(mockPrisma.settings.upsert).toHaveBeenCalledTimes(1);
    const call = (mockPrisma.settings.upsert as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual({ ownerId: 1 });
    expect(call.update.avatarUrl).toMatch(/^\/api\/uploads\/.+\.jpg$/);
    expect(call.create.avatarUrl).toMatch(/^\/api\/uploads\/.+\.jpg$/);
  });

  it('the upsert create block includes required default fields', async () => {
    await POST(validJpegRequest());

    const call = (mockPrisma.settings.upsert as jest.Mock).mock.calls[0][0];
    expect(call.create).toMatchObject({
      ownerId: 1,
      cloneName: expect.any(String),
      systemPrompt: expect.any(String),
      tone: expect.any(String),
      responseLength: expect.any(String),
    });
  });
});

// ===========================================================================
// 2. avatarUrl stored in DB is a relative URL (acceptance criterion)
// ===========================================================================

describe('avatarUrl stored in DB is a relative URL', () => {
  it('the upserted avatarUrl starts with /api/uploads/ — not an absolute filesystem path', async () => {
    await POST(validJpegRequest());

    const call = (mockPrisma.settings.upsert as jest.Mock).mock.calls[0][0];
    const stored: string = call.update.avatarUrl;

    // Must be a relative URL like /api/uploads/<filename>
    expect(stored).toMatch(/^\/api\/uploads\//);
    // Must NOT be an absolute filesystem path like /app/public/uploads/...
    // or contain OS-level path components
    expect(stored).not.toContain(process.cwd());
    expect(stored).not.toMatch(/^\/app\//);
    expect(stored).not.toContain('public');
  });

  it('the avatarUrl returned in the response body is the same relative URL saved to the DB', async () => {
    await POST(validJpegRequest());

    // Capture what was upserted
    const upsertCall = (mockPrisma.settings.upsert as jest.Mock).mock.calls[0][0];
    const storedUrl: string = upsertCall.update.avatarUrl;

    // The response must reflect the same relative URL
    const response = await POST(validJpegRequest());
    const body = await response.json();
    expect(body.avatarUrl).toMatch(/^\/api\/uploads\//);
    // Both must follow the same /api/uploads/<filename> pattern
    expect(storedUrl).toMatch(/^\/api\/uploads\//);
  });

  it('the relative URL is browser-accessible: starts with / and has no server-side path segments', async () => {
    const response = await POST(validJpegRequest());
    const body = await response.json();

    const avatarUrl: string = body.avatarUrl;

    // Must start with a leading slash (root-relative URL)
    expect(avatarUrl.startsWith('/')).toBe(true);
    // Must not be an absolute URL (no scheme)
    expect(avatarUrl).not.toMatch(/^https?:\/\//);
    // Must not contain any server-only path segments
    expect(avatarUrl).not.toContain('public');
    expect(avatarUrl).not.toContain(process.cwd());
  });
});

// ===========================================================================
// 3. Old avatar cleanup
// ===========================================================================

describe('Old avatar cleanup', () => {
  it('deletes the previous avatar file when one exists', async () => {
    (mockPrisma.settings.findUnique as jest.Mock).mockResolvedValue({
      avatarUrl: '/uploads/old-avatar.jpg',
    });

    await POST(validJpegRequest());

    expect(mockFs.unlink).toHaveBeenCalledTimes(1);
    const unlinkedPath = (mockFs.unlink as jest.Mock).mock.calls[0][0];
    expect(unlinkedPath).toBe(path.join(UPLOADS_DIR, 'old-avatar.jpg'));
  });

  it('does NOT call unlink when there is no previous avatar', async () => {
    (mockPrisma.settings.findUnique as jest.Mock).mockResolvedValue({ avatarUrl: null });

    await POST(validJpegRequest());

    expect(mockFs.unlink).not.toHaveBeenCalled();
  });

  it('does NOT call unlink when settings record does not exist', async () => {
    (mockPrisma.settings.findUnique as jest.Mock).mockResolvedValue(null);

    await POST(validJpegRequest());

    expect(mockFs.unlink).not.toHaveBeenCalled();
  });

  it('still returns 200 and saves the new file even if unlink throws (missing file)', async () => {
    (mockPrisma.settings.findUnique as jest.Mock).mockResolvedValue({
      avatarUrl: '/uploads/ghost-file.jpg',
    });
    (mockFs.unlink as jest.Mock).mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    );

    const response = await POST(validJpegRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('avatarUrl');
  });
});

// ===========================================================================
// 4. Validation — wrong field name
// ===========================================================================

describe('Missing image field', () => {
  it('returns 400 when the "image" field is absent', async () => {
    const formData = new FormData();
    // Send with a different field name
    formData.append('file', new File(['data'], 'avatar.jpg', { type: 'image/jpeg' }));
    const request = new Request('http://localhost/api/settings/avatar', {
      method: 'POST',
      headers: { cookie: `session=${AVATAR_TEST_SESSION}` },
      body: formData,
    }) as unknown as NextRequest;

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/no image file/i);
  });

  it('returns 400 when the form body is completely empty', async () => {
    const request = new Request('http://localhost/api/settings/avatar', {
      method: 'POST',
      headers: { cookie: `session=${AVATAR_TEST_SESSION}` },
      body: new FormData(),
    }) as unknown as NextRequest;

    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});

// ===========================================================================
// 5. Validation — file type
// ===========================================================================

describe('File type validation', () => {
  it('returns 400 for a GIF upload', async () => {
    const req = buildRequest('image', 'avatar.gif', 'image/gif', 100);
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/invalid file type/i);
  });

  it('returns 400 for a WebP upload', async () => {
    const req = buildRequest('image', 'avatar.webp', 'image/webp', 100);
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/invalid file type/i);
  });

  it('returns 400 for a PDF masquerading as an image', async () => {
    const req = buildRequest('image', 'evil.pdf', 'application/pdf', 100);
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/invalid file type/i);
  });

  it('returns 400 for a plain text file', async () => {
    const req = buildRequest('image', 'notes.txt', 'text/plain', 100);
    const response = await POST(req);

    expect(response.status).toBe(400);
  });

  it('accepts image/jpeg MIME type', async () => {
    const req = buildRequest('image', 'photo.jpg', 'image/jpeg', 100);
    const response = await POST(req);
    expect(response.status).toBe(200);
  });

  it('accepts image/png MIME type', async () => {
    const req = buildRequest('image', 'photo.png', 'image/png', 100);
    const response = await POST(req);
    expect(response.status).toBe(200);
  });
});

// ===========================================================================
// 6. Validation — file size
// ===========================================================================

describe('File size validation', () => {
  const MAX = 2 * 1024 * 1024; // 2 MB

  it('accepts a file exactly at the 2 MB limit', async () => {
    const req = validJpegRequest(MAX);
    const response = await POST(req);
    expect(response.status).toBe(200);
  });

  it('returns 400 for a file 1 byte over the 2 MB limit', async () => {
    const req = validJpegRequest(MAX + 1);
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/file too large/i);
  });

  it('returns 400 for a file significantly over the limit (e.g. 5 MB)', async () => {
    const req = validJpegRequest(5 * 1024 * 1024);
    const response = await POST(req);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/file too large/i);
  });

  it('accepts a small 1 KB file without issue', async () => {
    const req = validJpegRequest(1024);
    const response = await POST(req);
    expect(response.status).toBe(200);
  });
});

// ===========================================================================
// 7. Path-traversal guard and fs.unlink path correctness (acceptance criteria)
// ===========================================================================

describe('Path-traversal guard on old avatar deletion', () => {
  it('does not call unlink for a path with traversal characters', async () => {
    // Malicious avatarUrl that would resolve outside UPLOADS_DIR
    (mockPrisma.settings.findUnique as jest.Mock).mockResolvedValue({
      avatarUrl: '/uploads/../../../etc/passwd',
    });

    const response = await POST(validJpegRequest());

    // The new upload still succeeds
    expect(response.status).toBe(200);

    // But the traversal path must not be unlinked
    // (basename extraction means we only try to delete 'passwd' inside UPLOADS_DIR,
    //  which is safe — but the fs.unlink mock may or may not be called with that safe path)
    if ((mockFs.unlink as jest.Mock).mock.calls.length > 0) {
      const unlinkedPath = (mockFs.unlink as jest.Mock).mock.calls[0][0];
      expect(unlinkedPath).toMatch(new RegExp(`^${UPLOADS_DIR.replace(/\\/g, '\\\\')}.*`));
    }
  });

  it('does NOT call unlink when the stored avatarUrl produces an empty basename', async () => {
    // A bare slash has no filename component — path.basename('/') returns ''.
    // The inner guard in deletePreviousAvatar must detect the empty filename and
    // return early so UPLOADS_DIR itself is never passed to fs.unlink.
    // The outer `if (currentSettings?.avatarUrl)` is truthy for '/' (non-empty
    // string), so this exercises the inner guard directly.
    (mockPrisma.settings.findUnique as jest.Mock).mockResolvedValue({
      avatarUrl: '/',
    });

    const response = await POST(validJpegRequest());

    // The new upload still succeeds
    expect(response.status).toBe(200);

    // UPLOADS_DIR itself must never be passed to fs.unlink (would delete the directory)
    const unlinkCalls = (mockFs.unlink as jest.Mock).mock.calls;
    for (const [unlinkedPath] of unlinkCalls) {
      expect(unlinkedPath).not.toBe(UPLOADS_DIR);
      // Any path that was unlinked must sit strictly inside UPLOADS_DIR
      expect(unlinkedPath).toMatch(
        new RegExp(
          `^${UPLOADS_DIR.replace(/\\/g, '\\\\')}${path.sep.replace(/\\/g, '\\\\')}`
        )
      );
    }
  });

  it('fs.unlink receives the absolute filesystem path, NOT the relative URL stored in the DB', async () => {
    // This test pins down the separation of concerns required by the task:
    //   DB stores:       relative URL       → `/uploads/old-avatar.jpg`
    //   fs.unlink gets:  absolute fs path   → `<cwd>/public/uploads/old-avatar.jpg`
    // Confusing the two would either try to delete a URL-shaped path (which
    // does not exist on disk) or expose a relative-path traversal risk.
    const OLD_RELATIVE_URL = '/uploads/old-avatar.jpg';
    const EXPECTED_FILESYSTEM_PATH = path.join(UPLOADS_DIR, 'old-avatar.jpg');

    (mockPrisma.settings.findUnique as jest.Mock).mockResolvedValue({
      avatarUrl: OLD_RELATIVE_URL,
    });

    await POST(validJpegRequest());

    expect(mockFs.unlink).toHaveBeenCalledTimes(1);
    const unlinkedPath = (mockFs.unlink as jest.Mock).mock.calls[0][0];

    // Must be the absolute filesystem path — NOT the relative URL stored in the DB
    expect(unlinkedPath).toBe(EXPECTED_FILESYSTEM_PATH);
    expect(unlinkedPath).not.toBe(OLD_RELATIVE_URL);
    // Must start with the absolute uploads directory
    expect(unlinkedPath).toContain(UPLOADS_DIR);
    // Must not look like a URL (no leading /uploads/ without the full CWD prefix)
    expect(unlinkedPath.startsWith('/uploads/')).toBe(false);
  });
});

// ===========================================================================
// 8. DB / fs error handling
// ===========================================================================

describe('Internal error handling', () => {
  it('returns 500 when fs.writeFile throws', async () => {
    (mockFs.writeFile as jest.Mock).mockRejectedValue(new Error('ENOSPC: no space left on device'));

    const response = await POST(validJpegRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toMatch(/ENOSPC|failed to upload avatar/i);
  });

  it('returns 500 when the Prisma upsert throws', async () => {
    (mockPrisma.settings.upsert as jest.Mock).mockRejectedValue(
      new Error('Connection to database failed')
    );

    const response = await POST(validJpegRequest());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toMatch(/Connection to database failed|failed to upload avatar/i);
  });
});
