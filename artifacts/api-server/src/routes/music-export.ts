import { Router } from "express";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import { buildChargeIdempotencyKey } from "../lib/credits";
import {
  claimMusicExportJob,
  completeMusicExportJob,
  createMusicExportJob,
  failMusicExportJob,
  findActiveMusicExportJobByAttemptKey,
  getMusicExportJob,
  recoverInterruptedMusicExportJobs as recoverMusicExportJobs,
} from "../lib/music-export-jobs";
import {
  AudioExportError,
  isAllowedStemUrl,
  isFfmpegAvailable,
  runMixExport,
  selectStemsForExport,
  type AudioExportType,
  type AudioExportKind,
  type ExportStemInput,
  type ExportStemEffects,
  type ExportFxStep,
  type ExportAutomation,
  type MasterBusSettings,
} from "../lib/audioExport";
import { r2Upload, r2PublicUrl } from "../lib/r2-client";
import { aiDisclosureMetadataText, PROVENANCE_PLATFORM } from "../lib/provenance";

/* AI disclosure for audio exports (lane F7): DEFAULT ON — an absent
   aiDisclosure field means the disclosure rides in the file's tags; only
   an explicit false opts out. */
const AUDIO_DISCLOSURE_TEXT = aiDisclosureMetadataText({
  createdWith: { tool: "Audio Studio", model: null, platform: PROVENANCE_PLATFORM },
});
function disclosureOpts(aiDisclosure: unknown): { aiDisclosure: boolean; disclosureText: string } {
  return { aiDisclosure: aiDisclosure !== false, disclosureText: AUDIO_DISCLOSURE_TEXT };
}

const router = Router();
const BUCKET = "audio-stems";
const MAX_STEMS = 64;

/* ── Durable async job store (stack300 item 62) ─────────────────────────
   Mix renders can legitimately take several minutes for a full-length song
   with many stems and heavy per-stem effect chains, well past what an HTTP
   request/proxy can hold open reliably. POST /music/export enqueues a job
   and returns immediately; the client polls GET /music/export/job/:id for
   status. Jobs used to live in a process Map — every restart wiped
   in-flight renders and polling 404'd mid-render. The record now lives in
   the music_export_jobs table (lib/music-export-jobs.ts, migration 0326):
   the row carries the owner (the poll endpoint 404s for anyone else,
   item 63), the full render params (boot recovery re-runs an interrupted
   job from scratch), and an attempt key (a duplicate start POST returns
   the in-flight job instead of rendering twice, item 64).              */
interface MixExportJobResult {
  url: string;
  format: "mp3" | "wav";
  kind: AudioExportKind;
  exportType: string;
  stemsUsed: string[];
  createdAt: string;
  warnings?: string[];
}

/** Everything needed to (re)run a mix render — persisted on the job row. */
interface MixExportParams {
  stems: ExportStemInput[];
  masterVolume: number;
  format: "mp3" | "wav";
  masterSettings?: MasterBusSettings;
  kind: AudioExportKind;
  exportType: string;
  aiDisclosure: boolean;
}

const TYPE_MAP: Record<AudioExportType, { kind: AudioExportKind; format: "mp3" | "wav" }> = {
  "full-mp3": { kind: "full", format: "mp3" },
  "full-wav": { kind: "full", format: "wav" },
  "instrumental-mp3": { kind: "instrumental", format: "mp3" },
  "acapella-mp3": { kind: "acapella", format: "mp3" },
};

interface RawStem {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  url?: unknown;
  volume?: unknown;
  muted?: unknown;
  solo?: unknown;
  pan?: unknown;
  trimStart?: unknown;
  trimEnd?: unknown;
  durationSec?: unknown;
  effects?: unknown;
  /* Stack 6 arrangement fields. */
  startTime?: unknown;
  fadeInSec?: unknown;
  fadeOutSec?: unknown;
  fxChain?: unknown;
  automation?: unknown;
  duck?: unknown;
}

interface RawStemEffects {
  eq?: unknown;
  autotune?: unknown;
  reverb?: unknown;
  delay?: unknown;
  compression?: unknown;
  saturation?: unknown;
  deEsser?: unknown;
  noiseReduction?: unknown;
}

