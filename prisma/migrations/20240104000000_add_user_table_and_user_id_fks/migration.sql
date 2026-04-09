-- Migration: add_user_table_and_user_id_fks
--
-- Introduces a first-class `users` table for authentication and multi-tenancy.
-- A nullable `user_id` foreign key is added to every user-scoped table
-- (settings, documents, chat_sessions, share_links) so rows can be linked to
-- the new User entity while the existing owner_id / owners FK relationship
-- remains intact for backwards compatibility.
--
-- All new columns are nullable (no NOT NULL) and have no default value so
-- that existing rows are unaffected and no data backfill is required.

-- ---------------------------------------------------------------------------
-- 1. Create the users table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "users" (
  "id"            SERIAL       PRIMARY KEY,
  "email"         TEXT         NOT NULL,
  "password_hash" TEXT         NOT NULL,
  "name"          TEXT         NOT NULL,
  "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Unique constraint on email — enforced at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");

-- ---------------------------------------------------------------------------
-- 2. Add user_id to settings
-- ---------------------------------------------------------------------------

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "user_id" INTEGER;

ALTER TABLE "settings"
  ADD CONSTRAINT "settings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    NOT VALID;

ALTER TABLE "settings" VALIDATE CONSTRAINT "settings_user_id_fkey";

-- Unique index — each user has at most one Settings row.
CREATE UNIQUE INDEX IF NOT EXISTS "settings_user_id_key" ON "settings"("user_id");

-- ---------------------------------------------------------------------------
-- 3. Add user_id to documents
-- ---------------------------------------------------------------------------

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "user_id" INTEGER;

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    NOT VALID;

ALTER TABLE "documents" VALIDATE CONSTRAINT "documents_user_id_fkey";

CREATE INDEX IF NOT EXISTS "documents_user_id_idx" ON "documents"("user_id");

-- ---------------------------------------------------------------------------
-- 4. Add user_id to chat_sessions
-- ---------------------------------------------------------------------------

ALTER TABLE "chat_sessions"
  ADD COLUMN IF NOT EXISTS "user_id" INTEGER;

ALTER TABLE "chat_sessions"
  ADD CONSTRAINT "chat_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    NOT VALID;

ALTER TABLE "chat_sessions" VALIDATE CONSTRAINT "chat_sessions_user_id_fkey";

CREATE INDEX IF NOT EXISTS "chat_sessions_user_id_idx" ON "chat_sessions"("user_id");

-- ---------------------------------------------------------------------------
-- 5. Add user_id to share_links
-- ---------------------------------------------------------------------------

ALTER TABLE "share_links"
  ADD COLUMN IF NOT EXISTS "user_id" INTEGER;

ALTER TABLE "share_links"
  ADD CONSTRAINT "share_links_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    NOT VALID;

ALTER TABLE "share_links" VALIDATE CONSTRAINT "share_links_user_id_fkey";

CREATE INDEX IF NOT EXISTS "share_links_user_id_idx" ON "share_links"("user_id");
