'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, FileText, Loader2, Upload, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DocumentStatusBadge } from '@/components/documents/DocumentStatusBadge';
import { apiFetch, getStoredApiKey } from '@/lib/api';
import type { DocumentStatus, DocumentUploadResponse } from '@/types/document';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UploadFile {
  id: string;
  file: File;
  progress: number;
  state: 'idle' | 'uploading' | 'success' | 'error';
  result: DocumentUploadResponse | null;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_MB = 50;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ACCEPTED_TYPES = ['application/pdf'];

/** Interval (ms) to poll individual document status while PENDING / PROCESSING. */
const STATUS_POLL_INTERVAL_MS = 4000;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createUploadFile(file: File): UploadFile {
  return {
    id: `${file.name}-${Date.now()}-${Math.random()}`,
    file,
    progress: 0,
    state: 'idle',
    result: null,
    errorMessage: null,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function UploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // ---- File selection ----

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const valid: UploadFile[] = [];
    const fileArray = Array.from(incoming);

    for (const file of fileArray) {
      if (!ACCEPTED_TYPES.includes(file.type) && !file.name.toLowerCase().endsWith('.pdf')) {
        continue; // silently skip non-PDF files
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        valid.push({
          ...createUploadFile(file),
          state: 'error',
          errorMessage: `File exceeds the ${MAX_FILE_SIZE_MB} MB limit.`,
        });
        continue;
      }
      valid.push(createUploadFile(file));
    }

    setFiles((prev) => [...prev, ...valid]);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = '';
    }
  };

  // ---- Drag-and-drop ----

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  // ---- Upload using XMLHttpRequest for progress ----

  const uploadFile = async (uploadItem: UploadFile) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === uploadItem.id ? { ...f, state: 'uploading', progress: 0 } : f))
    );

    const formData = new FormData();
    formData.append('file', uploadItem.file);

    try {
      const result = await new Promise<DocumentUploadResponse>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/documents/upload');

        // Set API key header if available
        const apiKey = getStoredApiKey();
        if (apiKey) {
          xhr.setRequestHeader('x-openai-api-key', apiKey);
        }

        // Track upload progress
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const pct = Math.round((event.loaded / event.total) * 100);
            setFiles((prev) =>
              prev.map((f) => (f.id === uploadItem.id ? { ...f, progress: pct } : f))
            );
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch {
              reject(new Error('Invalid response from server'));
            }
          } else {
            try {
              const body = JSON.parse(xhr.responseText);
              reject(new Error(body.error || body.detail || `Upload failed (${xhr.status})`));
            } catch {
              reject(new Error(`Upload failed (${xhr.status})`));
            }
          }
        };

        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(formData);
      });

      setFiles((prev) =>
        prev.map((f) =>
          f.id === uploadItem.id
            ? { ...f, state: 'success', progress: 100, result }
            : f
        )
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setFiles((prev) =>
        prev.map((f) =>
          f.id === uploadItem.id ? { ...f, state: 'error', errorMessage: message } : f
        )
      );
    }
  };

  const uploadAll = () => {
    // Warn early if there is no API key — the server will reject the request
    // anyway, but surfacing the error before XHR starts is cleaner UX.
    if (!getStoredApiKey()) {
      setFiles((prev) =>
        prev.map((f) =>
          f.state === 'idle'
            ? {
                ...f,
                state: 'error',
                errorMessage:
                  'OpenAI API key is required. Please configure it in Settings before uploading.',
              }
            : f
        )
      );
      return;
    }
    const pending = files.filter((f) => f.state === 'idle');
    pending.forEach(uploadFile);
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // ---- Poll status for successfully-uploaded but still-processing documents ----
  //
  // After upload, the server returns status PENDING and begins ingestion
  // asynchronously.  We poll individual document status endpoints until
  // every uploaded doc reaches a terminal state (COMPLETED or FAILED).

  useEffect(() => {
    // Collect files that were uploaded but still awaiting terminal status.
    const inProgress = files.filter(
      (f) =>
        f.state === 'success' &&
        f.result !== null &&
        (f.result.status === 'PENDING' || f.result.status === 'PROCESSING')
    );

    if (inProgress.length === 0) return;

    const timer = setTimeout(async () => {
      // Fetch the list (returns summaries without chunks — lighter than GET /id).
      let allDocs: Array<{ id: number; status: DocumentStatus }> = [];
      try {
        allDocs = await apiFetch<Array<{ id: number; status: DocumentStatus }>>('/api/documents');
      } catch {
        // If the list fetch fails, leave statuses unchanged and retry next tick.
        return;
      }

      const updates: Array<{ id: string; status: DocumentStatus }> = inProgress.map((f) => {
        const match = allDocs.find((d) => d.id === f.result!.id);
        return { id: f.id, status: match ? match.status : f.result!.status };
      });

      setFiles((prev) =>
        prev.map((f) => {
          const update = updates.find((u) => u.id === f.id);
          if (!update || !f.result) return f;
          return { ...f, result: { ...f.result, status: update.status } };
        })
      );
    }, STATUS_POLL_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [files]);

  // ---- Derived state ----

  const pendingCount = files.filter((f) => f.state === 'idle').length;
  const uploadingCount = files.filter((f) => f.state === 'uploading').length;
  const successCount = files.filter((f) => f.state === 'success').length;
  const isUploading = uploadingCount > 0;

  return (
    <main className="container mx-auto p-6 max-w-3xl">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <Link href="/knowledge-base">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back to Knowledge Base
          </Button>
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-black">Upload Documents</h1>
        <p className="mt-1 text-gray-500">
          Upload PDF files to add them to your knowledge base. Maximum file size is{' '}
          {MAX_FILE_SIZE_MB}&nbsp;MB per file.
        </p>
      </div>

      {/* Drop zone */}
      <Card
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`mb-6 cursor-pointer border-2 border-dashed transition-colors ${
          isDragging
            ? 'border-black bg-gray-50'
            : 'border-gray-200 hover:border-gray-400'
        }`}
        onClick={() => inputRef.current?.click()}
      >
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <Upload
            className={`mb-4 h-10 w-10 transition-colors ${
              isDragging ? 'text-black' : 'text-gray-400'
            }`}
          />
          <p className="text-sm font-medium text-black">
            {isDragging ? 'Drop your PDF files here' : 'Drag & drop PDF files here'}
          </p>
          <p className="mt-1 text-xs text-gray-500">or click to browse</p>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            className="hidden"
            onChange={handleInputChange}
          />
        </CardContent>
      </Card>

      {/* File list */}
      {files.length > 0 && (
        <div className="space-y-3 mb-6">
          {files.map((item) => (
            <FileRow key={item.id} item={item} onRemove={removeFile} onRetry={uploadFile} />
          ))}
        </div>
      )}

      {/* Actions */}
      {files.length > 0 && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-gray-500">
            {successCount > 0 && `${successCount} uploaded \u00b7 `}
            {pendingCount > 0 && `${pendingCount} ready to upload`}
            {isUploading && `Uploading ${uploadingCount} file${uploadingCount > 1 ? 's' : ''}...`}
          </p>
          <div className="flex gap-3">
            {successCount > 0 && (
              <Button variant="outline" onClick={() => router.push('/knowledge-base')}>
                View Knowledge Base
              </Button>
            )}
            {pendingCount > 0 && (
              <Button onClick={uploadAll} disabled={isUploading} className="gap-2">
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Upload {pendingCount} file{pendingCount > 1 ? 's' : ''}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {files.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Supported formats</CardTitle>
            <CardDescription>
              Only PDF files are accepted. Text will be extracted and embedded for semantic search.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// FileRow sub-component
// ---------------------------------------------------------------------------

interface FileRowProps {
  item: UploadFile;
  onRemove: (id: string) => void;
  onRetry: (item: UploadFile) => void;
}

function FileRow({ item, onRemove, onRetry }: FileRowProps) {
  const isProcessing =
    item.state === 'success' &&
    item.result !== null &&
    (item.result.status === 'PENDING' || item.result.status === 'PROCESSING');

  return (
    <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      {/* Icon */}
      <div className="flex-shrink-0 mt-0.5">
        {item.state === 'uploading' ? (
          <Loader2 className="h-5 w-5 animate-spin text-black" />
        ) : item.state === 'success' ? (
          <CheckCircle2 className="h-5 w-5 text-black" />
        ) : item.state === 'error' ? (
          <XCircle className="h-5 w-5 text-black" />
        ) : (
          <FileText className="h-5 w-5 text-gray-400" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium text-black">{item.file.name}</p>
        <p className="text-xs text-gray-500">{formatFileSize(item.file.size)}</p>

        {/* Progress bar */}
        {item.state === 'uploading' && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-black transition-all duration-300"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        )}

        {/* Result status */}
        {item.state === 'success' && item.result && (
          <div className="mt-1.5 flex items-center gap-2">
            <DocumentStatusBadge status={item.result.status} />
            {isProcessing && (
              <span className="text-xs text-gray-500">Processing&hellip;</span>
            )}
          </div>
        )}

        {/* Error message */}
        {item.state === 'error' && item.errorMessage && (
          <p className="mt-1 text-xs text-black">{item.errorMessage}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex-shrink-0 flex gap-2">
        {item.state === 'error' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => onRetry({ ...item, state: 'idle', errorMessage: null })}
          >
            Retry
          </Button>
        )}
        {item.state !== 'uploading' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-gray-400 hover:text-black"
            onClick={() => onRemove(item.id)}
            aria-label="Remove file"
          >
            <XCircle className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
