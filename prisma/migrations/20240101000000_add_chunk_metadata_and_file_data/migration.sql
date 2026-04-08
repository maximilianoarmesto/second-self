-- Migration: add_chunk_metadata_and_file_data
--
-- 1. Store raw PDF bytes on documents so existing documents can be
--    re-processed with an updated chunking strategy.
-- 2. Add document_title to document_chunks so each chunk carries rich
--    source-citation metadata without an extra JOIN at query time.

-- Add file_data column to documents (nullable so existing rows are unaffected)
ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "file_data" BYTEA;

-- Add document_title column to document_chunks (defaults to '' so existing
-- rows remain consistent and no backfill is required)
ALTER TABLE "document_chunks"
  ADD COLUMN IF NOT EXISTS "document_title" TEXT NOT NULL DEFAULT '';
