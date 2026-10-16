/**
 * lips.ts — a vault character's lips, driven by its speaker's voice.
 *
 * Two halves, both pure and unit-tested:
 *  1. Mouth geometry: where the mouth IS on a portrait, derived from
 *     Face Landmarker landmarks (located once per portrait by
 *     portrait-mouth.ts — if no face is found there is no mouth box
 *     and the character simply never lip-syncs; nothing is faked).
 *  2. Voice → openness: an audio level (RMS of the speaker's live
 *     stream — a mic locally, a peer's mesh stream remotely) smoothed
 *     with fast attack / slow release, then mapped through a floor +
 *     curve so silence is a closed mouth and speech opens it.
 *
 * Landmark indices are the canonical face-mesh ones: 61 / 291 are the
 * mouth corners, 13 / 14 the inner upper / lower lip centers.
 */

export interface LandmarkPoint {
  x: number;
  y: number;
}

export interface MouthBox {
  /** Mouth center, normalized image coordinates (0..1). */
  cx: number;
  cy: number;
  /** Mouth width as a fraction of image width. */
  w: number;
}

/** A fully open mouth's opening height, as a fraction of its width —
 *  generous speech reads clearly at hall distance without clowning. */
export const MOUTH_OPEN_HEIGHT_RATIO = 0.36;

export const MOUTH_LEFT_CORNER = 61;
export const MOUTH_RIGHT_CORNER = 291;
export const LIP_UPPER_INNER = 13;
export const LIP_LOWER_INNER = 14;

/** Locate the mouth from a detected face's landmarks. Returns null
 *  when the landmarks can't support an honest mouth (missing points,
 *  a sliver of a mouth, a center outside the portrait) — callers treat
 *  null as "this character shows without lip animation". */
export function mouthBoxFromLandmarks(points: ArrayLike<LandmarkPoint> | null | undefined): MouthBox | null {
  if (!points || points.length <= MOUTH_RIGHT_CORNER) return null;
  const left = points[MOUTH_LEFT_CORNER];
  const right = points[MOUTH_RIGHT_CORNER];
  const upper = points[LIP_UPPER_INNER];
  const lower = points[LIP_LOWER_INNER];
  if (!left || !right || !upper || !lower) return null;
  for (const p of [left, right, upper, lower]) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    // Normalized landmarks of a real detection live inside the frame;
    // a corner thrown outside it is an artifact, not a mouth.
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return null;
  }
  const w = Math.abs(right.x - left.x);
  // A real mouth on a detected face is a few percent of the frame wide;
  // anything sliver-thin or frame-wide is a detection artifact.
  if (w < 0.015 || w > 0.7) return null;
  const cx = (left.x + right.x) / 2;
  const cy = (upper.y + lower.y) / 2;
  return { cx, cy, w };
}

/* ── Cover-fit mapping ────────────────────────────────────────────────
   The portrait canvas is a fixed 3:4 stage; the source image is
   cover-fit into it (center crop). Landmark space is source-image
   normalized, so the mouth must travel through the same transform
   the pixels do. */

export interface CoverTransform {
  scale: number;
  drawnW: number;
  drawnH: number;
  offsetX: number;
  offsetY: number;
}

export function coverTransform(srcW: number, srcH: number, dstW: number, dstH: number): CoverTransform {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const drawnW = srcW * scale;
  const drawnH = srcH * scale;
  return {
    scale,
    drawnW,
    drawnH,
    offsetX: (dstW - drawnW) / 2,
    offsetY: (dstH - drawnH) / 2,
  };
}

/** A source-normalized point → canvas pixels under the cover fit. */
export function normalizedToCanvas(
  p: { x: number; y: number },
  srcW: number,
  srcH: number,
  t: CoverTransform,
): { x: number; y: number } {
  return {
    x: p.x * srcW * t.scale + t.offsetX,
    y: p.y * srcH * t.scale + t.offsetY,
  };
}

/* ── Voice level → mouth openness ───────────────────────────────────── */

/** Below this RMS the speaker is silent — mouth shut, no jitter. */
export const SPEECH_LEVEL_FLOOR = 0.03;
/** RMS at (and above) which the mouth is fully open. */
export const SPEECH_LEVEL_CEILING = 0.53;

/** Map a raw audio level to mouth openness 0..1. A soft curve
 *  (power < 1) so ordinary speech — which lives in the low RMS
 *  range — opens the mouth visibly without shouting for it. */
export function mouthOpennessForLevel(level: number): number {
  if (!Number.isFinite(level) || level <= SPEECH_LEVEL_FLOOR) return 0;
  const t = Math.min(1, (level - SPEECH_LEVEL_FLOOR) / (SPEECH_LEVEL_CEILING - SPEECH_LEVEL_FLOOR));
  return Math.pow(t, 0.6);
}

/** RMS of an analyser's byte time-domain data (128 = silence). */
export function rmsFromTimeDomain(data: ArrayLike<number>): number {
  if (!data.length) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = ((data[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

/** Speech smoothing: fast attack (the mouth opens WITH the syllable),
 *  slower release (it doesn't slam shut between words). One tracker
 *  per speaker; push a fresh raw level per animation sample. */
export class SpeechLevelTracker {
  private value = 0;

  push(rawLevel: number): number {
    const target = Number.isFinite(rawLevel) ? Math.min(1, Math.max(0, rawLevel)) : 0;
    const k = target > this.value ? 0.6 : 0.22;
    this.value += (target - this.value) * k;
    if (this.value < 0.004) this.value = 0;
    return this.value;
  }

  get level(): number {
    return this.value;
  }

  reset(): void {
    this.value = 0;
  }
}
