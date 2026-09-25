/* ── Shared CSS → FFmpeg effect translation ───────────────────────────────
 * SINGLE source of truth used by BOTH Export Doctor diagnostics
 * (export-doctor.ts) and the real export pipeline (export-video.ts). Do not
 * fork this logic — any change here must stay in lockstep with the master
 * player's EFFECT_CSS_FILTERS table (video-editor.tsx) so the burned export
 * matches the live CSS preview.
 *
 * Only color effects (eq / hue / colorchannelmixer / gblur) are export-safe
 * here; animated overlays (Smoke / Rain / Sparks / etc.) are intentionally
 * NOT in this map and remain preview-only. */

export const EFFECT_CSS_FILTERS: Record<string, string> = {
  "Film Grain": "contrast(108%) brightness(97%)",
  Glow: "brightness(118%) saturate(140%)",
  Blur: "blur(2px)",
  Sharpen: "contrast(125%) brightness(103%)",
  Vignette: "brightness(82%)",
  "Black & White": "grayscale(100%)",
  "Neon Glow": "hue-rotate(270deg) saturate(180%) brightness(115%)",
  VHS: "saturate(75%) contrast(112%) hue-rotate(8deg) brightness(92%)",
  "Cinematic Bars": "brightness(83%) contrast(112%)",
  "Camera Shake": "contrast(108%) saturate(105%)",
  "Slow Zoom": "saturate(115%) brightness(103%)",
  "Speed Ramp": "contrast(120%) brightness(98%)",
  "Warm Grade": "sepia(40%) saturate(135%) brightness(108%)",
  "Cool Grade": "hue-rotate(195deg) saturate(115%) brightness(94%)",
  "Teal & Orange": "hue-rotate(20deg) saturate(165%) contrast(110%)",
  "Moody Desaturated": "saturate(40%) contrast(120%) brightness(88%)",
  "Vibrant Pop": "saturate(210%) brightness(108%) contrast(106%)",
  "Street Night":
    "hue-rotate(230deg) saturate(145%) brightness(80%) contrast(128%)",
  "Luxury Gold": "sepia(65%) saturate(175%) brightness(112%) contrast(108%)",
  "Dark Drill": "brightness(72%) contrast(148%) saturate(55%)",
  "Cinematic Contrast": "contrast(155%) saturate(88%) brightness(90%)",
};

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/** Standard sepia matrix blended toward identity by `amount` (0..1). */
function sepiaColorMixer(amount: number): string {
  const a = clamp(amount, 0, 1);
  const id = (x: number) => 1 - a + a * x; // diagonal
  const off = (x: number) => a * x; // off-diagonal
  const rr = id(0.393),
    rg = off(0.769),
    rb = off(0.189);
  const gr = off(0.349),
    gg = id(0.686),
    gb = off(0.168);
  const br = off(0.272),
    bg = off(0.534),
    bb = id(0.131);
  const f = (x: number) => x.toFixed(4);
  return `colorchannelmixer=rr=${f(rr)}:rg=${f(rg)}:rb=${f(rb)}:gr=${f(gr)}:gg=${f(gg)}:gb=${f(gb)}:br=${f(br)}:bg=${f(bg)}:bb=${f(bb)}`;
}

/**
 * Translate the combined CSS filter string (exactly as the master player builds it)
 * into an FFmpeg filter chain. Returns "" when nothing translatable is present.
 */
