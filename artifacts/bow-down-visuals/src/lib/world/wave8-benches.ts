/* ─── Wave8 single benches in-world (Stack 400 world parity,
   census B item B-19 / manifest lane s400-world-wave8) ──────
   Four of the Wave8 family's six single rails, native at the
   desks they belong to — the highlight cutter with the
   Repurpose family at the My Studio board, the media-kit
   builder at the Press Kit desk, the ad-lib generator with
   the board's music desks, and the styled-caption burn-in
   under the Hook Desk beside the Caption Styler bench. (The
   other two rails live with their own desk seams: the hook
   rewriter in lib/world/hook-desk.ts, the calendar auto-fill
   in lib/world/scheduler-desk.ts.)

   Each rail is its 2D twin's own rail, at the credit
   registry's price, on the registry-priced spend confirmation
   (useConfirmedApi's confirmedFetch) — the bench reads the
   registry, so the shown price can never drift from the
   confirmation's price:

     POST /api/wave8/highlights/cut        300  HighlightCutter
     POST /api/wave8/media-kit/generate    100  MediaKitBuilder
     GET  /api/artist-vaults                 0  the kit's vault pick
     POST /api/wave8/adlib/generate        150  AdLibGenerator
     POST /api/wave8/caption-styler/burn   100  CaptionStyler (wave8)

   The burn rail is NOT the Caption Styler bench's rail:
   /api/caption-styler (300, caption-styler-bench.ts) renders
   captions onto an uploaded video server-side; THIS rail
   times and styles a pasted transcript into SRT/VTT files.
   Different rail, different price, different desk job.

   Payloads are shaped EXACTLY as the twins shape them (same
   fields, same trims, same defaults) and every response is
   read through a null-on-drift guard at the twin's own
   acceptance bar: a payload that drifts is a failure state,
   never a dressed-up result. Copy rides the twins' own
   catalog namespace (wave8.*) wherever the twin already
   carries the words, so bench labels can never drift from
   the pages'; the few bench-only lines live in
   worldWave8Bench.* (English verbatim in the other nine
   catalogs, flagged unreviewed — house law).

   The page-side extras of the twins (the media kit's jsPDF
   build + public-link liveness check, the highlight reel's
   scheduler/promo handoffs, the ad-libs' mix handoff) belong
   to the 2D pages' plumbing; the benches run the charged
   rails themselves and land text results in the hub project
   as script assets, exactly where a desk result belongs. */
import { getCreditCost } from "../credit-costs";

/* ─── The four rails + registry-priced costs ───────────────── */

export const WAVE8_HIGHLIGHTS_PATH = "/api/wave8/highlights/cut";
export const WAVE8_MEDIA_KIT_PATH = "/api/wave8/media-kit/generate";
export const WAVE8_MEDIA_KIT_VAULTS_PATH = "/api/artist-vaults";
export const WAVE8_ADLIB_PATH = "/api/wave8/adlib/generate";
export const WAVE8_CAPTION_BURN_PATH = "/api/wave8/caption-styler/burn";

/** A rail's price, read live from the registry — the same
 *  number the spend confirmation charges. */
export function wave8BenchCost(path: string): number {
  const entry = getCreditCost(path);
  if (!entry) throw new Error(`No registered credit cost for ${path}`);
  return entry.cost;
}

export function wave8HighlightsCost(): number { return wave8BenchCost(WAVE8_HIGHLIGHTS_PATH); }
export function wave8MediaKitCost(): number { return wave8BenchCost(WAVE8_MEDIA_KIT_PATH); }
export function wave8AdlibCost(): number { return wave8BenchCost(WAVE8_ADLIB_PATH); }
export function wave8CaptionBurnCost(): number { return wave8BenchCost(WAVE8_CAPTION_BURN_PATH); }

/** All four charged rails with their registry prices — the
 *  lane's pin surface (order follows the census list; the
 *  hook-rewriter and calendar rails pin from their own seam
 *  files in the lane test). */
