/* ─── Clip Maker shared helpers ─────────────────────────────────────────
   Pure functions used by the /clip-maker page. Kept in lib/ so they are
   unit-testable without rendering the page. */

export interface ClipHighlightLike {
  id: string;
  startSec: number;
  endSec: number;
  title: string;
}

/** Format seconds as mm:ss for timestamp display. */
export function formatClipTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Build the free "copy timestamps" export text for selected highlights. */
export function buildTimestampExport(highlights: ClipHighlightLike[]): string {
  if (highlights.length === 0) return "No highlights selected.";
  return highlights
    .map((h) => `${formatClipTimestamp(h.startSec)}–${formatClipTimestamp(h.endSec)}  ${h.title}`)
    .join("\n");
}

/** Credit math for the cut step: 2 credits per rendered clip. */
export const CUT_CREDITS_PER_CLIP = 2;
export const ANALYZE_CREDITS = 3;

export function cutCostFor(clipCount: number): number {
  return Math.max(0, Math.floor(clipCount)) * CUT_CREDITS_PER_CLIP;
}