export function cssToFfmpegChain(combinedCss: string): string {
  let brightnessMul = 1,
    contrastMul = 1,
    satMul = 1,
    hueDeg = 0,
    blurSigma = 0,
    sepiaAmt = 0;
  const re = /([a-z-]+)\(([^)]+)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(combinedCss)) !== null) {
    const fn = m[1]!.toLowerCase();
    const raw = m[2]!.trim();
    const num = parseFloat(raw);
    if (!Number.isFinite(num)) continue;
    const pct = raw.includes("%") ? num / 100 : num;
    switch (fn) {
      case "brightness":
        brightnessMul *= pct;
        break;
      case "contrast":
        contrastMul *= pct;
        break;
      case "saturate":
        satMul *= pct;
        break;
      case "grayscale":
        satMul *= 1 - pct;
        break;
      case "hue-rotate":
        hueDeg += num;
        break; // degrees
      case "blur":
        blurSigma = Math.max(blurSigma, num);
        break;
      case "sepia":
        sepiaAmt = Math.max(sepiaAmt, pct);
        break;
      default:
        break;
    }
  }
  const parts: string[] = [];
  if (sepiaAmt > 0) parts.push(sepiaColorMixer(sepiaAmt));
  // eq: CSS brightness is multiplicative → approximate as additive (mul-1)*0.5
  const eqBrightness = clamp((brightnessMul - 1) * 0.5, -1, 1);
  const eqContrast = clamp(contrastMul, 0, 3);
  const eqSaturation = clamp(satMul, 0, 3);
  const eqBits: string[] = [];
  if (Math.abs(eqContrast - 1) > 0.001)
    eqBits.push(`contrast=${eqContrast.toFixed(4)}`);
  if (Math.abs(eqBrightness) > 0.001)
    eqBits.push(`brightness=${eqBrightness.toFixed(4)}`);
  if (Math.abs(eqSaturation - 1) > 0.001)
    eqBits.push(`saturation=${eqSaturation.toFixed(4)}`);
  if (eqBits.length > 0) parts.push(`eq=${eqBits.join(":")}`);
  if (hueDeg !== 0)
    parts.push(`hue=h=${(((hueDeg % 360) + 360) % 360).toFixed(2)}`);
  if (blurSigma > 0) parts.push(`gblur=sigma=${blurSigma.toFixed(2)}`);
  return parts.join(",");
}

/* ── Named export-safe grades ────────────────────────────────────────────────
 * A few grades get DEDICATED FFmpeg chains instead of the lossy CSS→eq path so
 * the burned export actually looks like the master player (the generic sepia→eq
 * translation washed Luxury Gold out and the merged-eq path zeroed saturation
 * whenever Black & White was also active). */
export const BW_NAME = "Black & White";
export const LUXURY_GOLD_NAME = "Luxury Gold";
export const FILM_GRAIN_NAME = "Film Grain";

/** Pure desaturation — export-safe Black & White. */
export const BW_FFMPEG = "eq=saturation=0.0";

/** Real warm cinematic gold grade: warm balance, reduced blue/cool tones,
 *  increased contrast, gold highlights, cinematic saturation. */
export const LUXURY_GOLD_FFMPEG =
  "colorbalance=rs=0.06:gs=0.03:bs=-0.06:rm=0.08:gm=0.04:bm=-0.08:rh=0.12:gh=0.07:bh=-0.14,eq=contrast=1.12:saturation=1.30:brightness=0.02";

/** Black & White + Luxury Gold "blend both": gold-tinted monochrome so BOTH
 *  effects are visibly present (low saturation + strong warm gold cast). */
export const BW_GOLD_BLEND_FFMPEG =
  "eq=saturation=0.18,colorbalance=rm=0.10:gm=0.05:bm=-0.10:rh=0.16:gh=0.08:bh=-0.16,eq=contrast=1.12:brightness=0.02";

/** Real animated film grain — the old CSS-path translation ("contrast 108% /
 *  brightness 97%") contained no actual grain, so the export never looked like
 *  film. Temporal uniform noise + a whisper of the original contrast grade. */
export const FILM_GRAIN_FFMPEG =
  "noise=alls=7:allf=t,eq=contrast=1.08:brightness=-0.015";

/** Effects treated as color grades (vs. plain filters) for the comparison panel. */
export const COLOR_GRADE_NAMES = new Set<string>([
  "Warm Grade",
  "Cool Grade",
  "Teal & Orange",
  "Moody Desaturated",
  "Vibrant Pop",
  "Street Night",
  LUXURY_GOLD_NAME,
  "Dark Drill",
  "Cinematic Contrast",
  BW_NAME,
]);

export type EffectConflictMode = "bw-only" | "gold-only" | "blend";

export interface ExportEffectEntry {
  name: string;
  type: "color-grade" | "filter";
  scope: "global";
  intensity: number | null;
  opacity: number;
  blend: "normal";
  startSec: number;
  endSec: number;
  supported: boolean;
  applied: boolean;
  ffmpeg: string;
}

