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
} from 'lucide-react';
import { cn } from '@/lib/utils';

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

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobile?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ collapsed, onToggle, mobile, onMobileClose }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <aside
      className={cn(
        'flex flex-col h-full bg-surface border-r border-border transition-all duration-300 ease-in-out',
        mobile ? 'w-64' : collapsed ? 'w-[72px]' : 'w-64'
      )}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-border flex-shrink-0">
        <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
          <span className="text-sm font-bold text-primary-foreground">SS</span>
        </div>
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

      {/* Collapse toggle (hidden on mobile) */}
      {!mobile && (
        <div className="px-2 py-3 border-t border-border flex-shrink-0">
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
        </div>
      )}
    </aside>
  );
}

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
