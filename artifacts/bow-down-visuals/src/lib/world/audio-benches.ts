/**
 * audio-benches.ts — Ring 2 (2.6 + 2.7): the Audio Desk's FULL bench.
 *
 * The Audio Studio hub's workbench docked one bench at a time, each
 * riding the hub's OWN endpoint, form shape, poll path and price —
 * read from the same sources the hub's panels read:
 *   - the credit-cost registry (lib/credit-costs) for every bench
 *     the registry prices — the desk throws rather than invent one;
 *   - the panels' own pinned constants for the two benches the
 *     registry marks PLACEHOLDER (vocal-tune 200 — VocalTunePanel's
 *     VOCAL_TUNE_CREDIT_COST; LUFS normalize 100 — LufsPanel's
 *     LUFS_NORMALIZE_CREDIT_COST), which agree with the registry;
 *   - the server route's own charge for rate-my-mix (100 — the
 *     route's MIX_CREDIT_COST default and the panel's displayed
 *     price; the panel's confirm override is a stale 1, the server
 *     is the truth the desk displays);
 *   - lib/voiceover's estimator for voiceover (200 per billable
 *     minute, the page's own estimate function);
 *   - the arrangement bench rides the hub's draft rail
 *     (POST /api/drafts, workflow "audio-arrangement") — editing
 *     there is FREE on the hub, and it is free here.
 * Stack-400 (B-07 + B-21) adds the five benches the desk had no
 * in-world form for — voice clone (registry /api/clone-voice 500)
 * and the four loose media utilities (sound-finder match 100,
 * remove-fillers analyze 200, transcribe-url 100, translate
 * captions 50 per language) — each riding its page's own endpoint,
 * form shape and registry price, and every one running through
 * confirmedFetch: the desk never charges without the SAME credit
 * confirmation its 2D twin shows (World law; Stack-400 B-01/B-02
 * ride the same seam in AudioDesk).
 * Naming law applies: no provider names in any user-facing string.
 */
import { getCreditCost, transcribeCostForDurationSec } from "../credit-costs";
import { estimateVoiceoverCost } from "../voiceover";

function registryCost(endpoint: string): number {
  const entry = getCreditCost(endpoint);
  if (!entry) throw new Error(`No registered credit cost for ${endpoint}`);
  return entry.cost;
}

/* ─── Bench ids + the registry ────────────────────────────────────── */

export type AudioBenchId =
  | "master"
  | "quick-master"
  | "mix"
  | "stems"
  | "vocal-removal"
  | "vocal-polish"
  | "harmony"
  | "singing-voice"
  | "vocal-tune"
  | "lufs-analyze"
  | "lufs-normalize"
  | "rate-my-mix"
  | "podcast"
  | "voiceover"
  | "hum"
  | "arrangement"
  | "voice-clone"
  | "sound-match"
  | "fillers"
  | "transcribe-url"
  | "translate-captions";

/** How a bench takes its source: an uploaded/library audio FILE
 *  (multipart), several stem FILES (mix), a hosted audio URL (the
 *  vocal benches work on library songs' URLs, as their modals do),
 *  typed TEXT (podcast / voiceover scripts), a hum FILE (two-step),
 *  or the arrangement DRAFT rail. Stack-400 (B-07/B-21) adds:
 *  a voice sample that rides the sample-upload rail (voice clone),
 *  a URL-input bench (the media utilities' media/audio URL — the
 *  fillers + transcribe benches), and a caption-text bench
 *  (translate captions). */
type AudioBenchInput = "file" | "stem-files" | "url" | "text" | "hum" | "draft" | "clone" | "media-url" | "captions";

interface AudioBenchDef {
  id: AudioBenchId;
  label: string;
  input: AudioBenchInput;
  /** POST path (with any query the page posts, e.g. stems mode). */
  endpoint: string;
  /** Poll path builder from the started job id; null = sync result. */
  pollPath: ((jobId: string) => string) | null;
  /** Cost in Visual Bucs from the bench's own pricing source.
   *  Voiceover's depends on the script, so it reads the input. */
  cost: (inputText?: string) => number;
}

const jobPoll = (base: string) => (jobId: string) => `${base}/${jobId}`;

export const RATE_MY_MIX_COST_VB = 100;

