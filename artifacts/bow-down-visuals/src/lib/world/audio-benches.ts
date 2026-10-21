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
 * Naming law applies: no provider names in any user-facing string.
 */
import { getCreditCost } from "../credit-costs";
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
  | "arrangement";

/** How a bench takes its source: an uploaded/library audio FILE
 *  (multipart), several stem FILES (mix), a hosted audio URL (the
 *  vocal benches work on library songs' URLs, as their modals do),
 *  typed TEXT (podcast / voiceover scripts), a hum FILE (two-step),
 *  or the arrangement DRAFT rail. */
export type AudioBenchInput = "file" | "stem-files" | "url" | "text" | "hum" | "draft";

export interface AudioBenchDef {
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
    label: "Harmony — classic doubles",
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
];

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
export const MASTER_REFERENCE_FIELD = "reference";

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

/** HarmonyGeneratorModal's classic-mode body (the registry-priced
 *  mode; the AI mode's price comes from the modes probe and stays
 *  on the website until it is registry-priced). */
export function buildHarmonyPayload(input: {
  songId?: string;
  audioUrl: string;
  keyHint?: string;
  style: string;
  mixLevel: number;
}): Record<string, unknown> {
  return {
    songId: input.songId,
    audioUrl: input.audioUrl,
    keyHint: input.keyHint?.trim() ? input.keyHint.trim() : undefined,
    style: input.style,
    mixLevel: input.mixLevel,
    mode: "classic",
  };
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

/** podcast.tsx's solo generate body (mode script/topic — the
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

/** voiceover.tsx's generate body. */
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

const EMPTY: AudioBenchResult = { done: false, failed: false, urls: [], text: null, error: null };

function failed(error: string | null): AudioBenchResult {
  return { done: true, failed: true, urls: [], text: null, error: error ?? "The job didn't finish." };
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
): AudioBenchResult {
  const status = typeof data["status"] === "string" ? (data["status"] as string) : null;
  if (status === "failed") {
    return failed(
      typeof data["error"] === "string" ? (data["error"] as string) : typeof data["message"] === "string" ? (data["message"] as string) : null,
    );
  }
  const str = (k: string): string | null =>
    typeof data[k] === "string" && (data[k] as string) ? (data[k] as string) : null;

  switch (benchId) {
    case "harmony": {
      const mixed = str("mixedPreviewUrl");
      if (!mixed) return EMPTY;
      const urls = [{ label: "Your song with harmony", url: mixed }];
      const stem = str("harmonyStemUrl") ?? str("harmonyUrl");
      if (stem) urls.push({ label: "Harmony stem", url: stem });
      return { done: true, failed: false, urls, text: null, error: null };
    }
    case "podcast":
    case "voiceover": {
      const url = str("audioUrl") ?? str("audioPlayUrl");
      if (!url) return EMPTY;
      return {
        done: true,
        failed: false,
        urls: [{ label: benchId === "podcast" ? "Your podcast episode" : "Your voiceover", url }],
        text: benchId === "podcast" ? str("rssXml") : null,
        error: null,
      };
    }
    case "lufs-analyze": {
      /* The route answers FLAT: { integratedLufs, loudnessRangeLu,
         truePeakDb, threshold, durationSec, targetLufs, ebur128 }. */
      if (typeof data["integratedLufs"] !== "number") return EMPTY;
      const lines = [
        `Integrated loudness: ${data["integratedLufs"]} LUFS`,
        typeof data["loudnessRangeLu"] === "number" ? `Loudness range: ${data["loudnessRangeLu"]} LU` : null,
        typeof data["truePeakDb"] === "number" ? `True peak: ${data["truePeakDb"]} dB` : null,
        typeof data["durationSec"] === "number" ? `Duration: ${data["durationSec"]}s` : null,
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
      if (!stems || typeof stems !== "object") return failed("The split finished but came back empty.");
      const urls = Object.entries(stems as Record<string, unknown>)
        .filter(([, v]) => typeof v === "string" && v)
        .map(([k, v]) => ({ label: `Stem — ${k}`, url: v as string }));
      return urls.length > 0
        ? { done: true, failed: false, urls, text: null, error: null }
        : failed("The split finished but came back empty.");
    }
    case "vocal-removal": {
      if (status !== "done") return EMPTY;
      const urls: Array<{ label: string; url: string }> = [];
      const inst = str("instrumental") ?? str("instrumentalUrl");
      const vox = str("vocals") ?? str("vocalsUrl") ?? str("acapellaUrl");
      if (inst) urls.push({ label: "Instrumental", url: inst });
      if (vox) urls.push({ label: "Vocals only", url: vox });
      const single = str("outputUrl") ?? str("url");
      if (urls.length === 0 && single) urls.push({ label: "Your audio", url: single });
      return urls.length > 0
        ? { done: true, failed: false, urls, text: null, error: null }
        : failed("The job finished but came back empty.");
    }
    default: {
      /* master family + mastering + polish + tune + lufs-normalize
         + singing-voice: job words with one primary output. */
      if (status !== "done") return EMPTY;
      const url = str("outputUrl") ?? str("mp3Url") ?? str("wavUrl") ?? str("url");
      return url
        ? { done: true, failed: false, urls: [{ label: "Your finished audio", url }], text: null, error: null }
        : failed("The job finished but came back empty.");
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
