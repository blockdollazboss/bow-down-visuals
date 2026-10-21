/* ── Pro Tools → FFmpeg filter translation ─────────────────────────────────
 * SINGLE source of truth for the Pro Tools tab's export mapping. The master
 * player's live preview (pro-tools-preview.ts) mirrors these mappings in CSS —
 * keep the two in lockstep so the burned export matches what the user saw.
 *
 * Filter-chain order (per clip, applied BEFORE normalizeClip scales to target):
 *   1. speed    → setpts (video timing)
 *   2. reverse  → reverse (frame order)
 *   3. crop     → crop (creative crop, aspect presets or free rect)
 *   4. rotate   → transpose (90/180/270)
 *   5. flip     → hflip / vflip
 *   6. color    → eq + colorbalance + vibrance (the SLIDERS)
 *   6b. curves  → ffmpeg curves (RGB, exact) then the HSL approximation —
 *                 curves COMPOSE AFTER the sliders: a curve-adjusted clip is
 *                 never collapsed back to a nearest preset. HSL mapping:
 *                 L curve → curves master (exact for lightness); S curve →
 *                 eq saturation sampled at mid-tones; H curve → hue shift
 *                 sampled at mid-tones (both documented approximations —
 *                 ffmpeg has no per-level HSL curve filter).
 *   7. chroma   → chromakey + composite over bg color (drawbox+overlay trick)
 *
 * Mapping table (UI slider -100..100 → FFmpeg):
 *  brightness  → eq=brightness=(b/100)*0.5            [-1..1]
 *  exposure    → folded into eq brightness (+e/100*0.5)
 *  contrast    → eq=contrast=1+(c/100)                  [0..2]
 *  saturation  → eq=saturation=1+(s/100)                [0..2]
 *  temperature → colorbalance warm/cool shift on mids+highlights
 *                warm (+): rm/gm up, bm down (red/green lift, blue cut)
 *  tint        → colorbalance green↔magenta (gm down = magenta)
 *  highlights  → colorbalance rh/gh/bh lift
 *  shadows     → colorbalance rs/gs/bs lift
 *  vibrance    → vibrance=intensity=(v/100)*2           [-2..2]
 *  speed       → setpts=(1/speed)*PTS
 *  reverse     → reverse
 *  rotation 90 → transpose=1 | 180 → transpose=1,transpose=1 | 270 → transpose=2
 *  flipH/flipV → hflip / vflip
 *  crop aspect → crop='if(gt(iw/ih,A),ih*A,iw)':'if(gt(iw/ih,A),ih,iw/A)'
 *  crop free   → crop=iw*W:ih*H:iw*X:ih*Y
 *  chroma      → chromakey=0xRRGGBB:sim:blend → composite over bg via
 *                split + drawbox(fill) + overlay (works with unknown dims)
 */

export interface ProToolsColorCorrection {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  vibrance: number;
  exposure: number;
}

export interface ProToolsChromaKey {
  enabled: boolean;
  color: string;
  similarity: number;
  blend: number;
  bgColor: string;
}

export interface ProToolsCrop {
  enabled: boolean;
  aspect: "16:9" | "9:16" | "1:1" | "4:5" | "free";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CurvePointInput { x: number; y: number }

export interface ColorCurvesInput {
  rgb: { all: CurvePointInput[]; r: CurvePointInput[]; g: CurvePointInput[]; b: CurvePointInput[] };
  hsl: { h: CurvePointInput[]; s: CurvePointInput[]; l: CurvePointInput[] };
}

export interface ProToolsFilterInput {
  colorCorrection?: ProToolsColorCorrection | null;
  /** Colour curves (Stack 5 #2) — compose after the sliders, see header. */
  curves?: ColorCurvesInput | null;
  /** Custom speed-ramp segments (Stack 5 #4) — take precedence over speedCurve. */
  speedSegments?: { startT: number; endT: number; speed: number }[] | null;
  chromaKey?: ProToolsChromaKey | null;
  speed?: number | null;
  /** Variable speed curve (CapCut-style). Takes precedence over flat speed. */
  speedCurve?: SpeedCurvePoint[] | null;
  /** Keyframed animation. Applied as a pre-pass before other filters. */
  keyframes?: KeyframePoint[] | null;
  reverse?: boolean;
  rotation?: 0 | 90 | 180 | 270 | null;
  flipH?: boolean;
  flipV?: boolean;
  crop?: ProToolsCrop | null;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const f4 = (n: number) => n.toFixed(4);

/** Normalize "#abc" / "#aabbcc" / "aabbcc" → "0xAABBCC". Falls back to green. */
export function hexToFfmpegColor(hex: string | null | undefined): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return "0x00FF00";
  let h = m[1]!;
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `0x${h.toUpperCase()}`;
}

const ASPECT_RATIOS: Record<string, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:5": 4 / 5,
};

