export type DocumentStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface DocumentChunk {
  id: number;
  documentId: number;
  chunkIndex: number;
  pageNumber: number;
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