export const AUDIO_BENCHES: readonly AudioBenchDef[] = [
  {
    id: "master",
    label: "Mix & master — one song",
    input: "file",
    endpoint: "/api/mix-master/master",
    pollPath: jobPoll("/api/mix-master/job"),
    cost: () => registryCost("/api/mix-master/master"),
  },
  {
    id: "quick-master",
    label: "Express master",
    input: "file",
    endpoint: "/api/mastering",
    pollPath: jobPoll("/api/mastering"),
    cost: () => registryCost("/api/mastering"),
  },
  {
    id: "mix",
    label: "Mix my stems",
    input: "stem-files",
    endpoint: "/api/mix-master/mix",
    pollPath: jobPoll("/api/mix-master/job"),
    cost: () => registryCost("/api/mix-master/mix"),
  },
  {
    id: "stems",
    label: "Split the stems",
    input: "file",
    endpoint: "/api/stems",
    pollPath: jobPoll("/api/stems"),
    cost: () => registryCost("/api/stems"),
  },
  {
    id: "vocal-removal",
    label: "Vocals only / instrumental",
    input: "file",
    endpoint: "/api/vocal-removal",
    pollPath: jobPoll("/api/vocal-removal"),
    cost: () => registryCost("/api/vocal-removal"),
  },
  {
    id: "vocal-polish",
    label: "Vocal polish",
    input: "url",
    endpoint: "/api/vocal-polish",
    pollPath: jobPoll("/api/vocal-polish"),
    cost: () => registryCost("/api/vocal-polish"),
  },
  {
    id: "harmony",
    label: "Harmony — classic + AI",
    input: "url",
    endpoint: "/api/generate-harmony",
    pollPath: null,
    cost: () => registryCost("/api/generate-harmony"),
  },
  {
    id: "singing-voice",
    label: "Singing voice",
    input: "url",
    endpoint: "/api/singing-voice",
    pollPath: (jobId) => `/api/singing-voice/jobs/${jobId}`,
    cost: () => registryCost("/api/singing-voice"),
  },
  {
    id: "vocal-tune",
    label: "Vocal tune",
    input: "file",
    endpoint: "/api/vocal-tune",
    pollPath: jobPoll("/api/vocal-tune"),
    cost: () => registryCost("/api/vocal-tune"),
  },
  {
    id: "lufs-analyze",
    label: "LUFS — measure (free)",
    input: "file",
    endpoint: "/api/lufs/analyze",
    pollPath: null,
    cost: () => 0,
  },
  {
    id: "lufs-normalize",
    label: "LUFS — normalize",
    input: "file",
    endpoint: "/api/lufs/normalize",
    pollPath: jobPoll("/api/lufs/normalize"),
    cost: () => registryCost("/api/lufs/normalize"),
  },
  {
    id: "rate-my-mix",
    label: "Rate my mix",
    input: "file",
    endpoint: "/api/rate-my-mix/analyze",
    pollPath: null,
    cost: () => RATE_MY_MIX_COST_VB,
  },
  {
    id: "podcast",
    label: "Podcast — from a script",
    input: "text",
    endpoint: "/api/podcast/generate",
    pollPath: null,
    cost: () => registryCost("/api/podcast/generate"),
  },
  {
    id: "voiceover",
    label: "Voiceover",
    input: "text",
    endpoint: "/api/voiceover/generate",
    pollPath: null,
    cost: (script) => estimateVoiceoverCost(script ?? "").credits,
  },
  {
    id: "hum",
    label: "Hum to song",
    input: "hum",
    endpoint: "/api/hum-to-song",
    pollPath: null,
    cost: () => registryCost("/api/hum-to-song"),
  },
  {
    id: "arrangement",
    label: "Arrangement — my draft",
    input: "draft",
    endpoint: "/api/drafts",
    pollPath: null,
    cost: () => 0,
  },
  {
    id: "voice-clone",
    label: "Voice clone — new voice",
    input: "clone",
    endpoint: "/api/clone-voice",
    pollPath: null,
    cost: () => registryCost("/api/clone-voice"),
  },
  {
    id: "sound-match",
    label: "Sound finder — match",
    input: "text",
    endpoint: "/api/sound-finder/match",
    pollPath: null,
    cost: () => registryCost("/api/sound-finder/match"),
  },
  {
    id: "fillers",
    label: "Filler words — find & cut",
    input: "media-url",
    endpoint: "/api/remove-fillers/analyze",
    pollPath: (jobId) => `/api/remove-fillers/analyze/${jobId}`,
    cost: () => registryCost("/api/remove-fillers/analyze"),
  },
  {
    id: "transcribe-url",
    label: "Transcribe — from a link",
    input: "media-url",
    endpoint: "/api/transcribe-url",
    pollPath: null,
    cost: () => registryCost("/api/transcribe-url"),
  },
  {
    id: "translate-captions",
    label: "Translate captions",
    input: "captions",
    endpoint: "/api/translate-captions",
    pollPath: null,
    cost: () => registryCost("/api/translate-captions"),
  },
];

/* ─── Stack-400 B-07 — Voice clone: the form + response shapes ────
   GenerateAudio's clone flow, mirrored: the member names the
   voice, picks a voice recording, consents that the voice is
   theirs (or permitted), and the sample rides the lane's upload
   path (uploadStemFile → R2 public URL) because /api/clone-voice
   takes a sampleUrl it downloads server-side. The 10-second
   minimum is pre-checked from the file's own duration so a
   too-short sample never reaches the paid call — the route
   re-validates and refunds. */

export const VOICE_CLONE_MIN_SAMPLE_SEC = 10;

export function buildCloneVoicePayload(input: { name: string; sampleUrl: string }): Record<string, unknown> {
  return { name: input.name.trim(), sampleUrl: input.sampleUrl };
}

/** The clone outcome in the route's own words: a real library
 *  voice (its library id + the source label the route reports)
 *  or an honest nothing. */