export const WAVE8_BENCH_RAILS: ReadonlyArray<{ path: string; cost: () => number }> = [
  { path: WAVE8_HIGHLIGHTS_PATH, cost: wave8HighlightsCost },
  { path: WAVE8_MEDIA_KIT_PATH, cost: wave8MediaKitCost },
  { path: WAVE8_ADLIB_PATH, cost: wave8AdlibCost },
  { path: WAVE8_CAPTION_BURN_PATH, cost: wave8CaptionBurnCost },
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

/* ─── 1 · Stream Highlight Auto-Editor (wave8/highlights) ──── */

/** The page's target reel lengths, verbatim (default 60). */
export const WAVE8_HIGHLIGHT_TARGET_SECONDS = [30, 60, 90, 120, 180] as const;
export const WAVE8_HIGHLIGHT_DEFAULT_TARGET_SECONDS = 60;

/** The page's generate body, field for field: every text
 *  field trimmed, the target carried as picked. */
export function buildWave8HighlightsPayload(input: {
  vodUrl: string;
  vodTitle: string;
  chatLog: string;
  transcript: string;
  targetSeconds: number;
}): { vodUrl: string; vodTitle: string; chatLog: string; transcript: string; targetSeconds: number } {
  return {
    vodUrl: input.vodUrl.trim(),
    vodTitle: input.vodTitle.trim(),
    chatLog: input.chatLog.trim(),
    transcript: input.transcript.trim(),
    targetSeconds: (WAVE8_HIGHLIGHT_TARGET_SECONDS as readonly number[]).includes(input.targetSeconds)
      ? input.targetSeconds
      : WAVE8_HIGHLIGHT_DEFAULT_TARGET_SECONDS,
  };
}

/** The page's readiness rule: at least one source — a VOD URL,
 *  a chat log, or a transcript — or nothing runs. */
export function wave8HighlightsReady(input: { vodUrl: string; chatLog: string; transcript: string }): boolean {
  return !!(input.vodUrl.trim() || input.chatLog.trim() || input.transcript.trim());
}

export interface Wave8HighlightMoment {
  startSec: number;
  endSec: number;
  score: number;
  label: string;
  reason: string;
}

export interface Wave8ReelSegment {
  startSec: number;
  endSec: number;
  caption: string;
}

export interface Wave8HighlightsResult {
  moments: Wave8HighlightMoment[];
  reelPlan: { totalSec: number; segments: Wave8ReelSegment[] };
  summary: string;
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

/** The cut answer: a non-empty moments list or it didn't cut
 *  (the page's own acceptance rule). */
export function wave8HighlightsOf(data: unknown): Wave8HighlightsResult | null {
  if (!isRecord(data)) return null;
  if (!Array.isArray(data.moments) || data.moments.length === 0) return null;
  const moments: Wave8HighlightMoment[] = [];
  for (const raw of data.moments as unknown[]) {
    if (!isRecord(raw)) return null;
    const startSec = numOrNull(raw.startSec);
    const endSec = numOrNull(raw.endSec);
    const score = numOrNull(raw.score);
    if (startSec === null || endSec === null || score === null) return null;
    moments.push({ startSec, endSec, score, label: strOr(raw.label, ""), reason: strOr(raw.reason, "") });
  }
  let reelPlan: Wave8HighlightsResult["reelPlan"] = { totalSec: 0, segments: [] };
  if (data.reelPlan !== undefined && data.reelPlan !== null) {
    if (!isRecord(data.reelPlan) || !Array.isArray(data.reelPlan.segments)) return null;
    const segments: Wave8ReelSegment[] = [];
    for (const raw of data.reelPlan.segments as unknown[]) {
      if (!isRecord(raw)) return null;
      const startSec = numOrNull(raw.startSec);
      const endSec = numOrNull(raw.endSec);
      if (startSec === null || endSec === null) return null;
      segments.push({ startSec, endSec, caption: strOr(raw.caption, "") });
    }
    reelPlan = { totalSec: numOrNull(data.reelPlan.totalSec) ?? 0, segments };
  }
  return {
    moments,
    reelPlan,
    summary: strOr(data.summary, ""),
    creditsUsed: numOrNull(data.creditsUsed),
    creditsRemaining: numOrNull(data.creditsRemaining),
  };
}

/* ─── 2 · Media Kit Builder (wave8/media-kit) ──────────────── */

export interface Wave8VaultOption {
  id: string;
  artistName: string;
  genre: string;
}

/** The page's vault-list read: the answer is `{ vaults }` or a
 *  bare array; anything else reads as no vaults. */
export function wave8VaultOptionsOf(data: unknown): Wave8VaultOption[] {
  const list = isRecord(data) ? (data.vaults ?? data) : data;
  if (!Array.isArray(list)) return [];
  const out: Wave8VaultOption[] = [];
  for (const raw of list as unknown[]) {
    if (!isRecord(raw)) continue;
    if (typeof raw.id !== "string" && typeof raw.id !== "number") continue;
    out.push({
      id: String(raw.id),
      artistName: strOr(raw.artist_name, ""),
      genre: strOr(raw.genre, ""),
    });
  }
  return out;
}

/** The page's generate body: `{ vaultId }` when a vault is
 *  picked, an empty body when the server auto-picks. */
export function buildWave8MediaKitPayload(vaultId: string | null): { vaultId?: string } {
  return vaultId ? { vaultId } : {};
}

export interface Wave8MediaKit {
  artistName: string;
  tagline: string;
  bio: string;
  audience: string;
  rates: Array<{ tier: string; price: string }>;
  contact: string;
  stats: { genre: string; artistType: string; visualStyle: string; voiceStyle: string };
  generatedAt: string;
}

/** The generate answer: a kit record or it didn't build (the
 *  page's own acceptance rule). */
export function wave8MediaKitOf(data: unknown): Wave8MediaKit | null {
  if (!isRecord(data) || !isRecord(data.kit)) return null;
  const kit = data.kit;
  const rates: Wave8MediaKit["rates"] = [];
  if (Array.isArray(kit.rates)) {
    for (const raw of kit.rates as unknown[]) {
      if (!isRecord(raw)) continue;
      rates.push({
        tier: strOr(raw.tier, ""),
        price: typeof raw.price === "number" ? String(raw.price) : strOr(raw.price, ""),
      });
    }
  }
  const stats = isRecord(kit.stats) ? kit.stats : {};
  return {
    artistName: strOr(kit.artistName, ""),
    tagline: strOr(kit.tagline, ""),
    bio: strOr(kit.bio, ""),
    audience: strOr(kit.audience, ""),
    rates,
    contact: strOr(kit.contact, ""),
    stats: {
      genre: strOr(stats.genre, ""),
      artistType: strOr(stats.artistType, ""),
      visualStyle: strOr(stats.visualStyle, ""),
      voiceStyle: strOr(stats.voiceStyle, ""),
    },
    generatedAt: strOr(kit.generatedAt, ""),
  };
}

/* ─── 3 · Ad-Lib Generator (wave8/adlib) ───────────────────── */

/** The page's energy picks, verbatim (default "hype"). */
export const WAVE8_ADLIB_ENERGIES = ["chill", "hype", "dark"] as const;
export type Wave8AdlibEnergy = (typeof WAVE8_ADLIB_ENERGIES)[number];
export const WAVE8_ADLIB_DEFAULT_ENERGY: Wave8AdlibEnergy = "hype";

/** The page's generate body, field for field: the three text
 *  fields trimmed, the energy carried as picked. */
export function buildWave8AdlibPayload(input: {
  lyrics: string;
  songTitle: string;
  vaultVoice: string;
  energy: Wave8AdlibEnergy;
}): { lyrics: string; songTitle: string; vaultVoice: string; energy: Wave8AdlibEnergy } {
  return {
    lyrics: input.lyrics.trim(),
    songTitle: input.songTitle.trim(),
    vaultVoice: input.vaultVoice.trim(),
    energy: input.energy,
  };
}

export interface Wave8AdlibResult {
  adlibs: Array<{ line: string; placement: string; delivery: string }>;
  stacks: Array<{ description: string; voices: string }>;
  takeA: { style: string; notes: string };
  takeB: { style: string; notes: string };
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

/** The generate answer: a non-empty ad-libs list or it didn't
 *  generate (the page's own acceptance rule). */
export function wave8AdlibOf(data: unknown): Wave8AdlibResult | null {
  if (!isRecord(data)) return null;
  if (!Array.isArray(data.adlibs) || data.adlibs.length === 0) return null;
  const adlibs: Wave8AdlibResult["adlibs"] = [];
  for (const raw of data.adlibs as unknown[]) {
    if (!isRecord(raw)) return null;
    adlibs.push({ line: strOr(raw.line, ""), placement: strOr(raw.placement, ""), delivery: strOr(raw.delivery, "") });
  }
  const stacks: Wave8AdlibResult["stacks"] = [];
  if (Array.isArray(data.stacks)) {
    for (const raw of data.stacks as unknown[]) {
      if (!isRecord(raw)) continue;
      stacks.push({ description: strOr(raw.description, ""), voices: strOr(raw.voices, "") });
    }
  }
  const takeOf = (v: unknown): { style: string; notes: string } | null => {
    if (v === undefined || v === null) return { style: "", notes: "" };
    if (!isRecord(v)) return null;
    return { style: strOr(v.style, ""), notes: strOr(v.notes, "") };
  };
  const takeA = takeOf(data.takeA);
  const takeB = takeOf(data.takeB);
  if (!takeA || !takeB) return null;
  return {
    adlibs,
    stacks,
    takeA,
    takeB,
    creditsUsed: numOrNull(data.creditsUsed),
    creditsRemaining: numOrNull(data.creditsRemaining),
  };
}

/* ─── 4 · Styled Caption Burn-in (wave8/caption-styler) ────── */

/** The page's style presets + pace default, verbatim. This is
 *  the transcript-timing rail — NOT the /api/caption-styler
 *  video job rail the Caption Styler bench rides. */
export const WAVE8_CAPTION_BURN_PRESETS = ["karaoke", "popin", "lowerthird"] as const;
export type Wave8CaptionBurnPreset = (typeof WAVE8_CAPTION_BURN_PRESETS)[number];
export const WAVE8_CAPTION_BURN_DEFAULT_PRESET: Wave8CaptionBurnPreset = "karaoke";
export const WAVE8_CAPTION_BURN_DEFAULT_WPS = 3;

/** The page's burn body, field for field: the transcript
 *  trimmed, the preset + pace carried as picked. */
export function buildWave8CaptionBurnPayload(input: {
  transcript: string;
  preset: Wave8CaptionBurnPreset;
  wordsPerSecond: number;
}): { transcript: string; preset: Wave8CaptionBurnPreset; wordsPerSecond: number } {
  return {
    transcript: input.transcript.trim(),
    preset: input.preset,
    wordsPerSecond: input.wordsPerSecond,
  };
}

export interface Wave8CaptionBurnResult {
  words: Array<{ word: string; start: number; end: number }>;
  srt: string;
  vtt: string;
  preset: string;
  creditsRemaining: number | null;
}

/** The burn answer: a non-empty timed word list plus both
 *  caption files, or it didn't burn — a zero-word answer is a
 *  failed burn, never a dressed-up success. */
export function wave8CaptionBurnOf(data: unknown): Wave8CaptionBurnResult | null {
  if (!isRecord(data)) return null;
  if (!Array.isArray(data.words) || data.words.length === 0) return null;
  if (typeof data.srt !== "string" || typeof data.vtt !== "string") return null;
  const words: Wave8CaptionBurnResult["words"] = [];
  for (const raw of data.words as unknown[]) {
    if (!isRecord(raw)) return null;
    const start = numOrNull(raw.start);
    const end = numOrNull(raw.end);
    if (typeof raw.word !== "string" || start === null || end === null) return null;
    words.push({ word: raw.word, start, end });
  }
  return {
    words,
    srt: data.srt,
    vtt: data.vtt,
    preset: strOr(data.preset, ""),
    creditsRemaining: numOrNull(data.creditsRemaining),
  };
}
