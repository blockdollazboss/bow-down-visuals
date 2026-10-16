/* ── Custom speed segments + bézier keyframe easing (Stack 5 #4 / #8) ────
 * #4: a custom speed ramp is a list of segments that TILE the clip — each
 * segment plays at a constant speed. Presets (SPEED_CURVE_PRESETS) remain
 * the starting points: segmentsFromPresetCurve samples a preset curve into
 * segments; the user then edits segment boundaries/speeds directly. Export
 * applies segments through the same split/trim/setpts/concat machinery as
 * speed curves (server: buildSpeedSegmentsFilter), so preview math here
 * (speedAtSegments, outputDurationForSegments) matches the render.
 *
 * #8: keyframe segments ease with a cubic bézier whose control points live
 * on the keyframes (easeOutCp on the segment's first keyframe, easeInCp on
 * its last). Absent handles = the legacy smoothstep, so old projects render
 * identically. Export approximates the eased curve with the existing
 * segment approximation, sampling DENSER where curvature is high
 * (planKeyframeSegments) — the plan is computed here so editor and server
 * agree on the sampling rule; the server implements the same rule in
 * pro-tools-ffmpeg.ts (keep in lockstep).
 */

import type { Keyframe, SpeedCurvePoint, SpeedSegment } from "@/lib/editor-settings";
import { keyframeAt, type KeyframeTransform } from "@/lib/editor-settings";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
let segSeq = 0;
export const newSegmentId = () => `seg-${Date.now().toString(36)}-${++segSeq}`;

/* ── Speed segments ────────────────────────────────────────────────────── */

/** Normalize segments so they tile [0,1] with no gaps/overlaps: sorted,
 *  clamped speeds, first starts at 0, last ends at 1, boundaries shared. */
export function normalizeSpeedSegments(segments: SpeedSegment[] | null | undefined): SpeedSegment[] {
  const segs = (segments ?? [])
    .filter((s) => s && Number.isFinite(s.startT) && Number.isFinite(s.endT) && s.endT > s.startT)
    .map((s) => ({
      id: s.id || newSegmentId(),
      startT: clamp(s.startT, 0, 1),
      endT: clamp(s.endT, 0, 1),
      speed: clamp(s.speed, 0.25, 4),
    }))
    .filter((s) => s.endT > s.startT)
    .sort((a, b) => a.startT - b.startT);
  if (segs.length === 0) return [{ id: newSegmentId(), startT: 0, endT: 1, speed: 1 }];
  const out: SpeedSegment[] = [];
  let cursor = 0;
  for (const s of segs) {
    const startT = cursor;
    const endT = Math.max(s.endT, startT + 0.01);
    out.push({ ...s, startT, endT: Math.min(1, endT) });
    cursor = Math.min(1, endT);
    if (cursor >= 1) break;
  }
  if (cursor < 1) out[out.length - 1] = { ...out[out.length - 1]!, endT: 1 };
  return out;
}

/** Split one segment into a tiling list from a preset curve (sampled at
 *  segment midpoints), so presets become editable custom segments. */
export function segmentsFromPresetCurve(points: SpeedCurvePoint[], count = 4): SpeedSegment[] {
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const speedAtT = (t: number): number => {
    if (sorted.length === 0) return 1;
    if (t <= sorted[0]!.t) return sorted[0]!.speed;
    if (t >= sorted[sorted.length - 1]!.t) return sorted[sorted.length - 1]!.speed;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]!, b = sorted[i + 1]!;
      if (t >= a.t && t <= b.t) {
        const f = (t - a.t) / (b.t - a.t || 1);
        return a.speed + (b.speed - a.speed) * f;
      }
    }
    return 1;
  };
  const segs: SpeedSegment[] = [];
  for (let i = 0; i < count; i++) {
    segs.push({
      id: newSegmentId(),
      startT: i / count,
      endT: (i + 1) / count,
      speed: Math.round(clamp(speedAtT((i + 0.5) / count), 0.25, 4) * 100) / 100,
    });
  }
  return segs;
}

/** Speed at normalized time t under the segment model. */
export function speedAtSegments(segments: SpeedSegment[], t: number): number {
  const segs = normalizeSpeedSegments(segments);
  const ct = clamp(t, 0, 1);
  const seg = segs.find((s) => ct >= s.startT && ct < s.endT) ?? segs[segs.length - 1]!;
  return seg.speed;
}

/** Output duration (seconds) of a clip of `durationSec` under segments:
 *  each slice contributes sliceDuration / speed. */
export function outputDurationForSegments(segments: SpeedSegment[], durationSec: number): number {
  return normalizeSpeedSegments(segments)
    .reduce((acc, s) => acc + ((s.endT - s.startT) * durationSec) / s.speed, 0);
}

