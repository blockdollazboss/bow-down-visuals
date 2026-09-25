import type {
  ColorCorrectionSettings,
  ChromaKeySettings,
  ProToolsSettings,
} from "./editor-settings";

/* ── Pro Tools → CSS preview ─────────────────────────────────────────────
 * Mirrors the server-side buildProToolsFilterChain() (pro-tools-ffmpeg.ts) so
 * the master player's live preview matches the burned export. Keep the two
 * in lockstep: any mapping change here must be reflected there.
 *
 * Mapping notes (approximations — CSS filter functions are multiplicative):
 *  brightness -100..100 → brightness(0..2)
 *  contrast   -100..100 → contrast(0..2)
 *  saturation -100..100 → saturate(0..2)
 *  exposure   -100..100 → folded into brightness (additive lift)
 *  temperature -100..100 → sepia() amount + hue shift (warm = sepia, cool = hue-rotate blue)
 *  tint       -100..100 → hue-rotate small shift (green↔magenta)
 *  highlights/shadows   → brightness/contrast nudge (CSS has no selective range)
 *  vibrance   -100..100 → saturate() scaled (CSS saturate is the closest analog)
 */

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** CSS `filter` string for live preview of manual color correction. */
export function buildProToolsCssFilter(cc: ColorCorrectionSettings): string {
  const parts: string[] = [];
  const pct = (v: number) => `${clamp(100 + v, 0, 200)}%`;

  // Exposure folds into brightness (both are additive lifts in the FFmpeg eq mapping).
  const bright = clamp(cc.brightness + cc.exposure * 0.6, -100, 100);
  if (bright !== 0) parts.push(`brightness(${pct(bright)})`);

  const contrast = clamp(cc.contrast + cc.highlights * 0.25 - cc.shadows * 0.15, -100, 100);
  if (contrast !== 0) parts.push(`contrast(${pct(contrast)})`);

  // Vibrance ≈ selective saturation; CSS saturate is the closest analog.
  const sat = clamp(cc.saturation + cc.vibrance * 0.7, -100, 100);
  if (sat !== 0) parts.push(`saturate(${pct(sat)})`);

  if (cc.temperature > 0) {
    parts.push(`sepia(${clamp(cc.temperature * 0.55, 0, 55)}%)`);
  } else if (cc.temperature < 0) {
    parts.push(`hue-rotate(${clamp(cc.temperature * 0.35, -35, 0)}deg)`);
    parts.push(`saturate(${pct(clamp(sat + 12, -100, 100))})`);
  }
  if (cc.tint !== 0) parts.push(`hue-rotate(${clamp(cc.tint * 0.3, -30, 30)}deg)`);

  return parts.join(" ");
}

/** CSS `transform` string for live preview of rotate/flip. */
export function buildProToolsTransform(pt: ProToolsSettings): string {
  const parts: string[] = [];
  if (pt.rotation !== 0) parts.push(`rotate(${pt.rotation}deg)`);
  const sx = pt.flipH ? -1 : 1;
  const sy = pt.flipV ? -1 : 1;
  if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);
  return parts.join(" ");
}

/** CSS `clip-path` for live preview of crop. Returns undefined when crop is off. */
export function buildProToolsClipPath(
  pt: ProToolsSettings,
  sourceAspect: number | null,
): string | undefined {
  const crop = pt.crop;
  if (!crop.enabled) return undefined;
  let x = 0, y = 0, w = 1, h = 1;
  if (crop.aspect === "free") {
    ({ x, y, w, h } = crop);
  } else if (sourceAspect && sourceAspect > 0) {
    const target = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5 }[crop.aspect];
    if (sourceAspect > target) {
      // Source wider → crop sides.
      w = target / sourceAspect;
      x = (1 - w) / 2;
    } else {
      // Source taller → crop top/bottom.
      h = sourceAspect / target;
      y = (1 - h) / 2;
    }
  } else {
    return undefined;
  }
  const f = (n: number) => `${(clamp(n, 0, 1) * 100).toFixed(2)}%`;
  return `inset(${f(y)} ${f(1 - x - w)} ${f(1 - y - h)} ${f(x)})`;
}

/* ── Free smart tools (client-side, no credits) ─────────────────────────── */

/** Draw the video's current frame to a small canvas and return pixel data. */
function samplePixels(video: HTMLVideoElement, size = 64): ImageData | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = Math.max(1, Math.round((size * video.videoHeight) / Math.max(1, video.videoWidth)));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null; // CORS-tainted canvas — can't sample cross-origin frames.
  }
}