/**
 * Build the per-clip FFmpeg filter chain for pro tools.
 * Returns "" when nothing is active (caller should skip the extra pass).
 * The returned string is a filter_complex body: `[0:v]<chain>[ptout]`.
 */
export function buildProToolsFilterChain(input: ProToolsFilterInput): string {
  const parts: string[] = [];
  // Labels that need threading through the split/overlay chroma composite.
  let outLabel = "[ptout]";

  // ── 1. Speed ──
  const speed = input.speed ?? 1;
  if (Number.isFinite(speed) && speed !== 1 && speed >= 0.25 && speed <= 4) {
    parts.push(`setpts=${f4(1 / speed)}*PTS`);
  }

  // ── 2. Reverse ──
  if (input.reverse) parts.push("reverse");

  // ── 3. Crop ──
  const crop = input.crop;
  if (crop?.enabled) {
    if (crop.aspect === "free") {
      const x = clamp(crop.x, 0, 0.95), y = clamp(crop.y, 0, 0.95);
      const w = clamp(crop.w, 0.05, 1 - x), h = clamp(crop.h, 0.05, 1 - y);
      parts.push(`crop=iw*${f4(w)}:ih*${f4(h)}:iw*${f4(x)}:ih*${f4(y)}`);
    } else {
      const A = ASPECT_RATIOS[crop.aspect] ?? 16 / 9;
      const a = A.toFixed(6);
      // If source is wider than target → crop width; else crop height. Centered.
      parts.push(`crop='if(gt(iw/ih,${a}),ih*${a},iw)':'if(gt(iw/ih,${a}),ih,iw/${a})'`);
    }
  }

  // ── 4. Rotate ──
  const rot = input.rotation ?? 0;
  if (rot === 90) parts.push("transpose=1");
  else if (rot === 270) parts.push("transpose=2");
  else if (rot === 180) parts.push("transpose=1,transpose=1");

  // ── 5. Flip ──
  if (input.flipH) parts.push("hflip");
  if (input.flipV) parts.push("vflip");

  // ── 6. Color correction ──
  const cc = input.colorCorrection;
  if (cc) {
    const eqBits: string[] = [];
    const bright = clamp((cc.brightness / 100) * 0.5 + (cc.exposure / 100) * 0.5, -1, 1);
    const contrast = clamp(1 + cc.contrast / 100, 0, 3);
    const sat = clamp(1 + cc.saturation / 100, 0, 3);
    if (Math.abs(contrast - 1) > 0.001) eqBits.push(`contrast=${f4(contrast)}`);
    if (Math.abs(bright) > 0.001) eqBits.push(`brightness=${f4(bright)}`);
    if (Math.abs(sat - 1) > 0.001) eqBits.push(`saturation=${f4(sat)}`);
    if (eqBits.length > 0) parts.push(`eq=${eqBits.join(":")}`);

    // colorbalance: temperature / tint / highlights / shadows.
    const t = clamp(cc.temperature, -100, 100);
    const ti = clamp(cc.tint, -100, 100);
    const hl = clamp(cc.highlights, -100, 100);
    const sh = clamp(cc.shadows, -100, 100);
    const cbBits: string[] = [];
    // Temperature: warm (+) lifts red/green mids+highlights, cuts blue.
    if (t !== 0) {
      cbBits.push(`rm=${f4(t * 0.0008)}`, `gm=${f4(t * 0.0004)}`, `bm=${f4(-t * 0.0008)}`);
      cbBits.push(`rh=${f4(t * 0.0012)}`, `gh=${f4(t * 0.0006)}`, `bh=${f4(-t * 0.0012)}`);
    }
    // Tint: positive = magenta (cut green), negative = green.
    if (ti !== 0) {
      cbBits.push(`gm=${f4(-ti * 0.001)}`, `gs=${f4(-ti * 0.0006)}`, `gh=${f4(-ti * 0.001)}`);
    }
    // Highlights / shadows lift.
    if (hl !== 0) cbBits.push(`rh=${f4(hl * 0.001)}`, `gh=${f4(hl * 0.001)}`, `bh=${f4(hl * 0.001)}`);
    if (sh !== 0) cbBits.push(`rs=${f4(sh * 0.001)}`, `gs=${f4(sh * 0.001)}`, `bs=${f4(sh * 0.001)}`);
    if (cbBits.length > 0) parts.push(`colorbalance=${cbBits.join(":")}`);

    const vib = clamp(cc.vibrance, -100, 100);
    if (vib !== 0) parts.push(`vibrance=intensity=${f4((vib / 100) * 2)}`);
  }

  // ── 6b. Colour curves (after sliders, documented in the header) ──
  if (input.curves) parts.push(...buildCurvesFilters(input.curves));

  if (parts.length === 0 && !input.chromaKey?.enabled) return "";

  // ── 7. Chroma key (needs stream labels: split → bg fill + keyed fg → overlay) ──
  const ck = input.chromaKey;
  const chain = parts.join(",");
  if (ck?.enabled) {
    const keyColor = hexToFfmpegColor(ck.color);
    const sim = clamp(ck.similarity / 100, 0.01, 1);
    const blend = clamp(ck.blend / 100, 0, 1);
    const bg = hexToFfmpegColor(ck.bgColor);
    // drawbox t=fill paints the whole frame — works without knowing dims.
    const pre = chain ? `${chain},` : "";
    return (
      `[0:v]${pre}split=2[ckbg][ckfg];` +
      `[ckbg]drawbox=c=${bg}:t=fill,format=yuv420p[ckbg2];` +
      `[ckfg]chromakey=${keyColor}:${sim.toFixed(3)}:${blend.toFixed(3)},format=yuva420p[ckfg2];` +
      `[ckbg2][ckfg2]overlay=0:0:format=yuv420${outLabel}`
    );
  }

  return `[0:v]${chain}${outLabel}`;
}

