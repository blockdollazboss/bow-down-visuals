/* ── Beat pads, slicing + sample-pack load — pure logic (W3b) ───────────
 * Wave 1–2 gave the beat studio its project model, sound registry and
 * exports. This module adds the two hands-on doors the FL study mapped
 * as ABSENT (gap rows 16/17 + the drag half of row 15):
 *
 *   • PADS — a 3×3 pad view over the nine existing tracks. A pad plays
 *     its track's assigned sound (synth, bank or upload — whatever the
 *     track already carries) through the same playTrackHit seam the
 *     sequencer steps use, so a pad hit and a step hit are the same
 *     sound through the same mixer path. Velocity comes from WHERE the
 *     pad is hit (top = hardest) or from a fixed control — the mapping
 *     lives here as a pure function.
 *
 *   • SLICING — one loaded audio file can be cut into equal slices and
 *     spread across consecutive pads: pad N then plays slice N of the
 *     file instead of the whole file. A slice is a REGION of the track's
 *     assigned upload (persisted in the beat project as
 *     BeatTrackSlice — see lib/beat-project.ts); playback resolves the
 *     region from the decoded buffer's duration at schedule time, in
 *     the live transport AND the offline render alike, because both go
 *     through playTrackHit. Session honesty is inherited from the
 *     registry: after a reload the upload's bytes are gone, resolution
 *     falls back to the track's synth voice and the UI says "not
 *     loaded" — a slice never plays the wrong audio silently.
 *
 *   • SAMPLE-PACK LOAD — dropping a folder's worth of audio files (or
 *     multi-picking them) lands each file on its own pad through the
 *     existing upload seam (decodeAndRegisterUpload + assign). The
 *     planning half lives here as pure functions so the outcome for
 *     EVERY file is decided up front and reported: loaded onto pad N,
 *     or not loaded with the exact reason (format / too large / empty /
 *     no free pad / unreadable / sign-in). Nothing is silently dropped
 *     — planPackLoad returns exactly one outcome per input file.
 *
 * Manual studio tools = pure UI = FREE. No charges, no provider calls.
 * No audio files are generated or bundled here — the sound bank is a
 * separate, owner-postponed program.
 */

import { BEAT_TRACK_COUNT } from "@/lib/beat-project";
import { defaultSoundIdForTrack } from "@/lib/beat-sounds";

/* ─── Slices ─────────────────────────────────────────────────────────────
 * A slice reference is stored on the project (lib/beat-project.ts
 * BeatTrackSlice): { soundId, index, count } — "when this track plays
 * `soundId`, play slice `index` of `count` equal slices". Regions are
 * resolved against the live buffer duration at play time, so the
 * stored shape carries no seconds and survives decode-rate differences. */

/** Slice counts the studio offers. */
export const BEAT_SLICE_COUNTS = [4, 8, 16] as const;

/** Widest slice count normalization accepts in a saved project. */
export const BEAT_SLICE_COUNT_MAX = 64;

export interface BeatSliceRegion {
  /** Seconds into the buffer where playback starts. */
  offset: number;
  /** Seconds of the buffer to play. */
  duration: number;
}

/** The region of slice `index` of `count` equal slices over a buffer
 *  of `durationSec`. Null for any input that cannot name a real slice
 *  (non-positive duration, count < 2, index outside the count). The
 *  last slice ends exactly at the buffer end. */
export function sliceRegionFor(
  durationSec: number,
  index: number,
  count: number,
): BeatSliceRegion | null {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;
  if (!Number.isInteger(count) || count < 2 || count > BEAT_SLICE_COUNT_MAX) return null;
  if (!Number.isInteger(index) || index < 0 || index >= count) return null;
  const offset = (durationSec * index) / count;
  const end = index === count - 1 ? durationSec : (durationSec * (index + 1)) / count;
  const duration = end - offset;
  if (!(duration > 0)) return null;
  return { offset, duration };
}

/** Resolve the region a track should actually play: the slice applies
 *  ONLY while the track's assigned sound is the very sound the slice
 *  was cut from. Any mismatch (sound changed, no slice, buffer length
 *  unknown) returns null and the caller plays the sound whole — the
 *  safe, honest default. */
export function resolveSliceRegion(
  slice: { soundId: string; index: number; count: number } | null | undefined,
  assignedSoundId: string | null | undefined,
  bufferDurationSec: number | null | undefined,
): BeatSliceRegion | null {
  if (!slice) return null;
  if (!assignedSoundId || slice.soundId !== assignedSoundId) return null;
  if (typeof bufferDurationSec !== "number") return null;
  return sliceRegionFor(bufferDurationSec, slice.index, slice.count);
}

/** Pads a slice spread starting at `startTrack` would occupy, in
 *  order, stopping at the last pad — the spread never wraps and never
 *  invents pads past the nine tracks. */
export function planSliceSpread(
  startTrack: number,
  count: number,
  trackCount: number = BEAT_TRACK_COUNT,
): number[] {
  const start = Number.isInteger(startTrack)
    ? Math.max(0, Math.min(trackCount - 1, startTrack))
    : 0;
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  const out: number[] = [];
  for (let i = 0; i < n && start + i < trackCount; i++) out.push(start + i);
  return out;
}

/* ─── Pad velocity ───────────────────────────────────────────────────────
 * Hit-position velocity: the pad is a vertical fader — hitting the TOP
 * of the pad is the hardest hit (1.0), the BOTTOM the softest (0.25).
 * The floor keeps a low hit audible; the mapping is linear between. */

export const BEAT_PAD_VELOCITY_MIN = 0.25;
export const BEAT_PAD_VELOCITY_MAX = 1.0;

