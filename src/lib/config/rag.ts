/**
 * RAG retrieval configuration constants.
 * Centralised here for easy tuning without touching service code.
 */

/** Maximum number of document chunks to retrieve per query. */
export const MAX_CHUNKS = 5;

/** Minimum cosine similarity threshold (0–1). Chunks below this are discarded. */
export const MIN_SIMILARITY_THRESHOLD = 0.0;
