-- Migration: migrate_avatar_url_to_api_uploads
--
-- Rewrites all existing `avatar_url` values in the settings table that were
-- saved with the legacy `/uploads/<filename>` path to the new
-- `/api/uploads/<filename>` path used by the dedicated file-serving API route.
--
-- Background:
--   The avatar upload endpoint previously stored relative URLs as
--   `/uploads/<filename>`, relying on Next.js static file serving from the
--   `public/uploads/` directory.  In the Docker standalone build, files
--   written at runtime are not covered by the static-file manifest baked at
--   build time, so a dedicated API route (`/api/uploads/[filename]`) was
--   introduced.  The upload endpoint was updated to save `/api/uploads/...`
--   paths, but any rows persisted before that change still hold the old prefix
--   and would resolve to broken URLs.  This migration backfills those rows.
--
-- Safety properties:
--   • Only rows whose `avatar_url` starts with `/uploads/` are touched;
--     NULL values and already-correct `/api/uploads/...` values are unchanged.
--   • REPLACE() is a pure string substitution — running this migration twice
--     leaves already-migrated rows intact because `/api/uploads/` does not
--     match the `/uploads/` prefix in a way that would double-replace.
--     (LIKE '/uploads/%' guards against any match that doesn't begin with
--      the exact legacy prefix, so idempotency is guaranteed.)

UPDATE "settings"
SET    "avatar_url" = REPLACE("avatar_url", '/uploads/', '/api/uploads/')
WHERE  "avatar_url" LIKE '/uploads/%';
