/* ── Beat Studio export pack — stems bounce + ZIP (W2-L3) ───────────────
 * The sequencer used to export ONE stereo WAV of the whole render. This
 * module is the pure half of the export pack:
 *   • stem enumeration — the render's own track list (the page passes its
 *     TRACKS ids in order) + the 808 bass line as its own stem. Melodic
 *     lanes are NOT in the render at this base; when a melody module
 *     lands, its lanes join by passing them as `extraLanes` — they are
 *     appended to the enumeration, no other code changes.
 *   • render scope — ONE scope object (pattern plays, total steps,
 *     duration) shared by the mix bounce and every stem bounce, so a
 *     stem can never drift from the mix's length or pattern order. Song
 *     mode bounces the whole arrangement chain; pattern mode the
 *     classic active-pattern ×4 loop (same rule as lib/beat-project).
 *   • solo isolation — a stem bounce runs the SAME offline synth/render
 *     as the mix, with a mixer state that keeps only that track's
 *     effective gain (what the track actually contributes to the mix:
 *     solo/mute/volume resolved exactly as the mix render resolves
 *     them) and zeroes everything else. The isolated gains sum back to
 *     the mix gains per track — that is the mix-vs-stems equality this
 *     module can prove purely. Sample-exact summation is NOT claimed:
 *     the drum synths use random noise bursts, so two renders differ
 *     sample-wise even for the identical mix.
 *   • file naming + ZIP assembly — stems ship as one ZIP built with the
 *     repo's existing store-only ZIP writer (lib/sfx createZip); no new
 *     dependency.
 *
 * MP3: NAMED GAP — the repo bundles no client-side MP3 encoder
 * (no lamejs-style dependency anywhere in the workspace; the AI tab's
 * MP3s are provider-delivered files, not local encodes). Per the lane
 * brief, no dependency is added silently: the export pack ships
 * WAV mix + WAV stems, and MP3 waits on a coordinator-ruled encoder add.
 *
 * Exporting is pure UI = FREE. No charges, no provider calls.
 */

import {
  BEAT_STEPS,
  renderPatternSequence,
  type BeatArrangementEntry,
  type BeatMixerState,
  type BeatPatternId,
  type BeatTransportMode,
} from "@/lib/beat-project";
import { createZip } from "@/lib/sfx";

/* ─── Stem enumeration ─────────────────────────────────────────────────── */

export type BeatStemKind = "drum" | "bass" | "melody";

export interface BeatStemDescriptor {
  /** Render track id (drums), "bassline", or a future melodic lane id. */
  id: string;
  kind: BeatStemKind;
  /** Index into the drum tracks for drum stems; the lane index for
   *  melodic lanes; null for the bass line (it has its own gain rail). */
  trackIndex: number | null;
  /** File-name part: <title>-<bpm>bpm-<fileSlug>.wav */
  fileSlug: string;
  /** House fallback label for menus/lists. */
  label: string;
}

/** Slugify one file-name part: lowercase, alphanumerics + dashes only. */
export function sanitizeFilePart(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "beat";
}

const DRUM_LABELS: Record<string, string> = {
  kick: "Kick",
  snare: "Snare",
  clap: "Clap",
  chat: "Closed Hat",
  ohat: "Open Hat",
  b808: "808 Hit",
  perc: "Perc",
  shk: "Shaker",
  crash: "Crash",
};

/**
 * The stem list for a render, in render order: every drum track the
 * caller enumerates (the page passes its own TRACKS list — the render's
 * own enumeration, never a copy kept here), then the 808 bass line,
 * then any extra lanes a future module supplies (melody joins here).
 */
export function enumerateBeatStems(
  drumTracks: readonly (string | { id: string; label?: string })[],
  extraLanes: readonly { id: string; label?: string }[] = [],
): BeatStemDescriptor[] {
  const stems: BeatStemDescriptor[] = drumTracks.map((tr, trackIndex) => {
    const id = typeof tr === "string" ? tr : tr.id;
    const label =
      (typeof tr === "string" ? undefined : tr.label) ?? DRUM_LABELS[id] ?? id;
    return {
      id,
      kind: "drum" as const,
      trackIndex,
      // The b808 drum hit and the bass line are different stems; keep
      // their file names unmistakably apart.
      fileSlug: id === "b808" ? "808-hit" : sanitizeFilePart(id),
      label,
    };
  });
  stems.push({
    id: "bassline",
    kind: "bass",
    trackIndex: null,
    fileSlug: "808-bass",
    label: "808 Bass",
  });
  extraLanes.forEach((lane, laneIndex) => {
    stems.push({
      id: lane.id,
      kind: "melody",
      trackIndex: laneIndex,
      fileSlug: sanitizeFilePart(lane.id),
      label: lane.label ?? lane.id,
    });
  });
  return stems;
}

/* ─── Render scope (shared by mix + every stem) ────────────────────────── */

/** Pattern-mode renders loop the active pattern this many times —
 *  the classic bounce, unchanged. */
export const BEAT_PATTERN_LOOP_PLAYS = 4;
/** Silence tail after the last step so decays finish (matches render). */
export const BEAT_RENDER_TAIL_SEC = 1.2;

export interface BeatRenderScopeInput {
  mode: BeatTransportMode;
  arrangement: BeatArrangementEntry[];
  activePattern: BeatPatternId;
  bpm: number;
  stepsPerPattern?: number;
}

export interface BeatRenderScope {
  /** Pattern-play sequence, in play order. */
  plays: BeatPatternId[];
  totalSteps: number;
  stepDurSec: number;
  tailSec: number;
  durationSec: number;
  /** True when the scope came from the arrangement chain (song mode). */
  song: boolean;
}

