/* ─── Wave9 benches in-world (Stack 400 world parity,
   census B item B-18 / manifest lane s400-world-wave9) ──────
   The Wave9 family's eight charged rails, native at the
   desks they belong to — the structure + lyrics benches at
   the Song Desk, the six editor/director benches at the
   Video Desk. Each rail is its 2D twin's own rail, at the
   credit registry's price, on the registry-priced spend
   confirmation (useConfirmedApi's confirmedFetch) — the
   bench reads the registry, so the shown price can never
   drift from the confirmation's price:

     POST /api/wave9a/structure/generate  200  SongStructureBuilder
     POST /api/wave9a/lyrics/timing        50  LyricsToTimeline
     POST /api/wave9b/beats/detect        150  BeatSyncSection
     POST /api/wave9b/templates/apply     100  TimelineTemplatesSection
     POST /api/wave9b/bg/charge           200  BackgroundReplaceSection
     POST /api/wave9c/direct/edit         150  VoiceDirectedEditsSection
     POST /api/wave9d/camera/prompt       100  CameraMovePlanner
     POST /api/wave9d/director/plan       150  CharacterDirector
     GET  /api/wave9d/camera/presets        0  the free camera deck

   Payloads are shaped EXACTLY as the twins shape them (same
   fields, same trims, same defaults) and every response is
   read through a null-on-drift guard: a payload that drifts
   is a failure state, never a dressed-up result. Copy rides
   the twins' own catalog namespaces (wave9.*) wherever the
   twin already carries the words, so bench labels can never
   drift from the pages'; the few bench-only lines live in
   worldWave9Bench.* (English verbatim in the other nine
   catalogs, flagged unreviewed — house law).

   The editor-side halves of these twins (applying ops to a
   timeline model, compositing a background on canvas,
   splitting clips) belong to the 2D editor's canvas and do
   not exist in the World; the benches run the charged rails
   themselves — the plan, the markers, the prompt, the
   charge — and land text results in the hub project as
   script assets, exactly where a desk result belongs. */
import { getCreditCost } from "../credit-costs";

/* ─── The eight rails + registry-priced costs ──────────────── */

export const WAVE9_STRUCTURE_PATH = "/api/wave9a/structure/generate";
export const WAVE9_LYRICS_PATH = "/api/wave9a/lyrics/timing";
export const WAVE9_BEATS_PATH = "/api/wave9b/beats/detect";
export const WAVE9_TEMPLATES_PATH = "/api/wave9b/templates/apply";
export const WAVE9_BG_CHARGE_PATH = "/api/wave9b/bg/charge";
export const WAVE9_DIRECT_PATH = "/api/wave9c/direct/edit";
export const WAVE9_CAMERA_PATH = "/api/wave9d/camera/prompt";
export const WAVE9_CAMERA_PRESETS_PATH = "/api/wave9d/camera/presets";
export const WAVE9_DIRECTOR_PATH = "/api/wave9d/director/plan";

/** A rail's price, read live from the registry — the same
 *  number the spend confirmation charges. */
export function wave9Cost(path: string): number {
  const entry = getCreditCost(path);
  if (!entry) throw new Error(`No registered credit cost for ${path}`);
  return entry.cost;
}

export function wave9StructureCost(): number { return wave9Cost(WAVE9_STRUCTURE_PATH); }
export function wave9LyricsCost(): number { return wave9Cost(WAVE9_LYRICS_PATH); }
export function wave9BeatsCost(): number { return wave9Cost(WAVE9_BEATS_PATH); }
export function wave9TemplatesCost(): number { return wave9Cost(WAVE9_TEMPLATES_PATH); }
export function wave9BgChargeCost(): number { return wave9Cost(WAVE9_BG_CHARGE_PATH); }
export function wave9DirectCost(): number { return wave9Cost(WAVE9_DIRECT_PATH); }
export function wave9CameraCost(): number { return wave9Cost(WAVE9_CAMERA_PATH); }
export function wave9DirectorCost(): number { return wave9Cost(WAVE9_DIRECTOR_PATH); }

/** All eight charged rails with their registry prices — the
 *  lane's pin surface (order follows the census list). */
