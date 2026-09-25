/* ─── Content Repurposer shared helpers ───────────────────────────────────
   Pure functions used by the /repurpose page. Kept in lib/ so they are
   unit-testable without rendering the page. */

export const PACK_CREDITS = 5;
export const REROLL_CREDITS = 1;

/** Format seconds as mm:ss for timestamp display. */
export function formatRepurposeTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export interface RepurposeCaptionLike {
  caption: string;
  hashtags: string[];
}

/** Build the free "copy all captions" export text. */
export function buildCaptionsExport(captions: RepurposeCaptionLike[]): string {
  if (captions.length === 0) return "No captions yet.";
  return captions
    .map((c, i) => {
      const tags = c.hashtags.map((t) => `#${t}`).join(" ");
      return `Caption ${i + 1}:\n${c.caption}\n${tags}`;
    })
    .join("\n\n");
}

export interface PlatformDescriptionsLike {
  tiktok: string;
  reels: string;
  shorts: string;
  x: string;
}

export type PlatformKey = keyof PlatformDescriptionsLike;

export const PLATFORM_LABELS: Record<PlatformKey, string> = {
  tiktok: "TikTok",
  reels: "Instagram Reels",
  shorts: "YouTube Shorts",
  x: "X",
};

/** Count how many of the 10 pack outputs are ready (for the progress UI). */
export function packProgress(ready: {
  clips: number;
  thumbnails: number;
  captions: number;
  descriptions: number;
}): { done: number; total: number } {
  const done = ready.clips + ready.thumbnails + ready.captions + ready.descriptions;
  return { done, total: 10 };
}