/** The one scope every bounce of this project state renders. */
export function beatRenderScope(input: BeatRenderScopeInput): BeatRenderScope {
  const stepsPerPattern = input.stepsPerPattern ?? BEAT_STEPS;
  const sequence = renderPatternSequence({
    mode: input.mode,
    arrangement: input.arrangement,
  });
  const plays: BeatPatternId[] =
    sequence ??
    Array<BeatPatternId>(BEAT_PATTERN_LOOP_PLAYS).fill(input.activePattern);
  const totalSteps = stepsPerPattern * plays.length;
  const stepDurSec = 60 / Math.max(1, input.bpm) / 4;
  return {
    plays,
    totalSteps,
    stepDurSec,
    tailSec: BEAT_RENDER_TAIL_SEC,
    durationSec: totalSteps * stepDurSec + BEAT_RENDER_TAIL_SEC,
    song: sequence != null,
  };
}

/** Per-stem scopes: every stem renders exactly the mix scope. */
export function stemRenderScopes(
  input: BeatRenderScopeInput,
  stems: readonly BeatStemDescriptor[],
): { stem: BeatStemDescriptor; scope: BeatRenderScope }[] {
  const scope = beatRenderScope(input);
  return stems.map((stem) => ({ stem, scope }));
}

export function renderScopesEqual(a: BeatRenderScope, b: BeatRenderScope): boolean {
  return (
    a.totalSteps === b.totalSteps &&
    a.durationSec === b.durationSec &&
    a.song === b.song &&
    a.plays.length === b.plays.length &&
    a.plays.every((p, i) => p === b.plays[i])
  );
}

/* ─── Solo isolation (mixer math) ──────────────────────────────────────── */

/** What a drum track actually contributes to the mix, resolving
 *  solo/mute/volume exactly as the sequencer's mixer graph does:
 *  any solo on → only solo tracks sound; otherwise unmuted tracks. */
export function effectiveDrumGain(mixer: BeatMixerState, trackIndex: number): number {
  const anySolo = mixer.solo.some(Boolean);
  const audible = anySolo ? mixer.solo[trackIndex] === true : mixer.mute[trackIndex] !== true;
  return audible ? (mixer.vol[trackIndex] ?? 0) : 0;
}

/** The bass line's mix gain. The existing mixer graph gives the bass
 *  its own rail that solo does not gate — preserved as-is here. */
export function effectiveBassGain(mixer: BeatMixerState): number {
  return mixer.bassMute ? 0 : mixer.bassVol;
}

export interface BeatStemMixer {
  vol: number[];
  mute: boolean[];
  solo: boolean[];
  bassVol: number;
  bassMute: boolean;
}

/**
 * The mixer state a stem bounce renders with: only the stem's own
 * effective gain survives; every other rail is zeroed. Feeding this to
 * the same applyMixer + synth path the mix uses IS the isolation —
 * there is no second render implementation. Returns null for stem
 * kinds the current render has no rail for (melodic lanes join when
 * their module joins the render).
 */
export function isolateStemMixer(
  mixer: BeatMixerState,
  stem: BeatStemDescriptor,
): BeatStemMixer | null {
  const n = mixer.vol.length;
  const silent: BeatStemMixer = {
    vol: Array(n).fill(0),
    mute: Array(n).fill(false),
    solo: Array(n).fill(false),
    bassVol: 0,
    bassMute: false,
  };
  if (stem.kind === "drum" && stem.trackIndex != null) {
    silent.vol[stem.trackIndex] = effectiveDrumGain(mixer, stem.trackIndex);
    return silent;
  }
  if (stem.kind === "bass") {
    silent.bassVol = effectiveBassGain(mixer);
    return silent;
  }
  return null;
}

/**
 * Gain-level mix-vs-stems equality: summing the isolated stem mixers
 * reproduces the mix's effective gain on every rail. (Sample-exact
 * summation is impossible across renders — the synths use random
 * noise — so scope equality above + this gain equality are the
 * honest, provable forms of "the stems add up to the mix".)
 */
export function stemMixersSumToMix(
  mixer: BeatMixerState,
  stems: readonly BeatStemDescriptor[],
): boolean {
  const n = mixer.vol.length;
  const drumSum = Array<number>(n).fill(0);
  let bassSum = 0;
  for (const stem of stems) {
    const iso = isolateStemMixer(mixer, stem);
    if (!iso) continue;
    for (let i = 0; i < n; i++) drumSum[i]! += iso.vol[i]!;
    bassSum += iso.bassVol;
  }
  for (let i = 0; i < n; i++) {
    if (Math.abs(drumSum[i]! - effectiveDrumGain(mixer, i)) > 1e-9) return false;
  }
  return Math.abs(bassSum - effectiveBassGain(mixer)) <= 1e-9;
}

/* ─── File naming + ZIP assembly ───────────────────────────────────────── */

export function stemFileName(title: string, bpm: number, stem: BeatStemDescriptor): string {
  return `${sanitizeFilePart(title)}-${Math.round(bpm)}bpm-${stem.fileSlug}.wav`;
}

export function stemsZipFileName(title: string, bpm: number): string {
  return `${sanitizeFilePart(title)}-${Math.round(bpm)}bpm-stems.zip`;
}

export interface BeatStemFile {
  name: string;
  data: Uint8Array;
}

/** Assemble the stems ZIP with the repo's existing store-only ZIP
 *  writer (lib/sfx). Stored (uncompressed) — WAVs barely compress and
 *  every major unzipper accepts stored entries. */
export function assembleStemsZip(files: readonly BeatStemFile[]): Uint8Array {
  return createZip(files.map((f) => ({ name: f.name, data: f.data })));
}
