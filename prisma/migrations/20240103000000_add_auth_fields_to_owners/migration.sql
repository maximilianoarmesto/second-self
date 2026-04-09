-- Migration: add_auth_fields_to_owners
--
-- Adds email (unique) and password_hash columns to the owners table so that
-- the single-owner can authenticate via the sign-up / login flow.
-- Both columns are nullable so that existing rows (seeded without credentials)
-- remain valid without a backfill.

ALTER TABLE "owners"
  ADD COLUMN IF NOT EXISTS "email" TEXT;

ALTER TABLE "owners"
  ADD COLUMN IF NOT EXISTS "password_hash" TEXT;

-- Unique constraint on email — enforced at the DB level to prevent duplicate
-- accounts even under concurrent requests.
CREATE UNIQUE INDEX IF NOT EXISTS "owners_email_key" ON "owners"("email");
