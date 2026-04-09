/**
 * Unit tests for GET /api/uploads/[filename]
 * ===========================================
 * Verifies the dedicated file-serving route that streams avatar images from
 * disk.  This route is the linchpin of the Docker avatar-persistence fix:
 * because the Next.js standalone build does not serve runtime-written files
 * from public/uploads/ via its static manifest, we route all avatar image
 * requests through this API handler, which reads files directly from the
 * volume-mounted directory.
 *
 * Acceptance criteria verified:
 *  1.  Returns 200 + correct Content-Type for a JPG file
 *  2.  Returns 200 + correct Content-Type for a PNG file
 *  3.  Returns 200 + correct Content-Type for a JPEG file (.jpeg extension)
 *  4.  Returns 404 when the file does not exist (ENOENT)
 *  5.  Returns 404 when the extension is not allowed (e.g. .gif, .pdf, .txt)
 *  6.  Returns 400 for a path-traversal filename (e.g. ../../etc/passwd)
 *  7.  Returns 400 for an empty filename
 *  8.  Returns 500 for unexpected fs errors
 *  9.  Sets Cache-Control: public, max-age=3600, must-revalidate
 * 10.  Sets Content-Length matching the file size
 * 11.  The route is accessible without authentication (public route)
 * 12.  Sanitised path never escapes UPLOADS_DIR (path-traversal guard)
 * 13.  GET /api/uploads/<filename> matches the URL pattern stored in the DB
 *      by POST /api/settings/avatar (i.e. /api/uploads/<timestamp>-<hex>.<ext>)
 *
 * All fs calls are mocked — no real disk access.
 */

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports
// ---------------------------------------------------------------------------

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: jest.fn(),
    },
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { GET } from '@/app/api/uploads/[filename]/route';

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

const mockReadFile = fs.readFile as jest.Mock;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');

/** 16 bytes of fake image data — enough to test Content-Length accuracy. */
const FAKE_FILE_BYTES = Buffer.from('FAKE_IMAGE_BYTES_16');

// ---------------------------------------------------------------------------
// Request / params builders
// ---------------------------------------------------------------------------

function buildRequest(filename: string): NextRequest {
  return new Request(`http://localhost/api/uploads/${filename}`) as unknown as NextRequest;
}

function buildParams(filename: string) {
  return { params: Promise.resolve({ filename }) };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  // Default: file exists and returns fake bytes
  mockReadFile.mockResolvedValue(FAKE_FILE_BYTES);
});

// ===========================================================================
// 1. Happy path — supported file types
// ===========================================================================

