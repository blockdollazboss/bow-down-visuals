/**
 * Timeline lock — the Studio Editor's "Lock Timeline" made real.
 *
 * The lock state itself lives in `EditorSettings.timelineLocked` (see
 * lib/editor-settings.ts) so it follows the editor's normal state flow:
 * every surface already receives `settings`/`setSettings`, and the flag
 * persists with the project's saved editor settings — no separate store.
 *
 * While locked, the timeline's clips cannot be moved, trimmed, split,
 * deleted, or otherwise edited. Enforcement is layered:
 *   1. The video-editor page's wrapped `setScenes` refuses any scenes
 *      change (every section receives those wrapped setters), and its
 *      wrapped `setSettings` refuses any change that rewrites the
 *      per-clip edits record (`settings.clips`).
 *   2. The timeline surfaces (TimelineDock, StudioEditorSection) gate
 *      their own controls so a locked timeline never starts a drag,
 *      split, or menu edit in the first place.
 * Playback, selection, zoom/scroll, and export are NOT gated — they never
 * rewrite scenes or per-clip edits.
 *
 * The predicates here are pure so the exact rules the wrappers enforce
 * are unit-testable (lib/timeline-lock.test.ts).
 */
import type { EditorSettings } from "./editor-settings";
import type { SceneData } from "./scene-parser";

/** User-facing explanation shown when an edit is refused because of the lock. */
export const TIMELINE_LOCKED_MESSAGE =
  "Timeline is locked — unlock it in the Studio tab to edit clips.";

/** True when the timeline lock is engaged for these settings. */
export function isTimelineLocked(
  settings: Pick<EditorSettings, "timelineLocked"> | null | undefined,
): boolean {
  return settings?.timelineLocked === true;
}

/**
 * A scenes change is blocked while the timeline is locked. Every real
 * timeline mutation (move/reorder, split, delete, duplicate, paste,
 * rename, replace, add-a-clip) replaces the scenes array, so refusing
 * array changes while locked covers them all at the page chokepoint.
 * Internal flows (project load, rebuild, auto-generate, sync) bypass
 * this via the page's internal setters — they are not user edits.
 */
export function timelineLockBlocksScenesChange(
  settings: Pick<EditorSettings, "timelineLocked"> | null | undefined,
  prev: SceneData[],
  next: SceneData[],
): boolean {
  if (!isTimelineLocked(settings)) return false;
  return next !== prev;
}

/**
 * A settings change is blocked while the timeline is locked ONLY when it
 * rewrites the per-clip edits record (`settings.clips`) — trims, manual
 * positions, transitions, effects, speed, volume, lip-sync attachments
 * all live there. Everything else (playback-adjacent settings, captions,
 * export range, dock layout, …) keeps flowing while locked, and the
 * lock toggle itself is always allowed so the user can unlock.
 */
export function timelineLockBlocksSettingsChange(
  prev: EditorSettings,
  next: EditorSettings,
): boolean {
  if (!isTimelineLocked(prev)) return false;
  /* Locking/unlocking always passes. */
  if (next.timelineLocked !== prev.timelineLocked) return false;
  return next.clips !== prev.clips;
}