function parseStemEffects(raw: unknown): ExportStemEffects | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as RawStemEffects;
  return {
    eq:            typeof r.eq === "string"          ? r.eq          : "Off",
    autotune:      typeof r.autotune === "string"    ? r.autotune    : "off",
    reverb:        typeof r.reverb === "string"      ? r.reverb      : "none",
    delay:         typeof r.delay === "string"       ? r.delay       : "none",
    compression:   typeof r.compression === "string" ? r.compression : "off",
    saturation:    typeof r.saturation === "string"  ? r.saturation  : "off",
    deEsser:       r.deEsser === true,
    noiseReduction: r.noiseReduction === true,
  };
}

/* ── Stack 6 arrangement payload parsing (clamped, defensive) ─────────── */
const FX_STEP_TYPES = new Set(["eq", "compressor", "saturation", "reverb", "delay"]);

function clampNum(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

/* ── FX chain honesty gate (Wave 3 #16) ──────────────────────────────────
 * parseFxChain below is a defensive clamp: it silently drops what it
 * cannot use. That is the right last-resort behavior for the render
 * graph, but it must never decide what a client MEANT: a stem that
 * arrives with a malformed chain would otherwise fall back to the
 * legacy preset chain and render something the user did not ask for,
 * with no sign anything went wrong. So both export routes run this
 * strict structural validation first — a chain that is present but
 * malformed fails the request with `invalid_fx_chain`. In-range
 * numbers are NOT errors (parseFxChain clamps them); structural
 * problems are: not an array, too many steps, a step that is not an
 * object, an unknown step type, malformed bands, or a parameter
 * value that is not a finite number. */
const FX_MAX_STEPS = 12;
const FX_MAX_BANDS = 5;
const FX_NUMERIC_FIELDS = [
  "thresholdDb", "ratio", "attackMs", "releaseMs",
  "drive", "mix", "timeMs", "feedback",
] as const;

export function validateFxChain(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) return "the FX chain must be a list of steps";
  if (raw.length > FX_MAX_STEPS) return `the FX chain has too many steps (max ${FX_MAX_STEPS})`;
  for (const item of raw) {
    if (!item || typeof item !== "object") return "an FX chain step is not an object";
    const r = item as Record<string, unknown>;
    if (typeof r["type"] !== "string" || !FX_STEP_TYPES.has(r["type"])) {
      return `an FX chain step has an unknown type (${String(r["type"])})`;
    }
    if (r["bands"] !== undefined) {
      if (!Array.isArray(r["bands"])) return "an EQ step's bands must be a list";
      if (r["bands"].length > FX_MAX_BANDS) return `an EQ step has too many bands (max ${FX_MAX_BANDS})`;
      for (const b of r["bands"]) {
        if (!b || typeof b !== "object") return "an EQ band is not an object";
        const bb = b as Record<string, unknown>;
        for (const f of ["freq", "gain", "q"] as const) {
          if (bb[f] !== undefined && (typeof bb[f] !== "number" || !Number.isFinite(bb[f]))) {
            return `an EQ band's ${f} must be a number`;
          }
        }
      }
    }
    for (const f of FX_NUMERIC_FIELDS) {
      if (r[f] !== undefined && (typeof r[f] !== "number" || !Number.isFinite(r[f] as number))) {
        return `an FX step's ${f} must be a number`;
      }
    }
  }
  return null;
}

/** First FX-chain error across a request's stems, naming the stem. */
export function findStemFxChainError(stems: RawStem[]): string | null {
  for (const s of stems) {
    if (!s || s.fxChain === undefined) continue;
    const err = validateFxChain(s.fxChain);
    if (err) return `Stem "${String(s.name ?? "Stem")}": ${err}.`;
  }
  return null;
}