export function cloneVoiceOfResponse(data: Record<string, unknown>): { name: string | null; libraryVoiceId: string | null; source: string | null } {
  const voice = (data["voice"] ?? null) as Record<string, unknown> | null;
  if (!voice || typeof voice !== "object") return { name: null, libraryVoiceId: null, source: null };
  return {
    name: typeof voice["name"] === "string" && voice["name"] ? (voice["name"] as string) : null,
    libraryVoiceId: typeof voice["libraryVoiceId"] === "string" && voice["libraryVoiceId"] ? (voice["libraryVoiceId"] as string) : null,
    source: typeof voice["source"] === "string" && voice["source"] ? (voice["source"] as string) : null,
  };
}

/* ─── Stack-400 B-21 — the four media utilities' form shapes ──────
   Each payload mirrors its own page's POST body field for field:
   the Sound Finder's match (ViralSoundFinder's runMatch), the
   Filler Remover's analyze (FillerRemoverCard's startAnalyze —
   the desk passes no custom words and the analyze defaults, the
   page's own starting state), the Song Workflow's transcribe-url
   (length-priced by the file's real duration — the desk probes
   the URL the same way the page does), and the Caption Suite's
   translate (captions + target languages, priced per language). */

export function buildSoundMatchPayload(input: { videoIdea: string; niche: string; platform: string }): Record<string, unknown> {
  return {
    videoIdea: input.videoIdea.trim(),
    niche: input.niche,
    platform: input.platform,
  };
}

export interface SoundMatchResult {
  soundType: string;
  why: string;
  searchTerms: string[];
  timingTip: string;
}

/** The match response's rows, in the page's own row shape. An
 *  empty or malformed answer reads as no matches — the desk says
 *  so honestly instead of blanking. */
export function soundMatchesOfResponse(data: Record<string, unknown>): SoundMatchResult[] {
  if (!Array.isArray(data["matches"])) return [];
  const out: SoundMatchResult[] = [];
  for (const raw of data["matches"]) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    out.push({
      soundType: typeof m["soundType"] === "string" ? (m["soundType"] as string) : "",
      why: typeof m["why"] === "string" ? (m["why"] as string) : "",
      searchTerms: Array.isArray(m["searchTerms"]) ? (m["searchTerms"] as unknown[]).filter((x): x is string => typeof x === "string") : [],
      timingTip: typeof m["timingTip"] === "string" ? (m["timingTip"] as string) : "",
    });
  }
  return out;
}

export function buildFillerAnalyzePayload(input: { mediaUrl: string }): Record<string, unknown> {
  return {
    mediaUrl: input.mediaUrl.trim(),
    fillerWords: [],
    removeSilences: true,
    minSilenceDuration: 0.5,
  };
}

export interface FillerCutResult {
  id: string;
  start: number;
  end: number;
  kind: "filler" | "silence";
  label: string;
}

/** One analyze poll answer in the card's own shapes: the job's
 *  status, its cuts (the page's FillerCut shape), and the time
 *  the cuts would save. */
export function fillerAnalysisOfResponse(data: Record<string, unknown>): {
  status: string | null;
  cuts: FillerCutResult[];
  durationSec: number | null;
  timeSavedSec: number;
} {
  const cuts: FillerCutResult[] = [];
  if (Array.isArray(data["cuts"])) {
    for (const raw of data["cuts"]) {
      if (!raw || typeof raw !== "object") continue;
      const c = raw as Record<string, unknown>;
      cuts.push({
        id: typeof c["id"] === "string" ? (c["id"] as string) : "",
        start: typeof c["start"] === "number" ? (c["start"] as number) : 0,
        end: typeof c["end"] === "number" ? (c["end"] as number) : 0,
        kind: c["kind"] === "silence" ? "silence" : "filler",
        label: typeof c["label"] === "string" ? (c["label"] as string) : "",
      });
    }
  }
  return {
    status: typeof data["status"] === "string" ? (data["status"] as string) : null,
    cuts,
    durationSec: typeof data["durationSec"] === "number" ? (data["durationSec"] as number) : null,
    timeSavedSec: typeof data["timeSavedSec"] === "number" ? (data["timeSavedSec"] as number) : 0,
  };
}

export function buildTranscribeUrlPayload(input: { audioUrl: string }): Record<string, unknown> {
  return { audioUrl: input.audioUrl.trim() };
}

export interface TranscribeUrlSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

/** The transcribe-url answer in SongWorkflow's own shapes: the
 *  transcript text + its timed segments. */
export function transcribeUrlOfResponse(data: Record<string, unknown>): { transcript: string | null; segments: TranscribeUrlSegment[] } {
  const segments: TranscribeUrlSegment[] = [];
  if (Array.isArray(data["segments"])) {
    for (const raw of data["segments"]) {
      if (!raw || typeof raw !== "object") continue;
      const s = raw as Record<string, unknown>;
      segments.push({
        id: typeof s["id"] === "number" ? (s["id"] as number) : 0,
        start: typeof s["start"] === "number" ? (s["start"] as number) : 0,
        end: typeof s["end"] === "number" ? (s["end"] as number) : 0,
        text: typeof s["text"] === "string" ? (s["text"] as string) : "",
      });
    }
  }
  return {
    transcript: typeof data["transcript"] === "string" && data["transcript"] ? (data["transcript"] as string) : null,
    segments,
  };
}

