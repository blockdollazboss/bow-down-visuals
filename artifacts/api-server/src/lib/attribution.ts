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

/** Coerce FormData-style "true"/"false" strings so multipart callers (thumbnails) work too. */
const coerceAttributionFlag = (v: unknown): unknown =>
  typeof v === "string" ? v.trim().toLowerCase() === "true" : v;

/** zod field for paid exports: opt-in, default off. */
export const attributionOptIn = () =>
  z
    .preprocess(coerceAttributionFlag, z.boolean().optional().default(false))
    .describe("Opt-in: burn the gold \"Made with Bow Down Visuals\" credit into the export.");

/** zod field for free/bonus exports: default ON, removable only via the watermark-removal upsell. */
export const attributionDefaultOn = () =>
  z
    .preprocess(coerceAttributionFlag, z.boolean().optional().default(true))
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

/**
 * Burn the quiet gold "Made with Bow Down Visuals" credit into a PNG/JPG
 * still (bottom-right corner, small, semi-transparent — the playbook for
 * image exports where the creator's own headline/logo owns the center).
 * Returns the original buffer unchanged when no font is available.
 */
export async function burnAttributionIntoImage(
  image: Uint8Array,
  width: number,
): Promise<Buffer> {
  const fontfile = await resolveAttributionFont();
  if (!fontfile) return Buffer.from(image) as Buffer;
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const { writeFile, readFile, mkdtemp, rm } = await import("fs/promises");
  const { tmpdir } = await import("os");
  const { join } = await import("path");
  const execFileAsync = promisify(execFile);

  const size = Math.max(12, Math.round(width / 64));
  const tag =
    `drawtext=fontfile='${fontfile}':text='${escapeDrawtext(ATTRIBUTION_TEXT)}':` +
    `fontsize=${size}:fontcolor=0xFFD75E@0.7:x=w-text_w-14:y=h-${size + 12}:` +
    `borderw=1:bordercolor=0x000000@0.6`;

  const workDir = await mkdtemp(join(tmpdir(), "bdv-attr-"));
  const inPath = join(workDir, "in.png");
  const outPath = join(workDir, "out.png");
  try {
    await writeFile(inPath, image);
    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", inPath, "-vf", tag, "-frames:v", "1", outPath],
      { timeout: 60_000 },
    );
    const out = await readFile(outPath);
    // Normalize to Buffer<ArrayBuffer> for downstream upload helpers.
    return Buffer.from(out.buffer, out.byteOffset, out.byteLength) as Buffer;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