export type BeatPadVelocityMode = "hit" | "fixed";

/** Velocity for a hit at `ratioFromTop` (0 = top edge, 1 = bottom
 *  edge) of a pad. Out-of-range ratios clamp to the pad edges. */
export function padVelocityFromHit(ratioFromTop: number): number {
  const r = Number.isFinite(ratioFromTop)
    ? Math.min(1, Math.max(0, ratioFromTop))
    : 0;
  return (
    BEAT_PAD_VELOCITY_MAX -
    (BEAT_PAD_VELOCITY_MAX - BEAT_PAD_VELOCITY_MIN) * r
  );
}

/** Clamp a fixed-velocity control value into the pad range. */
export function clampPadVelocity(v: number): number {
  if (!Number.isFinite(v)) return BEAT_PAD_VELOCITY_MAX;
  return Math.min(BEAT_PAD_VELOCITY_MAX, Math.max(0.1, v));
}

/** The velocity a pad hit plays at under the chosen mode. */
export function padHitVelocity(
  mode: BeatPadVelocityMode,
  ratioFromTop: number,
  fixedVelocity: number,
): number {
  return mode === "fixed" ? clampPadVelocity(fixedVelocity) : padVelocityFromHit(ratioFromTop);
}

/* ─── Sample-pack load: classification + planning ────────────────────────
 * Every dropped/picked file gets exactly one outcome. Classification
 * is by extension OR audio MIME (browsers report both inconsistently);
 * a file that passes neither is a format reject, never a silent skip. */

/** Largest single file a pack load accepts (25 MB). */
export const BEAT_PACK_MAX_BYTES = 25 * 1024 * 1024;

export const BEAT_PACK_AUDIO_EXTENSIONS = [
  "wav", "mp3", "ogg", "oga", "m4a", "flac", "aac", "webm", "aif", "aiff",
] as const;

export interface BeatPackFileMeta {
  name: string;
  type: string;
  size: number;
}

export type BeatPackRejectReason =
  | "format"   // not an audio file we can read
  | "size"     // over BEAT_PACK_MAX_BYTES
  | "empty"    // zero bytes
  | "no-track" // every pad already carries its own sound
  | "decode"   // looked like audio but could not be decoded
  | "sign-in"; // uploads need a signed-in creator

export type BeatPackClassification =
  | { ok: true }
  | { ok: false; reason: Extract<BeatPackRejectReason, "format" | "size" | "empty"> };

/** Can this file even be attempted as a sound? Pure metadata check —
 *  decoding is the execution step's job and reports "decode" itself. */
export function classifyPackFile(meta: BeatPackFileMeta): BeatPackClassification {
  if (!meta || typeof meta.size !== "number" || !(meta.size > 0)) {
    return { ok: false, reason: "empty" };
  }
  if (meta.size > BEAT_PACK_MAX_BYTES) return { ok: false, reason: "size" };
  const name = typeof meta.name === "string" ? meta.name : "";
  const ext = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase() ?? "";
  const mime = typeof meta.type === "string" ? meta.type.toLowerCase() : "";
  const audioMime = mime.startsWith("audio/") || mime === "video/webm";
  if (audioMime || (BEAT_PACK_AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: true };
  }
  return { ok: false, reason: "format" };
}

/** A pad can receive a pack file while it still plays its built-in
 *  synth voice and carries no slice — anything else is a sound the
 *  creator already chose, and a drop never overwrites it silently. */
export function isFreePackTrack(
  trackSounds: readonly (string | null | undefined)[],
  trackSlices: readonly (unknown | null | undefined)[],
  trackIndex: number,
): boolean {
  if (trackIndex < 0 || trackIndex >= BEAT_TRACK_COUNT) return false;
  const soundId = trackSounds[trackIndex];
  const onDefault = !soundId || soundId === defaultSoundIdForTrack(trackIndex);
  return onDefault && !trackSlices[trackIndex];
}

export type BeatPackPlanEntry =
  | { fileIndex: number; action: "assign"; trackIndex: number }
  | { fileIndex: number; action: "reject"; reason: BeatPackRejectReason };

/** Decide the fate of every file in a pack drop BEFORE any decoding:
 *  classifiable audio fills free pads in track order; everything else
 *  is a reject with its reason. The output has exactly one entry per
 *  input file, in input order — nothing is silently dropped, by
 *  construction. */
export function planPackLoad(
  files: readonly BeatPackFileMeta[],
  trackSounds: readonly (string | null | undefined)[],
  trackSlices: readonly (unknown | null | undefined)[],
): BeatPackPlanEntry[] {
  const freeTracks: number[] = [];
  for (let ti = 0; ti < BEAT_TRACK_COUNT; ti++) {
    if (isFreePackTrack(trackSounds, trackSlices, ti)) freeTracks.push(ti);
  }
  let nextFree = 0;
  return files.map((meta, fileIndex) => {
    const cls = classifyPackFile(meta);
    if (!cls.ok) return { fileIndex, action: "reject" as const, reason: cls.reason };
    if (nextFree >= freeTracks.length) {
      return { fileIndex, action: "reject" as const, reason: "no-track" as const };
    }
    const trackIndex = freeTracks[nextFree]!;
    nextFree += 1;
    return { fileIndex, action: "assign" as const, trackIndex };
  });
}

/** The per-file outcome the UI reports after executing a plan. */
export interface BeatPackFileResult {
  name: string;
  status: "loaded" | "rejected";
  /** Pad/track the file landed on (loaded only). */
  trackIndex?: number;
  /** Why it did not load (rejected only). */
  reason?: BeatPackRejectReason;
}
