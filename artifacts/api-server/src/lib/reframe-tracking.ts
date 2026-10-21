/* ─── Subject-tracking crop planning (auto-reframe v2) ───
   Pure functions — no I/O. The detector (lib/subject-detector.ts)
   samples the source video and returns one person matte box per
   sampled frame; this module decides whether that track is
   trustworthy, turns it into a SMOOTHED crop path (bounded pan
   speed, so the window can never teleport or jitter), and renders
   the ffmpeg crop filter for the path.

   Honesty contract: when the samples don't support tracking, the
   caller falls back to the exact v1 centre crop
   (centreCropFilter below is byte-identical to the pre-v2 route
   code) and labels the output as a centre crop with the reason.
   Nothing here ever dresses a centre crop up as tracking. */

/** Person matte bounding box, normalized 0..1 against the source frame. */
export interface SubjectBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectionSample {
  /** Seconds into the source video. */
  t: number;
  /** Dominant person matte box at this instant, or null when no person was found. */
  box: SubjectBox | null;
  /** Share of frame pixels inside the matte (0 when box is null). */
  coverage: number;
}

export interface CropKeyframe {
  t: number;
  /** Crop window centre, source pixels. */
  cx: number;
  cy: number;
}

export interface CropWindow {
  w: number;
  h: number;
}

export type TrackRejectReason =
  | "no-samples"
  | "no-subject"
  | "low-coverage"
  | "low-confidence";

export type TrackPlan =
  | {
      ok: true;
      filter: string;
      window: CropWindow;
      keyframes: CropKeyframe[];
      trackedSamples: number;
      meanCoverage: number;
    }
  | { ok: false; reason: TrackRejectReason };

/* Pan speed cap: the crop window may move at most this fraction of
   the frame width per second. This is THE smoothing bound — the
   tests pin that no segment of a planned path ever exceeds it, so a
   subject (or a matte glitch) can never yank the frame across. */
export const MAX_TRACK_SPEED_RATIO_PER_SEC = 0.45;

export const TRACK_MIN_SAMPLES = 3;
export const TRACK_MIN_TRACKED_RATIO = 0.5;
/* A trustworthy person matte covers a sane share of the frame:
   specks are detector noise, a near-full-frame matte is a blowout. */
export const TRACK_MIN_MATTE_SHARE = 0.004;
export const TRACK_MAX_MATTE_SHARE = 0.92;

/** Crop window size for a target aspect — the same math the v1
 *  ffmpeg expression computed inline (`ih*ratio` wide when cropping
 *  width, `iw/ratio` tall when cropping height), in even pixels. */
export function cropWindowFor(srcW: number, srcH: number, targetRatio: number): CropWindow {
  let w: number;
  let h: number;
  if (srcW / srcH > targetRatio) {
    w = srcH * targetRatio;
    h = srcH;
  } else {
    w = srcW;
    h = srcW / targetRatio;
  }
  return {
    w: Math.max(2, Math.floor(w / 2) * 2),
    h: Math.max(2, Math.floor(h / 2) * 2),
  };
}

/** The v1 centre-crop filter chain, byte-identical to the pre-v2
 *  route: expression-cropped to the target aspect around the centre,
 *  then scaled/cropped to the exact output canvas. Used verbatim for
 *  the tracking-off path and every fallback. */
export function centreCropFilter(targetRatio: number, outW: number, outH: number): string {
  const t = targetRatio.toFixed(6);
  const cropFilter =
    `crop='if(gt(iw/ih,${t}),ih*${t},iw)':` +
    `'if(gt(iw/ih,${t}),ih,iw/${t})'`;
  return `${cropFilter},scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}`;
}

/** Decide whether sampled detections support subject tracking. */
export function assessSamples(
  samples: DetectionSample[],
): { ok: true } | { ok: false; reason: TrackRejectReason } {
  if (samples.length === 0) return { ok: false, reason: "no-samples" };
  const tracked = samples.filter((s) => s.box !== null);
  if (tracked.length === 0) return { ok: false, reason: "no-subject" };
  if (
    tracked.length < TRACK_MIN_SAMPLES ||
    tracked.length / samples.length < TRACK_MIN_TRACKED_RATIO
  ) {
    return { ok: false, reason: "low-coverage" };
  }
  const meanCoverage =
    tracked.reduce((acc, s) => acc + s.coverage, 0) / tracked.length;
  if (meanCoverage < TRACK_MIN_MATTE_SHARE || meanCoverage > TRACK_MAX_MATTE_SHARE) {
    return { ok: false, reason: "low-confidence" };
  }
  return { ok: true };
}

