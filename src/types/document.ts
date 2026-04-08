export type DocumentStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface DocumentChunk {
  id: number;
  documentId: number;
  chunkIndex: number;
  pageNumber: number;
  /** Human-readable document title derived from the original filename. */
  documentTitle: string;
  content: string;
  createdAt: string;
}

export interface DocumentSummary {
  id: number;
  ownerId: number;
  filename: string;
  originalFilename: string;
  fileSize: number;
  pageCount: number | null;
  status: DocumentStatus;
  errorMessage: string | null;
  /** True when the raw PDF bytes are stored and re-processing is available. */
  canReprocess: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDetail extends DocumentSummary {
  chunks: DocumentChunk[];
}

export interface DocumentUploadResponse {
  id: number;
  filename: string;
  originalFilename: string;
  fileSize: number;
  status: DocumentStatus;
  createdAt: string;
}

/** Returned by POST /api/documents/:id when re-processing is queued. */
export type ReprocessResponse = DocumentUploadResponse;
