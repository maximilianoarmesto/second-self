'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DocumentStatusBadge } from '@/components/documents/DocumentStatusBadge';
import { apiFetch, getStoredApiKey } from '@/lib/api';
import type { DocumentDetail, DocumentSummary } from '@/types/document';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Interval (ms) used to auto-poll when any document is still PENDING or PROCESSING. */
const POLL_INTERVAL_MS = 4000;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function KnowledgeBasePage() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detailMap, setDetailMap] = useState<Record<number, DocumentDetail>>({});
  const [detailLoading, setDetailLoading] = useState<Record<number, boolean>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [reprocessingId, setReprocessingId] = useState<number | null>(null);
  const [reprocessError, setReprocessError] = useState<string | null>(null);
  const reprocessInputRef = useRef<HTMLInputElement>(null);
  const reprocessTargetId = useRef<number | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Fetch list (silent = don't show spinner on background polls) ----

  const fetchDocuments = useCallback(async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
      setError(null);
    }
    try {
      const data = await apiFetch<DocumentSummary[]>('/api/documents');

      // Collect IDs of documents whose status has changed so we can
      // invalidate their cached detail entries.  We read the current
      // documents value via a functional updater to avoid a stale-closure
      // dependency, then apply both state updates in the same React batch.
      setDocuments((prev) => {
        const changedIds = new Set(
          data
            .filter((d) => {
              const old = prev.find((p) => p.id === d.id);
              return old && old.status !== d.status;
            })
            .map((d) => d.id)
        );

        // Invalidate detail cache for docs whose status changed.
        // This is intentionally a separate state update — React 18 batches
        // state updates that originate from the same event/microtask, so
        // this produces a single re-render alongside the documents update.
        if (changedIds.size > 0) {
          setDetailMap((detailPrev) => {
            const next = { ...detailPrev };
            changedIds.forEach((id) => delete next[id]);
            return next;
          });
        }

        return data;
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load documents. Please try again.';
      if (!silent) setError(message);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // ---- Auto-poll while any document is PENDING or PROCESSING ----
  useEffect(() => {
    const hasInProgress = documents.some(
      (d) => d.status === 'PENDING' || d.status === 'PROCESSING'
    );

    // Clear any existing timer before (re-)scheduling.
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    if (hasInProgress) {
      pollTimerRef.current = setTimeout(() => {
        fetchDocuments(true /* silent */);
      }, POLL_INTERVAL_MS);
    }

    return () => {
      if (pollTimerRef.current !== null) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [documents, fetchDocuments]);

  // ---- Expand / detail ----

  const toggleExpand = async (docId: number) => {
    if (expandedId === docId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(docId);

    // Fetch detail if not cached
    if (!detailMap[docId]) {
      setDetailLoading((prev) => ({ ...prev, [docId]: true }));
      try {
        const data = await apiFetch<DocumentDetail>(`/api/documents/${docId}`);
        setDetailMap((prev) => ({ ...prev, [docId]: data }));
      } catch {
        // Detail fetch failure is non-critical
      } finally {
        setDetailLoading((prev) => ({ ...prev, [docId]: false }));
      }
    }
  };

  // ---- Re-process ----

  const handleReprocess = async (docId: number) => {
    setReprocessingId(docId);
    setReprocessError(null);
    try {
      await apiFetch(`/api/documents/${docId}`, {
        method: 'POST',
      });
      // Optimistically mark as PENDING in the list so the user sees feedback
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === docId ? { ...d, status: 'PENDING' as const, errorMessage: null } : d
        )
      );
      // Invalidate cached detail for this document so it reloads fresh
      setDetailMap((prev) => {
        const next = { ...prev };
        delete next[docId];
        return next;
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Re-processing failed. Please try again.';
      setReprocessError(message);
    } finally {
      setReprocessingId(null);
    }
  };

  // ---- Delete ----

  const handleDelete = async (docId: number) => {
    setDeletingId(docId);
    try {
      await apiFetch(`/api/documents/${docId}`, { method: 'DELETE' });
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      setDetailMap((prev) => {
        const next = { ...prev };
        delete next[docId];
        return next;
      });
      if (expandedId === docId) setExpandedId(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete document.';
      setError(message);
    } finally {
      setDeletingId(null);
      setDeleteConfirm(null);
    }
  };

  // ---- Re-process ----

  /**
   * Triggered when the user picks a replacement PDF from the hidden file input.
   * Sends the file to `POST /api/documents/[documentId]` and refreshes the list.
   */
  const handleReprocessFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const docId = reprocessTargetId.current;
    const file = e.target.files?.[0];
    // Reset the input immediately so the same file can be re-selected later.
    e.target.value = '';

    if (!docId || !file) return;

    const apiKey = getStoredApiKey();
    if (!apiKey) {
      setError('OpenAI API key is required. Please configure it in Settings.');
      return;
    }

    setReprocessingId(docId);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`/api/documents/${docId}`, {
        method: 'POST',
        headers: { 'x-openai-api-key': apiKey },
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || `Re-processing failed (${response.status})`);
      }

      // Optimistically update status to PROCESSING in the list.
      setDocuments((prev) =>
        prev.map((d) => (d.id === docId ? { ...d, status: 'PROCESSING' } : d))
      );
      // Invalidate cached detail so the expanded view refreshes on next open.
      setDetailMap((prev) => {
        const next = { ...prev };
        delete next[docId];
        return next;
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Re-processing failed. Please try again.';
      setError(message);
    } finally {
      setReprocessingId(null);
      reprocessTargetId.current = null;
    }
  };

  const requestReprocess = (docId: number) => {
    reprocessTargetId.current = docId;
    reprocessInputRef.current?.click();
  };

  // ---- Render ----

  const hasInProgress = documents.some(
    (d) => d.status === 'PENDING' || d.status === 'PROCESSING'
  );

  return (
    <main className="container mx-auto p-6 max-w-4xl">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-black">Knowledge Base</h1>
          <p className="mt-1 text-gray-500">
            Manage your uploaded documents and their processing status.
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchDocuments()}
            disabled={isLoading}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Link href="/knowledge-base/upload">
            <Button size="sm" className="gap-2">
              <Upload className="w-4 h-4" />
              Upload
            </Button>
          </Link>
        </div>
      </div>

      {/* Auto-polling indicator */}
      {hasInProgress && !isLoading && (
        <div className="mb-4 flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
          <span>Checking processing status automatically&hellip;</span>
        </div>
      )}

      {/* Global error */}
      {(error || reprocessError) && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-black">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" />
          <div>
            <p className="font-medium">Error</p>
            <p className="mt-0.5">{error ?? reprocessError}</p>
          </div>
          <button
            onClick={() => {
              setError(null);
              setReprocessError(null);
            }}
            className="ml-auto flex-shrink-0 text-gray-500 hover:text-black"
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-20 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && documents.length === 0 && !error && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="mb-4 h-12 w-12 text-gray-400" />
            <CardTitle className="mb-2 text-lg">No documents yet</CardTitle>
            <CardDescription className="mb-6">
              Upload PDF files to build your knowledge base and enable AI-powered document
              retrieval.
            </CardDescription>
            <Link href="/knowledge-base/upload">
              <Button className="gap-2">
                <Upload className="w-4 h-4" />
                Upload your first document
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Hidden file input for re-processing — shared across all rows */}
      <input
        ref={reprocessInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={handleReprocessFileChange}
      />

      {/* Document list */}
      {!isLoading && documents.length > 0 && (
        <div className="space-y-3">
          {/* Stats bar */}
          <div className="flex flex-wrap gap-4 text-sm text-gray-500 mb-2">
            <span>
              {documents.length} document{documents.length !== 1 ? 's' : ''}
            </span>
            {[
              {
                label: 'completed',
                count: documents.filter((d) => d.status === 'COMPLETED').length,
              },
              {
                label: 'processing',
                count: documents.filter((d) => d.status === 'PROCESSING').length,
              },
              {
                label: 'pending',
                count: documents.filter((d) => d.status === 'PENDING').length,
              },
              {
                label: 'failed',
                count: documents.filter((d) => d.status === 'FAILED').length,
              },
            ]
              .filter((s) => s.count > 0)
              .map((s) => (
                <span key={s.label} className="capitalize">
                  &middot; {s.count} {s.label}
                </span>
              ))}
          </div>

          {documents.map((doc) => (
            <DocumentRow
              key={doc.id}
              doc={doc}
              isExpanded={expandedId === doc.id}
              detail={detailMap[doc.id] ?? null}
              isLoadingDetail={detailLoading[doc.id] ?? false}
              isDeleting={deletingId === doc.id}
              isReprocessing={reprocessingId === doc.id}
              deleteConfirmId={deleteConfirm}
              onToggle={() => toggleExpand(doc.id)}
              onDeleteRequest={() => setDeleteConfirm(doc.id)}
              onDeleteConfirm={() => handleDelete(doc.id)}
              onDeleteCancel={() => setDeleteConfirm(null)}
              onReprocess={() => requestReprocess(doc.id)}
            />
          ))}
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// DocumentRow sub-component
// ---------------------------------------------------------------------------

interface DocumentRowProps {
  doc: DocumentSummary;
  isExpanded: boolean;
  detail: DocumentDetail | null;
  isLoadingDetail: boolean;
  isDeleting: boolean;
  isReprocessing: boolean;
  deleteConfirmId: number | null;
  onToggle: () => void;
  onDeleteRequest: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
  onReprocess: () => void;
}

function DocumentRow({
  doc,
  isExpanded,
  detail,
  isLoadingDetail,
  isDeleting,
  isReprocessing,
  deleteConfirmId,
  onToggle,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
  onReprocess,
}: DocumentRowProps) {
  const isConfirmingDelete = deleteConfirmId === doc.id;
  const isBusy = isDeleting || isReprocessing || doc.status === 'PROCESSING';

  return (
    <Card className="overflow-hidden transition-shadow hover:shadow-md">
      {/* Summary row */}
      <div
        className="flex cursor-pointer items-center gap-4 p-4"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onToggle()}
        aria-expanded={isExpanded}
      >
        {/* Expand chevron */}
        <span className="flex-shrink-0 text-gray-400">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>

        {/* File icon */}
        <FileText className="h-5 w-5 flex-shrink-0 text-gray-400" />

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <p className="truncate font-medium text-sm text-black">{doc.originalFilename}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span>{formatFileSize(doc.fileSize)}</span>
            {doc.pageCount != null && (
              <span>
                {doc.pageCount} page{doc.pageCount !== 1 ? 's' : ''}
              </span>
            )}
            <span>{formatDate(doc.createdAt)}</span>
          </div>
        </div>

        {/* Status badge */}
        <div className="flex-shrink-0">
          <DocumentStatusBadge status={doc.status} />
        </div>

        {/* Action controls (re-process + delete) */}
        <div
          className="flex-shrink-0 flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          {isConfirmingDelete ? (
            <>
              <span className="text-xs text-black font-medium">Delete?</span>
              <Button
                variant="destructive"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={isBusy}
                onClick={onDeleteConfirm}
              >
                {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={isBusy}
                onClick={onDeleteCancel}
              >
                No
              </Button>
            </>
          ) : (
            <>
              {/* Re-process button — available for COMPLETED and FAILED docs */}
              {(doc.status === 'COMPLETED' || doc.status === 'FAILED') && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-gray-400 hover:text-black"
                  disabled={isBusy}
                  onClick={onReprocess}
                  aria-label="Re-process document"
                  title="Re-process: upload the PDF again to re-chunk with the latest settings"
                >
                  {isReprocessing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="h-4 w-4" />
                  )}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-gray-400 hover:text-black"
                disabled={isBusy}
                onClick={onDeleteRequest}
                aria-label="Delete document"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Error message when status is failed */}
      {doc.status === 'FAILED' && doc.errorMessage && (
        <div className="border-t border-gray-200 bg-gray-50 px-4 py-2">
          <p className="text-xs text-black">
            <span className="font-medium">Processing error: </span>
            {doc.errorMessage}
          </p>
        </div>
      )}

      {/* Expanded detail */}
      {isExpanded && (
        <div className="border-t border-gray-200 bg-gray-50 px-4 py-4">
          {isLoadingDetail ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading chunks...
            </div>
          ) : detail ? (
            <DocumentDetailPanel detail={detail} />
          ) : (
            <p className="text-sm text-gray-500">No detail available.</p>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// DocumentDetailPanel -- shows chunk preview
// ---------------------------------------------------------------------------

interface DocumentDetailPanelProps {
  detail: DocumentDetail;
}

function DocumentDetailPanel({ detail }: DocumentDetailPanelProps) {
  const [showAll, setShowAll] = useState(false);
  const PREVIEW_COUNT = 3;
  const chunks = detail.chunks;
  const visible = showAll ? chunks : chunks.slice(0, PREVIEW_COUNT);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-black">
          Extracted chunks <span className="font-normal text-gray-500">({chunks.length})</span>
        </h3>
      </div>

      {chunks.length === 0 ? (
        <p className="text-sm text-gray-500">No text chunks were extracted.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((chunk) => (
            <div
              key={chunk.id}
              className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-black"
            >
              <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-gray-500">
                <span className="font-medium">Chunk {chunk.chunkIndex + 1}</span>
                <span>&middot;</span>
                <span>Page {chunk.pageNumber}</span>
                {chunk.documentTitle && (
                  <>
                    <span>&middot;</span>
                    <span className="truncate max-w-[160px]" title={chunk.documentTitle}>
                      {chunk.documentTitle}
                    </span>
                  </>
                )}
              </div>
              <p className="line-clamp-3 leading-relaxed">{chunk.content}</p>
            </div>
          ))}

          {chunks.length > PREVIEW_COUNT && (
            <button
              onClick={() => setShowAll((s) => !s)}
              className="mt-1 text-xs text-black underline-offset-4 hover:underline"
            >
              {showAll ? 'Show less' : `Show all ${chunks.length} chunks`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
