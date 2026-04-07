'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Link2, Plus, Copy, Check, XCircle, Loader2, ExternalLink, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape returned by GET /api/share-links (Prisma model, no raw token). */
interface ShareLinkFromAPI {
  id: number;
  tokenHash: string;
  isActive: boolean;
  createdAt: string;
  label: string;
  revokedAt: string | null;
}

/** Shape returned by POST /api/share-links (includes the one-time raw token). */
interface ShareLinkCreated {
  id: number;
  token: string;
  label: string;
  isActive: boolean;
  createdAt: string;
}

/** Internal UI representation. `token` is only present for newly created links. */
interface ShareLink {
  id: number;
  token?: string;
  label: string;
  isActive: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Clipboard helper
// ---------------------------------------------------------------------------

/**
 * Copies `text` to the clipboard.
 * Falls back to the legacy `execCommand` approach when the Clipboard API is
 * unavailable (non-HTTPS / non-localhost contexts).
 * Returns `true` if the copy succeeded, `false` otherwise.
 */
async function copyText(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;

  // Modern Clipboard API
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy approach
    }
  }

  // Legacy execCommand fallback
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SharePage() {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [revokeConfirm, setRevokeConfirm] = useState<number | null>(null);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [newlyCreatedId, setNewlyCreatedId] = useState<number | null>(null);

  // ---- Load links ----
  const loadLinks = useCallback(async () => {
    try {
      const data = await apiFetch<ShareLinkFromAPI[]>('/api/share-links');
      setLinks(
        data.map((l) => ({
          id: l.id,
          label: l.label,
          isActive: l.isActive,
          createdAt: l.createdAt,
          // No raw token available for existing links
        }))
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load share links.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  // ---- Generate new link ----
  const generateLink = async () => {
    setGenerating(true);
    setError(null);
    try {
      const created = await apiFetch<ShareLinkCreated>('/api/share-links', {
        method: 'POST',
        body: JSON.stringify({ label: `Share Link ${links.length + 1}` }),
      });
      const newLink: ShareLink = {
        id: created.id,
        token: created.token,
        label: created.label,
        isActive: created.isActive,
        createdAt: created.createdAt,
      };
      setLinks((prev) => [newLink, ...prev]);
      setNewlyCreatedId(newLink.id);
      // Auto-copy the URL (best-effort)
      copyToClipboard(created.token, created.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate share link.');
    } finally {
      setGenerating(false);
    }
  };

  // ---- Revoke link ----
  const revokeLink = async (id: number) => {
    setRevokingId(id);
    try {
      await apiFetch(`/api/share-links/${id}`, { method: 'DELETE' });
      setLinks((prev) => prev.map((l) => (l.id === id ? { ...l, isActive: false } : l)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to revoke share link.');
    } finally {
      setRevokingId(null);
      setRevokeConfirm(null);
    }
  };

  // ---- Copy to clipboard ----
  const copyToClipboard = async (token: string, id: number) => {
    const url = `${window.location.origin}/clone/${token}`;
    const ok = await copyText(url);
    if (ok) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const getPublicUrl = (token: string) => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/clone/${token}`;
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-black">Share</h1>
          <p className="mt-1 text-gray-500">
            Generate public links to share your digital clone with others.
          </p>
        </div>
        <Button onClick={generateLink} disabled={generating} className="gap-2 flex-shrink-0">
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Generate New Link
        </Button>
      </div>

      {/* Global error */}
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-black">
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

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-gray-100 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && links.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Link2 className="w-12 h-12 text-gray-400 mb-4" />
            <CardTitle className="text-lg mb-2">No share links yet</CardTitle>
            <CardDescription className="mb-6">
              Generate a public link to let others interact with your digital clone.
            </CardDescription>
            <Button onClick={generateLink} disabled={generating} className="gap-2">
              <Plus className="w-4 h-4" />
              Generate your first link
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Link list */}
      {!loading && links.length > 0 && (
        <div className="space-y-3">
          {links.map((link) => {
            const isActive = link.isActive;
            const isRevoked = !link.isActive;
            const hasToken = !!link.token;
            const isConfirmingRevoke = revokeConfirm === link.id;
            const isRevoking = revokingId === link.id;
            const isCopied = copiedId === link.id;
            const isNew = newlyCreatedId === link.id;

            return (
              <Card
                key={link.id}
                className={isRevoked ? 'opacity-60' : isNew ? 'ring-1 ring-gray-400' : ''}
              >
                <CardContent className="p-4 space-y-3">
                  {/* Top row */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Link2 className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-black truncate">{link.label}</p>
                        <p className="text-xs text-gray-500">
                          Generated on{' '}
                          {new Date(link.createdAt).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                      </div>
                    </div>
                    <Badge variant={isActive ? 'default' : 'outline'}>
                      {isActive ? 'Active' : 'Revoked'}
                    </Badge>
                  </div>

                  {/* URL + Actions — only shown when raw token is available */}
                  {isActive && hasToken && (
                    <div className="flex items-center gap-2">
                      <Input
                        readOnly
                        value={getPublicUrl(link.token!)}
                        className="text-xs font-mono bg-gray-50 border-gray-200"
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 flex-shrink-0"
                        onClick={() => copyToClipboard(link.token!, link.id)}
                      >
                        {isCopied ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Copy
                          </>
                        )}
                      </Button>
                      <a href={getPublicUrl(link.token!)} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm" className="flex-shrink-0">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Button>
                      </a>
                    </div>
                  )}

                  {/* Info for existing links without a raw token */}
                  {isActive && !hasToken && (
                    <p className="text-xs text-gray-500">
                      The share URL was shown when this link was created. For security, the token is
                      not stored and cannot be displayed again.
                    </p>
                  )}

                  {/* Revoke controls */}
                  {isActive && (
                    <div className="flex justify-end">
                      {isConfirmingRevoke ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-black font-medium">
                            Revoke this link?
                          </span>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={isRevoking}
                            onClick={() => revokeLink(link.id)}
                          >
                            {isRevoking ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              'Yes, revoke'
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={isRevoking}
                            onClick={() => setRevokeConfirm(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-gray-500 hover:text-black gap-1.5"
                          onClick={() => setRevokeConfirm(link.id)}
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Revoke
                        </Button>
                      )}
                    </div>
                  )}

                  {/* New link prompt */}
                  {isNew && isActive && hasToken && (
                    <p className="text-xs text-black font-medium">
                      Link created. Save this URL — it cannot be shown again.
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
