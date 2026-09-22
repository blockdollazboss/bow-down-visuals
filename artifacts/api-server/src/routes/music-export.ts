import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAuth } from "../middlewares/require-auth";
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
  type MasterBusSettings,
} from "../lib/audioExport";

const router = Router();
const BUCKET = "audio-stems";
const MAX_STEMS = 64;

/* ── In-process async job store ──────────────────────────────────────────
   Mix renders can legitimately take several minutes for a full-length song
   with many stems and heavy per-stem effect chains, well past what an HTTP
   request/proxy can hold open reliably. POST /music/export now enqueues a
   job and returns immediately; the client polls GET /music/export/job/:id
   for status. Jobs are pruned after 2 h; safe for a single-instance
   deployment since the server process is long-running.                    */
interface MixExportJobResult {
  url: string;
  format: "mp3" | "wav";
  kind: AudioExportKind;
  exportType: string;
  stemsUsed: string[];
  createdAt: string;
  warnings?: string[];
}
interface MixExportJob {
  status: "queued" | "processing" | "done" | "failed";
  result?: MixExportJobResult;
  error?: string;
  code?: string;
  createdAt: string;
  updatedAt: string;
}

const mixExportJobs = new Map<string, MixExportJob>();

setInterval(
  () => {
    const cutoffMs = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, job] of mixExportJobs) {
      if (new Date(job.createdAt).getTime() < cutoffMs) mixExportJobs.delete(id);
    }
  },
  30 * 60 * 1000,
).unref();

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
  const { exportType, stems, masterVolume, masterSettings } = (req.body ?? {}) as {
    exportType?: string;
    stems?: RawStem[];
    masterVolume?: unknown;
    masterSettings?: unknown;
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

  const cleanStems: ExportStemInput[] = stems
    .filter((s) => s && typeof s.url === "string" && s.url.startsWith("http"))
    .map((s) => ({
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
    }));

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

  const jobId = randomUUID();
  const now = new Date().toISOString();
  mixExportJobs.set(jobId, { status: "queued", createdAt: now, updatedAt: now });

  const sb = req.userSupabase!;
  const userId = req.userId;
  const log = req.log;

  void processMixExportJob(jobId, {
    stems: selected,
    masterVolume: mv,
    format: mapping.format,
    masterSettings: parsedMaster,
    kind: mapping.kind,
    exportType: exportType!,
    sb,
    userId: userId!,
    log,
  });

  res.status(202).json({ jobId, status: "queued" });
});

async function processMixExportJob(
  jobId: string,
  params: {
    stems: ExportStemInput[];
    masterVolume: number;
    format: "mp3" | "wav";
    masterSettings?: MasterBusSettings;
    kind: AudioExportKind;
    exportType: string;
    sb: SupabaseClient;
    userId: string;
    log: { error: (obj: unknown, msg?: string) => void };
  },
): Promise<void> {
  const update = (patch: Partial<MixExportJob>) => {
    const j = mixExportJobs.get(jobId);
    if (j) mixExportJobs.set(jobId, { ...j, ...patch, updatedAt: new Date().toISOString() });
  };

  update({ status: "processing" });

  try {
    const { buffer, contentType, ext, warnings } = await runMixExport({
      stems: params.stems,
      masterVolume: params.masterVolume,
      format: params.format,
      masterSettings: params.masterSettings,
    });

    const path = `${params.userId}/exports/${Date.now()}-${params.kind}.${ext}`;
    const { error: upErr } = await params.sb.storage.from(BUCKET).upload(path, buffer, {
      contentType,
      upsert: true,
    });
    if (upErr) {
      params.log.error({ err: upErr }, "Audio export upload failed");
      update({ status: "failed", error: "Could not save the exported file.", code: "export_failed" });
      return;
    }
    const { data } = params.sb.storage.from(BUCKET).getPublicUrl(path);

    update({
      status: "done",
      result: {
        url: data.publicUrl,
        format: params.format,
        kind: params.kind,
        exportType: params.exportType,
        stemsUsed: params.stems.map((s) => s.name),
        createdAt: new Date().toISOString(),
        ...(warnings.length > 0 ? { warnings } : {}),
      },
    });
  } catch (err) {
    if (err instanceof AudioExportError) {
      params.log.error({ err, stderr: err.stderr }, "Audio export error");
      update({ status: "failed", error: err.message, code: err.code });
      return;
    }
    params.log.error({ err }, "Audio export failed");
    update({ status: "failed", error: "Audio export failed.", code: "export_failed" });
  }
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
  const { stems, masterVolume, masterSettings, previewSeconds } = (req.body ?? {}) as {
    stems?: RawStem[];
    masterVolume?: unknown;
    masterSettings?: unknown;
    previewSeconds?: unknown;
  };

  if (!Array.isArray(stems) || stems.length === 0) {
    res.status(400).json({ error: "No stems available to preview.", code: "no_stems" });
    return;
  }

  const cleanStems: ExportStemInput[] = stems
    .filter((s) => s && typeof s.url === "string" && s.url.startsWith("http"))
    .map((s) => ({
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
    }));

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

router.get("/music/export/job/:id", requireAuth, (req, res) => {
  const job = mixExportJobs.get(String(req.params["id"] ?? ""));
  if (!job) {
    res.status(404).json({ error: "Export job not found or expired.", code: "job_not_found" });
    return;
  }
  res.json(job);
});

export default router;
