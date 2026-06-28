import { Router } from "express";
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
  type MasterBusSettings,
} from "../lib/audioExport";

const router = Router();
const BUCKET = "audio-stems";
const MAX_STEMS = 64;

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
  trimStart?: unknown;
  trimEnd?: unknown;
  durationSec?: unknown;
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
    eqTone:        typeof r.eqTone === "string"           ? r.eqTone              : "neutral",
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
      trimStart: Number.isFinite(Number(s.trimStart)) ? Number(s.trimStart) : 0,
      trimEnd: Number.isFinite(Number(s.trimEnd)) ? Number(s.trimEnd) : 0,
      ...(Number.isFinite(Number(s.durationSec)) ? { durationSec: Number(s.durationSec) } : {}),
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

  try {
    const mv = Number.isFinite(Number(masterVolume)) ? Number(masterVolume) : 100;
    const parsedMaster = parseMasterSettings(masterSettings);
    const { buffer, contentType, ext } = await runMixExport({
      stems: selected,
      masterVolume: mv,
      format: mapping.format,
      masterSettings: parsedMaster,
    });

    const sb = req.userSupabase!;
    const path = `${req.userId}/exports/${Date.now()}-${mapping.kind}.${ext}`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buffer, {
      contentType,
      upsert: true,
    });
    if (upErr) {
      req.log.error({ err: upErr }, "Audio export upload failed");
      res.status(500).json({ error: "Could not save the exported file.", code: "export_failed" });
      return;
    }
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);

    res.json({
      url: data.publicUrl,
      format: mapping.format,
      kind: mapping.kind,
      exportType,
      stemsUsed: selected.map((s) => s.name),
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof AudioExportError) {
      req.log.error({ err, stderr: err.stderr }, "Audio export error");
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    req.log.error({ err }, "Audio export failed");
    res.status(500).json({ error: "Audio export failed.", code: "export_failed" });
  }
});

export default router;