function boxCenter(b: SubjectBox): { cx: number; cy: number } {
  return { cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
}

/** Drop single-sample matte glitches: an interior sample whose
 *  centre sits far from where its tracked neighbours say the subject
 *  should be is treated as no-detection. Neighbours that agree with
 *  each other outvote one wild frame. */
export function cleanSamples(samples: DetectionSample[]): DetectionSample[] {
  const trackedIdx = samples
    .map((s, i) => (s.box !== null ? i : -1))
    .filter((i) => i >= 0);
  if (trackedIdx.length < 3) return samples;
  const drop = new Set<number>();
  for (let k = 1; k < trackedIdx.length - 1; k++) {
    const prev = samples[trackedIdx[k - 1]!]!.box!;
    const cur = samples[trackedIdx[k]!]!.box!;
    const next = samples[trackedIdx[k + 1]!]!.box!;
    const pc = boxCenter(prev);
    const nc = boxCenter(next);
    const cc = boxCenter(cur);
    const predCx = (pc.cx + nc.cx) / 2;
    const predCy = (pc.cy + nc.cy) / 2;
    if (Math.hypot(cc.cx - predCx, cc.cy - predCy) > 0.3) {
      drop.add(trackedIdx[k]!);
    }
  }
  if (drop.size === 0) return samples;
  return samples.map((s, i) => (drop.has(i) ? { ...s, box: null, coverage: 0 } : s));
}

function clampCenter(c: number, size: number, frame: number): number {
  if (size >= frame) return frame / 2;
  return Math.min(frame - size / 2, Math.max(size / 2, c));
}

/** The smoothing: a velocity-limited follower. Walking a fixed time
 *  grid, the crop centre chases the latest desired centre (zero-order
 *  hold — only past samples are ever used, so the window can never
 *  "anticipate" a move that hasn't happened) and moves at most
 *  maxSpeedPxPerSec toward it. Bounded per-step delta is therefore
 *  true BY CONSTRUCTION on every segment — the property the tests
 *  pin — and a subject teleport becomes a fast bounded pan that
 *  starts when the subject actually moves, not before. */
export function followSubjectPath(
  desired: CropKeyframe[],
  opts: { startT: number; endT: number; stepSec: number; maxSpeedPxPerSec: number },
): CropKeyframe[] {
  if (desired.length === 0) return [];
  const step = Math.max(0.05, opts.stepSec);
  const keys: CropKeyframe[] = [];
  let cur = { cx: desired[0]!.cx, cy: desired[0]!.cy };
  keys.push({ t: opts.startT, cx: cur.cx, cy: cur.cy });
  let di = 0;
  const chase = (target: CropKeyframe, dt: number) => {
    const maxMove = opts.maxSpeedPxPerSec * dt;
    const dx = target.cx - cur.cx;
    const dy = target.cy - cur.cy;
    const dist = Math.hypot(dx, dy);
    if (dist > 0) {
      const s = Math.min(1, maxMove / dist);
      cur = { cx: cur.cx + dx * s, cy: cur.cy + dy * s };
    }
  };
  for (let t = opts.startT + step; t < opts.endT - 1e-9; t += step) {
    while (di + 1 < desired.length && desired[di + 1]!.t <= t) di++;
    chase(desired[di]!, step);
    keys.push({ t, cx: cur.cx, cy: cur.cy });
  }
  const lastT = keys[keys.length - 1]!.t;
  if (opts.endT > lastT) {
    chase(desired[desired.length - 1]!, opts.endT - lastT);
    keys.push({ t: opts.endT, cx: cur.cx, cy: cur.cy });
  }
  return decimateCollinear(keys);
}

/** Drop grid keys that sit (nearly) on the line between their
 *  neighbours — steady pans collapse to their endpoints, which
 *  keeps the emitted ffmpeg expression small. */
function decimateCollinear(keys: CropKeyframe[]): CropKeyframe[] {
  if (keys.length <= 2) return keys;
  const out: CropKeyframe[] = [keys[0]!];
  for (let i = 1; i < keys.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const next = keys[i + 1]!;
    const cur = keys[i]!;
    const f = (cur.t - prev.t) / (next.t - prev.t);
    const lx = prev.cx + (next.cx - prev.cx) * f;
    const ly = prev.cy + (next.cy - prev.cy) * f;
    if (Math.hypot(cur.cx - lx, cur.cy - ly) > 1.5) out.push(cur);
  }
  out.push(keys[keys.length - 1]!);
  return out;
}

/** Piecewise-linear sample of a planned path (the JS mirror of the
 *  ffmpeg expression buildTrackedCropFilter emits). */
export function sampleCropPath(
  keys: CropKeyframe[],
  t: number,
): { cx: number; cy: number } {
  const first = keys[0]!;
  if (t <= first.t) return { cx: first.cx, cy: first.cy };
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i]!;
    if (t <= b.t) {
      const a = keys[i - 1]!;
      const f = (t - a.t) / (b.t - a.t);
      return { cx: a.cx + (b.cx - a.cx) * f, cy: a.cy + (b.cy - a.cy) * f };
    }
  }
  const last = keys[keys.length - 1]!;
  return { cx: last.cx, cy: last.cy };
}