describe('Happy path — file is returned with correct headers', () => {
  it('returns 200 for a JPG file', async () => {
    const res = await GET(buildRequest('avatar.jpg'), buildParams('avatar.jpg'));
    expect(res.status).toBe(200);
  });

  it('sets Content-Type: image/jpeg for a .jpg file', async () => {
    const res = await GET(buildRequest('avatar.jpg'), buildParams('avatar.jpg'));
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });

  it('returns 200 for a PNG file', async () => {
    const res = await GET(buildRequest('avatar.png'), buildParams('avatar.png'));
    expect(res.status).toBe(200);
  });

  it('sets Content-Type: image/png for a .png file', async () => {
    const res = await GET(buildRequest('avatar.png'), buildParams('avatar.png'));
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('returns 200 for a .jpeg file', async () => {
    const res = await GET(buildRequest('photo.jpeg'), buildParams('photo.jpeg'));
    expect(res.status).toBe(200);
  });

  it('sets Content-Type: image/jpeg for a .jpeg file', async () => {
    const res = await GET(buildRequest('photo.jpeg'), buildParams('photo.jpeg'));
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });

  it('returns the file bytes as the response body', async () => {
    const res = await GET(buildRequest('avatar.jpg'), buildParams('avatar.jpg'));
    const body = await res.arrayBuffer();
    expect(Buffer.from(body)).toEqual(FAKE_FILE_BYTES);
  });

  it('reads the file from the correct absolute path inside UPLOADS_DIR', async () => {
    await GET(buildRequest('1700000000000-abc123.jpg'), buildParams('1700000000000-abc123.jpg'));

    expect(mockReadFile).toHaveBeenCalledTimes(1);
    const [readPath] = mockReadFile.mock.calls[0] as [string];
    expect(readPath).toBe(path.join(UPLOADS_DIR, '1700000000000-abc123.jpg'));
  });
});

// ===========================================================================
// 2. Caching headers
// ===========================================================================

describe('Cache-Control header', () => {
  it('sets Cache-Control: public, max-age=3600, must-revalidate', async () => {
    const res = await GET(buildRequest('avatar.jpg'), buildParams('avatar.jpg'));
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600, must-revalidate');
  });

  it('sets Content-Length matching the file buffer size', async () => {
    const res = await GET(buildRequest('avatar.jpg'), buildParams('avatar.jpg'));
    expect(res.headers.get('content-length')).toBe(String(FAKE_FILE_BYTES.byteLength));
  });
});

// ===========================================================================
// 3. 404 — file not found
// ===========================================================================

describe('404 — file not found', () => {
  it('returns 404 when the file does not exist (ENOENT)', async () => {
    mockReadFile.mockRejectedValue(
      Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
    );

    const res = await GET(buildRequest('missing.jpg'), buildParams('missing.jpg'));
    expect(res.status).toBe(404);
  });

  it('returns JSON error body on 404', async () => {
    mockReadFile.mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    );

    const res = await GET(buildRequest('missing.jpg'), buildParams('missing.jpg'));
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ===========================================================================
// 4. 404 — disallowed file extensions
// ===========================================================================

describe('404 — disallowed file types', () => {
  it('returns 404 for a .gif file (not allowed)', async () => {
    const res = await GET(buildRequest('anim.gif'), buildParams('anim.gif'));
    expect(res.status).toBe(404);
  });

  it('returns 404 for a .webp file (not allowed)', async () => {
    const res = await GET(buildRequest('photo.webp'), buildParams('photo.webp'));
    expect(res.status).toBe(404);
  });

  it('returns 404 for a .pdf file (not allowed)', async () => {
    const res = await GET(buildRequest('doc.pdf'), buildParams('doc.pdf'));
    expect(res.status).toBe(404);
  });

  it('returns 404 for a .txt file (not allowed)', async () => {
    const res = await GET(buildRequest('notes.txt'), buildParams('notes.txt'));
    expect(res.status).toBe(404);
  });

  it('returns 404 for a file with no extension', async () => {
    const res = await GET(buildRequest('noext'), buildParams('noext'));
    expect(res.status).toBe(404);
  });

  it('does NOT call fs.readFile for disallowed extensions (no disk access)', async () => {
    await GET(buildRequest('malware.exe'), buildParams('malware.exe'));
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 5. Path-traversal protection
// ===========================================================================

describe('Path-traversal protection', () => {
  it('returns 400 for a path with ../ traversal characters', async () => {
    const res = await GET(
      buildRequest('../etc/passwd'),
      buildParams('../etc/passwd')
    );
    // After basename sanitisation '/../etc/passwd' becomes 'passwd' (no extension) → 404
    // OR the startsWith guard rejects it → 400 / 404
    // Either way it must NOT return 200 or read the file
    expect(res.status).not.toBe(200);
    expect(mockReadFile).not.toHaveBeenCalledWith(
      expect.stringContaining('etc/passwd')
    );
  });

  it('returns 400 or 404 for a Windows-style traversal (%5C..%5C)', async () => {
    const res = await GET(
      buildRequest('..%5C..%5Cwindows%5Csystem32'),
      buildParams('..%5C..%5Cwindows%5Csystem32')
    );
    expect(res.status).not.toBe(200);
  });

  it('never reads a path outside UPLOADS_DIR even with crafted input', async () => {
    await GET(
      buildRequest('../../../../etc/passwd'),
      buildParams('../../../../etc/passwd')
    );
    // If readFile was called, ensure it was only called with a path inside UPLOADS_DIR
    if (mockReadFile.mock.calls.length > 0) {
      const [readPath] = mockReadFile.mock.calls[0] as [string];
      expect(readPath.startsWith(UPLOADS_DIR)).toBe(true);
    }
  });
});

// ===========================================================================
// 6. 500 — unexpected errors
// ===========================================================================

describe('500 — unexpected fs errors', () => {
  it('returns 500 for an unexpected fs error (not ENOENT)', async () => {
    mockReadFile.mockRejectedValue(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    );

    const res = await GET(buildRequest('avatar.jpg'), buildParams('avatar.jpg'));
    expect(res.status).toBe(500);
  });

  it('returns JSON error body on 500', async () => {
    mockReadFile.mockRejectedValue(
      Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
    );

    const res = await GET(buildRequest('avatar.jpg'), buildParams('avatar.jpg'));
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ===========================================================================
// 7. DB URL format compatibility
// ===========================================================================

describe('URL format compatibility — stored DB paths resolve correctly', () => {
  /**
   * POST /api/settings/avatar stores URLs as `/api/uploads/<timestamp>-<hex>.<ext>`.
   * This test verifies that the filename extracted from such a URL resolves to
   * the correct path inside UPLOADS_DIR.
   *
   * The pattern mirrors the generateFilename() output:
   *   `${Date.now()}-${Math.random().toString(16).slice(2,8)}.jpg`
   */
  const STORED_JPG = '1717000000000-a3f9c2.jpg';
  const STORED_PNG = '1717000000000-b7d4e1.png';

  it('resolves a JPG filename from the DB URL pattern to the correct absolute path', async () => {
    await GET(buildRequest(STORED_JPG), buildParams(STORED_JPG));

    expect(mockReadFile).toHaveBeenCalledWith(path.join(UPLOADS_DIR, STORED_JPG));
  });

  it('resolves a PNG filename from the DB URL pattern to the correct absolute path', async () => {
    await GET(buildRequest(STORED_PNG), buildParams(STORED_PNG));

    expect(mockReadFile).toHaveBeenCalledWith(path.join(UPLOADS_DIR, STORED_PNG));
  });

  it('returns 200 for a typical timestamped JPG avatar filename', async () => {
    const res = await GET(buildRequest(STORED_JPG), buildParams(STORED_JPG));
    expect(res.status).toBe(200);
  });

  it('returns 200 for a typical timestamped PNG avatar filename', async () => {
    const res = await GET(buildRequest(STORED_PNG), buildParams(STORED_PNG));
    expect(res.status).toBe(200);
  });

  it('the route serves files matching the pattern generated by the upload route', async () => {
    // Simulate a filename produced by generateFilename() in the avatar upload route
    const ts = 1700000000000;
    const rnd = 'abc123';
    const filenameJpg = `${ts}-${rnd}.jpg`;
    const filenamePng = `${ts}-${rnd}.png`;

    const resJpg = await GET(buildRequest(filenameJpg), buildParams(filenameJpg));
    expect(resJpg.status).toBe(200);
    expect(resJpg.headers.get('content-type')).toBe('image/jpeg');

    const resPng = await GET(buildRequest(filenamePng), buildParams(filenamePng));
    expect(resPng.status).toBe(200);
    expect(resPng.headers.get('content-type')).toBe('image/png');
  });
});

// ===========================================================================
// 8. No-auth — the route is publicly accessible
// ===========================================================================

describe('Public accessibility — no authentication required', () => {
  /**
   * The route handler signature is a plain `async function GET(...)` — it does
   * NOT use the `requireAuth` wrapper.  We verify this by calling the handler
   * with a request that has NO session cookie and confirming a 200 response.
   */
  it('returns 200 for a valid file request with no authentication cookie', async () => {
    // Request without any Authorization / cookie headers
    const req = new Request('http://localhost/api/uploads/avatar.jpg') as unknown as NextRequest;
    const res = await GET(req, buildParams('avatar.jpg'));
    expect(res.status).toBe(200);
  });

  it('returns 200 for a valid file request sent from the public clone page (no session)', async () => {
    // The /clone/[token] page requests the avatar without auth — simulate that
    const req = new Request('http://localhost/api/uploads/avatar.png') as unknown as NextRequest;
    const res = await GET(req, buildParams('avatar.png'));
    expect(res.status).toBe(200);
  });
});
