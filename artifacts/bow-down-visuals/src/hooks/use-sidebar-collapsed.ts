import { useCallback, useState } from "react";

/**
 * localStorage key for the desktop sidebar collapsed state.
 * The shadcn SidebarProvider also mirrors state to a `sidebar_state` cookie;
 * localStorage is the source of truth this app reads on boot so the choice
 * survives reloads even when cookies are blocked.
 */
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "bdv-sidebar-collapsed";

/** Reads the persisted collapsed flag. Safe to call during SSR (no window). */
export function readSidebarCollapsed(): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    // Private mode / blocked storage: fall back to expanded.
    return false;
  }
}

/** Persists the collapsed flag. Never throws. */
export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
      collapsed ? "1" : "0",
    );
  } catch {
    // Private mode / blocked storage: collapse still works for the session.
  }
}

/**
 * Desktop sidebar collapsed state, persisted to localStorage.
 *
 * Returns `[collapsed, setCollapsed]` — the inverse of the SidebarProvider
 * `open` prop (`open = !collapsed`). Pass it straight through:
 *
 *   const [collapsed, setCollapsed] = useSidebarCollapsed();
 *   <SidebarProvider open={!collapsed} onOpenChange={(open) => setCollapsed(!open)}>
 */
export function useSidebarCollapsed(): [
  boolean,
  (collapsed: boolean) => void,
] {
  const [collapsed, setCollapsedState] =
    useState<boolean>(readSidebarCollapsed);
  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    writeSidebarCollapsed(next);
  }, []);
  return [collapsed, setCollapsed];
}
