-- Add document_title column to document_chunks table.
-- Stores the human-readable document title alongside each chunk so that
-- retrieval results can surface richer source citations without an extra
-- JOIN to the documents table.
--
-- The column is NOT NULL with an empty-string default so existing rows are
-- automatically backfilled and application code can always rely on a string
-- value being present.

ALTER TABLE "document_chunks"
  ADD COLUMN IF NOT EXISTS "document_title" TEXT NOT NULL DEFAULT '';
