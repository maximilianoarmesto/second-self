'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  FileText,
  Layers,
  MessageCircle,
  Link2,
  Upload,
  Share2,
  Settings,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DocumentStatusBadge } from '@/components/documents/DocumentStatusBadge';
import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardStats {
  cloneName: string;
  documentCount: number;
  chunkCount: number;
  chatSessionCount: number;
  publicLinkCount: number;
  recentDocuments: {
    id: number;
    original_filename: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    created_at: string;
  }[];
  recentSessions: {
    id: number;
    title: string;
    messageCount: number;
    created_at: string;
  }[];
}

// ---------------------------------------------------------------------------
// Skeleton components
// ---------------------------------------------------------------------------

function StatCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="h-4 w-24 rounded bg-gray-100 animate-pulse" />
      </CardHeader>
      <CardContent>
        <div className="h-8 w-16 rounded bg-gray-100 animate-pulse" />
      </CardContent>
    </Card>
  );
}

function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-14 rounded-lg bg-gray-100 animate-pulse" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat cards
// ---------------------------------------------------------------------------

const statConfig = [
  { key: 'documentCount' as const, label: 'Documents', icon: FileText },
  { key: 'chunkCount' as const, label: 'Chunks', icon: Layers },
  { key: 'chatSessionCount' as const, label: 'Chat Sessions', icon: MessageCircle },
  { key: 'publicLinkCount' as const, label: 'Public Links', icon: Link2 },
];

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------

const quickActions = [
  { label: 'Upload Files', href: '/knowledge-base/upload', icon: Upload },
  { label: 'Private Chat', href: '/chat', icon: MessageCircle },
  { label: 'Share Link', href: '/share', icon: Share2 },
  { label: 'Settings', href: '/settings', icon: Settings },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [data, setData] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await apiFetch<DashboardStats>('/api/dashboard');
        if (!cancelled) setData(result);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      {/* Page title */}
      <div>
        <h1 className="text-3xl font-bold text-black">
          {data?.cloneName ? `${data.cloneName}'s Dashboard` : 'Dashboard'}
        </h1>
        <p className="mt-1 text-gray-500">
          Overview of your digital clone and knowledge base.
        </p>
      </div>

      {/* Error */}
      {error && (
        <Card className="border-gray-200">
          <CardContent className="py-4">
            <p className="text-sm text-black">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
          : statConfig.map((stat) => {
              const Icon = stat.icon;
              return (
                <Card key={stat.key}>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardDescription className="text-sm font-medium">
                      {stat.label}
                    </CardDescription>
                    <Icon className="w-4 h-4 text-gray-500" />
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-black">
                      {data ? data[stat.key] : 0}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="text-lg font-semibold text-black mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link key={action.href} href={action.href}>
                <Card className="hover:bg-gray-50 transition-colors cursor-pointer h-full">
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4 h-4 text-black" />
                    </div>
                    <span className="text-sm font-medium text-black">{action.label}</span>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Recent content */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent documents */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Recent Documents</CardTitle>
              <CardDescription>Last uploaded files</CardDescription>
            </div>
            <Link href="/knowledge-base">
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                View all <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ListSkeleton rows={3} />
            ) : !data?.recentDocuments?.length ? (
              <div className="text-center py-8">
                <FileText className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No documents yet</p>
                <Link href="/knowledge-base/upload">
                  <Button variant="link" size="sm" className="mt-1">
                    Upload your first file
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {data.recentDocuments.slice(0, 5).map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-3 rounded-lg p-2 hover:bg-gray-50 transition-colors"
                  >
                    <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-black truncate">
                        {doc.original_filename}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(doc.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <DocumentStatusBadge status={doc.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent sessions */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Recent Chats</CardTitle>
              <CardDescription>Latest conversations</CardDescription>
            </div>
            <Link href="/chat">
              <Button variant="ghost" size="sm" className="gap-1 text-xs">
                View all <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ListSkeleton rows={3} />
            ) : !data?.recentSessions?.length ? (
              <div className="text-center py-8">
                <MessageCircle className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No conversations yet</p>
                <Link href="/chat">
                  <Button variant="link" size="sm" className="mt-1">
                    Start a chat
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {data.recentSessions.slice(0, 5).map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center gap-3 rounded-lg p-2 hover:bg-gray-50 transition-colors"
                  >
                    <MessageCircle className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-black truncate">
                        {session.title}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(session.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs flex-shrink-0">
                      {session.messageCount} msg{session.messageCount !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