export const WAVE9_RAILS: ReadonlyArray<{ path: string; cost: () => number }> = [
  { path: WAVE9_LYRICS_PATH, cost: wave9LyricsCost },
  { path: WAVE9_STRUCTURE_PATH, cost: wave9StructureCost },
  { path: WAVE9_BEATS_PATH, cost: wave9BeatsCost },
  { path: WAVE9_BG_CHARGE_PATH, cost: wave9BgChargeCost },
  { path: WAVE9_TEMPLATES_PATH, cost: wave9TemplatesCost },
  { path: WAVE9_DIRECT_PATH, cost: wave9DirectCost },
  { path: WAVE9_CAMERA_PATH, cost: wave9CameraCost },
  { path: WAVE9_DIRECTOR_PATH, cost: wave9DirectorCost },
];

/* ─── Shared response helpers ──────────────────────────────── */

function isRecord(data: unknown): data is Record<string, unknown> {
  return !!data && typeof data === "object" && !Array.isArray(data);
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

function strOr(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

/* ─── 1 · Song Structure Builder (wave9a) ──────────────────── */

export interface Wave9StructureSectionInput {
  type: string;
  bars: number;
  label?: string;
}

/** The page's section types + default bars, verbatim. */
export const WAVE9_SECTION_TYPES = ["Intro", "Verse", "Pre-Chorus", "Chorus", "Bridge", "Outro"] as const;
export const WAVE9_SECTION_DEFAULT_BARS: Record<string, number> = {
  Intro: 4, Verse: 16, "Pre-Chorus": 8, Chorus: 16, Bridge: 8, Outro: 8,
};

/** The page's generate body, field for field: sections carry
 *  { type, bars, label } with label defaulted to "". */
export function buildWave9StructurePayload(input: {
  sections: Wave9StructureSectionInput[];
  lyrics: string;
  vibe: string;
  title: string;
}): { sections: Array<{ type: string; bars: number; label: string }>; lyrics: string; vibe: string; title: string } {
  return {
    sections: input.sections.map(({ type, bars, label }) => ({ type, bars, label: label ?? "" })),
    lyrics: input.lyrics.trim(),
    vibe: input.vibe.trim(),
    title: input.title.trim(),
  };
}

export interface Wave9ArrangementSection {
  type: string;
  bars: number;
  startsAtBar: number;
  energy: string;
  direction: string;
  lyricMap?: string;
}

export interface Wave9Arrangement {
  arrangement: Wave9ArrangementSection[];
  totalBars: number;
  notes: string | null;
  creditsRemaining: number | null;
}

/** The generate answer: a non-empty arrangement or it didn't
 *  generate (the page's own acceptance rule). */
export function wave9ArrangementOf(data: unknown): Wave9Arrangement | null {
  if (!isRecord(data)) return null;
  if (!Array.isArray(data.arrangement) || data.arrangement.length === 0) return null;
  const sections: Wave9ArrangementSection[] = [];
  for (const raw of data.arrangement as unknown[]) {
    if (!isRecord(raw)) return null;
    if (typeof raw.type !== "string" || typeof raw.bars !== "number") return null;
    sections.push({
      type: raw.type,
      bars: raw.bars,
      startsAtBar: numOrNull(raw.startsAtBar) ?? 0,
      energy: strOr(raw.energy, ""),
      direction: strOr(raw.direction, ""),
      ...(typeof raw.lyricMap === "string" ? { lyricMap: raw.lyricMap } : {}),
    });
  }
  return {
    arrangement: sections,
    totalBars: numOrNull(data.totalBars) ?? sections.reduce((sum, s) => sum + s.bars, 0),
    notes: typeof data.notes === "string" ? data.notes : null,
    creditsRemaining: numOrNull(data.creditsRemaining),
  };
}

/* ─── 2 · Lyrics-to-Timeline (wave9a) ──────────────────────── */

export interface Wave9TimedLine {
  text: string;
  start: number;
  end: number;
}

/** The page's timing body, field for field. */
export function buildWave9LyricsPayload(input: { lyrics: string; durationSec: number; title: string }): {
  lyrics: string;
  durationSec: number;
  title: string;
} {
  return {
    lyrics: input.lyrics.trim(),
    durationSec: input.durationSec,
    title: input.title.trim(),
  };
}

/** The timing answer: a non-empty lines array or it didn't
 *  place (the page's own acceptance rule). */
export function wave9TimedLinesOf(data: unknown): Wave9TimedLine[] | null {
  if (!isRecord(data)) return null;
  if (!Array.isArray(data.lines) || data.lines.length === 0) return null;
  const lines: Wave9TimedLine[] = [];
  for (const raw of data.lines as unknown[]) {
    if (!isRecord(raw)) return null;
    if (typeof raw.text !== "string" || typeof raw.start !== "number" || typeof raw.end !== "number") return null;
    lines.push({ text: raw.text, start: raw.start, end: raw.end });
  }
  return lines;
}

/* ─── 3 · Beat-Sync Cuts (wave9b) ──────────────────────────── */

/** The section's detect body, field for field. */
export function buildWave9BeatsPayload(mediaUrl: string): { mediaUrl: string } {
  return { mediaUrl };
}

export interface Wave9BeatsResult {
  beats: number[];
  bpm: number | null;
  method: string | null;
  creditsRemaining: number | null;
}

/** The detect answer, filtered exactly as the section filters
 *  it: finite non-negative numbers, capped at 400, rounded to
 *  hundredths. A missing beats array parses to null. */
export function wave9BeatsOf(data: unknown): Wave9BeatsResult | null {
  if (!isRecord(data)) return null;
  if (!Array.isArray(data.beats)) return null;
  const beats = (data.beats as unknown[])
    .filter((b): b is number => typeof b === "number" && isFinite(b) && b >= 0)
    .slice(0, 400)
    .map((b) => Math.round(b * 100) / 100);
  return {
    beats,
    bpm: numOrNull(data.bpm),
    method: typeof data.method === "string" ? data.method : null,
    creditsRemaining: numOrNull(data.creditsRemaining),
  };
}

/* ─── 4 · Timeline Edit Recipes (wave9b) ───────────────────── */

export const WAVE9_RECIPE_IDS = ["jumpcut-vlog", "lyric-video", "talking-head"] as const;
export type Wave9RecipeId = (typeof WAVE9_RECIPE_IDS)[number];

/** The catalog label key segment per recipe (the section's
 *  RECIPES name keys). */
export const WAVE9_RECIPE_NAME_KEYS: Record<Wave9RecipeId, string> = {
  "jumpcut-vlog": "jumpcutName",
  "lyric-video": "lyricName",
  "talking-head": "talkingHeadName",
};
export const WAVE9_RECIPE_DESC_KEYS: Record<Wave9RecipeId, string> = {
  "jumpcut-vlog": "jumpcutDesc",
  "lyric-video": "lyricDesc",
  "talking-head": "talkingHeadDesc",
};

/** Which recipes need the project audio (the section's
 *  needsAudio flags). */
export const WAVE9_RECIPE_NEEDS_AUDIO: Record<Wave9RecipeId, boolean> = {
  "jumpcut-vlog": true,
  "lyric-video": false,
  "talking-head": false,
};

/** The section's apply body, field for field: the beat grid
 *  rides only for jumpcut-vlog, capped at 600. */
export function buildWave9TemplatesPayload(input: {
  recipeId: Wave9RecipeId;
  mediaUrl?: string | null;
  durationSec?: number | null;
  beatGrid?: number[];
}): { recipeId: Wave9RecipeId; mediaUrl?: string; durationSec: number; beatGrid: number[] } {
  return {
    recipeId: input.recipeId,
    mediaUrl: input.mediaUrl ?? undefined,
    durationSec: input.durationSec ?? 0,
    beatGrid: input.recipeId === "jumpcut-vlog" ? (input.beatGrid ?? []).slice(0, 600) : [],
  };
}

export interface Wave9EditOp {
  op: string;
  target?: string;
  params: Record<string, unknown>;
  label: string;
  reversible: boolean;
}

/** The apply answer: an ops array or it didn't compile (the
 *  section's own acceptance rule). Ops keep the server's
 *  label — the preview reads what the server planned. */
export function wave9OpsOf(data: unknown): Wave9EditOp[] | null {
  if (!isRecord(data)) return null;
  if (!Array.isArray(data.ops)) return null;
  const ops: Wave9EditOp[] = [];
  for (const raw of data.ops as unknown[]) {
    if (!isRecord(raw)) return null;
    if (typeof raw.op !== "string" || typeof raw.label !== "string") return null;
    ops.push({
      op: raw.op,
      ...(typeof raw.target === "string" ? { target: raw.target } : {}),
      params: isRecord(raw.params) ? raw.params : {},
      label: raw.label,
      reversible: raw.reversible === true,
    });
  }
  return ops;
}

/* ─── 5 · Background Replace charge (wave9b) ───────────────── */

/** The section's charge body, field for field. */
export function buildWave9BgChargePayload(sceneId: string): { sceneId: string } {
  return { sceneId };
}

/** The preset catalog key segments (the section's PRESETS —
 *  the custom/upload preset has no in-World form: the World
 *  carries no device-canvas composite, so the bench charges
 *  for one of the four scene presets). */
export const WAVE9_BG_PRESET_KEYS = ["presetStudio", "presetStage", "presetCityNight", "presetAbstractGold"] as const;
export type Wave9BgPresetKey = (typeof WAVE9_BG_PRESET_KEYS)[number];

/** The charge answer: the route's own { ok, remaining }. */
export function wave9BgChargeOf(data: unknown): { ok: true; remaining: number | null } | null {
  if (!isRecord(data)) return null;
  if (data.ok !== true) return null;
  return { ok: true, remaining: numOrNull(data.remaining) };
}

/* ─── 6 · Voice-Directed Edits (wave9c) ────────────────────── */

export interface Wave9TimelineClip {
  id: string;
  index: number;
  section: string;
  startSec: number;
  endSec: number;
  volume: number;
}

/** The section's direct body, field for field: timeline
 *  entries carry { id, index, section, startSec, endSec,
 *  volume } with seconds rounded to tenths (the section's
 *  own rounding). The bench's clip rows are hand-built (the
 *  World has no editor timeline), so timings are computed
 *  here from clip durations in order — the same cumulative
 *  shape computeSceneTimings produces. */
export function buildWave9DirectPayload(input: {
  command: string;
  clips: Array<{ id: string; section?: string; durationSec: number; volume?: number }>;
  projectTitle: string;
}): { command: string; timeline: Wave9TimelineClip[]; totalDurationSec: number; projectTitle: string } {
  let cursor = 0;
  const timeline: Wave9TimelineClip[] = input.clips.map((clip, index) => {
    const startSec = Math.round(cursor * 10) / 10;
    cursor += Math.max(0, clip.durationSec);
    const endSec = Math.round(cursor * 10) / 10;
    return {
      id: clip.id,
      index,
      section: clip.section ?? "",
      startSec,
      endSec,
      volume: clip.volume ?? 100,
    };
  });
  return {
    command: input.command.trim(),
    timeline,
    totalDurationSec: timeline.length > 0 ? timeline[timeline.length - 1]!.endSec : 0,
    projectTitle: input.projectTitle ?? "",
  };
}

export type Wave9DirectOp =
  | { op: "split"; sceneId: string; atSec: number; reason: string }
  | { op: "trim"; sceneId: string; trimStart: number; trimEnd: number; reason: string }
  | { op: "delete-range"; startSec: number; endSec: number; reason: string }
  | { op: "add-marker"; title: string; atSec: number; durationSec: number; reason: string }
  | { op: "move-clip"; sceneId: string; toIndex: number; reason: string }
  | { op: "set-volume"; sceneId: string; volume: number; reason: string };

export interface Wave9DirectPlan {
  planSummary: string;
  ops: Wave9DirectOp[];
}

const WAVE9_DIRECT_OP_KINDS = ["split", "trim", "delete-range", "add-marker", "move-clip", "set-volume"] as const;

/** The plan answer: the route's response shape — a summary
 *  and 1–8 ops of the six known kinds; anything else parses
 *  to null (the section throws on an empty plan; the bench
 *  fails honestly on a drifted one). */
export function wave9DirectPlanOf(data: unknown): Wave9DirectPlan | null {
  if (!isRecord(data)) return null;
  if (typeof data.planSummary !== "string" || data.planSummary.length === 0) return null;
  if (!Array.isArray(data.ops) || data.ops.length === 0 || data.ops.length > 8) return null;
  const ops: Wave9DirectOp[] = [];
  for (const raw of data.ops as unknown[]) {
    if (!isRecord(raw)) return null;
    if (typeof raw.op !== "string" || !(WAVE9_DIRECT_OP_KINDS as readonly string[]).includes(raw.op)) return null;
    const reason = strOr(raw.reason, "");
    switch (raw.op) {
      case "split":
        if (typeof raw.sceneId !== "string" || typeof raw.atSec !== "number") return null;
        ops.push({ op: "split", sceneId: raw.sceneId, atSec: raw.atSec, reason });
        break;
      case "trim":
        if (typeof raw.sceneId !== "string" || typeof raw.trimStart !== "number" || typeof raw.trimEnd !== "number") return null;
        ops.push({ op: "trim", sceneId: raw.sceneId, trimStart: raw.trimStart, trimEnd: raw.trimEnd, reason });
        break;
      case "delete-range":
        if (typeof raw.startSec !== "number" || typeof raw.endSec !== "number") return null;
        ops.push({ op: "delete-range", startSec: raw.startSec, endSec: raw.endSec, reason });
        break;
      case "add-marker":
        if (typeof raw.title !== "string" || typeof raw.atSec !== "number") return null;
        ops.push({ op: "add-marker", title: raw.title, atSec: raw.atSec, durationSec: numOrNull(raw.durationSec) ?? 0, reason });
        break;
      case "move-clip":
        if (typeof raw.sceneId !== "string" || typeof raw.toIndex !== "number") return null;
        ops.push({ op: "move-clip", sceneId: raw.sceneId, toIndex: raw.toIndex, reason });
        break;
      case "set-volume":
        if (typeof raw.sceneId !== "string" || typeof raw.volume !== "number") return null;
        ops.push({ op: "set-volume", sceneId: raw.sceneId, volume: raw.volume, reason });
        break;
    }
  }
  return { planSummary: data.planSummary, ops };
}

/** m:ss.s — the twins' clock format (the direct-edit
 *  section's formatClock shape). */
export function wave9FormatClock(sec: number): string {
  const safe = isFinite(sec) && sec > 0 ? sec : 0;
  const m = Math.floor(safe / 60);
  const s = (safe % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

/* ─── 7 · Camera Move Planner (wave9d) ─────────────────────── */

export const WAVE9_CAMERA_INTENSITIES = ["subtle", "natural", "dramatic"] as const;
export type Wave9CameraIntensity = (typeof WAVE9_CAMERA_INTENSITIES)[number];

/** The classic five — the planner's own deck fallback when
 *  the free deck read fails (ids + label key segments). */
export const WAVE9_CAMERA_FALLBACK_MOVES = ["static-wide", "dolly-in", "crane-up", "orbit", "handheld"] as const;

export interface Wave9CameraPreset {
  id: string;
  name: string;
  category: string;
  blurb: string;
  locked: boolean;
  conflictsWith: string[];
}

export interface Wave9CameraDeck {
  presets: Wave9CameraPreset[];
  maxStack: number;
  buildCredits: number | null;
}

/** The free deck answer (GET /camera/presets). */
export function wave9CameraDeckOf(data: unknown): Wave9CameraDeck | null {
  if (!isRecord(data)) return null;
  if (!Array.isArray(data.presets) || data.presets.length === 0) return null;
  const presets: Wave9CameraPreset[] = [];
  for (const raw of data.presets as unknown[]) {
    if (!isRecord(raw)) return null;
    if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
    presets.push({
      id: raw.id,
      name: raw.name,
      category: strOr(raw.category, ""),
      blurb: strOr(raw.blurb, ""),
      locked: raw.locked === true,
      conflictsWith: Array.isArray(raw.conflictsWith)
        ? (raw.conflictsWith as unknown[]).filter((c): c is string => typeof c === "string")
        : [],
    });
  }
  return {
    presets,
    maxStack: numOrNull(data.maxStack) ?? 3,
    buildCredits: numOrNull(data.buildCredits),
  };
}

/** The planner's build body, field for field: the stack in
 *  performance order ({ preset, intensity? }), the stack's
 *  default intensity, and the scene's base prompt + context. */
export function buildWave9CameraPayload(input: {
  stack: Array<{ preset: string; intensity?: Wave9CameraIntensity | null }>;
  intensity: Wave9CameraIntensity;
  basePrompt: string;
  sceneContext: string;
}): {
  moves: Array<{ preset: string; intensity?: Wave9CameraIntensity }>;
  intensity: Wave9CameraIntensity;
  basePrompt: string;
  sceneContext: string;
} {
  return {
    moves: input.stack.map((s) => ({
      preset: s.preset,
      ...(s.intensity ? { intensity: s.intensity } : {}),
    })),
    intensity: input.intensity,
    basePrompt: input.basePrompt,
    sceneContext: input.sceneContext,
  };
}

/** The build answer: the enriched prompt or it didn't build
 *  (the planner's own acceptance rule). */
export function wave9CameraPromptOf(data: unknown): string | null {
  if (!isRecord(data)) return null;
  return typeof data.enrichedPrompt === "string" && data.enrichedPrompt.length > 0 ? data.enrichedPrompt : null;
}

/** The stack rules the server enforces before charging,
 *  mirrored so the bench refuses the same stacks up front:
 *  a locked-off move always stands alone, and a move never
 *  stacks with one it conflicts with. Returns the offending
 *  pair (or the locked move twice) — null when the stack is
 *  legal. */
export function wave9CameraStackConflict(
  stack: Array<{ preset: string }>,
  presets: Wave9CameraPreset[],
): { a: string; b: string; locked: boolean } | null {
  if (stack.length <= 1) return null;
  const byId = new Map(presets.map((p) => [p.id, p]));
  for (const entry of stack) {
    const preset = byId.get(entry.preset);
    if (preset?.locked) return { a: preset.name, b: preset.name, locked: true };
  }
  for (let i = 0; i < stack.length; i++) {
    for (let j = i + 1; j < stack.length; j++) {
      const a = byId.get(stack[i]!.preset);
      const b = byId.get(stack[j]!.preset);
      if (!a || !b) continue;
      if (a.conflictsWith.includes(b.id) || b.conflictsWith.includes(a.id)) {
        return { a: a.name, b: b.name, locked: false };
      }
    }
  }
  return null;
}

/* ─── 8 · Character Director (wave9d) ──────────────────────── */

export interface Wave9CastMember {
  vaultId: string;
  name: string;
  description: string;
}

export interface Wave9ShotInput {
  characters: string[];
  action: string;
  cameraNote: string;
}

/** The director's plan body, field for field: name/style
 *  omitted when blank, shots indexed from 1 with trimmed
 *  action + camera note. */
export function buildWave9DirectorPayload(input: {
  name: string;
  sceneStyle: string;
  cast: Wave9CastMember[];
  shots: Wave9ShotInput[];
}): {
  name?: string;
  sceneStyle?: string;
  cast: Wave9CastMember[];
  shots: Array<{ index: number; characters: string[]; action: string; cameraNote: string }>;
} {
  return {
    name: input.name.trim() || undefined,
    sceneStyle: input.sceneStyle.trim() || undefined,
    cast: input.cast.map((v) => ({ vaultId: v.vaultId, name: v.name, description: v.description })),
    shots: input.shots.map((s, i) => ({
      index: i + 1,
      characters: s.characters,
      action: s.action.trim(),
      cameraNote: s.cameraNote.trim(),
    })),
  };
}

export interface Wave9PlannedShot {
  index: number;
  characters: string[];
  action: string;
  cameraNote: string;
  generatedPrompt: string;
}

export interface Wave9DirectorResult {
  planId: string | null;
  shots: Wave9PlannedShot[];
  creditsRemaining: number | null;
}

/** The plan answer: the merged shots (the route merges the
 *  model's prompts back onto the input shots) or it didn't
 *  plan (the page's own acceptance rule). */
export function wave9DirectorResultOf(data: unknown): Wave9DirectorResult | null {
  if (!isRecord(data)) return null;
  if (!Array.isArray(data.shots) || data.shots.length === 0) return null;
  const shots: Wave9PlannedShot[] = [];
  for (const raw of data.shots as unknown[]) {
    if (!isRecord(raw)) return null;
    shots.push({
      index: numOrNull(raw.index) ?? shots.length + 1,
      characters: Array.isArray(raw.characters)
        ? (raw.characters as unknown[]).filter((c): c is string => typeof c === "string")
        : [],
      action: strOr(raw.action, ""),
      cameraNote: strOr(raw.cameraNote, ""),
      generatedPrompt: strOr(raw.generatedPrompt, ""),
    });
  }
  return {
    planId: typeof data.planId === "string" ? data.planId : null,
    shots,
    creditsRemaining: numOrNull(data.creditsRemaining),
  };
}
