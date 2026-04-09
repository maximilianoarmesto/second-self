import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware/requireAuth';
import type { AuthContext } from '@/lib/middleware/requireAuth';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');

/**
 * URL prefix used to build the publicly accessible avatar URL that is stored
 * in the database and returned to clients.
 *
 * We serve uploads through the dedicated /api/uploads/[filename] route rather
 * than relying on Next.js static file serving from /public/uploads/.  In the
 * standalone Docker build Next.js does not automatically serve files written
 * at runtime to public/uploads/ (the static manifest is baked at build time),
 * so the API route reads directly from disk and works correctly with a Docker
 * volume mount at /app/public/uploads.
 */
const AVATAR_URL_PREFIX = '/api/uploads';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives the file extension from the MIME type.
 * Falls back to `.jpg` for image/jpeg so the persisted filename is
 * always one of: `.jpg` | `.png`.
 */
function extensionForMime(mime: string): string {
  return mime === 'image/png' ? '.png' : '.jpg';
}

/**
 * Generates a unique filename: `<timestamp>-<6-char random hex><ext>`.
 * Example: `1717000000000-a3f9c2.png`
 */
function generateFilename(ext: string): string {
  const ts = Date.now();
  const rnd = Math.random().toString(16).slice(2, 8);
  return `${ts}-${rnd}${ext}`;
}

/**
 * Deletes a previously stored avatar from disk.
 * The `avatarUrl` stored in the DB is a relative path such as
 * `/api/uploads/1717000000000-a3f9c2.png`; `path.basename` extracts the filename
 * component, which is then joined with `UPLOADS_DIR` to form the absolute
 * filesystem path for `fs.unlink`.
 *
 * Security: `path.basename` neutralises path-traversal sequences (e.g.
 * `/../../../etc/passwd` becomes `passwd`).  The subsequent guard ensures the
 * resolved path sits strictly *inside* `UPLOADS_DIR` — never equal to the
 * directory itself (which would happen if `basename` returned an empty string).
 *
 * Errors are swallowed — a missing file must not block a new upload.
 */
async function deletePreviousAvatar(avatarUrl: string): Promise<void> {
  try {
    const filename = path.basename(avatarUrl);
    // An empty filename means avatarUrl had no meaningful file component
    // (e.g. it was an empty string).  Nothing to delete.
    if (!filename) {
      return;
    }
    // Resolve the absolute filesystem path inside the uploads directory.
    // This must NOT be used to call fs.unlink directly on UPLOADS_DIR itself.
    const filePath = path.join(UPLOADS_DIR, filename);
    // Guard: only proceed if the resolved path sits strictly inside UPLOADS_DIR.
    // `startsWith(UPLOADS_DIR + sep)` rejects both the directory itself and any
    // path that escapes it (defense-in-depth after basename neutralisation).
    if (!filePath.startsWith(UPLOADS_DIR + path.sep)) {
      return;
    }
    await fs.unlink(filePath);
  } catch {
    // File may have been manually removed — not a fatal error
  }
}

// ---------------------------------------------------------------------------
// POST /api/settings/avatar
// ---------------------------------------------------------------------------

export const POST = requireAuth(async (request: NextRequest, ctx: AuthContext) => {
  try {
    const { userId } = ctx.auth;

    // ---- Parse multipart form data ----------------------------------------
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: 'Invalid multipart/form-data request' }, { status: 400 });
    }

    const file = formData.get('image') as File | null;
    if (!file || typeof file === 'string') {
      return NextResponse.json(
        { error: 'No image file provided. Send a multipart/form-data request with an "image" field.' },
        { status: 400 }
      );
    }

    // ---- Validate MIME type ------------------------------------------------
    // Check the MIME type reported by the browser first, then fall back to
    // the file extension so the validation is not trivially bypassed by
    // renaming a file.
    const mime = file.type.toLowerCase();
    const ext = path.extname(file.name).toLowerCase();

    if (!ALLOWED_MIME_TYPES.has(mime) && !ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only JPG and PNG images are accepted.' },
        { status: 400 }
      );
    }

    // Prefer the MIME-derived extension; fall back to the filename extension.
    const resolvedExt = ALLOWED_MIME_TYPES.has(mime) ? extensionForMime(mime) : ext;

    // ---- Validate file size ------------------------------------------------
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File too large. Maximum allowed size is 2 MB.' },
        { status: 400 }
      );
    }

    // ---- Ensure the uploads directory exists --------------------------------
    await fs.mkdir(UPLOADS_DIR, { recursive: true });

    // ---- Fetch current settings to find any existing avatar -----------------
    const currentSettings = await prisma.settings.findUnique({
      where: { ownerId: userId },
      select: { avatarUrl: true },
    });

    // ---- Save file to disk --------------------------------------------------
    const filename = generateFilename(resolvedExt);
    const filePath = path.join(UPLOADS_DIR, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    // ---- Upsert settings with the new avatarUrl ----------------------------
    // Store the /api/uploads/<filename> URL so the file is served through the
    // dedicated API route, which reads from disk at request time and therefore
    // works correctly in Docker with a runtime volume mount.
    const avatarUrl = `${AVATAR_URL_PREFIX}/${filename}`;

    await prisma.settings.upsert({
      where: { ownerId: userId },
      update: { avatarUrl },
      create: {
        ownerId: userId,
        cloneName: 'My Second Self',
        systemPrompt: '',
        tone: 'natural',
        responseLength: 'balanced',
        avatarUrl,
      },
    });

    // ---- Delete the previous avatar after the DB is updated ----------------
    if (currentSettings?.avatarUrl) {
      await deletePreviousAvatar(currentSettings.avatarUrl);
    }

    return NextResponse.json({ avatarUrl }, { status: 200 });
  } catch (error: any) {
    console.error('Avatar upload error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to upload avatar' },
      { status: 500 }
    );
  }
});
