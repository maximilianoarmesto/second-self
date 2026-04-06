// ---------------------------------------------------------------------------
// Document status — mirrors backend DocumentStatus enum
// ---------------------------------------------------------------------------

export type DocumentStatus = 'pending' | 'processing' | 'completed' | 'failed';

// ---------------------------------------------------------------------------
// API response shapes — mirror backend Pydantic schemas
// ---------------------------------------------------------------------------

export interface DocumentChunk {
  id: number;
  document_id: number;
  chunk_index: number;
  page_number: number;
  content: string;
  created_at: string;
}

export interface DocumentSummary {
  id: number;
  user_id: number;
  filename: string;
  original_filename: string;
  file_size: number;
  page_count: number | null;
  status: DocumentStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentDetail extends DocumentSummary {
  chunks: DocumentChunk[];
}

export interface DocumentUploadResponse {
  id: number;
  filename: string;
  original_filename: string;
  file_size: number;
  status: DocumentStatus;
  created_at: string;
}
