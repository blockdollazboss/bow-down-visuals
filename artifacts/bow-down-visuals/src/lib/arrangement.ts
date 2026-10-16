/* ── Arrangement model — the Audio desk as an instrument (Stack 6) ───────
 * The Audio Studio page graduated from one-shot jobs to a real arrangement:
 * tracks hold clips on a timeline, per-track parametric FX chains run in a
 * user-controlled order, volume / pan / reverb-mix automation rides on
 * breakpoint lanes, vocal tracks carry take lanes with a comp map, tracks
 * can duck against the vocal lane, and MIDI tracks hold piano-roll notes.
 *
 * This module is the single source of truth for that model. It is shared by:
 *   • the Audio Studio arrangement surface (components/audio-studio/*)
 *   • the preview adapter that feeds lib/audio-engine.ts
 *   • the export adapter that builds the POST /music/export payload — the
 *     server render (api-server lib/audioExport.ts) mirrors these shapes
 *     and renders them with FFmpeg, so what the arrangement plays is what
 *     the export renders (see expandArrangementToExportStems).
 *
 * Persistence: localStorage for the fast same-browser restore + a server
 * draft (POST /api/drafts, workflowType "audio-arrangement") — the same
 * house pattern as lib/music-lane.ts. No DB migration: the arrangement is
 * project JSON, exactly like the editor's MusicStudioSettings.
 *
 * Editing an arrangement is free (editor-free law). Only generations and
 * the final audio export keep their existing Visual Bucs charges.
 */

import type { MasterSettings } from "@/lib/editor-settings";

/** Same defaults as the editor's Music Studio master bus. */
export function defaultArrangementMaster(): MasterSettings {
  return {
    volume: 100,
    limiter: true,
    compression: 40,
    eqTone: "balanced",
    stereoWidth: 50,
    bassBoost: 30,
    loudnessTarget: "streaming",
    fadeIn: false,
    fadeOut: true,
  };
}

/* ─── FX chain ─────────────────────────────────────────────────────────── */

export type FxStepType = "eq" | "compressor" | "saturation" | "reverb" | "delay";

export interface EqBand {
  /** Center frequency, Hz (20–20,000). */
  freq: number;
  /** Gain, dB (−24…+24). */
  gain: number;
  /** Q factor (0.3–12). */
  q: number;
}

export interface FxStep {
  id: string;
  type: FxStepType;
  enabled: boolean;
  /** eq: up to 5 peaking bands. */
  bands?: EqBand[];
  /** compressor params. */
  thresholdDb?: number; // −60…0
  ratio?: number; // 1…20
  attackMs?: number; // 0.1…500
  releaseMs?: number; // 10…1000
  /** saturation drive 1–3. */
  drive?: number;
  /** reverb / delay wet mix 0–100 (%). */
  mix?: number;
  /** delay time, ms (reverb ignores this). */
  timeMs?: number;
  /** delay feedback 0–80 (%). */
  feedback?: number;
}

export function defaultEqBands(): EqBand[] {
  return [
    { freq: 100, gain: 0, q: 1 },
    { freq: 1000, gain: 0, q: 1 },
    { freq: 8000, gain: 0, q: 1 },
  ];
}

export function makeFxStep(type: FxStepType, id: string): FxStep {
  switch (type) {
    case "eq":
      return { id, type, enabled: true, bands: defaultEqBands() };
    case "compressor":
      return { id, type, enabled: true, thresholdDb: -18, ratio: 3, attackMs: 10, releaseMs: 150 };
    case "saturation":
      return { id, type, enabled: true, drive: 1.5 };
    case "reverb":
      return { id, type, enabled: true, mix: 25 };
    case "delay":
      return { id, type, enabled: true, mix: 20, timeMs: 250, feedback: 30 };
  }
}

/** Move a chain step to a new index (chain order is user-controlled). */
export function moveFxStep(chain: FxStep[], stepId: string, toIndex: number): FxStep[] {
  const from = chain.findIndex((s) => s.id === stepId);
  if (from < 0) return chain;
  const next = [...chain];
  const [step] = next.splice(from, 1);
  const clamped = Math.max(0, Math.min(next.length, toIndex));
  next.splice(clamped, 0, step!);
  return next;
}

/* ─── Automation ───────────────────────────────────────────────────────── */

export interface AutomationPoint {
  /** Timeline seconds. */
  time: number;
  value: number;
}

export interface TrackAutomation {
  /** Gain breakpoints, value 0–150 (%). */
  volume?: AutomationPoint[];
  /** Pan breakpoints, value −100…100. */
  pan?: AutomationPoint[];
  /** Wet-mix breakpoints (0–100 %) for the track's first enabled reverb
   *  step — the one FX parameter both the preview engine and the FFmpeg
   *  render can automate truthfully (wet-branch gain expression). */
  reverbMix?: AutomationPoint[];
}