/** True when the input would produce a non-empty filter chain. */
export function proToolsFilterActive(input: ProToolsFilterInput): boolean {
  return buildProToolsFilterChain(input).length > 0;
}

/* ─── Colour curves (Stack 5 #2) ────────────────────────────────────────── */

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/** Normalize curve points the same way the editor does (sort, pin ends). */
export function normalizeCurvePoints(points: CurvePointInput[] | null | undefined): CurvePointInput[] {
  const pts = (points ?? [])
    .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }))
    .sort((a, b) => a.x - b.x);
  if (pts.length === 0) return [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  if (pts[0]!.x > 0) pts.unshift({ x: 0, y: pts[0]!.y });
  if (pts[pts.length - 1]!.x < 1) pts.push({ x: 1, y: pts[pts.length - 1]!.y });
  return pts;
}

export function curveIsIdentity(points: CurvePointInput[] | null | undefined): boolean {
  return normalizeCurvePoints(points).every((p) => Math.abs(p.y - p.x) <= 0.005);
}

function pointsArg(points: CurvePointInput[]): string {
  return normalizeCurvePoints(points).map((p) => `${p.x.toFixed(3)}/${p.y.toFixed(3)}`).join(" ");
}

/** Value of a curve at x — used to sample the HSL S/H approximations. */
export function curveValueAt(points: CurvePointInput[] | null | undefined, x: number): number {
  const pts = normalizeCurvePoints(points);
  const cx = clamp01(x);
  if (cx <= pts[0]!.x) return pts[0]!.y;
  if (cx >= pts[pts.length - 1]!.x) return pts[pts.length - 1]!.y;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    if (cx >= a.x && cx <= b.x) {
      const f = (cx - a.x) / (b.x - a.x || 1);
      return a.y + (b.y - a.y) * f;
    }
  }
  return cx;
}

/**
 * Curves → ffmpeg filters, in composition order:
 *   1. RGB curves exactly via `curves` (all/r/g/b in one filter instance).
 *   2. HSL lightness via a second `curves` master pass (exact for L).
 *   3. HSL saturation/hue sampled at mid-tones (x=0.5) — approximations,
 *      because ffmpeg exposes no per-level HSL curve; the editor labels
 *      them as such. Identity channels emit nothing.
 */