/** The transcribe confirm price for a probed duration — the
 *  registry's own length-pricing curve (100 up to 5 minutes,
 *  +20 per minute after), exactly the page's override. */
export function transcribeUrlCostForDuration(durationSec: number | null): number {
  return transcribeCostForDurationSec(durationSec);
}

/** One caption line from the desk's textarea: evenly timed lines
 *  (10 seconds each, the caption-suite shape), built the way the
 *  suite builds its translate body. */
export function buildCaptionLines(text: string): Array<{ start: number; end: number; text: string }> {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l, i) => ({ start: i * 10, end: (i + 1) * 10, text: l }));
}

export function buildTranslateCaptionsPayload(input: {
  captions: Array<{ start: number; end: number; text: string }>;
  targetLanguages: string[];
}): Record<string, unknown> {
  return { captions: input.captions, targetLanguages: input.targetLanguages };
}

/** The translate answer: each language's translated lines. */
export function translateCaptionsOfResponse(data: Record<string, unknown>): Record<string, Array<{ start: number; end: number; text: string }>> {
  const out: Record<string, Array<{ start: number; end: number; text: string }>> = {};
  const translations = data["translations"];
  if (!translations || typeof translations !== "object") return out;
  for (const [code, lines] of Object.entries(translations as Record<string, unknown>)) {
    if (!Array.isArray(lines)) continue;
    out[code] = lines
      .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
      .map((l) => ({
        start: typeof l["start"] === "number" ? (l["start"] as number) : 0,
        end: typeof l["end"] === "number" ? (l["end"] as number) : 0,
        text: typeof l["text"] === "string" ? (l["text"] as string) : "",
      }));
  }
  return out;
}

/** The translate confirm price: the registry's per-language
 *  price × the chosen languages, exactly the suite's override. */
export function translateCaptionsCost(languageCount: number): number {
  return registryCost("/api/translate-captions") * Math.max(0, languageCount);
}

/** The caption languages the desk offers — the ten most-used of
 *  the suite's own ladder (its full 15-language list stays on
 *  the 2D page; the bench offers the same rail at the same
 *  per-language price). */
export const TRANSLATE_LANGUAGE_CODES: readonly string[] = ["es", "fr", "de", "pt", "it", "ja", "ko", "ar", "hi", "zh"];

export function audioBenchOf(id: AudioBenchId): AudioBenchDef {
  const def = AUDIO_BENCHES.find((b) => b.id === id);
  if (!def) throw new Error(`Unknown audio bench ${id}`);
  return def;
}

/* ─── Form field builders — each hub panel's append order ──────────
   Returned as [name, value] lists so the contract is testable
   without File objects; the component attaches the File(s) under
   the bench's named file field. */

/** MixMasterPanel MasterPanel: audio + genre + intensity +
 *  loudness (+ sourceSongId / reference when present). */
export function masterFields(input: {
  genre: string;
  intensity: string;
  loudness: string;
  sourceSongId?: string | null;
}): Array<[string, string]> {
  const f: Array<[string, string]> = [
    ["genre", input.genre],
    ["intensity", input.intensity],
    ["loudness", input.loudness],
  ];
  if (input.sourceSongId) f.push(["sourceSongId", input.sourceSongId]);
  return f;
}
export const MASTER_FILE_FIELD = "audio";

/** QuickMasterPanel: audio + preset (+ sourceSongId). */
export function quickMasterFields(input: {
  preset: string;
  sourceSongId?: string | null;
}): Array<[string, string]> {
  const f: Array<[string, string]> = [["preset", input.preset]];
  if (input.sourceSongId) f.push(["sourceSongId", input.sourceSongId]);
  return f;
}

/** MixPanel: every stem file under "stems", then genre / intensity
 *  / loudness / vocalLevelDb. */
export function mixFields(input: {
  genre: string;
  intensity: string;
  loudness: string;
  vocalLevelDb: number;
}): Array<[string, string]> {
  return [
    ["genre", input.genre],
    ["intensity", input.intensity],
    ["loudness", input.loudness],
    ["vocalLevelDb", String(input.vocalLevelDb)],
  ];
}
export const MIX_STEMS_FIELD = "stems";

/** StemsPanel: audio only, plus stems="pro" on the Pro tier. */
export function stemsFields(input: { pro?: boolean }): Array<[string, string]> {
  return input.pro ? [["stems", "pro"]] : [];
}

/** VocalTunePanel: audio + style + keyShift. */
export function vocalTuneFields(input: { style: string; keyShift: number }): Array<[string, string]> {
  return [
    ["style", input.style],
    ["keyShift", String(input.keyShift)],
  ];
}

/** LufsPanel normalize: audio + targetLufs + format. Its analyze
 *  post is the audio file alone. */
export function lufsNormalizeFields(input: { targetLufs: number; format: string }): Array<[string, string]> {
  return [
    ["targetLufs", String(input.targetLufs)],
    ["format", input.format],
  ];
}

