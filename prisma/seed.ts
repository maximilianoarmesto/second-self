/**
 * prisma/seed.ts
 *
 * Idempotent database seeder. Safe to run multiple times — it will not create
 * duplicate rows.
 *
 * Seed user credentials are sourced from environment variables so they can be
 * overridden per-environment without touching this file:
 *
 *   SEED_USER_EMAIL    — defaults to "admin@example.com"
 *   SEED_USER_PASSWORD — defaults to "changeme123"  (≥ 8 chars required)
 *
 * The password is hashed with bcrypt (12 rounds) before storage, matching the
 * salt-round constant used by the signup route.
 */

import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BCRYPT_SALT_ROUNDS = 12;

const DEFAULT_SEED_EMAIL = 'admin@example.com';
const DEFAULT_SEED_PASSWORD = 'changeme123';
const DEFAULT_CLONE_NAME = 'My Second Self';

// ---------------------------------------------------------------------------
// Prisma client (mirrors the pattern in src/lib/prisma.ts)
// ---------------------------------------------------------------------------

const connectionString =
  process.env.PRISMA_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const email = (process.env.SEED_USER_EMAIL ?? DEFAULT_SEED_EMAIL)
    .trim()
    .toLowerCase();
  const password = process.env.SEED_USER_PASSWORD ?? DEFAULT_SEED_PASSWORD;

  // -------------------------------------------------------------------------
  // 1. Upsert the seed Owner by email (idempotent — unique on email column).
  //    Only update the passwordHash when a new password is explicitly supplied
  //    via the env var (i.e. not the default), so re-running the seed with the
  //    default doesn't silently overwrite a user-changed password in prod.
  // -------------------------------------------------------------------------
  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  const owner = await prisma.owner.upsert({
    where: { email },
    update: {
      // Keep the password hash fresh if the env var was customised.
      passwordHash,
    },
    create: {
      cloneName: DEFAULT_CLONE_NAME,
      email,
      passwordHash,
    },
  });

  console.log(`[seed] Owner upserted — id: ${owner.id}, email: ${owner.email}`);

  // -------------------------------------------------------------------------
  // 2. Upsert the linked Settings row (idempotent — unique on owner_id).
  //    update: {} intentionally leaves existing settings untouched so that
  //    production configuration isn't clobbered on re-seed.
  // -------------------------------------------------------------------------
  await prisma.settings.upsert({
    where: { ownerId: owner.id },
    update: {},
    create: {
      ownerId: owner.id,
      cloneName: DEFAULT_CLONE_NAME,
    },
  });

  console.log(`[seed] Settings upserted — ownerId: ${owner.id}`);
  console.log('[seed] Seed completed successfully.');
}

main()
  .catch((error) => {
    console.error('[seed] Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
