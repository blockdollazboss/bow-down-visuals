import { z } from "zod";

/* ─── Virality attribution playbook (Wave 5, audited Wave 6) ───────────────
   Every export is a billboard: free/bonus exports carry the
   "Made with Bow Down Visuals" tag by default (removable only via the paid
   watermark-removal upsell); paid exports offer it as an opt-in toggle.
   This module centralizes the text, the ffmpeg drawtext conventions, and
   the zod schema helpers so every export path burns the same gold/black
   credit — small, semi-transparent, bottom-center, never over the user's
   own branding. */

export const ATTRIBUTION_TEXT = "Made with Bow Down Visuals";
export const ATTRIBUTION_SITE = "bowdownvisuals.com";

/** zod field for paid exports: opt-in, default off. */
export const attributionOptIn = () =>
  z
    .boolean()
    .optional()
    .default(false)
    .describe("Opt-in: burn the gold \"Made with Bow Down Visuals\" credit into the export.");

/** zod field for free/bonus exports: default ON, removable only via the watermark-removal upsell. */
export const attributionDefaultOn = () =>
  z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Free exports carry the \"Made with Bow Down Visuals\" credit by default; remove it via the watermark-removal upsell.",
    );

const FONT_CANDIDATES = [
  "/usr/share/fonts/bdv/Poppins-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
];

/** Resolve a bold TTF usable by ffmpeg drawtext on this host. Null when none exist. */
export async function resolveAttributionFont(): Promise<string | null> {
  const { access } = await import("fs/promises");
  for (const p of FONT_CANDIDATES) {
    try {
      await access(p);
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Escape literal text for ffmpeg drawtext=text='...'. */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "%%");
}

export interface AttributionTagOpts {
  /** Explicit font size in px. Defaults to max(14, round(width / 40)). */
  fontSize?: number;
  /** Gold tag color+alpha, e.g. "0xFFD75E@0.75". */
  color?: string;
  /** Override vertical anchor: "bottom" (default) or "top". */
  anchor?: "bottom" | "top";
}

/**
 * Build an ffmpeg drawtext filter that burns the small gold
 * "Made with Bow Down Visuals" tag — bottom-center, semi-transparent,
 * with a soft black border so it reads on any background.
 * `width` is the output video/still width in px.
 */
export function attributionDrawtext(
  fontfile: string,
  width: number,
  opts: AttributionTagOpts = {},
): string {
  const size = opts.fontSize ?? Math.max(14, Math.round(width / 40));
  const color = opts.color ?? "0xFFD75E@0.75";
  const y = opts.anchor === "top" ? `${size + 18}` : `h-${size + 18}`;
  return (
    `drawtext=fontfile='${fontfile}':text='${escapeDrawtext(ATTRIBUTION_TEXT)}':` +
    `fontsize=${size}:fontcolor=${color}:x=(w-text_w)/2:y=${y}:` +
    `borderw=1:bordercolor=0x000000@0.6`
  );
}
