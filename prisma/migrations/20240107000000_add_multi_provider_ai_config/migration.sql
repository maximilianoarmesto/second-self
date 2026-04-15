-- Migration: add_multi_provider_ai_config
--
-- Extends the settings table with four new columns to support configuring
-- multiple AI providers (OpenAI and Anthropic):
--
--   anthropic_api_key  — nullable TEXT, stores the Anthropic API key
--                        (masked in API responses, same treatment as
--                        openai_api_key_encrypted).
--   ai_provider        — non-nullable enum (openai | anthropic), defaults
--                        to 'openai' so existing rows are unaffected.
--   openai_model       — nullable TEXT, defaults to 'gpt-4o'.
--   anthropic_model    — nullable TEXT, defaults to 'claude-3-5-sonnet-20241022'.
--
-- All four columns are added with IF NOT EXISTS / DEFAULT so the migration
-- is safe to re-run and leaves existing rows consistent without a backfill.

-- 1. Create the ai_provider enum type (Postgres requires the type to exist
--    before it can be referenced in a column definition).
DO $$ BEGIN
  CREATE TYPE "ai_provider" AS ENUM ('openai', 'anthropic');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Add the new columns to the settings table.
ALTER TABLE "settings"
  ADD COLUMN IF NOT EXISTS "anthropic_api_key"  TEXT,
  ADD COLUMN IF NOT EXISTS "ai_provider"         "ai_provider" NOT NULL DEFAULT 'openai',
  ADD COLUMN IF NOT EXISTS "openai_model"        TEXT DEFAULT 'gpt-4o',
  ADD COLUMN IF NOT EXISTS "anthropic_model"     TEXT DEFAULT 'claude-3-5-sonnet-20241022';
