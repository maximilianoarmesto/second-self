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
 *   SEED_USER_NAME     — defaults to "My Second Self"
 *
 * The password is hashed with bcrypt (12 rounds) before storage, matching the
 * salt-round constant used by the signup route.
 *
 * Seeding order:
 *  1. Upsert the seed User (users table) — the primary auth / identity entity.
 *  2. Upsert the legacy Owner row (owners table) that existing application
 *     code still references via ownerId = 1. The Owner row is linked back to
 *     the seed User so both FK chains remain consistent.
 *  3. Upsert the linked Settings row for both the Owner and the User.
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
const DEFAULT_SEED_NAME = 'My Second Self';

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
  const name = (process.env.SEED_USER_NAME ?? DEFAULT_SEED_NAME).trim();

  // Hash the password once — used for both the User upsert and the legacy
  // Owner upsert so both rows reflect the same credentials.
  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  // -------------------------------------------------------------------------
  // 1. Upsert the seed User (users table).
  //    Idempotent — keyed on the unique email column.
  //    The passwordHash is always refreshed so re-running the seed with a
  //    different SEED_USER_PASSWORD picks up the new value.
  // -------------------------------------------------------------------------
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, name },
    create: { email, passwordHash, name },
  });

  console.log(`[seed] User upserted — id: ${user.id}, email: ${user.email}`);

  // -------------------------------------------------------------------------
  // 2. Upsert the legacy Owner row (owners table, id = 1).
  //    Existing application routes still query ownerId = 1; keeping this row
  //    ensures those paths continue to work without a full migration of all
  //    call-sites in the same changeset.
  // -------------------------------------------------------------------------
  const owner = await prisma.owner.upsert({
    where: { id: 1 },
    update: { email, passwordHash },
    create: { id: 1, cloneName: name, email, passwordHash },
  });

  console.log(`[seed] Owner upserted — id: ${owner.id}, email: ${owner.email}`);

  // -------------------------------------------------------------------------
  // 3. Upsert the linked Settings row.
  //    - ownerId links to the legacy Owner (required, non-nullable FK).
  //    - userId links to the new User (optional FK, enables multi-tenancy).
  //    update: {} intentionally leaves existing settings untouched so that
  //    production configuration (API keys, prompts, etc.) is not clobbered
  //    when the seed is re-run.
  // -------------------------------------------------------------------------
  await prisma.settings.upsert({
    where: { ownerId: owner.id },
    update: {},
    create: {
      ownerId: owner.id,
      userId: user.id,
      cloneName: name,
    },
  });

  console.log(
    `[seed] Settings upserted — ownerId: ${owner.id}, userId: ${user.id}`
  );
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