export function buildCurvesFilters(curves: ColorCurvesInput): string[] {
  const out: string[] = [];
  const rgbBits: string[] = [];
  if (!curveIsIdentity(curves.rgb.all)) rgbBits.push(`all='${pointsArg(curves.rgb.all)}'`);
  if (!curveIsIdentity(curves.rgb.r)) rgbBits.push(`r='${pointsArg(curves.rgb.r)}'`);
  if (!curveIsIdentity(curves.rgb.g)) rgbBits.push(`g='${pointsArg(curves.rgb.g)}'`);
  if (!curveIsIdentity(curves.rgb.b)) rgbBits.push(`b='${pointsArg(curves.rgb.b)}'`);
  if (rgbBits.length > 0) out.push(`curves=${rgbBits.join(":")}`);

  if (!curveIsIdentity(curves.hsl.l)) {
    out.push(`curves=all='${pointsArg(curves.hsl.l)}'`);
  }
  if (!curveIsIdentity(curves.hsl.s)) {
    const mid = curveValueAt(curves.hsl.s, 0.5);
    const sat = clamp(mid / 0.5, 0, 3);
    if (Math.abs(sat - 1) > 0.01) out.push(`eq=saturation=${sat.toFixed(4)}`);
  }
  if (!curveIsIdentity(curves.hsl.h)) {
    const shift = (curveValueAt(curves.hsl.h, 0.5) - 0.5) * 360;
    if (Math.abs(shift) > 0.5) out.push(`hue=h=${shift.toFixed(2)}`);
  }
  return out;
}

/* ─── Speed curves ──────────────────────────────────────────────────────── */

export interface SpeedCurvePoint {
  t: number;     // normalized 0-1
  speed: number; // 0.25-4
}

/** Linear interpolation of speed at normalized time t. */
export function speedAt(curve: SpeedCurvePoint[], t: number): number {
  if (curve.length === 0) return 1;
  const clamped = Math.min(1, Math.max(0, t));
  const sorted = [...curve].sort((a, b) => a.t - b.t);
  if (clamped <= sorted[0]!.t) return sorted[0]!.speed;
  if (clamped >= sorted[sorted.length - 1]!.t) return sorted[sorted.length - 1]!.speed;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!, b = sorted[i + 1]!;
    if (clamped >= a.t && clamped <= b.t) {
      const f = (clamped - a.t) / (b.t - a.t || 1);
      return a.speed + (b.speed - a.speed) * f;
    }
  }
  return 1;
}

/**
 * Build a filter_complex that applies a variable speed curve by splitting
 * into N segments, applying setpts per segment, and concatenating.
 * Returns the filter string; caller must provide clip duration.
 */
export function buildSpeedCurveFilter(curve: SpeedCurvePoint[], durationSec: number, segments = 10): string {
  if (curve.length === 0 || durationSec <= 0) return "";
  const segDur = durationSec / segments;
  const splitLabels = Array.from({ length: segments }, (_, i) => `[s${i}]`).join("");
  const parts: string[] = [`[0:v]split=${segments}${splitLabels}`];

  const concatInputs: string[] = [];
  for (let i = 0; i < segments; i++) {
    const tMid = (i + 0.5) / segments;
    const speed = Math.min(4, Math.max(0.25, speedAt(curve, tMid)));
    const start = (i * segDur).toFixed(3);
    const end = ((i + 1) * segDur).toFixed(3);
    const outLabel = `[sg${i}]`;
    parts.push(`[s${i}]trim=start=${start}:end=${end},setpts=${f4(1 / speed)}*PTS${outLabel}`);
    concatInputs.push(outLabel);
  }
  parts.push(`${concatInputs.join("")}concat=n=${segments}:v=1:a=0[ptout]`);
  return parts.join(";");
}

/* ─── Custom speed segments (Stack 5 #4) ──────────────────────────────── */

export interface SpeedSegmentInput { startT: number; endT: number; speed: number }

/** Normalize segments into a tiling of [0,1] — mirrors the editor model
 *  (frontend lib/motion-pro.ts normalizeSpeedSegments). */
export function normalizeSpeedSegments(
  segments: SpeedSegmentInput[] | null | undefined,
): SpeedSegmentInput[] {
  const segs = (segments ?? [])
    .filter((x) => x && Number.isFinite(x.startT) && Number.isFinite(x.endT) && x.endT > x.startT)
    .map((x) => ({
      startT: clamp(x.startT, 0, 1),
      endT: clamp(x.endT, 0, 1),
      speed: clamp(Number.isFinite(x.speed) ? x.speed : 1, 0.25, 4),
    }))
    .filter((x) => x.endT > x.startT)
    .sort((a, b) => a.startT - b.startT);
  if (segs.length === 0) return [{ startT: 0, endT: 1, speed: 1 }];
  const out: SpeedSegmentInput[] = [];
  let cursor = 0;
  for (const seg of segs) {
    const startT = cursor;
    const endT = Math.min(1, Math.max(seg.endT, startT + 0.01));
    out.push({ ...seg, startT, endT });
    cursor = endT;
    if (cursor >= 1) break;
  }
  if (cursor < 1) out[out.length - 1] = { ...out[out.length - 1]!, endT: 1 };
  return out;
}