const clampN = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

/** Sorted, de-duplicated copy of a breakpoint lane. */
export function sortPoints(points: AutomationPoint[] | undefined): AutomationPoint[] {
  if (!points) return [];
  const byTime = new Map<number, number>();
  for (const p of points) {
    if (Number.isFinite(p.time) && Number.isFinite(p.value)) {
      byTime.set(Math.round(p.time * 1000) / 1000, p.value);
    }
  }
  return [...byTime.entries()]
    .map(([time, value]) => ({ time, value }))
    .sort((a, b) => a.time - b.time);
}

/** Linear-interpolated lane value at time t (holds the end values outside). */
export function automationValueAt(
  points: AutomationPoint[] | undefined,
  t: number,
  fallback: number,
): number {
  const pts = sortPoints(points);
  if (pts.length === 0) return fallback;
  if (t <= pts[0]!.time) return pts[0]!.value;
  const last = pts[pts.length - 1]!;
  if (t >= last.time) return last.value;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (t <= b.time) {
      const span = b.time - a.time;
      if (span <= 0) return b.value;
      return a.value + ((b.value - a.value) * (t - a.time)) / span;
    }
  }
  return last.value;
}

/** Insert or replace the breakpoint at `time` on a lane. */
export function upsertPoint(
  points: AutomationPoint[] | undefined,
  time: number,
  value: number,
): AutomationPoint[] {
  const t = Math.round(Math.max(0, time) * 1000) / 1000;
  return sortPoints([...(points ?? []).filter((p) => Math.abs(p.time - t) > 0.001), { time: t, value }]);
}

