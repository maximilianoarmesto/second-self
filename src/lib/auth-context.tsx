'use client';

/**
 * Auth context — single source of truth for the authenticated user.
 *
 * On mount, `AuthProvider` calls GET /api/auth/me to restore the session.
 * The resolved user object (or `null` when unauthenticated) is made available
 * to every child component via the `useAuth()` hook.
 *
 * Usage:
 *   // Wrap the private layout:
 *   <AuthProvider>{children}</AuthProvider>
 *
 *   // Consume anywhere inside the tree:
 *   const { user, isLoading, logout } = useAuth();
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: number;
  email: string | null;
  name: string;
  avatarUrl: string | null;
}

export interface AuthContextValue {
  /** The authenticated user, or `null` when not logged in. */
  user: AuthUser | null;
  /** `true` while the initial GET /api/auth/me request is in flight. */
  isLoading: boolean;
  /** Calls POST /api/auth/logout then redirects to /login. */
  logout: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        const data = await apiFetch<AuthUser>('/api/auth/me');
        if (!cancelled) setUser(data);
      } catch {
        // 401 or network error — treat as unauthenticated
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Even if the server call fails, clear client-side state and redirect
    } finally {
      setUser(null);
      router.push('/login');
    }
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, isLoading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns the current auth state: `{ user, isLoading, logout }`.
 *
 * Must be called from a component that is a descendant of `AuthProvider`.
 * Throws if used outside the provider so misconfigured trees are caught early.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth() must be used inside <AuthProvider>.');
  }
  return ctx;
}
