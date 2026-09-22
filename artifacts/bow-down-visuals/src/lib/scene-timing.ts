/**
 * Shared scene timing computation.
 *
 * Single source of truth for "where does scene N fall in the song's audio
 * timeline" — used by BOTH the master player (TimelinePreviewPlayer) and
 * the Lip Sync section, so the audio segment extracted for lip sync always
 * matches what actually plays during that scene in the main timeline.
 *
 * IMPORTANT: a scene's effective start time is the CUMULATIVE sum of the
 * durations of all prior scenes — NOT the raw start value baked into that
 * scene's own `timestamp` string. AI-generated scene breakdowns frequently
 * have gaps/overlaps between consecutive timestamps, so trusting a scene's
 * own absolute start text (instead of the cumulative offset the master
 * player actually uses to place it on the timeline) is what previously
 * caused lip sync to grab the wrong section of the song.
 */
import type { SceneData } from "@/lib/scene-parser";

export interface SceneTiming {
  startSec: number;
  endSec: number;
  durationSec: number;
  hasExplicitEnd: boolean;
}

/** Parse a scene's raw "M:SS-M:SS" duration. Returns the 5s default when
 *  the timestamp is missing or not a parseable range — mirrors TLP's parseDur. */
export function parseRawSceneDuration(ts: string | null | undefined): { durationSec: number; hasExplicitEnd: boolean } {
  if (!ts) return { durationSec: 5, hasExplicitEnd: false };
  const m = ts.match(/(\d+):(\d{2})\s*[-–]\s*(\d+):(\d{2})/);
  if (m) {
    const s = +m[1] * 60 + +m[2];
    const e = +m[3] * 60 + +m[4];
    return e > s ? { durationSec: e - s, hasExplicitEnd: true } : { durationSec: 5, hasExplicitEnd: false };
  }
  return { durationSec: 5, hasExplicitEnd: false };
}

/**
 * Compute cumulative start/end times for every scene, exactly mirroring
 * TimelinePreviewPlayer's algorithm:
 *  - Per-scene duration comes from its own "M:SS-M:SS" timestamp range.
 *  - If EVERY scene lacks a real range (all fall back to the 5s default)
 *    AND the song's total audioDuration is known, distribute that duration
 *    evenly across all scenes instead.
 *  - A scene's start is the sum of all prior scenes' durations (cumulative
 *    offset), not its own raw timestamp text.
 */
export function computeSceneTimings(scenes: SceneData[], audioDuration: number | null): SceneTiming[] {
  const raw = scenes.map((s) => parseRawSceneDuration(s.timestamp));
  const allDefaultDurs = raw.length > 0 && raw.every((r) => !r.hasExplicitEnd);

  const durs: number[] = allDefaultDurs && audioDuration != null && audioDuration > 0
    ? scenes.map(() => audioDuration / scenes.length)
    : raw.map((r) => r.durationSec);

  const timings: SceneTiming[] = [];
  let acc = 0;
  for (let i = 0; i < scenes.length; i++) {
    const durationSec = durs[i] ?? 5;
    timings.push({
      startSec: acc,
      endSec: acc + durationSec,
      durationSec,
      hasExplicitEnd: raw[i]?.hasExplicitEnd ?? false,
    });
    acc += durationSec;
  }
  return timings;
}

/** Look up the computed timing for a specific scene by identity within `scenes`. */
export function getSceneTiming(scene: SceneData, scenes: SceneData[], audioDuration: number | null): SceneTiming {
  const idx = scenes.findIndex((s) => s.id === scene.id);
  const timings = computeSceneTimings(scenes, audioDuration);
  return timings[idx >= 0 ? idx : 0] ?? { startSec: 0, endSec: 5, durationSec: 5, hasExplicitEnd: false };
}

/** Minimal shape needed from ClipEdit for manual timeline placement. */
export interface ManualPlacementEdit {
  manualStartSec: number | null;
}

/** SceneTiming extended with gap/overlap info relative to the PREVIOUS clip
 *  in timeline order (not array order — manual positions can reorder clips). */
