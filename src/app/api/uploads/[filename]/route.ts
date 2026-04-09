import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Absolute path to the uploads directory on disk.
 * Files are written here by POST /api/settings/avatar.
 * In Docker the directory is backed by a named volume so uploads persist
 * across container restarts.
 */
const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');

/** Allowed extensions → MIME type mapping (keep in sync with the upload route). */
const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

// ---------------------------------------------------------------------------
// GET /api/uploads/[filename]
// ---------------------------------------------------------------------------

/**
 * Serves an uploaded file (avatar image) from the local `public/uploads/`
 * directory.
 *
 * Why an API route instead of Next.js static file serving?
 * In the standalone Docker output Next.js does NOT automatically re-serve
 * files written at runtime to `public/uploads/` — the static manifest is
 * baked at build time and doesn't know about post-build uploads.  This
 * handler reads the file directly from disk on every request, so it works
 * correctly with a Docker volume mount at `/app/public/uploads`.
 *
 * Security measures:
 *  - `path.basename` strips any directory component from the filename.
 *  - The resolved path is checked with `startsWith(UPLOADS_DIR + sep)` to
 *    prevent path-traversal escapes.
 *  - Only `.jpg`, `.jpeg`, and `.png` extensions are served; everything else
 *    receives 404 so the route cannot be used to read arbitrary files.
 *  - The route is intentionally public (no authentication) because avatar
 *    images must be visible on the public clone share page.
 *
 * Response headers:
 *  - `Content-Type`  — derived from the file extension.
 *  - `Cache-Control` — 1-hour public cache; `must-revalidate` for correctness.
 *  - `Content-Length` — set from the buffer size.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
): Promise<NextResponse> {
  const { filename } = await params;

  // ── Sanitise the filename ──────────────────────────────────────────────────
  // path.basename removes any directory component (e.g. "../../etc/passwd"
  // becomes "passwd").  The subsequent startsWith guard rejects the result if
  // it somehow escapes UPLOADS_DIR.
  const safeFilename = path.basename(filename);

  if (!safeFilename) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
  }

  // ── Validate the extension ────────────────────────────────────────────────
  const ext = path.extname(safeFilename).toLowerCase();
  const contentType = MIME_BY_EXT[ext];
  if (!contentType) {
    return NextResponse.json({ error: 'File type not allowed' }, { status: 404 });
  }

  // ── Build and guard the absolute path ─────────────────────────────────────
  const filePath = path.join(UPLOADS_DIR, safeFilename);

  // Ensure the resolved path is strictly inside UPLOADS_DIR (defense-in-depth).
  if (!filePath.startsWith(UPLOADS_DIR + path.sep)) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
  }

  // ── Read the file ─────────────────────────────────────────────────────────
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    console.error(`[GET /api/uploads/${safeFilename}] Unexpected error:`, err);
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
  }

  // ── Respond with the file bytes ───────────────────────────────────────────
  // Convert the Node.js Buffer to a Uint8Array so TypeScript's BodyInit type
  // is satisfied (Buffer is not directly assignable to BodyInit in strict mode,
  // but Uint8Array is, and Buffer is a subclass of Uint8Array at runtime).
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buffer.byteLength),
      // Cache for 1 hour; must-revalidate ensures stale content isn't served
      // beyond the TTL.  The unique timestamped filenames mean a new upload
      // always produces a cache miss automatically.
      'Cache-Control': 'public, max-age=3600, must-revalidate',
    },
  });
}