export interface EffectStackResult {
  filter: string;
  stack: ExportEffectEntry[];
  supported: string[];
  unsupported: string[];
  applied: string[];
  conflict: {
    detected: boolean;
    effects: string[];
    mode: EffectConflictMode;
    note: string;
  } | null;
  /** True only when every supported effect is actually applied and nothing is dropped. */
  stackMatch: boolean;
}

/** Resolve ONE effect name to an FFmpeg chain (dedicated grades first, else CSS path). */
export function ffmpegForEffect(name: string): {
  ffmpeg: string;
  supported: boolean;
  type: "color-grade" | "filter";
} {
  if (name === BW_NAME)
    return { ffmpeg: BW_FFMPEG, supported: true, type: "color-grade" };
  if (name === LUXURY_GOLD_NAME)
    return { ffmpeg: LUXURY_GOLD_FFMPEG, supported: true, type: "color-grade" };
  if (name === FILM_GRAIN_NAME)
    return { ffmpeg: FILM_GRAIN_FFMPEG, supported: true, type: "filter" };
  const css = EFFECT_CSS_FILTERS[name];
  if (!css) return { ffmpeg: "", supported: false, type: "filter" };
  const ffmpeg = cssToFfmpegChain(css);
  return {
    ffmpeg,
    supported: ffmpeg.length > 0,
    type: COLOR_GRADE_NAMES.has(name) ? "color-grade" : "filter",
  };
}

/**
 * Build the full export effect stack: each effect is chained SEQUENTIALLY (not
 * merged into one lossy eq), Black & White ↔ Luxury Gold conflicts are resolved
 * by `conflictMode`, and every effect is reported (supported / applied / ffmpeg)
 * so the UI can compare the master stack against what export actually burns.
 */
export function buildEffectStack(
  effects: string[],
  totalDuration: number,
  conflictMode: EffectConflictMode = "blend",
): EffectStackResult {
  const names = effects.filter((e) => typeof e === "string" && e.trim());
  const hasBW = names.includes(BW_NAME);
  const hasGold = names.includes(LUXURY_GOLD_NAME);
  const conflictDetected = hasBW && hasGold;

  const chains: string[] = [];
  const stack: ExportEffectEntry[] = [];
  const supported: string[] = [];
  const unsupported: string[] = [];
  const applied: string[] = [];

  for (const name of names) {
    const base = ffmpegForEffect(name);
    let isApplied = base.supported;
    let usedFfmpeg = base.ffmpeg;

    if (conflictDetected && (name === BW_NAME || name === LUXURY_GOLD_NAME)) {
      if (conflictMode === "bw-only") {
        isApplied = name === BW_NAME;
        usedFfmpeg = name === BW_NAME ? BW_FFMPEG : "";
      } else if (conflictMode === "gold-only") {
        isApplied = name === LUXURY_GOLD_NAME;
        usedFfmpeg = name === LUXURY_GOLD_NAME ? LUXURY_GOLD_FFMPEG : "";
      } else {
        // blend both — attribute the single blend chain to the Luxury Gold row
        isApplied = true;
        usedFfmpeg = name === LUXURY_GOLD_NAME ? BW_GOLD_BLEND_FFMPEG : "";
      }
    }

    stack.push({
      name,
      type: base.type,
      scope: "global",
      intensity: null,
      opacity: 1,
      blend: "normal",
      startSec: 0,
      endSec: totalDuration,
      supported: base.supported,
      applied: isApplied,
      ffmpeg: usedFfmpeg,
    });

    if (!base.supported) {
      unsupported.push(name);
      continue;
    }
    supported.push(name);
    if (isApplied) {
      applied.push(name);
      if (usedFfmpeg) chains.push(usedFfmpeg);
    }
  }

  const conflict = conflictDetected
    ? {
        detected: true,
        effects: [BW_NAME, LUXURY_GOLD_NAME],
        mode: conflictMode,
        note: "Black & White reduces color from Luxury Gold.",
      }
    : null;

  const stackMatch =
    supported.length > 0 &&
    applied.length === supported.length &&
    unsupported.length === 0;

  return {
    filter: chains.join(","),
    stack,
    supported,
    unsupported,
    applied,
    conflict,
    stackMatch,
  };
}
