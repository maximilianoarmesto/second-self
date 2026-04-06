'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Link2, Plus, Copy, Check, XCircle, Loader2, ExternalLink } from 'lucide-react';
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
// Page
// ---------------------------------------------------------------------------

export default function SharePage() {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
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
    } catch {
      // Silently handle
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
      // Auto-copy the URL
      copyToClipboard(created.token, created.id);
    } catch {
      // Handle error silently
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
    } catch {
      // Handle error silently
    } finally {
      setRevokingId(null);
      setRevokeConfirm(null);
    }
  };

  // ---- Copy to clipboard ----
  const copyToClipboard = (token: string, id: number) => {
    const url = `${window.location.origin}/clone/${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
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
          <h1 className="text-3xl font-bold text-foreground">Share</h1>
          <p className="mt-1 text-muted-foreground">
            Generate public links to share your digital clone with others.
          </p>
        </div>
        <Button onClick={generateLink} disabled={generating} className="gap-2 flex-shrink-0">
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Generate New Link
        </Button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && links.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Link2 className="w-12 h-12 text-muted-foreground mb-4" />
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
                className={isRevoked ? 'opacity-60' : isNew ? 'ring-1 ring-primary/50' : ''}
              >
                <CardContent className="p-4 space-y-3">
                  {/* Top row */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Link2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{link.label}</p>
                        <p className="text-xs text-muted-foreground">
                          Generated on{' '}
                          {new Date(link.createdAt).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                      </div>
                    </div>
                    <Badge variant={isActive ? 'default' : 'secondary'}>
                      {isActive ? 'Active' : 'Revoked'}
                    </Badge>
                  </div>

                  {/* URL + Actions — only shown when raw token is available */}
                  {isActive && hasToken && (
                    <div className="flex items-center gap-2">
                      <Input
                        readOnly
                        value={getPublicUrl(link.token!)}
                        className="text-xs font-mono bg-muted border-none"
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
                    <p className="text-xs text-muted-foreground">
                      The share URL was shown when this link was created. For security, the token is
                      not stored and cannot be displayed again.
                    </p>
                  )}

                  {/* Revoke controls */}
                  {isActive && (
                    <div className="flex justify-end">
                      {isConfirmingRevoke ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-destructive font-medium">
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
                          className="text-xs text-muted-foreground hover:text-destructive gap-1.5"
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
                    <p className="text-xs text-primary font-medium">
                      Link created and copied to clipboard. Save this URL — it cannot be shown
                      again.
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
