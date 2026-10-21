/**
 * audio-ab.ts — STACK-20 R2 #9 (UPGRADE-PROGRAM 2.7): the
 * before/after A/B seam for the Audio Desk.
 *
 * Ring 2 (2.7) docked the A/B player at the QUICK bench for
 * cleanup / de-reverb only (CreateDeskShared's ABAudioPlayer —
 * the Audio Studio DeverbPanel's own pattern: one element, swap
 * the source at the same position, per-side waveform peaks).
 * Everything around it was missing:
 *   - the FULL workbench rendered every transform result as a
 *     bare player — no comparison for master, tune, normalize,
 *     polish, singing-voice or the harmony mix, though the desk
 *     holds the source it worked on;
 *   - the quick bench's finish tool had both versions too and
 *     no comparison;
 *   - a missing original failed SILENTLY — the Before tab just
 *     sat disabled, and a face left on "before" could keep the
 *     finished audio under a Before label.
 * This module is the pure half the player and the desks share:
 * which side exists, whether a flip is allowed, where playback
 * resumes after a swap, and which bench results honestly carry
 * a treated version of the same audio at all.
 */
import type { AudioBenchId, AudioBenchResult } from "./audio-benches";

export type ABSide = "before" | "after";

export interface ABAvailability {
  before: boolean;
  after: boolean;
}

/** A side exists only when its source is really there: a File in
 *  hand, or a non-empty URL string. Anything else (null, empty
 *  string) reads unavailable — never "present but broken". */
export function abAvailability(input: {
  beforeSource: File | string | null | undefined;
  afterUrl: string | null | undefined;
}): ABAvailability {
  return {
    before:
      input.beforeSource instanceof File ||
      (typeof input.beforeSource === "string" && input.beforeSource.trim() !== ""),
    after: typeof input.afterUrl === "string" && input.afterUrl.trim() !== "",
  };
}

/** Where playback resumes on the swapped-in source: the same
 *  position, clamped to the target's length when the length is
 *  known — DeverbPanel's own `Math.min(t, duration || t)`, with
 *  the unusable readings (NaN, 0, negative, non-finite) falling
 *  back to the position itself, exactly as the panel's did. */
export function abResumePosition(currentTime: number, targetDuration: number | null | undefined): number {
  const t = typeof currentTime === "number" && Number.isFinite(currentTime) && currentTime > 0 ? currentTime : 0;
  if (typeof targetDuration === "number" && Number.isFinite(targetDuration) && targetDuration > 0) {
    return Math.min(t, targetDuration);
  }
  return t;
}

/** The flip state machine: a flip lands only on a side that
 *  exists. Asking for the side already showing, or for a side
 *  that isn't there, changes nothing — the caller still settles
 *  its state on the returned side. */
export function abSideAfterFlip(current: ABSide, next: ABSide, availability: ABAvailability): ABSide {
  if (next === current) return current;
  return availability[next] ? next : current;
}

/** The side the player may honestly SHOW: the chosen side when
 *  it exists, otherwise the other side when IT exists. When
 *  neither exists the choice stands (nothing can play either
 *  way, and the render gates on availability separately). This
 *  is what stops a vanished original from leaving the finished
 *  audio playing under a "Before" face. */
export function abSettledSide(side: ABSide, availability: ABAvailability): ABSide {
  if (availability[side]) return side;
  const other: ABSide = side === "before" ? "after" : "before";
  return availability[other] ? other : side;
}

/* ─── Which full-bench results carry an honest A/B ──────────────
   A comparison is honest only when ONE output is a treated
   version of the SAME single source the bench ran on:
     - master / quick-master / vocal-tune / lufs-normalize /
       vocal-polish / singing-voice answer with that one output;
     - harmony answers with a mixed preview of the song (its
       second output, the harmony-only stem, is a part, not a
       version — it keeps its own plain player).
   Everything else stays a plain result, by design:
     - stems / vocal-removal return PARTS of the audio, not a
       treated whole; mix takes several files — no single
       "before" exists;
     - podcast / voiceover / hum CREATE new audio (words / a
       hum in, a performance out) — there is no earlier version
       of the result to compare against;
     - lufs-analyze / rate-my-mix answer in text;
     - arrangement saves a draft, no audio at all. */

export const AB_COMPARABLE_BENCHES: readonly AudioBenchId[] = [
  "master",
  "quick-master",
  "vocal-tune",
  "lufs-normalize",
  "vocal-polish",
  "singing-voice",
  "harmony",
];

/** The short name of the treated side, per bench — what the
 *  After tab says. Null for benches with no honest comparison. */
export function abAfterLabelForBench(benchId: AudioBenchId): string | null {
  switch (benchId) {
    case "master":
    case "quick-master":
      return "Mastered";
    case "vocal-tune":
      return "Tuned";
    case "lufs-normalize":
      return "Normalized";
    case "vocal-polish":
      return "Polished";
    case "singing-voice":
      return "New voice";
    case "harmony":
      return "With harmony";
    default:
      return null;
  }
}

/** The one output of a bench result that is the treated version
 *  of the source — null when the bench has no honest comparison
 *  or the result didn't carry it. Harmony's comparable output
 *  is picked by its interpreted label ("Your song with
 *  harmony"), never by position alone, so a shape change in
 *  the interpreter fails closed instead of comparing a stem. */
export function abComparableOutput(
  benchId: AudioBenchId,
  result: AudioBenchResult,
): { label: string; url: string } | null {
  if (!AB_COMPARABLE_BENCHES.includes(benchId)) return null;
  if (benchId === "harmony") {
    return result.urls.find((u) => u.label === "Your song with harmony") ?? null;
  }
  return result.urls[0] ?? null;
}
