'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DocumentStatusBadge } from '@/components/documents/DocumentStatusBadge';
import { apiFetch } from '@/lib/api';
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

  // ---- Fetch list ----

  const fetchDocuments = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiFetch<DocumentSummary[]>('/api/documents');
      setDocuments(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load documents. Please try again.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

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

  // ---- Render ----

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
            onClick={fetchDocuments}
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

      {/* Global error */}
      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-black">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" />
          <div>
            <p className="font-medium">Error</p>
            <p className="mt-0.5">{error}</p>
          </div>
          <button
            onClick={() => setError(null)}
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

      {/* Document list */}
      {!isLoading && documents.length > 0 && (
        <div className="space-y-3">
          {/* Stats bar */}
          <div className="flex flex-wrap gap-4 text-sm text-gray-500 mb-2">
            <span>{documents.length} document{documents.length !== 1 ? 's' : ''}</span>
            {[
              { label: 'completed', count: documents.filter((d) => d.status === 'COMPLETED').length },
              { label: 'processing', count: documents.filter((d) => d.status === 'PROCESSING').length },
              { label: 'pending', count: documents.filter((d) => d.status === 'PENDING').length },
              { label: 'failed', count: documents.filter((d) => d.status === 'FAILED').length },
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
              deleteConfirmId={deleteConfirm}
              onToggle={() => toggleExpand(doc.id)}
              onDeleteRequest={() => setDeleteConfirm(doc.id)}
              onDeleteConfirm={() => handleDelete(doc.id)}
              onDeleteCancel={() => setDeleteConfirm(null)}
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
  deleteConfirmId: number | null;
  onToggle: () => void;
  onDeleteRequest: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}

function DocumentRow({
  doc,
  isExpanded,
  detail,
  isLoadingDetail,
  isDeleting,
  deleteConfirmId,
  onToggle,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: DocumentRowProps) {
  const isConfirmingDelete = deleteConfirmId === doc.id;

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
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>

        {/* File icon */}
        <FileText className="h-5 w-5 flex-shrink-0 text-gray-400" />

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <p className="truncate font-medium text-sm text-black">{doc.originalFilename}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span>{formatFileSize(doc.fileSize)}</span>
            {doc.pageCount != null && (
              <span>{doc.pageCount} page{doc.pageCount !== 1 ? 's' : ''}</span>
            )}
            <span>{formatDate(doc.createdAt)}</span>
          </div>
        </div>

        {/* Status badge */}
        <div className="flex-shrink-0">
          <DocumentStatusBadge status={doc.status} />
        </div>

        {/* Delete controls */}
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
                disabled={isDeleting}
                onClick={onDeleteConfirm}
              >
                {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={isDeleting}
                onClick={onDeleteCancel}
              >
                No
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-gray-400 hover:text-black"
              disabled={isDeleting}
              onClick={onDeleteRequest}
              aria-label="Delete document"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
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
          Extracted chunks{' '}
          <span className="font-normal text-gray-500">({chunks.length})</span>
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
              <div className="mb-1 flex items-center gap-2 text-gray-500">
                <span className="font-medium">Chunk {chunk.chunkIndex + 1}</span>
                <span>&middot;</span>
                <span>Page {chunk.pageNumber}</span>
              </div>
              <p className="line-clamp-3 leading-relaxed">{chunk.content}</p>
            </div>
          ))}

          {chunks.length > PREVIEW_COUNT && (
            <button
              onClick={() => setShowAll((s) => !s)}
              className="mt-1 text-xs text-black underline-offset-4 hover:underline"
            >
              {showAll
                ? 'Show less'
                : `Show all ${chunks.length} chunks`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
