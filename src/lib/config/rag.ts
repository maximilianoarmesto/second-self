/**
 * RAG retrieval configuration constants.
 * Centralised here for easy tuning without touching service code.
 */

/** Maximum number of document chunks to retrieve per query. */
export const MAX_CHUNKS = 5;

/** Minimum cosine similarity threshold (0–1). Chunks below this are discarded. */
export const MIN_SIMILARITY_THRESHOLD = 0.3;

/** Maximum number of prior conversation messages to include in each OpenAI request. */
export const MAX_HISTORY_MESSAGES = 20;

/**
 * Maximum total character budget for the prompt sent to the model.
 * Used to truncate conversation history when the window would exceed context limits.
 */
export const MAX_PROMPT_CHARS = 12_000;

/** Target character length for each text chunk produced by the chunker. */
export const CHUNK_SIZE = 1_000;

/**
 * Number of characters that overlap between consecutive chunks.
 * Must be strictly less than CHUNK_SIZE.
 */
export const CHUNK_OVERLAP = 200;