/** Remove the breakpoint nearest to `time` (within tolerance). */
export function removePointNear(
  points: AutomationPoint[] | undefined,
  time: number,
  tolerance = 0.25,
): AutomationPoint[] {
  const pts = sortPoints(points);
  let best = -1;
  let bestDist = Infinity;
  pts.forEach((p, i) => {
    const d = Math.abs(p.time - time);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  if (best < 0 || bestDist > tolerance) return pts;
  return pts.filter((_, i) => i !== best);
}

/* ─── Clips, takes, comp ───────────────────────────────────────────────── */

export interface ArrangementClip {
  id: string;
  /** Public URL of the audio file. */
  url: string;
  name: string;
  /** Timeline position, seconds. */
  startTime: number;
  /** Seconds trimmed off the source start. */
  trimStart: number;
  /** Seconds trimmed off the source end. */
  trimEnd: number;
  /** Full source length in seconds, when known. */
  durationSec?: number;
}

/** Playable length of a clip after trims. */
export function clipPlayLength(clip: ArrangementClip): number {
  if (typeof clip.durationSec !== "number" || !Number.isFinite(clip.durationSec)) return 0;
  return Math.max(0, clip.durationSec - Math.max(0, clip.trimStart) - Math.max(0, clip.trimEnd));
}

export interface TrackTake {
  id: string;
  name: string;
  url: string;
  durationSec?: number;
}

/** One chosen region of the comp: timeline [startTime, startTime+length]
 *  is sourced from take `takeId` at [srcStart, srcEnd]. */
export interface CompRegion {
  id: string;
  takeId: string;
  srcStart: number;
  srcEnd: number;
  startTime: number;
}

/** Short crossfade the render applies at comp joins (seconds). The server
 *  render supports per-segment fades; the preview engine does not crossfade
 *  comp joins — the UI says so where it matters. */
export const COMP_FADE_SEC = 0.015;

/**
 * Resolve a track's comp map into clip-shaped segments ready for preview
 * and export. Regions are sorted by timeline position; overlaps are
 * resolved in favor of the LATER region (it covers the earlier one's tail),
 * which matches how comp editors behave when regions are nudged together.
 */
export function resolveCompSegments(
  takes: TrackTake[],
  comp: CompRegion[],
): Array<ArrangementClip & { fadeInSec: number; fadeOutSec: number }> {
  const byId = new Map(takes.map((t) => [t.id, t]));
  const regions = [...comp]
    .filter((r) => byId.has(r.takeId) && r.srcEnd > r.srcStart && r.startTime >= 0)
    .sort((a, b) => a.startTime - b.startTime);
  const out: Array<ArrangementClip & { fadeInSec: number; fadeOutSec: number }> = [];
  regions.forEach((r, i) => {
    const take = byId.get(r.takeId)!;
    let end = r.startTime + (r.srcEnd - r.srcStart);
    const next = regions[i + 1];
    if (next && next.startTime < end) end = next.startTime;
    const len = end - r.startTime;
    if (len <= 0.02) return;
    const srcEnd = r.srcStart + len;
    const durationSec =
      typeof take.durationSec === "number" && Number.isFinite(take.durationSec)
        ? take.durationSec
        : srcEnd;
    out.push({
      id: `comp-${r.id}`,
      url: take.url,
      name: `${take.name} (comp)`,
      startTime: r.startTime,
      trimStart: r.srcStart,
      trimEnd: Math.max(0, durationSec - srcEnd),
      durationSec,
      fadeInSec: COMP_FADE_SEC,
      fadeOutSec: COMP_FADE_SEC,
    });
  });
  return out;
}

/** Timeline windows the comp covers — the lane UI mutes take material
 *  outside these windows and highlights the chosen take inside them. */
export function compCoverage(comp: CompRegion[]): Array<{ start: number; end: number }> {
  return [...comp]
    .filter((r) => r.srcEnd > r.srcStart)
    .map((r) => ({ start: r.startTime, end: r.startTime + (r.srcEnd - r.srcStart) }))
    .sort((a, b) => a.start - b.start);
}

/* ─── MIDI ─────────────────────────────────────────────────────────────── */

export type MidiInstrumentId = "keys" | "pluck" | "bass" | "pad";

export const MIDI_INSTRUMENTS: Array<{ id: MidiInstrumentId; label: string }> = [
  { id: "keys", label: "Keys" },
  { id: "pluck", label: "Pluck" },
  { id: "bass", label: "Bass" },
  { id: "pad", label: "Pad" },
];

export interface MidiRollNote {
  id: string;
  /** MIDI note number 0–127 (69 = A4). */
  pitch: number;
  /** Start, seconds from arrangement start. */
  start: number;
  /** Length, seconds. */
  duration: number;
  /** 0–127. */
  velocity: number;
}

export function clampNote(n: MidiRollNote): MidiRollNote {
  return {
    id: n.id,
    pitch: Math.round(clampN(n.pitch, 0, 127)),
    start: Math.round(clampN(n.start, 0, 86400) * 1000) / 1000,
    duration: Math.round(clampN(n.duration, 0.03, 3600) * 1000) / 1000,
    velocity: Math.round(clampN(n.velocity, 1, 127)),
  };
}

export function moveNote(notes: MidiRollNote[], id: string, start: number, pitch: number): MidiRollNote[] {
  return notes.map((n) => (n.id === id ? clampNote({ ...n, start, pitch }) : n));
}

export function resizeNote(notes: MidiRollNote[], id: string, duration: number): MidiRollNote[] {
  return notes.map((n) => (n.id === id ? clampNote({ ...n, duration }) : n));
}

export function notesInRange(notes: MidiRollNote[], from: number, to: number): MidiRollNote[] {
  return notes.filter((n) => n.start < to && n.start + n.duration > from);
}

/* ─── Tracks & arrangement ─────────────────────────────────────────────── */

export interface TrackDucking {
  /** Track id this track ducks against (normally the vocal lane). */
  againstTrackId: string;
  /** House-simple duck amount 0–100. */
  amount: number;
  /** House-simple voice sensitivity 0–100. */
  sensitivity: number;
}

export interface ArrangementTrack {
  id: string;
  name: string;
  kind: "audio" | "midi";
  /** Free-form role label used by export kind selection (e.g. "Lead Vocal"). */
  type: string;
  clips: ArrangementClip[];
  /** Vocal take lanes (audio tracks only). When `comp` is non-empty the
   *  comp — not `clips` — is what plays and renders. */
  takes?: TrackTake[];
  comp?: CompRegion[];
  volume: number; // 0–100
  pan: number; // −100…100
  muted: boolean;
  solo: boolean;
  fxChain: FxStep[];
  automation: TrackAutomation;
  ducking?: TrackDucking | null;
  /** MIDI payload (kind === "midi"). */
  instrument?: MidiInstrumentId;
  notes?: MidiRollNote[];
}

export interface Arrangement {
  version: 1;
  title: string;
  bpm: number;
  tracks: ArrangementTrack[];
  master: MasterSettings;
}

let uidCounter = 0;
export function arrangementUid(prefix = "id"): string {
  uidCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function makeAudioTrack(name: string, type = "Other Stem"): ArrangementTrack {
  return {
    id: arrangementUid("trk"),
    name,
    kind: "audio",
    type,
    clips: [],
    volume: 90,
    pan: 0,
    muted: false,
    solo: false,
    fxChain: [],
    automation: {},
    ducking: null,
  };
}

export function makeMidiTrack(name = "Keys"): ArrangementTrack {
  return {
    ...makeAudioTrack(name, "Piano / Keys"),
    kind: "midi",
    instrument: "keys",
    notes: [],
  };
}

export function emptyArrangement(): Arrangement {
  return {
    version: 1,
    title: "Untitled Arrangement",
    bpm: 120,
    tracks: [],
    master: defaultArrangementMaster(),
  };
}

/** Total arrangement length in seconds (audio clips, comp, MIDI notes). */
export function arrangementDuration(a: Arrangement): number {
  let max = 0;
  for (const t of a.tracks) {
    if (t.kind === "midi") {
      for (const n of t.notes ?? []) max = Math.max(max, n.start + n.duration);
      continue;
    }
    if (t.comp && t.comp.length > 0 && t.takes && t.takes.length > 0) {
      for (const seg of resolveCompSegments(t.takes, t.comp)) {
        max = Math.max(max, seg.startTime + clipPlayLength(seg));
      }
      continue;
    }
    for (const c of t.clips) max = Math.max(max, c.startTime + clipPlayLength(c));
  }
  return max;
}

/** A track's sounding segments: the comp when one exists, else its clips. */
export function trackSegments(
  t: ArrangementTrack,
): Array<ArrangementClip & { fadeInSec?: number; fadeOutSec?: number }> {
  if (t.kind === "audio" && t.comp && t.comp.length > 0 && t.takes && t.takes.length > 0) {
    const segs = resolveCompSegments(t.takes, t.comp);
    if (segs.length > 0) return segs;
  }
  return t.clips;
}

/* ─── Export adapter ─────────────────────────────────────────────────────
 * Mirrors the server's ExportStemInput (api-server lib/audioExport.ts).
 * MIDI tracks are NOT expanded here — the caller bounces them to audio
 * first (OfflineAudioContext synth bounce, uploaded like any stem) and
 * passes the bounce URLs in `midiBounceUrls`, so the server render stays
 * a pure audio graph and preview/export use the identical synth. */

export interface ArrangementExportStem {
  id: string;
  name: string;
  type: string;
  url: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  pan: number;
  trimStart: number;
  trimEnd: number;
  durationSec?: number;
  startTime: number;
  fadeInSec?: number;
  fadeOutSec?: number;
  fxChain?: FxStep[];
  automation?: TrackAutomation;
  /** In-arrangement ducking: this stem ducks against the mix of the named
   *  source stems (ALL rendered segments of the source track). */
  duck?: { sourceStemIds: string[]; amount: number; sensitivity: number };
}

export function expandArrangementToExportStems(
  a: Arrangement,
  midiBounceUrls: Record<string, string> = {},
): ArrangementExportStem[] {
  const out: ArrangementExportStem[] = [];
  const stemIdsByTrackId = new Map<string, string[]>();

  for (const t of a.tracks) {
    if (t.kind === "midi") {
      const url = midiBounceUrls[t.id];
      if (!url) continue; // unrenderable without a bounce — never fake it
      const stem: ArrangementExportStem = {
        id: `stem-${t.id}`,
        name: t.name,
        type: t.type,
        url,
        volume: t.volume,
        muted: t.muted,
        solo: t.solo,
        pan: t.pan,
        trimStart: 0,
        trimEnd: 0,
        startTime: 0,
        ...(t.fxChain.length > 0 ? { fxChain: t.fxChain } : {}),
        ...(hasAutomation(t.automation) ? { automation: cleanAutomation(t.automation) } : {}),
      };
      stemIdsByTrackId.set(t.id, [stem.id]);
      out.push(stem);
      continue;
    }
    const segs = trackSegments(t);
    segs.forEach((seg, i) => {
      const stem: ArrangementExportStem = {
        id: `stem-${t.id}-${i}`,
        name: segs.length > 1 ? `${t.name} · part ${i + 1}` : t.name,
        type: t.type,
        url: seg.url,
        volume: t.volume,
        muted: t.muted,
        solo: t.solo,
        pan: t.pan,
        trimStart: seg.trimStart,
        trimEnd: seg.trimEnd,
        ...(typeof seg.durationSec === "number" ? { durationSec: seg.durationSec } : {}),
        startTime: seg.startTime,
        ...(seg.fadeInSec ? { fadeInSec: seg.fadeInSec } : {}),
        ...(seg.fadeOutSec ? { fadeOutSec: seg.fadeOutSec } : {}),
        ...(t.fxChain.length > 0 ? { fxChain: t.fxChain } : {}),
        ...(hasAutomation(t.automation) ? { automation: cleanAutomation(t.automation) } : {}),
      };
      const list = stemIdsByTrackId.get(t.id) ?? [];
      list.push(stem.id);
      stemIdsByTrackId.set(t.id, list);
      out.push(stem);
    });
  }

  /* Ducking: every rendered segment of the target track ducks against the
   * mix of ALL rendered segments of the source track (a comped vocal is
   * still one logical sidechain source — the server mixes the source
   * segments into a single feed). */
  for (const t of a.tracks) {
    if (!t.ducking) continue;
    const sourceStemIds = stemIdsByTrackId.get(t.ducking.againstTrackId);
    if (!sourceStemIds || sourceStemIds.length === 0) continue;
    for (const stem of out) {
      if ((stemIdsByTrackId.get(t.id) ?? []).includes(stem.id)) {
        stem.duck = {
          sourceStemIds,
          amount: t.ducking.amount,
          sensitivity: t.ducking.sensitivity,
        };
      }
    }
  }
  return out;
}

export function hasAutomation(auto: TrackAutomation | undefined): boolean {
  if (!auto) return false;
  return (
    (auto.volume?.length ?? 0) > 0 ||
    (auto.pan?.length ?? 0) > 0 ||
    (auto.reverbMix?.length ?? 0) > 0
  );
}

export function cleanAutomation(auto: TrackAutomation): TrackAutomation {
  const out: TrackAutomation = {};
  if (auto.volume?.length) out.volume = sortPoints(auto.volume);
  if (auto.pan?.length) out.pan = sortPoints(auto.pan);
  if (auto.reverbMix?.length) out.reverbMix = sortPoints(auto.reverbMix);
  return out;
}

/* ─── Persistence (house pattern: localStorage + /api/drafts) ──────────── */

export const ARRANGEMENT_WORKFLOW = "audio-arrangement";
const ARRANGEMENT_LOCAL_KEY = "bdv-audio-arrangement-v1";

export function saveLocalArrangement(a: Arrangement): void {
  try {
    localStorage.setItem(ARRANGEMENT_LOCAL_KEY, JSON.stringify(a));
  } catch {
    /* storage full/blocked — server draft still covers restore */
  }
}

export function loadLocalArrangement(): Arrangement | null {
  try {
    const raw = localStorage.getItem(ARRANGEMENT_LOCAL_KEY);
    if (!raw) return null;
    return normalizeArrangement(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function fetchServerArrangement(token: string | null): Promise<Arrangement | null> {
  try {
    const res = await fetch(`/api/drafts?workflow=${ARRANGEMENT_WORKFLOW}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { drafts?: Array<{ draft_data?: unknown }> };
    const draft = data.drafts?.[0]?.draft_data;
    if (!draft || typeof draft !== "object") return null;
    return normalizeArrangement(draft);
  } catch {
    return null;
  }
}

export async function saveServerArrangement(token: string | null, a: Arrangement): Promise<void> {
  try {
    await fetch("/api/drafts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        workflowType: ARRANGEMENT_WORKFLOW,
        title: a.title || "Audio arrangement",
        draftData: a,
      }),
    });
  } catch {
    /* best-effort — local copy remains */
  }
}

/** Defensive load: any older/partial JSON loads as a valid arrangement so
 *  existing projects open unchanged (backward compatibility). */
export function normalizeArrangement(raw: unknown): Arrangement | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Arrangement>;
  const base = emptyArrangement();
  const tracks: ArrangementTrack[] = Array.isArray(r.tracks)
    ? r.tracks.filter((t): t is ArrangementTrack => !!t && typeof t === "object").map((t) => {
        const fallback = t.kind === "midi" ? makeMidiTrack(t.name ?? "Keys") : makeAudioTrack(t.name ?? "Track");
        return {
          ...fallback,
          ...t,
          clips: Array.isArray(t.clips) ? t.clips : [],
          fxChain: Array.isArray(t.fxChain) ? t.fxChain : [],
          automation: t.automation && typeof t.automation === "object" ? t.automation : {},
          takes: Array.isArray(t.takes) ? t.takes : undefined,
          comp: Array.isArray(t.comp) ? t.comp : undefined,
          notes: Array.isArray(t.notes) ? t.notes.map(clampNote) : t.kind === "midi" ? [] : undefined,
        };
      })
    : [];
  return {
    version: 1,
    title: typeof r.title === "string" ? r.title : base.title,
    bpm: typeof r.bpm === "number" && r.bpm >= 30 && r.bpm <= 300 ? r.bpm : base.bpm,
    tracks,
    master: { ...base.master, ...(r.master && typeof r.master === "object" ? r.master : {}) },
  };
}
