/* ── Colour curves math + preview scopes (Stack 5 #2 / #3) ───────────────
 * Pure functions, shared by the curve editor UI and its tests. The server
 * mirror of the curve→ffmpeg mapping lives in api-server pro-tools-ffmpeg.ts
 * (buildCurvesFilter) — keep the point format identical: {x, y} in 0..1.
 *
 * Scopes are computed from a downscaled preview frame (the UI analyses at
 * 160px wide and says so). They are display-only analysis: nothing here
 * feeds export.
 */

import type { ColorCurves, CurvePoint } from "@/lib/editor-settings";

export const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/** Sort + clamp curve points and pin the endpoints to x=0 / x=1. */
export function normalizeCurvePoints(points: CurvePoint[] | null | undefined): CurvePoint[] {
  const pts = (points ?? [])
    .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }))
    .sort((a, b) => a.x - b.x);
  if (pts.length === 0) return [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  if (pts[0]!.x > 0) pts.unshift({ x: 0, y: pts[0]!.y });
  if (pts[pts.length - 1]!.x < 1) pts.push({ x: 1, y: pts[pts.length - 1]!.y });
  return pts;
}

/** Evaluate a curve at input level x (piecewise-linear between points). */
export function curveValueAt(points: CurvePoint[] | null | undefined, x: number): number {
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

/** SVG path (viewBox 0 0 100 100, y flipped) sampling the curve smoothly. */
export function curveSvgPath(points: CurvePoint[], samples = 24): string {
  const parts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const x = i / samples;
    const y = curveValueAt(points, x);
    parts.push(`${i === 0 ? "M" : "L"}${(x * 100).toFixed(1)},${((1 - y) * 100).toFixed(1)}`);
  }
  return parts.join(" ");
}

export type CurveChannelId = "all" | "r" | "g" | "b" | "h" | "s" | "l";

export function getCurveChannel(curves: ColorCurves, channel: CurveChannelId): CurvePoint[] {
  return channel === "all" || channel === "r" || channel === "g" || channel === "b"
    ? curves.rgb[channel]
    : curves.hsl[channel];
}

export function setCurveChannel(curves: ColorCurves, channel: CurveChannelId, points: CurvePoint[]): ColorCurves {
  const next: ColorCurves = {
    rgb: { ...curves.rgb },
    hsl: { ...curves.hsl },
  };
  if (channel === "all" || channel === "r" || channel === "g" || channel === "b") next.rgb[channel] = points;
  else next.hsl[channel] = points;
  return next;
}

/* ── Scopes ────────────────────────────────────────────────────────────── */

export interface ScopeData {
  /** Per-channel + luma histograms, 32 bins, counts normalized 0..1. */
  histogram: { r: number[]; g: number[]; b: number[]; luma: number[] };
  /** Waveform density [xBin][lumaBin], 0..1 — luma distribution per column. */
  waveform: number[][];
  /** Vectorscope density [vBin][uBin], 0..1 — chroma scatter (U horizontal, V vertical). */
  vectorscope: number[][];
  /** Pixels actually analysed (after downscale) — shown honestly in the UI. */
  sampledPixels: number;
  width: number;
  height: number;
}

export const SCOPE_BINS = 32;

/**
 * Compute histogram + waveform + vectorscope from raw RGBA pixels.
 * Waveform/vectorscope are density grids normalized by their peak cell so
 * the UI can render them as intensity maps.
 */
export function computeScopes(data: Uint8ClampedArray, width: number, height: number): ScopeData {
  const bins = SCOPE_BINS;
  const hist = {
    r: new Array<number>(bins).fill(0), g: new Array<number>(bins).fill(0),
    b: new Array<number>(bins).fill(0), luma: new Array<number>(bins).fill(0),
  };
  const waveform: number[][] = Array.from({ length: bins }, () => new Array<number>(bins).fill(0));
  const vectorscope: number[][] = Array.from({ length: bins }, () => new Array<number>(bins).fill(0));
  let sampled = 0;
  let wavePeak = 0, vecPeak = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i]! / 255, g = data[i + 1]! / 255, b = data[i + 2]! / 255;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const bin = (v: number) => Math.min(bins - 1, Math.floor(v * bins));
      hist.r[bin(r)]!++; hist.g[bin(g)]!++; hist.b[bin(b)]!++; hist.luma[bin(luma)]!++;
      const xBin = Math.min(bins - 1, Math.floor((x / Math.max(1, width)) * bins));
      const wv = ++waveform[xBin]![bin(luma)]!;
      if (wv > wavePeak) wavePeak = wv;
      // BT.601 chroma, recentred to 0..1 (u,v ∈ [-0.5, 0.5] approx).
      const u = -0.14713 * r - 0.28886 * g + 0.436 * b + 0.5;
      const v = 0.615 * r - 0.51499 * g - 0.10001 * b + 0.5;
      const vs = ++vectorscope[bin(clamp01(v))]![bin(clamp01(u))]!;
      if (vs > vecPeak) vecPeak = vs;
      sampled++;
    }
  }
  const normHist = (arr: number[]) => {
    const peak = Math.max(1, ...arr);
    return arr.map((n) => n / peak);
  };
  const normGrid = (grid: number[][], peak: number) =>
    grid.map((row) => row.map((n) => (peak > 0 ? n / peak : 0)));
  return {
    histogram: { r: normHist(hist.r), g: normHist(hist.g), b: normHist(hist.b), luma: normHist(hist.luma) },
    waveform: normGrid(waveform, wavePeak),
    vectorscope: normGrid(vectorscope, vecPeak),
    sampledPixels: sampled,
    width, height,
  };
}
