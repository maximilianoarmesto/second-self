'use client';

import React, { useEffect, useState } from 'react';
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
  LogOut,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from '@/components/ui/Logo';
import { setAvatarUrl as broadcastAvatarUrl, getAvatarUrl, initAvatarUrl, subscribeAvatarUrl } from '@/lib/avatar-store';
import { useAuth } from '@/lib/auth-context';

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
  /** Initials to display when no avatar URL is available (e.g. "JS"). */
  initials?: string;
}

function AvatarThumbnail({ avatarUrl, size = 32, initials }: AvatarThumbnailProps) {
  const sizePx = `${size}px`;
  // Track load failures so we can fall back to the placeholder instead
  // of showing a broken-image element.
  const [imgError, setImgError] = useState(false);

  // Reset the error state whenever the URL changes (e.g. after a fresh upload
  // so the new image gets a clean load attempt).
  useEffect(() => {
    setImgError(false);
  }, [avatarUrl]);

  // Show the avatar image only when a URL is available and it loaded successfully.
  const showImage = Boolean(avatarUrl) && !imgError;

  if (showImage) {
    return (
      <div
        className="flex-shrink-0 rounded-full overflow-hidden border border-border bg-secondary"
        style={{ width: sizePx, height: sizePx }}
        aria-hidden="true"
      >
        {/*
         * Plain <img> is used instead of next/image so that:
         * - onError reliably fires when the file is missing / broken,
         *   allowing an instant fallback to the placeholder icon.
         * - Local /uploads/ paths are static files served directly by
         *   Next.js and gain no benefit from the optimisation pipeline.
         *
         * eslint-disable-next-line @next/next/no-img-element
         */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarUrl!}
          alt="User avatar"
          // key forces a remount when the URL changes so the browser
          // always fetches the freshly uploaded file, not a cached copy.
          key={avatarUrl}
          className="object-cover w-full h-full"
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  // Initials placeholder — shown when no avatar is set or the image fails.
  // Falls back to a generic User icon when initials are not available.
  if (initials) {
    return (
      <div
        className="flex-shrink-0 rounded-full bg-secondary border border-border flex items-center justify-center"
        style={{ width: sizePx, height: sizePx }}
        aria-hidden="true"
      >
        <span
          className="text-foreground font-semibold leading-none select-none"
          style={{ fontSize: Math.round(size * 0.38) }}
        >
          {initials}
        </span>
      </div>
    );
  }

  // Generic User icon fallback — when initials are not available.
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
  const { user, logout } = useAuth();

  // Seed from the module-level store so the avatar is available immediately
  // if the Settings page has already updated it in the same session.
  const [avatarUrl, setLocalAvatarUrl] = useState<string | null>(getAvatarUrl);

  // Derive the avatar URL: prefer the live store (updated after uploads),
  // then fall back to the value from the auth context (from login/me response).
  const resolvedAvatarUrl = avatarUrl ?? user?.avatarUrl ?? null;

  // Derive initials from the authenticated user's name for the avatar fallback.
  const initials = React.useMemo<string | undefined>(() => {
    if (!user?.name) return undefined;
    const parts = user.name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [user?.name]);

  // ---- Avatar store subscription -------------------------------------------
  // Subscribe to avatar store updates — enables instant reflection after
  // an upload on the Settings page (same tab, same JS bundle).

  useEffect(() => {
    // Seed the store from the auth context's avatarUrl on mount so the store
    // always reflects the most recently known value.
    if (user?.avatarUrl !== undefined) {
      initAvatarUrl(user.avatarUrl);
    }
    return subscribeAvatarUrl((url) => setLocalAvatarUrl(url));
  }, [user?.avatarUrl]);

  // Re-seed local state when the auth context's avatarUrl changes (e.g. after
  // the user logs in and the session resolves for the first time).
  useEffect(() => {
    if (user?.avatarUrl !== undefined) {
      setLocalAvatarUrl(user.avatarUrl);
    }
  }, [user?.avatarUrl]);

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
          'flex flex-col gap-1'
        )}
      >
        {/* Avatar + name + logout row */}
        <div
          className={cn(
            'flex items-center rounded-lg px-3 py-2',
            // Expanded: avatar | name | logout icon; Collapsed: just avatar
            (!collapsed || mobile) ? 'gap-2.5' : 'justify-center'
          )}
        >
          {/* Avatar — always visible; acts as the sole indicator when collapsed */}
          <AvatarThumbnail
            avatarUrl={resolvedAvatarUrl}
            size={32}
            initials={initials}
          />

          {/* Name + logout — visible only in expanded state */}
          {(!collapsed || mobile) && (
            <>
              <span
                className="text-sm font-medium text-foreground truncate flex-1 min-w-0"
                title={user?.name ?? ''}
              >
                {user?.name ?? ''}
              </span>

              {/* Logout button */}
              <button
                onClick={logout}
                className="flex-shrink-0 p-1 rounded-md text-foreground hover:bg-secondary transition-colors"
                aria-label="Log out"
                title="Log out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </>
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

// Re-export broadcastAvatarUrl under the legacy name so the Settings page
// (which calls setAvatarUrl from '@/lib/avatar-store' directly) continues
// to work without changes.
export { broadcastAvatarUrl };