function fmt(n: number, digits = 2): string {
  const s = n.toFixed(digits);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** Piecewise-linear ffmpeg expression over `t` for one axis:
 *  nested if(lt(t,…)) segments between keyframes, held constant
 *  after the last keyframe. `offset` converts centres to top-left. */
function axisExpression(
  keys: CropKeyframe[],
  pick: (k: CropKeyframe) => number,
  offset: number,
  clipMax: number,
): string {
  const last = keys[keys.length - 1]!;
  let expr = fmt(pick(last) - offset);
  for (let i = keys.length - 2; i >= 0; i--) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    const va = pick(a) - offset;
    const vb = pick(b) - offset;
    const seg = `${fmt(va)}+(${fmt(vb - va, 2)})*(t-${fmt(a.t, 3)})/${fmt(b.t - a.t, 3)}`;
    expr = `if(lt(t,${fmt(b.t, 3)}),${seg},${expr})`;
  }
  return `clip(${expr},0,${fmt(Math.max(0, clipMax))})`;
}

/** The tracked filter chain: a fixed-size crop whose top-left corner
 *  follows the smoothed path, then the same scale-to-canvas tail the
 *  centre path uses. */
export function buildTrackedCropFilter(
  window: CropWindow,
  keyframes: CropKeyframe[],
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
): string {
  const xExpr = axisExpression(keyframes, (k) => k.cx, window.w / 2, srcW - window.w);
  const yExpr = axisExpression(keyframes, (k) => k.cy, window.h / 2, srcH - window.h);
  return (
    `crop=${window.w}:${window.h}:'${xExpr}':'${yExpr}',` +
    `scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}`
  );
}

/** Full planning pipeline: assess → clean → desired centres →
 *  smooth → filter. Returns the rejection reason untouched when the
 *  samples don't support tracking. */
export function planTrackedCrop(args: {
  samples: DetectionSample[];
  srcW: number;
  srcH: number;
  targetRatio: number;
  outW: number;
  outH: number;
  durationSec: number;
}): TrackPlan {
  const first = assessSamples(args.samples);
  if (!first.ok) return first;
  const cleaned = cleanSamples(args.samples);
  const second = assessSamples(cleaned);
  if (!second.ok) return second;

  const tracked = cleaned.filter((s) => s.box !== null);
  const window = cropWindowFor(args.srcW, args.srcH, args.targetRatio);
  const desired = tracked.map((s) => {
    const c = boxCenter(s.box!);
    return {
      t: s.t,
      cx: clampCenter(c.cx * args.srcW, window.w, args.srcW),
      cy: clampCenter(c.cy * args.srcH, window.h, args.srcH),
    };
  });

  const endT =
    args.durationSec > 0
      ? args.durationSec
      : desired[desired.length - 1]!.t + 0.5;
  const maxSpeed = MAX_TRACK_SPEED_RATIO_PER_SEC * args.srcW;
  const keyframes = followSubjectPath(desired, {
    startT: 0,
    endT,
    stepSec: Math.max(0.25, endT / 240),
    maxSpeedPxPerSec: maxSpeed,
  });
  const filter = buildTrackedCropFilter(
    window,
    keyframes,
    args.srcW,
    args.srcH,
    args.outW,
    args.outH,
  );
  const meanCoverage =
    tracked.reduce((acc, s) => acc + s.coverage, 0) / tracked.length;
  return {
    ok: true,
    filter,
    window,
    keyframes,
    trackedSamples: tracked.length,
    meanCoverage,
  };
}
