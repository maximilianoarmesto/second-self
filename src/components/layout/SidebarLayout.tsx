'use client';

import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Sidebar, useSidebarCollapsed } from './Sidebar';
import { Logo } from '@/components/ui/Logo';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';

interface SidebarLayoutProps {
  children: React.ReactNode;
}

export function SidebarLayout({ children }: SidebarLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const { collapsed, toggle } = useSidebarCollapsed();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Hide sidebar entirely for /clone/*, /login, and /signup routes.
  // These routes are public — they must never be subject to the auth guard.
  const isPublicRoute =
    pathname.startsWith('/clone') ||
    pathname === '/login' ||
    pathname === '/signup';

  // ── Client-side route guard ────────────────────────────────────────────────
  // After AuthProvider resolves the session (isLoading = false) and the user
  // is still null, redirect to /login with a `returnTo` parameter so the user
  // is bounced back to the intended page after signing in.
  //
  // This guard complements the server-side middleware: it handles the case
  // where the session cookie expires while the app is already mounted in the
  // browser (e.g. the user keeps a tab open overnight).
  useEffect(() => {
    if (isLoading || isPublicRoute) return;

    if (user === null) {
      const destination = `/login?returnTo=${encodeURIComponent(pathname)}`;
      router.replace(destination);
    }
  }, [user, isLoading, isPublicRoute, pathname, router]);

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Public routes (clone, login, signup) bypass the layout and guard entirely.
  if (isPublicRoute) {
    return <>{children}</>;
  }

  // While the session is being restored, or if auth is pending a redirect,
  // render nothing to avoid a flash of the private page content.
  if (isLoading || user === null) {
    return null;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <div className="hidden md:flex flex-shrink-0">
        <Sidebar collapsed={collapsed} onToggle={toggle} />
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          {/* Sidebar */}
          <div className="fixed inset-y-0 left-0 z-50 shadow-xl">
            <Sidebar
              collapsed={false}
              onToggle={toggle}
              mobile
              onMobileClose={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <div className="md:hidden flex items-center h-14 px-4 border-b border-border bg-surface flex-shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 -ml-2 rounded-lg text-foreground hover:bg-secondary transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="ml-3 flex items-center gap-2">
            <Logo size={28} />
            <span className="font-semibold text-foreground">Second Self</span>
          </div>
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