/** Split a segment at normalized time t into two segments (same speed). */
export function splitSpeedSegment(segments: SpeedSegment[], id: string, t: number): SpeedSegment[] {
  const out: SpeedSegment[] = [];
  for (const s of segments) {
    if (s.id !== id || t <= s.startT + 0.02 || t >= s.endT - 0.02) { out.push(s); continue; }
    out.push({ ...s, endT: t }, { id: newSegmentId(), startT: t, endT: s.endT, speed: s.speed });
  }
  return normalizeSpeedSegments(out);
}

/* ── Bézier easing ─────────────────────────────────────────────────────── */

export interface BezierHandles { x: number; y: number }

/** Cubic bézier easing: given x (time fraction), solve for y. Control
 *  points are (0,0), cp1, cp2, (1,1). Newton iterations + bisection guard. */
export function cubicBezierY(cp1: BezierHandles, cp2: BezierHandles, x: number): number {
  const cx = clamp(x, 0, 1);
  if (cx === 0 || cx === 1) return cx;
  const bx = (t: number) =>
    3 * (1 - t) ** 2 * t * cp1.x + 3 * (1 - t) * t ** 2 * cp2.x + t ** 3;
  const by = (t: number) =>
    3 * (1 - t) ** 2 * t * cp1.y + 3 * (1 - t) * t ** 2 * cp2.y + t ** 3;
  let t = cx;
  for (let i = 0; i < 8; i++) {
    const err = bx(t) - cx;
    if (Math.abs(err) < 1e-5) return by(t);
    const d = 3 * (1 - t) ** 2 * cp1.x + 6 * (1 - t) * t * (cp2.x - cp1.x) + 3 * t ** 2 * (1 - cp2.x);
    if (Math.abs(d) < 1e-6) break;
    t = clamp(t - err / d, 0, 1);
  }
  // Bisection fallback for flat derivatives.
  let lo = 0, hi = 1;
  t = cx;
  for (let i = 0; i < 20; i++) {
    if (bx(t) < cx) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return by(t);
}

/** The legacy easing (smoothstep) expressed as bézier handles. */
export const SMOOTHSTEP_HANDLES: { out: BezierHandles; in: BezierHandles } = {
  out: { x: 0.33, y: 0 }, in: { x: 0.67, y: 1 },
};

export const EASING_PRESETS: { id: string; label: string; out: BezierHandles; in: BezierHandles }[] = [
  { id: "smooth", label: "Smooth", out: { x: 0.33, y: 0 }, in: { x: 0.67, y: 1 } },
  { id: "linear", label: "Linear", out: { x: 0, y: 0 }, in: { x: 1, y: 1 } },
  { id: "ease-in", label: "Ease In", out: { x: 0.55, y: 0 }, in: { x: 0.85, y: 0.4 } },
  { id: "ease-out", label: "Ease Out", out: { x: 0.15, y: 0.6 }, in: { x: 0.45, y: 1 } },
  { id: "snap", label: "Snap", out: { x: 0.1, y: 0.9 }, in: { x: 0.3, y: 1 } },
];

/** Eased interpolation fraction for the segment a→b at fraction f. */
export function easedFraction(a: Keyframe, b: Keyframe, f: number): number {
  if (!a.easeOutCp && !b.easeInCp) {
    // Legacy smoothstep — old projects render exactly as before.
    return f * f * (3 - 2 * f);
  }
  const cp1 = a.easeOutCp ?? SMOOTHSTEP_HANDLES.out;
  const cp2 = b.easeInCp ?? SMOOTHSTEP_HANDLES.in;
  return cubicBezierY(cp1, cp2, clamp(f, 0, 1));
}

/** keyframeAt with bézier easing (drop-in sibling of the legacy helper). */
export function keyframeAtEased(keyframes: Keyframe[], t: number): KeyframeTransform {
  if (keyframes.length === 0) return keyframeAt(keyframes, t);
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (t <= sorted[0]!.time || t >= sorted[sorted.length - 1]!.time) return keyframeAt(keyframes, t);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!, b = sorted[i + 1]!;
    if (t >= a.time && t <= b.time) {
      if (!a.easeOutCp && !b.easeInCp) return keyframeAt(keyframes, t);
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
  return keyframeAt(keyframes, t);
}

/**
 * Adaptive sampling plan for export: how many approximation segments each
 * keyframe span needs. Curvature is estimated from the eased curve's second
 * difference; high curvature → denser sampling (up to 4x the base density),
 * flat spans stay coarse. Total is capped so export time stays bounded.
 */
export function planKeyframeSegments(
  keyframes: Keyframe[], durationSec: number, baseSegments = 12, maxTotal = 48,
): number {
  if (keyframes.length < 2 || durationSec <= 0) return Math.min(baseSegments, maxTotal);
  // Sample the eased scale curve (the most visible property) for curvature.
  const N = 40;
  let curvature = 0;
  let prevSlope: number | null = null;
  let prevVal: number | null = null;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * durationSec;
    const v = keyframeAtEased(keyframes, t).scale;
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