export function parseFxChain(raw: unknown): ExportFxStep[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const steps: ExportFxStep[] = [];
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r["type"] !== "string" || !FX_STEP_TYPES.has(r["type"])) continue;
    const step: ExportFxStep = {
      type: r["type"] as ExportFxStep["type"],
      enabled: r["enabled"] !== false,
    };
    if (Array.isArray(r["bands"])) {
      step.bands = r["bands"].slice(0, 5).map((b) => {
        const bb = (b ?? {}) as Record<string, unknown>;
        return {
          freq: clampNum(bb["freq"], 20, 20000, 1000),
          gain: clampNum(bb["gain"], -24, 24, 0),
          q: clampNum(bb["q"], 0.3, 12, 1),
        };
      });
    }
    if (r["thresholdDb"] !== undefined) step.thresholdDb = clampNum(r["thresholdDb"], -60, 0, -18);
    if (r["ratio"] !== undefined) step.ratio = clampNum(r["ratio"], 1, 20, 3);
    if (r["attackMs"] !== undefined) step.attackMs = clampNum(r["attackMs"], 0.1, 500, 10);
    if (r["releaseMs"] !== undefined) step.releaseMs = clampNum(r["releaseMs"], 10, 1000, 150);
    if (r["drive"] !== undefined) step.drive = clampNum(r["drive"], 1, 3, 1.5);
    if (r["mix"] !== undefined) step.mix = clampNum(r["mix"], 0, 100, 20);
    if (r["timeMs"] !== undefined) step.timeMs = clampNum(r["timeMs"], 10, 2000, 250);
    if (r["feedback"] !== undefined) step.feedback = clampNum(r["feedback"], 0, 80, 30);
    steps.push(step);
  }
  return steps.length > 0 ? steps : undefined;
}

function parseAutomationLane(raw: unknown, lo: number, hi: number) {
  if (!Array.isArray(raw)) return undefined;
  const pts = raw
    .slice(0, 200)
    .filter((p) => p && typeof p === "object")
    .map((p) => {
      const pp = p as Record<string, unknown>;
      return { time: clampNum(pp["time"], 0, 86400, 0), value: clampNum(pp["value"], lo, hi, lo) };
    });
  return pts.length > 0 ? pts : undefined;
}

export function parseAutomation(raw: unknown): ExportAutomation | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: ExportAutomation = {};
  const volume = parseAutomationLane(r["volume"], 0, 150);
  const pan = parseAutomationLane(r["pan"], -100, 100);
  const reverbMix = parseAutomationLane(r["reverbMix"], 0, 100);
  if (volume) out.volume = volume;
  if (pan) out.pan = pan;
  if (reverbMix) out.reverbMix = reverbMix;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseDuck(raw: unknown): ExportStemInput["duck"] {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r["sourceStemIds"])) return undefined;
  const sourceStemIds = r["sourceStemIds"]
    .filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 128)
    .slice(0, 64);
  if (sourceStemIds.length === 0) return undefined;
  return {
    sourceStemIds,
    amount: clampNum(r["amount"], 0, 100, 60),
    sensitivity: clampNum(r["sensitivity"], 0, 100, 50),
  };
}

/** Shared stem-payload → ExportStemInput mapping for /music/export and
 *  /music/preview-render (previously two hand-kept copies). */
export function parseStemInput(s: RawStem): ExportStemInput {
  const fxChain = parseFxChain(s.fxChain);
  const automation = parseAutomation(s.automation);
  const duck = parseDuck(s.duck);
  return {
    id: String(s.id ?? ""),
    name: String(s.name ?? "Stem"),
    type: String(s.type ?? ""),
    url: String(s.url),
    volume: Number.isFinite(Number(s.volume)) ? Number(s.volume) : 100,
    muted: !!s.muted,
    solo: !!s.solo,
    pan: Number.isFinite(Number(s.pan)) ? Number(s.pan) : 0,
    trimStart: Number.isFinite(Number(s.trimStart)) ? Number(s.trimStart) : 0,
    trimEnd: Number.isFinite(Number(s.trimEnd)) ? Number(s.trimEnd) : 0,
    ...(Number.isFinite(Number(s.durationSec)) ? { durationSec: Number(s.durationSec) } : {}),
    ...(parseStemEffects(s.effects) ? { effects: parseStemEffects(s.effects)! } : {}),
    ...(Number.isFinite(Number(s.startTime)) ? { startTime: Math.max(0, Number(s.startTime)) } : {}),
    ...(Number.isFinite(Number(s.fadeInSec)) ? { fadeInSec: Math.max(0, Math.min(5, Number(s.fadeInSec))) } : {}),
    ...(Number.isFinite(Number(s.fadeOutSec)) ? { fadeOutSec: Math.max(0, Math.min(5, Number(s.fadeOutSec))) } : {}),
    ...(fxChain ? { fxChain } : {}),
    ...(automation ? { automation } : {}),
    ...(duck ? { duck } : {}),
  };
}