/** RateMyMix: the mix file under "mix" + optional genre. */
export function rateMyMixFields(input: { genre?: string }): Array<[string, string]> {
  return input.genre?.trim() ? [["genre", input.genre.trim()]] : [];
}
export const RATE_MY_MIX_FILE_FIELD = "mix";

/* ─── JSON payload builders — the vocal / text benches ───────────── */

/** VocalPolishModal startPolish's body. tempoFactor is the page's
 *  tempo percent / 100. */
export function buildVocalPolishPayload(input: {
  audioUrl: string;
  correctionStrength: number;
  keyShift: number;
  tempoPercent: number;
}): Record<string, unknown> {
  return {
    audioUrl: input.audioUrl,
    correctionStrength: input.correctionStrength,
    keyShift: input.keyShift,
    tempoFactor: input.tempoPercent / 100,
  };
}

/** HarmonyGeneratorModal's generate body. Classic is the
 *  registry-priced mode (300); the AI mode's price comes from the
 *  modes probe below (Stack-100 #51) and is confirmed through the
 *  modal's own override-cost confirmation, never invented here. */
export function buildHarmonyPayload(input: {
  songId?: string;
  audioUrl: string;
  keyHint?: string;
  style: string;
  mixLevel: number;
  mode?: "classic" | "ai";
}): Record<string, unknown> {
  return {
    songId: input.songId,
    audioUrl: input.audioUrl,
    keyHint: input.keyHint?.trim() ? input.keyHint.trim() : undefined,
    style: input.style,
    mixLevel: input.mixLevel,
    mode: input.mode ?? "classic",
  };
}

/* ─── Stack-100 #51 — Harmony AI mode: the modes probe ─────────────
   HarmonyGeneratorModal's capability probe, mirrored exactly:
   GET /api/generate-harmony/modes (free, no charge — the modal
   reads it with the confirmation skipped) answers the two modes
   with their REAL server prices + availability, the style list,
   and the defaults. The desk prices AI harmony ONLY from this
   probe; when the probe hasn't answered, the modal's own fallback
   figures (classic 300 / AI 600) are what the modal itself shows,
   so the desk shows the same ones — and the server re-validates
   on generate either way. */

export const HARMONY_MODES_ENDPOINT = "/api/generate-harmony/modes";

export interface HarmonyModeInfo {
  key: "classic" | "ai";
  label: string;
  blurb: string;
  /** The mode's real price in Visual Bucs, from the probe. */
  cost: number;
  available: boolean;
  missing: string[];
}

export interface HarmonyModesProbe {
  modes: HarmonyModeInfo[];
  styles: Array<{ key: string; label: string }>;
  defaultStyle: string | null;
  defaultMixLevel: number | null;
}

/** The modal's own pre-probe fallbacks (HarmonyGeneratorModal:
 *  classicCost ?? 300, aiCost ?? 600). */
export const HARMONY_CLASSIC_FALLBACK_COST = 300;
export const HARMONY_AI_FALLBACK_COST = 600;

export function parseHarmonyModesResponse(json: unknown): HarmonyModesProbe | null {
  if (!json || typeof json !== "object") return null;
  const r = json as Record<string, unknown>;
  if (!Array.isArray(r["modes"])) return null;
  const modes: HarmonyModeInfo[] = [];
  for (const raw of r["modes"]) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as Record<string, unknown>;
    if (m["key"] !== "classic" && m["key"] !== "ai") continue;
    modes.push({
      key: m["key"] as "classic" | "ai",
      label: typeof m["label"] === "string" ? m["label"] : m["key"] === "ai" ? "AI harmonies" : "Classic doubles",
      blurb: typeof m["blurb"] === "string" ? m["blurb"] : "",
      cost: typeof m["cost"] === "number" && Number.isFinite(m["cost"]) ? m["cost"] : m["key"] === "ai" ? HARMONY_AI_FALLBACK_COST : HARMONY_CLASSIC_FALLBACK_COST,
      available: m["available"] === true,
      missing: Array.isArray(m["missing"]) ? m["missing"].filter((x): x is string => typeof x === "string") : [],
    });
  }
  if (modes.length === 0) return null;
  const styles: Array<{ key: string; label: string }> = [];
  if (Array.isArray(r["styles"])) {
    for (const raw of r["styles"]) {
      if (!raw || typeof raw !== "object") continue;
      const s = raw as Record<string, unknown>;
      if (typeof s["key"] === "string" && s["key"]) {
        styles.push({ key: s["key"], label: typeof s["label"] === "string" ? s["label"] : s["key"] });
      }
    }
  }
  return {
    modes,
    styles,
    defaultStyle: typeof r["defaultStyle"] === "string" ? r["defaultStyle"] : null,
    defaultMixLevel: typeof r["defaultMixLevel"] === "number" ? r["defaultMixLevel"] : null,
  };
}

/** One mode's price from the probe (or the modal's fallback when
 *  the probe hasn't answered / doesn't carry the mode). */
export function harmonyModeCost(probe: HarmonyModesProbe | null, mode: "classic" | "ai"): number {
  const found = probe?.modes.find((m) => m.key === mode);
  if (found) return found.cost;
  return mode === "ai" ? HARMONY_AI_FALLBACK_COST : HARMONY_CLASSIC_FALLBACK_COST;
}

