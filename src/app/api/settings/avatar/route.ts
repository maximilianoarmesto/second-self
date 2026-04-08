import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png']);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');

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
 * The `avatarUrl` stored in the DB is a relative public path such as
 * `/uploads/1717000000000-a3f9c2.png`; we strip the leading `/uploads/`
 * to resolve the absolute path.
 * Errors are swallowed — a missing file must not block a new upload.
 */
async function deletePreviousAvatar(avatarUrl: string): Promise<void> {
  try {
    const filename = path.basename(avatarUrl);
    // Guard against path-traversal: only delete files directly inside UPLOADS_DIR
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!filePath.startsWith(UPLOADS_DIR + path.sep) && filePath !== UPLOADS_DIR) {
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

export async function POST(request: NextRequest) {
  try {
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
      where: { ownerId: 1 },
      select: { avatarUrl: true },
    });

    // ---- Save file to disk --------------------------------------------------
    const filename = generateFilename(resolvedExt);
    const filePath = path.join(UPLOADS_DIR, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    // ---- Upsert settings with the new avatarUrl ----------------------------
    const avatarUrl = `/uploads/${filename}`;

    await prisma.settings.upsert({
      where: { ownerId: 1 },
      update: { avatarUrl },
      create: {
        ownerId: 1,
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
}
