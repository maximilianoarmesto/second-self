import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png'] as const;
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB
const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');
const UPLOADS_URL_PREFIX = '/uploads';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true when the MIME type and file extension are both JPG or PNG. */
function isAllowedImage(file: File): boolean {
  const mime = file.type as string;
  const ext = path.extname(file.name).toLowerCase();
  return (
    (ALLOWED_MIME_TYPES as readonly string[]).includes(mime) &&
    (ALLOWED_EXTENSIONS as readonly string[]).includes(ext)
  );
}

/**
 * Builds a unique filename for the uploaded avatar, e.g.
 * "avatar-1718123456789-a3f9.png"
 */
function buildUniqueFilename(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  const randomSuffix = Math.random().toString(36).slice(2, 6);
  return `avatar-${Date.now()}-${randomSuffix}${ext}`;
}

/**
 * Removes a previously stored avatar file from disk.
 * Failures are logged but never thrown — a missing old file must not block
 * the upload of the new one.
 */
async function deletePreviousAvatar(avatarUrl: string | null): Promise<void> {
  if (!avatarUrl) return;

  // Only delete files that live inside our uploads directory.
  if (!avatarUrl.startsWith(UPLOADS_URL_PREFIX + '/')) return;

  const filename = path.basename(avatarUrl);
  const filePath = path.join(UPLOADS_DIR, filename);

  try {
    await fs.unlink(filePath);
  } catch (err: any) {
    // ENOENT → file already gone; any other error is unexpected but non-fatal.
    if (err?.code !== 'ENOENT') {
      console.error('Failed to delete previous avatar:', filePath, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    // ── 1. Parse multipart/form-data ───────────────────────────────────────
    const formData = await request.formData();
    const file = formData.get('image') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No image file provided' }, { status: 400 });
    }

    // ── 2. Validate file type ──────────────────────────────────────────────
    if (!isAllowedImage(file)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only JPG and PNG images are accepted.' },
        { status: 400 }
      );
    }

    // ── 3. Validate file size ──────────────────────────────────────────────
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File size exceeds the 2 MB limit.' },
        { status: 400 }
      );
    }

    // ── 4. Ensure uploads directory exists ────────────────────────────────
    await fs.mkdir(UPLOADS_DIR, { recursive: true });

    // ── 5. Fetch current settings to get any existing avatar URL ──────────
    const existingSettings = await prisma.settings.findUnique({
      where: { ownerId: 1 },
      select: { avatarUrl: true },
    });

    // ── 6. Write new file to disk ──────────────────────────────────────────
    const filename = buildUniqueFilename(file.name);
    const filePath = path.join(UPLOADS_DIR, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    // ── 7. Delete the old avatar (best-effort, after new file is written) ──
    await deletePreviousAvatar(existingSettings?.avatarUrl ?? null);

    // ── 8. Persist the relative URL in the settings record ────────────────
    const avatarUrl = `${UPLOADS_URL_PREFIX}/${filename}`;

    // Ensure the owner row exists before upserting settings (FK constraint).
    await prisma.owner.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, cloneName: 'My Second Self' },
    });

    await prisma.settings.upsert({
      where: { ownerId: 1 },
      update: { avatarUrl },
      create: {
        ownerId: 1,
        cloneName: 'My Second Self',
        avatarUrl,
      },
    });

    // ── 9. Return the saved URL ────────────────────────────────────────────
    return NextResponse.json({ avatarUrl }, { status: 201 });
  } catch (error: any) {
    console.error('Avatar upload error:', error);
    return NextResponse.json(
      { error: error.message || 'Avatar upload failed' },
      { status: 500 }
    );
  }
}
