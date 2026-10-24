/**
 * Feed formats for clip generation (#30) — client mirror of the server's
 * verified per-model support table (api-server clip-pricing.ts
 * resolveFormatDelivery). The server is the source of truth and reports
 * the authoritative delivery + notice in the generation response; this
 * mirror only powers the picker's up-front honest hint, with identical
 * wording, so the creator is never surprised and a reframe is never
 * labelled native.
 */
export type ClipFormat = "16:9" | "9:16" | "1:1" | "4:5";
export type ClipModelId = "gen4.5" | "seedance2_5" | "veo3_1";

export const CLIP_FORMAT_OPTIONS: { format: ClipFormat; label: string; blurb: string }[] = [
  { format: "16:9", label: "16:9 Wide", blurb: "YouTube, TV" },
  { format: "9:16", label: "9:16 Vertical", blurb: "TikTok, Reels, Shorts" },
  { format: "1:1", label: "1:1 Square", blurb: "Instagram / Facebook feed" },
  { format: "4:5", label: "4:5 Feed", blurb: "Portrait feed posts" },
];

/** Client pixel ratio sent alongside `format` (server format wins). */
export const FORMAT_TO_RATIO: Record<ClipFormat, string> = {
  "16:9": "1280:720",
  "9:16": "720:1280",
  "1:1": "960:960",
  "4:5": "1080:1350",
};

/**
 * Honest hint for a model + format pick, mirroring the server's resolution:
 * - native square models say so;
 * - every reframe case returns the server's exact notice wording
 *   ("Generated wide, reframed to square", …);
 * - gen4.5 square depends on a reference photo existing (image-to-video),
 *   so its hint names both branches plainly.
 */
export function feedFormatHint(model: ClipModelId, format: ClipFormat, hasReference: boolean): string | null {
  if (format === "16:9" || format === "9:16") return null;
  if (format === "1:1") {
    if (model === "seedance2_5") return "Native square — generated 1:1, no crop.";
    if (model === "veo3_1") return "Generated wide, reframed to square";
    return hasReference
      ? "Native square — generated 1:1, no crop."
      : "Generated wide, reframed to square";
  }
  /* 4:5 — no house model emits it natively. */
  if (model === "seedance2_5") return "Generated in 3:4, reframed to 4:5";
  if (model === "veo3_1") return "Generated vertical, reframed to 4:5";
  return hasReference ? "Generated in 3:4, reframed to 4:5" : "Generated vertical, reframed to 4:5";
}

export function isNativeFeedFormat(model: ClipModelId, format: ClipFormat, hasReference: boolean): boolean {
  if (format === "16:9" || format === "9:16") return true;
  if (format === "1:1") {
    if (model === "seedance2_5") return true;
    if (model === "gen4.5") return hasReference;
  }
  return false;
}
