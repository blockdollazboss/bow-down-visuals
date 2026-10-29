/**
 * backdrop-selection.ts — the ONE background choice behind the Go Live
 * studio's "Behind me" panel.
 *
 * Owner directive (Oct 28, 2026): "Once I put the fake green screen
 * on, I should be able to choose my own background — it shouldn't be
 * separate. I should be able to upload any photo." Before this module
 * the studio held only a built-in backdrop id in state; a custom
 * photo lived nowhere — the upload control silently dropped the file
 * when the camera was off, applied nothing at camera start, and the
 * choice was lost on every stop/start. The selection now is a single
 * value the panel, the camera-start path, and the engine-landed path
 * all resolve the same way:
 *
 *   builtin → the library backdrop's data URI (backdrops.ts)
 *   custom  → the creator's own source, held by the studio: an
 *             uploaded File, or a pasted image URL
 *
 * The background is a function of THIS selection only. It is not an
 * input to — and never read from — the matting quality/engine, so
 * flipping the A/B engine switch (Pro ↔ MediaPipe) cannot move it:
 * BackgroundChanger.setQuality re-selects the engine and never
 * touches the loaded backdrop, and this module has no quality input
 * at all.
 */

import { BACKDROP_URIS } from "./backdrops";
import type { BackgroundMode } from "./background-changer";

export type BackdropSelection =
  | { kind: "builtin"; id: string }
  | { kind: "custom"; name: string };

export const DEFAULT_BACKDROP_SELECTION: BackdropSelection = { kind: "builtin", id: "stage" };

/** The source a selection resolves to: what BackgroundChanger.setImage eats. */
export type BackdropSource = string | File | null;

/**
 * Resolve a selection to the compositor's backdrop source.
 * `customSource` is the studio-held upload (File) or pasted URL for a
 * custom selection; without one held, a custom selection resolves to
 * null (nothing to paint — the caller falls back honestly).
 */
export function backdropSelectionSource(
  selection: BackdropSelection,
  customSource: File | string | null,
): BackdropSource {
  if (selection.kind === "builtin") return BACKDROP_URIS[selection.id] ?? null;
  return customSource ?? null;
}

export function isCustomSelection(selection: BackdropSelection): boolean {
  return selection.kind === "custom";
}

export function isSelectionActive(
  selection: BackdropSelection,
  candidate: BackdropSelection,
): boolean {
  if (selection.kind !== candidate.kind) return false;
  if (selection.kind === "builtin" && candidate.kind === "builtin") return selection.id === candidate.id;
  return true; // there is only ever one custom slot — held by the studio
}

/**
 * The green-screen cue: when the solid green screen is the active
 * mode, the picker directly under it is how the creator replaces the
 * green with any picture — the two are ONE control, not two stops.
 * The cue shows exactly in that moment (and in Backdrop/image mode,
 * where the picker is self-evidently the chooser, it stays quiet).
 */
export function greenScreenCueVisible(mode: BackgroundMode): boolean {
  return mode === "green";
}

/* ── Upload rules — the app's existing image rules ─────────────────
   Types: the editor's image inputs (BrandingSection, ExportSection,
   JewelryBench) accept PNG / JPEG / WebP. Size: the photo and
   branding surfaces cap image picks at 5 MB (BgStudio,
   BrandingSection, ExportSection). Same rules here, same style of
   message — one law for every image pick on the site. */
export const BACKDROP_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const BACKDROP_UPLOAD_ACCEPT = BACKDROP_UPLOAD_TYPES.join(",");
export const BACKDROP_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Validate an uploaded backdrop photo. Returns null when the file is
 * acceptable, or the exact creator-facing refusal when it is not.
 * Pure over the file's metadata so the panel and the tests share it.
 */
export function validateBackdropUpload(file: { type: string; size: number }): string | null {
  if (!file.type || !(BACKDROP_UPLOAD_TYPES as readonly string[]).includes(file.type)) {
    return "That file isn't a photo we can use — pick a JPG, PNG, or WebP image.";
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return "That photo looks empty — pick another image.";
  }
  if (file.size > BACKDROP_UPLOAD_MAX_BYTES) {
    return "That photo is over 5 MB — pick a smaller image and it will sit behind you.";
  }
  return null;
}

/**
 * Selection bookkeeping for an upload attempt. A successful pick
 * becomes the custom selection; a failed one (bad file, unreadable
 * image, changer refused it) keeps the previous selection untouched —
 * a bad pick never costs the creator the background they already had.
 */
export function selectionAfterUpload(
  previous: BackdropSelection,
  outcome: { ok: true; name: string } | { ok: false },
): BackdropSelection {
  return outcome.ok ? { kind: "custom", name: outcome.name } : previous;
}
