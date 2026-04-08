-- Add avatar_url column to settings table.
-- Stores the relative URL of the uploaded avatar image so the client can
-- display it without an additional lookup.  Nullable because existing rows
-- do not have an avatar yet.

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "avatar_url" TEXT;