interface RawMasterSettings {
  volume?: unknown;
  compression?: unknown;
  stereoWidth?: unknown;
  bassBoost?: unknown;
  eqTone?: unknown;
  loudnessTarget?: unknown;
  limiter?: unknown;
  fadeIn?: unknown;
  fadeOut?: unknown;
}

function parseMasterSettings(raw: unknown): MasterBusSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as RawMasterSettings;
  return {
    volume:        Number.isFinite(Number(r.volume))      ? Number(r.volume)      : 100,
    compression:   Number.isFinite(Number(r.compression)) ? Number(r.compression) : 0,
    stereoWidth:   Number.isFinite(Number(r.stereoWidth)) ? Number(r.stereoWidth) : 50,
    bassBoost:     Number.isFinite(Number(r.bassBoost))   ? Number(r.bassBoost)   : 0,
    eqTone:        typeof r.eqTone === "string"           ? r.eqTone              : "balanced",
    loudnessTarget: typeof r.loudnessTarget === "string"  ? r.loudnessTarget      : "streaming",
    limiter:       r.limiter !== false,
    fadeIn:        !!r.fadeIn,
    fadeOut:       !!r.fadeOut,
  };
}

router.post("/music/export", requireAuth, async (req, res) => {
  const { exportType, stems, masterVolume, masterSettings, aiDisclosure } = (req.body ?? {}) as {
    exportType?: string;
    stems?: RawStem[];
    masterVolume?: unknown;
    masterSettings?: unknown;
    aiDisclosure?: unknown;
  };

  const mapping = TYPE_MAP[exportType as AudioExportType];
  if (!mapping) {
    res.status(400).json({ error: "Invalid export type.", code: "invalid_type" });
    return;
  }
  if (!Array.isArray(stems) || stems.length === 0) {
    res.status(400).json({ error: "No stems available to export.", code: "no_stems" });
    return;
  }

  const fxChainError = findStemFxChainError(stems);
  if (fxChainError) {
    res.status(400).json({ error: fxChainError, code: "invalid_fx_chain" });
    return;
  }

  const cleanStems: ExportStemInput[] = stems
    .filter((s) => s && typeof s.url === "string" && s.url.startsWith("http"))
    .map((s) => parseStemInput(s));

  if (cleanStems.length > MAX_STEMS) {
    res.status(400).json({ error: `Too many stems (max ${MAX_STEMS}).`, code: "too_many_stems" });
    return;
  }
  if (cleanStems.some((s) => !isAllowedStemUrl(s.url))) {
    res.status(400).json({
      error: "One or more stem files came from an untrusted source.",
      code: "invalid_stem_url",
    });
    return;
  }

  const selected = selectStemsForExport(cleanStems, mapping.kind);
  if (selected.length === 0) {
    const error =
      mapping.kind === "instrumental"
        ? "No instrumental stems found. Label your beat / drums / bass / melody stems and try again."
        : mapping.kind === "acapella"
          ? "No vocal stems found. Label your lead / background / ad-lib vocals and try again."
          : "No unmuted stems to export.";
    res.status(400).json({ error, code: "no_stems" });
    return;
  }

  if (!(await isFfmpegAvailable())) {
    res.status(503).json({
      error: "Audio export is unavailable on this server right now.",
      code: "ffmpeg_unavailable",
    });
    return;
  }

  const mv = Number.isFinite(Number(masterVolume)) ? Number(masterVolume) : 100;
  const parsedMaster = parseMasterSettings(masterSettings);

  const renderParams: MixExportParams = {
    stems: selected,
    masterVolume: mv,
    format: mapping.format,
    masterSettings: parsedMaster,
    kind: mapping.kind,
    exportType: exportType!,
    aiDisclosure: aiDisclosure !== false,
  };

  /* Item 64: duplicate-submit guard. The attempt key is derived from
     (user + render params) — or taken from the client's Idempotency-Key
     header when it sends one — and a duplicate POST while the original
     job is still queued/processing returns THAT job instead of
     starting a second identical render. */
  const userId = req.userId!;
  const attemptKey = buildChargeIdempotencyKey(
    "music_export",
    userId,
    req.header("Idempotency-Key") ?? null,
    renderParams,
  );
  const existing = await findActiveMusicExportJobByAttemptKey(userId, attemptKey).catch((err) => {
    req.log.error({ err }, "Music export dedup lookup failed; proceeding with a new job");
    return undefined;
  });
  if (existing) {
    res.status(202).json({ jobId: existing.id, status: existing.state, duplicate: true });
    return;
  }

  const jobId = randomUUID();
  try {
    await createMusicExportJob(jobId, userId, renderParams, attemptKey);
  } catch (err) {
    /* No durable row, no render: better an honest 503 than a job the
       next restart would silently erase (the old in-memory behavior). */
    req.log.error({ err }, "Music export job could not be recorded");
    res.status(503).json({
      error: "Audio export is unavailable on this server right now.",
      code: "export_unavailable",
    });
    return;
  }

  void processMixExportJob(jobId, req.log);

  res.status(202).json({ jobId, status: "queued" });
});