/** The modal's preselect rule: AI when the probe says the AI mode
 *  is available, classic otherwise (and classic before any probe). */
export function harmonyDefaultMode(probe: HarmonyModesProbe | null): "classic" | "ai" {
  return probe?.modes.find((m) => m.key === "ai")?.available ? "ai" : "classic";
}

/* ─── Stack-100 #51 — stems remix-levels mixdown ───────────────────
   audio-studio.tsx's StemsPanel exportRemix, mirrored exactly:
   POST /api/stems/:jobId/remix with { levels } for the stems the
   JOB actually returned (the classic four, or all six on a Pro
   job — the server validates against the job's own key set).
   FREE: the split was paid for; the remix charges nothing. Each
   level is 0–2 (0 = muted, 1 = unity, 2 = double). */

const STEM_REMIX_MIN_LEVEL = 0;
const STEM_REMIX_MAX_LEVEL = 2;

/** A stem's key from the stems bench's result label ("Stem —
 *  vocals" → "vocals"). Labels in any other shape carry no key.
 *  The label template is a parameter so a label composed in the
 *  desk's active language still parses (the desk passes its
 *  worldAudioDesk stemLabel template); the English template is
 *  the default and parses every pre-i18n label. */
export function stemKeyOfResultLabel(label: string, template: string = AUDIO_BENCH_RESULT_STRINGS_EN.stemLabel): string | null {
  const parts = template.split("{{key}}").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const m = new RegExp(`^${parts.join("(.+)")}$`).exec(label.trim());
  return m && m[1] ? m[1] : null;
}

/** The remix body for the stems a split actually returned: one
 *  level per returned stem, clamped to the server's 0–2 range;
 *  stems the job didn't return never ride (the server would
 *  refuse the whole mix). Missing levels default to unity. */
export function buildStemRemixPayload(
  stemKeys: readonly string[],
  levels: Readonly<Record<string, number>>,
): { levels: Record<string, number> } {
  const out: Record<string, number> = {};
  for (const key of stemKeys) {
    const raw = typeof levels[key] === "number" && Number.isFinite(levels[key]) ? (levels[key] as number) : 1;
    out[key] = Math.min(STEM_REMIX_MAX_LEVEL, Math.max(STEM_REMIX_MIN_LEVEL, raw));
  }
  return { levels: out };
}

export function stemRemixUrlOfResponse(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const url = (json as { url?: unknown }).url;
  return typeof url === "string" && url ? url : null;
}

export function stemRemixPath(jobId: string): string {
  return `/api/stems/${jobId}/remix`;
}

/** SingingVoiceModal startConversion's body. */
export function buildSingingVoicePayload(input: {
  voiceId: string;
  sourceAudioUrl: string;
  strength: number;
  keepInstrumental: boolean;
}): Record<string, unknown> {
  return {
    voiceId: input.voiceId,
    sourceAudioUrl: input.sourceAudioUrl,
    strength: input.strength,
    keepInstrumental: input.keepInstrumental,
  };
}

/** PodcastStudio's solo generate body (mode script/topic — the
 *  dialogue mode's multi-speaker casting stays on the page). */
export function buildPodcastPayload(input: {
  mode: string;
  script?: string;
  topic?: string;
  title: string;
  description?: string;
  format: string;
  musicBed: boolean;
}): Record<string, unknown> {
  return {
    mode: input.mode,
    script: (input.script ?? "").trim(),
    topic: (input.topic ?? "").trim(),
    videoUrl: undefined,
    title: input.title.trim(),
    description: (input.description ?? "").trim(),
    hostVoiceId: undefined,
    format: input.format,
    coHostVoiceId: undefined,
    musicBed: input.musicBed,
  };
}

/** VoiceoverStudio's generate body. */
export function buildVoiceoverPayload(input: {
  script: string;
  voiceId: string;
  emotion: string;
  format: string;
  speed: number;
}): Record<string, unknown> {
  return {
    script: input.script.trim(),
    voiceId: input.voiceId,
    emotion: input.emotion,
    format: input.format,
    speed: input.speed,
  };
}

/* ─── Result interpretation — the benches' own response shapes ──── */

export interface AudioBenchResult {
  done: boolean;
  failed: boolean;
  /** Playable audio outputs (stems/removal return several). */
  urls: Array<{ label: string; url: string }>;
  /** Text outcomes (LUFS measurements, rate-my-mix notes, podcast RSS). */
  text: string | null;
  error: string | null;
}

/** The user-facing words `interpretAudioBenchResponse` composes:
 *  result labels, failure lines, the LUFS measurement lines and
 *  the stem-label template. The desk passes its active language's
 *  bundle (worldAudioDesk catalog keys); every other caller gets
 *  these English defaults, byte-identical to the pre-i18n copy. */
export interface AudioBenchResultStrings {
  jobFailed: string;
  splitEmpty: string;
  jobEmpty: string;
  harmonyMix: string;
  harmonyStem: string;
  podcastEpisode: string;
  voiceover: string;
  instrumental: string;
  vocalsOnly: string;
  yourAudio: string;
  finishedAudio: string;
  /** Template carrying one {{key}} token — the stem's rail key. */
  stemLabel: string;
  /** Templates carrying one {{value}} token — the measurement. */
  lufsIntegrated: string;
  lufsRange: string;
  lufsTruePeak: string;
  lufsDuration: string;
}

