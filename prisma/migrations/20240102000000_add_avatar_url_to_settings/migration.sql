-- Migration: add_avatar_url_to_settings
--
-- Adds an optional avatar_url column to the settings table so that
-- the owner's avatar image path can be persisted after upload.

ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "avatar_url" TEXT;