/**
 * Apply custom speed segments via the existing segment machinery:
 * split → trim each segment's window → per-segment setpts → concat.
 * Video-only like buildSpeedCurveFilter (the export's audio is the song
 * track, which is not retimed — same as preset curves today).
 */
export function buildSpeedSegmentsFilter(
  segments: SpeedSegmentInput[], durationSec: number,
): string {
  if (!segments?.length || durationSec <= 0) return "";
  const segs = normalizeSpeedSegments(segments);
  if (segs.length === 1 && segs[0]!.speed === 1) return "";
  const splitLabels = segs.map((_, i) => `[ss${i}]`).join("");
  const parts: string[] = [`[0:v]split=${segs.length}${splitLabels}`];
  const concatInputs: string[] = [];
  segs.forEach((seg, i) => {
    const start = (seg.startT * durationSec).toFixed(3);
    const end = (seg.endT * durationSec).toFixed(3);
    parts.push(`[ss${i}]trim=start=${start}:end=${end},setpts=${f4(1 / seg.speed)}*PTS[sg${i}]`);
    concatInputs.push(`[sg${i}]`);
  });
  parts.push(`${concatInputs.join("")}concat=n=${segs.length}:v=1:a=0[ptout]`);
  return parts.join(";");
}

/* ─── Keyframes ───────────────────────────────────────────────────────── */

export interface KeyframePoint {
  id: string;
  time: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  /** Bézier easing handles (Stack 5 #8) for the segment starting at this
   *  keyframe (easeOutCp) / ending at this keyframe (easeInCp). Absent =
   *  legacy smoothstep — old projects render identically. */
  easeOutCp?: { x: number; y: number };
  easeInCp?: { x: number; y: number };
}

/** Cubic bézier easing — mirror of frontend lib/motion-pro.ts cubicBezierY. */
export function cubicBezierY(
  cp1: { x: number; y: number }, cp2: { x: number; y: number }, x: number,
): number {
  const cx = clamp(x, 0, 1);
  if (cx === 0 || cx === 1) return cx;
  const bx = (t: number) => 3 * (1 - t) ** 2 * t * cp1.x + 3 * (1 - t) * t ** 2 * cp2.x + t ** 3;
  const by = (t: number) => 3 * (1 - t) ** 2 * t * cp1.y + 3 * (1 - t) * t ** 2 * cp2.y + t ** 3;
  let t = cx;
  for (let i = 0; i < 8; i++) {
    const err = bx(t) - cx;
    if (Math.abs(err) < 1e-5) return by(t);
    const d = 3 * (1 - t) ** 2 * cp1.x + 6 * (1 - t) * t * (cp2.x - cp1.x) + 3 * t ** 2 * (1 - cp2.x);
    if (Math.abs(d) < 1e-6) break;
    t = clamp(t - err / d, 0, 1);
  }
  let lo = 0, hi = 1;
  t = cx;
  for (let i = 0; i < 20; i++) {
    if (bx(t) < cx) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return by(t);
}

const SMOOTHSTEP_OUT = { x: 0.33, y: 0 };
const SMOOTHSTEP_IN = { x: 0.67, y: 1 };

/** Eased fraction for segment a→b; smoothstep when no handles are set. */
export function easedFraction(a: KeyframePoint, b: KeyframePoint, f: number): number {
  if (!a.easeOutCp && !b.easeInCp) return f * f * (3 - 2 * f);
  return cubicBezierY(a.easeOutCp ?? SMOOTHSTEP_OUT, b.easeInCp ?? SMOOTHSTEP_IN, clamp(f, 0, 1));
}

/** Interpolate keyframe values at time t (seconds). */
export function keyframeAt(kfs: KeyframePoint[], t: number): { x: number; y: number; scale: number; rotation: number; opacity: number } {
  const neutral = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };
  if (kfs.length === 0) return neutral;
  const sorted = [...kfs].sort((a, b) => a.time - b.time);
  if (t <= sorted[0]!.time) {
    const k = sorted[0]!;
    return { x: k.x, y: k.y, scale: k.scale, rotation: k.rotation, opacity: k.opacity };
  }
  if (t >= sorted[sorted.length - 1]!.time) {
    const k = sorted[sorted.length - 1]!;
    return { x: k.x, y: k.y, scale: k.scale, rotation: k.rotation, opacity: k.opacity };
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!, b = sorted[i + 1]!;
    if (t >= a.time && t <= b.time) {
      const f = (t - a.time) / (b.time - a.time || 1);
      const e = easedFraction(a, b, f);
      return {
        x: a.x + (b.x - a.x) * e,
        y: a.y + (b.y - a.y) * e,
        scale: a.scale + (b.scale - a.scale) * e,
        rotation: a.rotation + (b.rotation - a.rotation) * e,
        opacity: a.opacity + (b.opacity - a.opacity) * e,
      };
    }
  }
  return neutral;
}