export const AUDIO_BENCH_RESULT_STRINGS_EN: AudioBenchResultStrings = {
  jobFailed: "The job didn't finish.",
  splitEmpty: "The split finished but came back empty.",
  jobEmpty: "The job finished but came back empty.",
  harmonyMix: "Your song with harmony",
  harmonyStem: "Harmony stem",
  podcastEpisode: "Your podcast episode",
  voiceover: "Your voiceover",
  instrumental: "Instrumental",
  vocalsOnly: "Vocals only",
  yourAudio: "Your audio",
  finishedAudio: "Your finished audio",
  stemLabel: "Stem — {{key}}",
  lufsIntegrated: "Integrated loudness: {{value}} LUFS",
  lufsRange: "Loudness range: {{value}} LU",
  lufsTruePeak: "True peak: {{value}} dB",
  lufsDuration: "Duration: {{value}}s",
};

function fillToken(template: string, token: string, value: string): string {
  return template.split(token).join(value);
}

/** Build the bundle from a translate function (the desk's `t`):
 *  every field reads its worldAudioDesk catalog key, templates
 *  included — the interpreter fills their tokens itself. */
export function audioBenchResultStrings(translate: (key: string) => string): AudioBenchResultStrings {
  return {
    jobFailed: translate("worldAudioDesk.resultJobFailed"),
    splitEmpty: translate("worldAudioDesk.resultSplitEmpty"),
    jobEmpty: translate("worldAudioDesk.resultJobEmpty"),
    harmonyMix: translate("worldAudioDesk.resultHarmonyMix"),
    harmonyStem: translate("worldAudioDesk.resultHarmonyStem"),
    podcastEpisode: translate("worldAudioDesk.resultPodcastEpisode"),
    voiceover: translate("worldAudioDesk.resultVoiceover"),
    instrumental: translate("worldAudioDesk.resultInstrumental"),
    vocalsOnly: translate("worldAudioDesk.resultVocalsOnly"),
    yourAudio: translate("worldAudioDesk.resultYourAudio"),
    finishedAudio: translate("worldAudioDesk.resultFinishedAudio"),
    stemLabel: translate("worldAudioDesk.stemLabel"),
    lufsIntegrated: translate("worldAudioDesk.lufsIntegrated"),
    lufsRange: translate("worldAudioDesk.lufsRange"),
    lufsTruePeak: translate("worldAudioDesk.lufsTruePeak"),
    lufsDuration: translate("worldAudioDesk.lufsDuration"),
  };
}

const EMPTY: AudioBenchResult = { done: false, failed: false, urls: [], text: null, error: null };

function failed(error: string | null, strings: AudioBenchResultStrings): AudioBenchResult {
  return { done: true, failed: true, urls: [], text: null, error: error ?? strings.jobFailed };
}

/** Interpret one bench response (start, poll, or sync) in the
 *  bench's own shape:
 *   - job benches speak queued/processing → done/failed with the
 *     output in outputUrl (polish/tune/lufs), mp3Url/wavUrl
 *     (master family), stems{…} (stems), or instrumental/vocals
 *     (vocal-removal);
 *   - harmony answers synchronously with mixedPreviewUrl (+ the
 *     harmony-only stem when present);
 *   - podcast / voiceover answer synchronously with audioUrl;
 *   - LUFS analyze answers with measurements; rate-my-mix with
 *     measurements + notes. */