export interface ManualSceneTiming extends SceneTiming {
  /** Seconds of silent/empty timeline before this clip starts (0 if none or if this is first). */
  gapBeforeSec: number;
  /** Seconds this clip's start overlaps the previous clip's end (0 if none or if this is first). */
  overlapWithPrevSec: number;
  /** True when this scene's position came from an explicit manualStartSec override. */
  isManuallyPlaced: boolean;
}

/**
 * Compute freeform timeline placement for "manual" layout mode.
 *
 * Each scene's position is `clipEdits[id].manualStartSec` when set, otherwise
 * it falls back to appending right after the furthest clip end seen so far
 * (so newly-added / not-yet-dragged clips default to a sane back-to-back
 * position instead of collapsing to t=0).
 *
 * Returns timings index-aligned with `scenes` (same order/length as input),
 * plus `order`: scene array indices sorted by actual timeline startSec —
 * this is the order clips should actually play/render in, since manual
 * placement can make the visual/array order differ from playback order.
 * Gap/overlap fields on each timing are computed against the PREVIOUS clip
 * in that sorted order.
 */
export function computeManualTimings(
  scenes: SceneData[],
  audioDuration: number | null,
  clipEdits: Record<string, ManualPlacementEdit | undefined>,
): { timings: ManualSceneTiming[]; order: number[] } {
  const raw = scenes.map((s) => parseRawSceneDuration(s.timestamp));
  const allDefaultDurs = raw.length > 0 && raw.every((r) => !r.hasExplicitEnd);
  const durs: number[] = allDefaultDurs && audioDuration != null && audioDuration > 0
    ? scenes.map(() => audioDuration / scenes.length)
    : raw.map((r) => r.durationSec);

  const timings: ManualSceneTiming[] = scenes.map((s, i) => {
    const durationSec = durs[i] ?? 5;
    const override = clipEdits[s.id]?.manualStartSec;
    const isManuallyPlaced = typeof override === "number" && isFinite(override) && override >= 0;
    return {
      startSec: isManuallyPlaced ? override! : 0, // fallback filled in below
      endSec: 0,
      durationSec,
      hasExplicitEnd: raw[i]?.hasExplicitEnd ?? false,
      gapBeforeSec: 0,
      overlapWithPrevSec: 0,
      isManuallyPlaced,
    };
  });

  // Fill fallback positions for scenes without an override: append after the
  // furthest clip end seen so far, walking in array order.
  let fallbackAcc = 0;
  for (let i = 0; i < timings.length; i++) {
    const t = timings[i]!;
    if (!t.isManuallyPlaced) {
      t.startSec = fallbackAcc;
    }
    t.endSec = t.startSec + t.durationSec;
    fallbackAcc = Math.max(fallbackAcc, t.endSec);
  }

  // Determine playback order by actual timeline position.
  const order = scenes.map((_, i) => i).sort((a, b) => {
    const d = timings[a]!.startSec - timings[b]!.startSec;
    return d !== 0 ? d : a - b;
  });

  // The very first clip in playback order has no previous clip to compare
  // against, but it can still be manually placed away from timeline origin
  // (e.g. dragged to start 10s into the song) — that offset is a real gap
  // from t=0 and must not be silently dropped, or exports bunch every clip
  // at t=0 regardless of where the user actually placed the first one.
  if (order.length > 0) {
    const firstIdx = order[0]!;
    timings[firstIdx]!.gapBeforeSec = Math.max(0, timings[firstIdx]!.startSec);
  }

  // Compute gap/overlap relative to the previous clip in that order.
  for (let k = 1; k < order.length; k++) {
    const prevIdx = order[k - 1]!;
    const curIdx  = order[k]!;
    const prevEnd = timings[prevIdx]!.endSec;
    const curStart = timings[curIdx]!.startSec;
    if (curStart >= prevEnd) {
      timings[curIdx]!.gapBeforeSec = curStart - prevEnd;
    } else {
      timings[curIdx]!.overlapWithPrevSec = prevEnd - curStart;
    }
  }

  return { timings, order };
}
