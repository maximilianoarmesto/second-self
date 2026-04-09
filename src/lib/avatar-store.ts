/**
 * Simple in-memory avatar URL store with pub/sub for cross-component reactivity.
 * The avatar URL is persisted in the Settings DB table; this module provides
 * a client-side cache so the Sidebar and Settings page stay in sync without
 * a full page reload.
 */

type Listener = (url: string | null) => void;

let currentUrl: string | null = null;
const listeners = new Set<Listener>();

export function getAvatarUrl(): string | null {
  return currentUrl;
}

export function setAvatarUrl(url: string | null): void {
  currentUrl = url;
  listeners.forEach((fn) => fn(url));
}

/** Silent seed — updates the store without notifying subscribers. */
export function initAvatarUrl(url: string | null): void {
  currentUrl = url;
}

export function subscribeAvatarUrl(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