export function interpretAudioBenchResponse(
  benchId: AudioBenchId,
  data: Record<string, unknown>,
  strings: AudioBenchResultStrings = AUDIO_BENCH_RESULT_STRINGS_EN,
): AudioBenchResult {
  /* Stack-400 B-21: the fillers analyze job speaks the card's own
     poll shape — queued/processing reads not-done; a done job
     carries its cut list as text (an honest empty line when the
     clip had nothing to cut); failed reads as its failure. */
  if (benchId === "fillers") {
    const read = fillerAnalysisOfResponse(data);
    if (read.status === "failed") {
      return failed(
        typeof data["error"] === "string" ? (data["error"] as string) : typeof data["message"] === "string" ? (data["message"] as string) : null,
        strings,
      );
    }
    if (read.status !== "done") return EMPTY;
    const lines = read.cuts.map((c) => `${c.label || c.kind} — ${c.start.toFixed(1)}s → ${c.end.toFixed(1)}s`);
    return { done: true, failed: false, urls: [], text: lines.join("\n"), error: null };
  }
  const status = typeof data["status"] === "string" ? (data["status"] as string) : null;
  if (status === "failed") {
    return failed(
      typeof data["error"] === "string" ? (data["error"] as string) : typeof data["message"] === "string" ? (data["message"] as string) : null,
      strings,
    );
  }
  const str = (k: string): string | null =>
    typeof data[k] === "string" && (data[k] as string) ? (data[k] as string) : null;

  switch (benchId) {
    case "harmony": {
      const mixed = str("mixedPreviewUrl");
      if (!mixed) return EMPTY;
      const urls = [{ label: strings.harmonyMix, url: mixed }];
      const stem = str("harmonyStemUrl") ?? str("harmonyUrl");
      if (stem) urls.push({ label: strings.harmonyStem, url: stem });
      return { done: true, failed: false, urls, text: null, error: null };
    }
    case "podcast":
    case "voiceover": {
      const url = str("audioUrl") ?? str("audioPlayUrl");
      if (!url) return EMPTY;
      return {
        done: true,
        failed: false,
        urls: [{ label: benchId === "podcast" ? strings.podcastEpisode : strings.voiceover, url }],
        text: benchId === "podcast" ? str("rssXml") : null,
        error: null,
      };
    }
    case "lufs-analyze": {
      /* The route answers FLAT: { integratedLufs, loudnessRangeLu,
         truePeakDb, threshold, durationSec, targetLufs, ebur128 }. */
      if (typeof data["integratedLufs"] !== "number") return EMPTY;
      const lines = [
        fillToken(strings.lufsIntegrated, "{{value}}", String(data["integratedLufs"])),
        typeof data["loudnessRangeLu"] === "number" ? fillToken(strings.lufsRange, "{{value}}", String(data["loudnessRangeLu"])) : null,
        typeof data["truePeakDb"] === "number" ? fillToken(strings.lufsTruePeak, "{{value}}", String(data["truePeakDb"])) : null,
        typeof data["durationSec"] === "number" ? fillToken(strings.lufsDuration, "{{value}}", String(data["durationSec"])) : null,
      ].filter(Boolean);
      return { done: true, failed: false, urls: [], text: lines.join("\n"), error: null };
    }
    case "rate-my-mix": {
      const notes = data["notes"];
      const measurements = data["measurements"];
      if (!notes && !measurements) return EMPTY;
      const text = [
        typeof notes === "string" ? notes : null,
        measurements && typeof measurements === "object" ? JSON.stringify(measurements, null, 2) : null,
      ]
        .filter(Boolean)
        .join("\n\n");
      return { done: true, failed: false, urls: [], text: text || null, error: null };
    }
    case "stems": {
      if (status !== "done") return EMPTY;
      const stems = data["stems"];
      if (!stems || typeof stems !== "object") return failed(strings.splitEmpty, strings);
      const urls = Object.entries(stems as Record<string, unknown>)
        .filter(([, v]) => typeof v === "string" && v)
        .map(([k, v]) => ({ label: fillToken(strings.stemLabel, "{{key}}", k), url: v as string }));
      return urls.length > 0
        ? { done: true, failed: false, urls, text: null, error: null }
        : failed(strings.splitEmpty, strings);
    }
    case "vocal-removal": {
      if (status !== "done") return EMPTY;
      const urls: Array<{ label: string; url: string }> = [];
      const inst = str("instrumental") ?? str("instrumentalUrl");
      const vox = str("vocals") ?? str("vocalsUrl") ?? str("acapellaUrl");
      if (inst) urls.push({ label: strings.instrumental, url: inst });
      if (vox) urls.push({ label: strings.vocalsOnly, url: vox });
      const single = str("outputUrl") ?? str("url");
      if (urls.length === 0 && single) urls.push({ label: strings.yourAudio, url: single });
      return urls.length > 0
        ? { done: true, failed: false, urls, text: null, error: null }
        : failed(strings.jobEmpty, strings);
    }
    default: {
      /* master family + mastering + polish + tune + lufs-normalize
         + singing-voice: job words with one primary output. */
      if (status !== "done") return EMPTY;
      const url = str("outputUrl") ?? str("mp3Url") ?? str("wavUrl") ?? str("url");
      return url
        ? { done: true, failed: false, urls: [{ label: strings.finishedAudio, url }], text: null, error: null }
        : failed(strings.jobEmpty, strings);
    }
  }
}

/** The job id from a bench start response — null when the start
 *  didn't land, so the desk fails honestly instead of polling air. */
export function audioBenchJobIdOf(data: Record<string, unknown>): string | null {
  return typeof data["jobId"] === "string" && data["jobId"] ? (data["jobId"] as string) : null;
}

/* ─── Ring 2 (2.7) — waveform peaks for the A/B player ──────────────
   peaks are plain amplitudes in [0,1]; the pure shaping (bucketing
   raw channel samples into bars) lives here so it is testable
   without an AudioContext — the component decodes and feeds it
   the channel data, the same numbers DeverbPanel's A/B computes. */

export function peaksFromChannelData(samples: ArrayLike<number>, bars = 48): number[] {
  if (samples.length === 0 || bars <= 0) return [];
  const step = Math.max(1, Math.floor(samples.length / bars));
  const peaks: number[] = [];
  for (let i = 0; i < bars; i++) {
    let max = 0;
    const start = i * step;
    for (let j = start; j < Math.min(start + step, samples.length); j += 4) {
      const v = Math.abs(samples[j] ?? 0);
      if (v > max) max = v;
    }
    peaks.push(Math.min(1, max * 1.6));
  }
  return peaks;
}