/**
 * FREE auto-levels: histogram-based black/white point analysis.
 * Returns suggested { brightness, contrast, exposure } adjustments (-100..100).
 * Runs fully client-side — no credits, instant.
 */
export function autoLevelsFromFrame(
  video: HTMLVideoElement,
): { brightness: number; contrast: number; exposure: number } | null {
  const img = samplePixels(video, 96);
  if (!img) return null;
  const { data } = img;
  const hist = new Array<number>(256).fill(0);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    // Luminance (Rec. 601).
    const l = Math.round(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!);
    hist[l]!++;
    n++;
  }
  if (n === 0) return null;
  // Find 1st and 99th percentile (robust black/white points).
  const lo = n * 0.01;
  const hi = n * 0.99;
  let acc = 0, black = 0, white = 255;
  for (let i = 0; i < 256; i++) {
    acc += hist[i]!;
    if (acc >= lo && black === 0 && i > 0) black = i;
    if (acc >= hi) { white = i; break; }
  }
  const range = Math.max(1, white - black);
  // Map to slider space: stretch range → contrast, recenter → brightness/exposure.
  const contrast = clamp(Math.round(((255 / range) - 1) * 100), -40, 60);
  const midIn = (black + white) / 2;
  const midOut = 128 + contrast * 0.4;
  const lift = clamp(Math.round(((midOut - midIn) / 255) * 160), -50, 50);
  return {
    brightness: clamp(Math.round(lift * 0.6), -100, 100),
    contrast,
    exposure: clamp(Math.round(lift * 0.5), -100, 100),
  };
}

/**
 * FREE chroma auto-key: scans the frame for the dominant green/blue background
 * color and suggests a key color + similarity. Returns null when no clear
 * green/blue dominant color is found (or the canvas is CORS-tainted).
 */
export function detectChromaColor(
  video: HTMLVideoElement,
): { color: string; similarity: number } | null {
  const img = samplePixels(video, 64);
  if (!img) return null;
  const { data } = img;
  // Bucket hues: count strongly-green and strongly-blue pixels.
  let green = 0, blue = 0;
  let gR = 0, gG = 0, gB = 0, bR = 0, bG = 0, bB = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < 40) continue; // near-gray — not a key candidate.
    if (g === mx && g > r * 1.25 && g > b * 1.1) {
      green++; gR += r; gG += g; gB += b;
    } else if (b === mx && b > r * 1.25 && b > g * 1.05) {
      blue++; bR += r; bG += g; bB += b;
    }
  }
  const total = data.length / 4;
  const pickGreen = green >= blue && green > total * 0.12;
  const pickBlue = blue > green && blue > total * 0.12;
  if (!pickGreen && !pickBlue) return null;
  const toHex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  if (pickGreen) {
    const c = `#${toHex(gR / green)}${toHex(gG / green)}${toHex(gB / green)}`;
    return { color: c, similarity: clamp(Math.round(28 + (green / total) * 40), 20, 60) };
  }
  const c = `#${toHex(bR / blue)}${toHex(bG / blue)}${toHex(bB / blue)}`;
  return { color: c, similarity: clamp(Math.round(28 + (blue / total) * 40), 20, 60) };
}

/** Capture the current video frame as a JPEG data URL (for the AI auto-grade endpoint). */
export function captureFrameDataUrl(video: HTMLVideoElement, maxW = 640): string | null {
  try {
    const scale = Math.min(1, maxW / Math.max(1, video.videoWidth));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    if (!canvas.width || !canvas.height) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    return null;
  }
}

/** Sample a single pixel's hex color from the video frame at normalized (0..1) coords. */
export function samplePixelHex(video: HTMLVideoElement, nx: number, ny: number): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (!canvas.width || !canvas.height) return null;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    const px = ctx.getImageData(
      clamp(Math.round(nx * canvas.width), 0, canvas.width - 1),
      clamp(Math.round(ny * canvas.height), 0, canvas.height - 1),
      1, 1,
    ).data;
    const toHex = (v: number) => v.toString(16).padStart(2, "0");
    return `#${toHex(px[0]!)}${toHex(px[1]!)}${toHex(px[2]!)}`;
  } catch {
    return null;
  }
}

export type { ChromaKeySettings };
