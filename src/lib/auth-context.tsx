'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
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
  user: AuthUser | null;
  isLoading: boolean;
  logout: () => Promise<void>;
  setUser: (user: AuthUser | null) => void;
  refreshUser: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  // isLoading MUST default to `true` so the guard never redirects before
  // the session check has had a chance to run — even in Docker production
  // builds where the first useEffect fires slightly later than in dev.
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        const data = await apiFetch<AuthUser>('/api/auth/me');
        if (!cancelled) {
          setUser(data);
        }
      } catch {
        // 401 or network error — user is not authenticated
        if (!cancelled) {
          setUser(null);
        }
      } finally {
        // Always flip the loading flag regardless of outcome
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Re-fetch the current user (e.g. after avatar upload or profile update).
   */
  const refreshUser = useCallback(async () => {
    try {
      const data = await apiFetch<AuthUser>('/api/auth/me');
      setUser(data);
    } catch {
      setUser(null);
    }
  }, []);

  /**
   * Log out the current user:
   *  1. POST /api/auth/logout (clears the HttpOnly session cookie)
   *  2. Clear local user state
   *  3. Redirect to /login
   *
   * The finally block guarantees that state is cleared and the redirect
   * happens even if the API call fails (e.g. network error).
   */
  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Intentionally swallowed — we still want to clear state and redirect
    } finally {
      setUser(null);
      router.push('/login');
    }
  }, [router]);

  const value: AuthContextValue = {
    user,
    isLoading,
    logout,
    setUser,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