/**
 * Build a filter_complex that applies keyframed transforms by splitting
 * into N segments, applying per-segment scale/rotate/opacity, and concatenating.
 * Position (x,y) is implemented via crop offset for pan effects.
 */
/**
 * Adaptive approximation density (Stack 5 #8): the eased curve is rendered
 * through this segment approximation — NOT a true per-frame expression —
 * with denser sampling where the eased scale curve bends hardest
 * (up to 4x base, capped at 48 segments). Mirror of the frontend
 * planKeyframeSegments rule.
 */
export function planKeyframeSegments(kfs: KeyframePoint[], durationSec: number, baseSegments = 12, maxTotal = 48): number {
  if (kfs.length < 2 || durationSec <= 0) return Math.min(baseSegments, maxTotal);
  const N = 40;
  let curvature = 0;
  let prevSlope: number | null = null;
  let prevVal: number | null = null;
  for (let i = 0; i <= N; i++) {
    const v = keyframeAt(kfs, (i / N) * durationSec).scale;
    if (prevVal !== null) {
      const slope = v - prevVal;
      if (prevSlope !== null) curvature += Math.abs(slope - prevSlope);
      prevSlope = slope;
    }
    prevVal = v;
  }
  const density = 1 + Math.min(3, Math.floor(curvature * 6));
  return Math.min(maxTotal, baseSegments * density);
}

export function buildKeyframeFilter(kfs: KeyframePoint[], durationSec: number, segments?: number): string {
  if (kfs.length === 0 || durationSec <= 0) return "";
  if (segments === undefined) segments = planKeyframeSegments(kfs, durationSec);
  const segDur = durationSec / segments;
  const splitLabels = Array.from({ length: segments }, (_, i) => `[k${i}]`).join("");
  const parts: string[] = [`[0:v]split=${segments}${splitLabels}`];

  const concatInputs: string[] = [];
  for (let i = 0; i < segments; i++) {
    const tMid = (i + 0.5) * segDur;
    const kf = keyframeAt(kfs, tMid);
    const start = (i * segDur).toFixed(3);
    const end = ((i + 1) * segDur).toFixed(3);
    const outLabel = `[kg${i}]`;

    const filters: string[] = [`trim=start=${start}:end=${end}`, "setpts=PTS-STARTPTS"];
    // Scale
    if (Math.abs(kf.scale - 1) > 0.01) {
      filters.push(`scale=iw*${f4(kf.scale)}:ih*${f4(kf.scale)}`);
    }
    // Rotation (small angles only; large rotations need more complex handling)
    if (Math.abs(kf.rotation) > 0.5) {
      const rad = (kf.rotation * Math.PI / 180).toFixed(4);
      filters.push(`rotate=${rad}:fillcolor=black`);
    }
    // Opacity
    if (kf.opacity < 0.99) {
      filters.push(`format=rgba,colorchannelmixer=aa=${f4(kf.opacity)}`);
    }
    // Position via crop (pan effect) — offset the crop window
    if (Math.abs(kf.x - 0.5) > 0.01 || Math.abs(kf.y - 0.5) > 0.01) {
      const xOff = ((kf.x - 0.5) * 100).toFixed(1);
      const yOff = ((kf.y - 0.5) * 100).toFixed(1);
      filters.push(`crop=iw:ih:${xOff}:${yOff}`);
    }

    parts.push(`[k${i}]${filters.join(",")}${outLabel}`);
    concatInputs.push(outLabel);
  }
  parts.push(`${concatInputs.join("")}concat=n=${segments}:v=1:a=0[ptout]`);
  return parts.join(";");
}
