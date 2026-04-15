'use client';

import React from 'react';
import { RouteGuard } from '@/lib/route-guard';
import { useAuth } from '@/lib/auth-context';

interface SidebarLayoutProps {
  children: React.ReactNode;
}

/**
 * SidebarLayout wraps all authenticated pages.
 *
 * It delegates auth-gating to RouteGuard so:
 *  - Page content is never rendered while isLoading === true
 *  - Unauthenticated visitors are redirected to /login
 *  - Authenticated users see the sidebar + page content
 */
export function SidebarLayout({ children }: SidebarLayoutProps) {
  return (
    <RouteGuard>
      <SidebarLayoutInner>{children}</SidebarLayoutInner>
    </RouteGuard>
  );
}

/**
 * Inner layout rendered only when RouteGuard has confirmed the user
 * is authenticated (isLoading === false && user !== null).
 */
function SidebarLayoutInner({ children }: SidebarLayoutProps) {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-white flex flex-col">
        <div className="p-6 border-b border-gray-700">
          <h1 className="text-xl font-semibold truncate">
            {user?.name ?? 'Second Self'}
          </h1>
        </div>
        <nav className="flex-1 p-4">
          {/* Navigation items would live here */}
        </nav>
        <div className="p-4 border-t border-gray-700">
          <button
            onClick={logout}
            className="w-full text-left text-sm text-gray-400 hover:text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 bg-gray-50 overflow-auto">
        {children}
      </main>
    </div>
  );
}