/**
 * Run one mix render from its durable row. The claim (queued →
 * processing) is atomic, so the route kickoff and boot recovery can
 * both call this for the same job and exactly one renders. All state
 * lands back on the row — the poll endpoint reads nothing else.
 */
async function processMixExportJob(
  jobId: string,
  log: { error: (obj: unknown, msg?: string) => void },
): Promise<void> {
  const claimed = await claimMusicExportJob(jobId).catch((err) => {
    log.error({ err, jobId }, "Music export job claim failed");
    return undefined;
  });
  if (!claimed) return; // gone, already claimed, or already terminal

  const params = claimed.params as MixExportParams;
  const { disclosureText } = disclosureOpts(params.aiDisclosure);

  try {
    const { buffer, contentType, ext, warnings } = await runMixExport({
      stems: params.stems,
      masterVolume: params.masterVolume,
      format: params.format,
      masterSettings: params.masterSettings,
      aiDisclosure: params.aiDisclosure,
      disclosureText,
    });

    const path = `${claimed.userId}/exports/${Date.now()}-${params.kind}.${ext}`;
    const r2Key = `audio-stems/${path}`;
    try {
      await r2Upload(r2Key, buffer, contentType);
    } catch (upErr) {
      log.error({ err: upErr, jobId }, "Audio export upload failed");
      await failMusicExportJob(jobId, "Could not save the exported file.", "export_failed").catch(() => undefined);
      return;
    }
    const exportUrl = r2PublicUrl(r2Key);

    const result: MixExportJobResult = {
      url: exportUrl,
      format: params.format,
      kind: params.kind,
      exportType: params.exportType,
      stemsUsed: params.stems.map((s) => s.name),
      createdAt: new Date().toISOString(),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
    await completeMusicExportJob(jobId, result as unknown as Record<string, unknown>).catch((err) =>
      log.error({ err, jobId }, "Music export completion could not be recorded"),
    );
  } catch (err) {
    if (err instanceof AudioExportError) {
      log.error({ err, stderr: err.stderr, jobId }, "Audio export error");
      await failMusicExportJob(jobId, err.message, err.code).catch(() => undefined);
      return;
    }
    log.error({ err, jobId }, "Audio export failed");
    await failMusicExportJob(jobId, "Audio export failed.", "export_failed").catch(() => undefined);
  }
}

/**
 * Boot recovery (item 62): re-drive mix-export jobs a previous process
 * left queued/processing — the persisted params make the render
 * re-runnable from scratch. Called once from index.ts after listen.
 */
export async function recoverInterruptedMusicExportJobs(): Promise<void> {
  await recoverMusicExportJobs(async (job) => {
    void processMixExportJob(job.id, logger);
  });
}

/** Clamp bounds for the "true render" preview clip length. */
const MIN_PREVIEW_SECONDS = 5;
const MAX_PREVIEW_SECONDS = 20;
const DEFAULT_PREVIEW_SECONDS = 12;

/**
 * Renders a short clip of the *actual* FFmpeg mix pipeline (not the Web Audio
 * browser approximation) so users can A/B it before spending export credits
 * on a full render. Always renders the full mix (kind="full") since that's
 * what the live preview approximates. Runs synchronously — a 5-20s clip
 * renders in a couple seconds even with a heavy effect chain — so no job
 * polling is needed here.
 */
router.post("/music/preview-render", requireAuth, async (req, res) => {
  const { stems, masterVolume, masterSettings, previewSeconds, aiDisclosure } = (req.body ?? {}) as {
    stems?: RawStem[];
    masterVolume?: unknown;
    masterSettings?: unknown;
    previewSeconds?: unknown;
    aiDisclosure?: unknown;
  };

  if (!Array.isArray(stems) || stems.length === 0) {
    res.status(400).json({ error: "No stems available to preview.", code: "no_stems" });
    return;
  }

  const fxChainError = findStemFxChainError(stems);
  if (fxChainError) {
    res.status(400).json({ error: fxChainError, code: "invalid_fx_chain" });
    return;
  }

  const cleanStems: ExportStemInput[] = stems
    .filter((s) => s && typeof s.url === "string" && s.url.startsWith("http"))
    .map((s) => parseStemInput(s));

  if (cleanStems.length > MAX_STEMS) {
    res.status(400).json({ error: `Too many stems (max ${MAX_STEMS}).`, code: "too_many_stems" });
    return;
  }
  if (cleanStems.some((s) => !isAllowedStemUrl(s.url))) {
    res.status(400).json({
      error: "One or more stem files came from an untrusted source.",
      code: "invalid_stem_url",
    });
    return;
  }

  const selected = selectStemsForExport(cleanStems, "full");
  if (selected.length === 0) {
    res.status(400).json({ error: "No unmuted stems to preview.", code: "no_stems" });
    return;
  }

  if (!(await isFfmpegAvailable())) {
    res.status(503).json({
      error: "Real preview rendering isn't available on this server right now.",
      code: "ffmpeg_unavailable",
    });
    return;
  }

  const mv = Number.isFinite(Number(masterVolume)) ? Number(masterVolume) : 100;
  const parsedMaster = parseMasterSettings(masterSettings);
  const clipSeconds = Math.min(
    MAX_PREVIEW_SECONDS,
    Math.max(MIN_PREVIEW_SECONDS, Number.isFinite(Number(previewSeconds)) ? Number(previewSeconds) : DEFAULT_PREVIEW_SECONDS),
  );

  try {
    const { buffer, contentType, warnings } = await runMixExport({
      stems: selected,
      masterVolume: mv,
      format: "mp3",
      masterSettings: parsedMaster,
      previewSeconds: clipSeconds,
      ...disclosureOpts(aiDisclosure),
    });

    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Preview-Seconds", String(clipSeconds));
    if (warnings.length > 0) {
      res.setHeader("X-Preview-Warnings", encodeURIComponent(JSON.stringify(warnings)));
    }
    res.send(buffer);
  } catch (err) {
    if (err instanceof AudioExportError) {
      req.log.error({ err, stderr: err.stderr }, "Preview render error");
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    req.log.error({ err }, "Preview render failed");
    res.status(500).json({ error: "Preview render failed.", code: "export_failed" });
  }
});

router.get("/music/export/job/:id", requireAuth, async (req, res) => {
  const job = await getMusicExportJob(String(req.params["id"] ?? "")).catch(() => undefined);
  /* Item 63: the job record carries its owner — a poll from anyone
     else gets the same 404 as a missing job (the sibling export poll
     handlers' pattern), never the result URL. */
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Export job not found or expired.", code: "job_not_found" });
    return;
  }
  res.json({
    status: job.state,
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(job.code ? { code: job.code } : {}),
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
  });
});

export default router;
