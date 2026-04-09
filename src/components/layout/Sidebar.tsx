'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  MessageCircle,
  BookOpen,
  Share2,
  Settings,
  ChevronLeft,
  ChevronRight,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/ui/Logo';
import { apiFetch } from '@/lib/api';
import { getAvatarUrl, initAvatarUrl, subscribeAvatarUrl } from '@/lib/avatar-store';
import type { SettingsData } from '@/types/settings';

const COLLAPSED_KEY = 'sidebar-collapsed';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Chat', href: '/chat', icon: MessageCircle },
  { label: 'Knowledge Base', href: '/knowledge-base', icon: BookOpen },
  { label: 'Share', href: '/share', icon: Share2 },
  { label: 'Settings', href: '/settings', icon: Settings },
];

// ---------------------------------------------------------------------------
// Avatar thumbnail — shown next to the user name in the footer
// ---------------------------------------------------------------------------

interface AvatarThumbnailProps {
  /** Relative URL returned by the API (e.g. "/uploads/avatar.png") or null. */
  avatarUrl: string | null;
  /** Display size in pixels — rendered as a perfect circle. */
  size?: number;
}

function AvatarThumbnail({ avatarUrl, size = 32 }: AvatarThumbnailProps) {
  const sizePx = `${size}px`;

  if (avatarUrl) {
    return (
      <div
        className="flex-shrink-0 rounded-full overflow-hidden border border-border bg-secondary"
        style={{ width: sizePx, height: sizePx }}
        aria-hidden="true"
      >
        <Image
          src={avatarUrl}
          alt="User avatar"
          width={size}
          height={size}
          className="object-cover w-full h-full"
          // Force a fresh fetch when the URL changes (e.g. after upload).
          // Using the URL as a key unmounts/remounts the Image element so
          // Next.js doesn't serve a stale cached version.
          key={avatarUrl}
          // Avatars are small — no lazy loading needed
          priority={false}
          unoptimized
        />
      </div>
    );
  }

  // Placeholder icon — shown when no avatar has been set
  return (
    <div
      className="flex-shrink-0 rounded-full bg-secondary border border-border flex items-center justify-center"
      style={{ width: sizePx, height: sizePx }}
      aria-hidden="true"
    >
      <User className="text-foreground" style={{ width: size * 0.55, height: size * 0.55 }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobile?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ collapsed, onToggle, mobile, onMobileClose }: SidebarProps) {
  const pathname = usePathname();

  // Seed from the module-level store so the avatar is available immediately
  // if the Settings page has already updated it in the same session.
  const [avatarUrl, setLocalAvatarUrl] = useState<string | null>(getAvatarUrl);
  const [cloneName, setCloneName] = useState<string>('');

  // ---- Fetch settings (avatar + clone name) --------------------------------

  const fetchSettings = React.useCallback(async () => {
    try {
      const data = await apiFetch<SettingsData>('/api/settings');
      const url = data.avatarUrl ?? null;
      // Seed the shared store so late subscribers (and getAvatarUrl() calls
      // elsewhere) see the correct value — WITHOUT broadcasting to listeners.
      // We use initAvatarUrl here (not setAvatarUrl) to avoid triggering our
      // own subscribeAvatarUrl listener, which would cause a redundant state
      // update from the component's own API fetch.
      initAvatarUrl(url);
      // Update local state directly — this is the authoritative re-render for
      // the Sidebar itself; the subscription only handles external broadcasts
      // (e.g. avatar uploaded in Settings while the Sidebar is mounted).
      setLocalAvatarUrl(url);
      setCloneName(data.cloneName ?? '');
    } catch {
      // Non-fatal — sidebar continues to render without an avatar
    }
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Re-fetch when the tab regains visibility (e.g. user uploads avatar in
  // Settings then switches back) so the sidebar stays in sync without a
  // full page reload.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchSettings();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [fetchSettings]);

  // Subscribe to avatar store updates — enables instant reflection after
  // an upload on the Settings page (same tab, same JS bundle).
  useEffect(() => {
    return subscribeAvatarUrl((url) => setLocalAvatarUrl(url));
  }, []);

  // ---- Active route detection ---------------------------------------------

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  // ---- Render --------------------------------------------------------------

  return (
    <aside
      className={cn(
        'flex flex-col h-full bg-surface border-r border-border transition-all duration-300 ease-in-out',
        mobile ? 'w-64' : collapsed ? 'w-[72px]' : 'w-64'
      )}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-border flex-shrink-0">
        <Logo size={36} />
        {(!collapsed || mobile) && (
          <span className="text-lg font-semibold text-foreground whitespace-nowrap overflow-hidden">
            Second Self
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onMobileClose}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-secondary text-foreground'
                  : 'text-foreground hover:bg-secondary hover:text-foreground'
              )}
              title={collapsed && !mobile ? item.label : undefined}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {(!collapsed || mobile) && (
                <span className="whitespace-nowrap overflow-hidden">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User identity footer */}
      <div
        className={cn(
          'px-2 py-3 border-t border-border flex-shrink-0',
          // Keep a consistent minimum height regardless of collapsed state
          // so the collapse toggle below doesn't shift position.
          'flex flex-col gap-1'
        )}
      >
        {/* Avatar + name row */}
        <div
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-3 py-2',
            // Use the same secondary hover as nav items for visual consistency
            'hover:bg-secondary transition-colors'
          )}
          title={
            collapsed && !mobile
              ? cloneName || 'Second Self'
              : undefined
          }
        >
          {/* Always render the avatar — it becomes the sole indicator when collapsed */}
          <AvatarThumbnail avatarUrl={avatarUrl} size={32} />

          {/* Name — hidden when collapsed (desktop only) */}
          {(!collapsed || mobile) && (
            <span className="text-sm font-medium text-foreground truncate">
              {cloneName || 'Second Self'}
            </span>
          )}
        </div>

        {/* Collapse toggle (hidden on mobile) */}
        {!mobile && (
          <button
            onClick={onToggle}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-secondary transition-colors w-full"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <ChevronRight className="w-5 h-5 flex-shrink-0" />
            ) : (
              <>
                <ChevronLeft className="w-5 h-5 flex-shrink-0" />
                <span className="whitespace-nowrap overflow-hidden">Collapse</span>
              </>
            )}
          </button>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// useSidebarCollapsed hook
// ---------------------------------------------------------------------------

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (stored === 'true') setCollapsed(true);
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(COLLAPSED_KEY, String(next));
      return next;
    });
  };

  return { collapsed, toggle };
}
