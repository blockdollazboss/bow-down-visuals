import { useCallback, useRef, useState } from "react";

/**
 * useUndoRedo — a reusable undo/redo history hook for any page.
 *
 * The hook owns the past/future stacks; the page keeps owning its "present"
 * state. Before each meaningful change, call `push(preChangeSnapshot)`.
 * `undo(currentSnapshot)` / `redo(currentSnapshot)` return the snapshot the
 * page should restore (or null when there's nothing to do).
 *
 * Snapshots are deep-cloned on the way in so later mutations of the live
 * state can never corrupt history.
 *
 * Rapid-fire changes (typing, slider drags) inside `coalesceMs` are merged
 * into a single undo step: only the oldest pre-change snapshot is kept.
 *
 * Example:
 * ```tsx
 * const history = useUndoRedo<EditorSnapshot>({ maxHistory: 50 });
 *
 * const setScenes = (next: SceneData[]) => {
 *   history.push({ scenes, settings }); // snapshot BEFORE the change
 *   setScenesState(next);
 * };
 *
 * const handleUndo = () => {
 *   const snap = history.undo({ scenes, settings });
 *   if (snap) { setScenesState(snap.scenes); setSettingsState(snap.settings); }
 * };
 * ```
 */
export interface UseUndoRedoOptions {
  /** Maximum undo steps kept (default 50). */
  maxHistory?: number;
  /**
   * Changes pushed within this window (ms) of the previous push are merged
   * into one undo step (default 800). Set to 0 to disable coalescing.
   */
  coalesceMs?: number;
}

export interface UndoRedoApi<T> {
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
  /** Record the state BEFORE a change. Clears the redo stack. */
  push: (snapshot: T) => void;
  /**
   * Pop the most recent snapshot. Pass the CURRENT state so it lands on the
   * redo stack. Returns the snapshot to restore, or null if nothing to undo.
   */
  undo: (current: T) => T | null;
  /**
   * Re-apply the most recently undone snapshot. Pass the CURRENT state so it
   * lands back on the undo stack. Returns the snapshot to restore, or null.
   */
  redo: (current: T) => T | null;
  /** Clear both stacks (e.g. after initial load or project switch). */
  reset: () => void;
}

function deepClone<T>(value: T): T {
  // structuredClone handles Dates, Maps, typed arrays, etc.
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch {
    /* fall through to JSON */
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    // Last resort: keep the reference (caller must treat state immutably).
    return value;
  }
}

export function useUndoRedo<T>(options?: UseUndoRedoOptions): UndoRedoApi<T> {
  const maxHistory = Math.max(1, options?.maxHistory ?? 50);
  const coalesceMs = Math.max(0, options?.coalesceMs ?? 800);

  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);
  const lastPushAtRef = useRef(0);
  // Bumped on every stack mutation so canUndo/canRedo re-render.
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const push = useCallback(
    (snapshot: T) => {
      const now = Date.now();
      if (coalesceMs > 0 && now - lastPushAtRef.current < coalesceMs && pastRef.current.length > 0) {
        // Rapid follow-up change: keep the OLDER pre-change snapshot so one
        // undo step rewinds the whole burst (typing, slider drag, …).
        lastPushAtRef.current = now;
        return;
      }
      lastPushAtRef.current = now;
      pastRef.current.push(deepClone(snapshot));
      if (pastRef.current.length > maxHistory) {
        pastRef.current.splice(0, pastRef.current.length - maxHistory);
      }
      // A new action invalidates the redo stack.
      if (futureRef.current.length > 0) futureRef.current = [];
      bump();
    },
    [maxHistory, coalesceMs, bump],
  );

  const undo = useCallback(
    (current: T): T | null => {
      const prev = pastRef.current.pop();
      if (prev === undefined) return null;
      futureRef.current.push(deepClone(current));
      lastPushAtRef.current = 0; // don't coalesce the next push with pre-undo history
      bump();
      return prev;
    },
    [bump],
  );

  const redo = useCallback(
    (current: T): T | null => {
      const next = futureRef.current.pop();
      if (next === undefined) return null;
      pastRef.current.push(deepClone(current));
      if (pastRef.current.length > maxHistory) {
        pastRef.current.splice(0, pastRef.current.length - maxHistory);
      }
      lastPushAtRef.current = 0;
      bump();
      return next;
    },
    [maxHistory, bump],
  );

  const reset = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    lastPushAtRef.current = 0;
    bump();
  }, [bump]);

  // The returned object is rebuilt on every render, so canUndo/canRedo always
  // reflect the current stacks; `version` bumps re-render after mutations.
  void version;
  return {
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    undoCount: pastRef.current.length,
    redoCount: futureRef.current.length,
    push,
    undo,
    redo,
    reset,
  };
}
