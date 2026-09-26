import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { Request, Response, Router, NextFunction } from "express";
import multer from "multer";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";
import {
  GENRE_PRESETS,
  LOUDNESS_TARGETS,
  resolveGenre,
  resolveIntensity,
  resolveLoudness,
  detectStemType,
  buildMasterPreChain,
  buildMixFilterComplex,
  buildLoudnormRender,
  parseLoudnormJson,
  type MixMasterGenre,
  type MixMasterIntensity,
  type MixMasterLoudness,
  type StemType,
  type LoudnormMeasurement,
} from "./mix-master-chain";

const router = Router();
const execFileAsync = promisify(execFile);

export const MIX_MASTER_CREDIT_COST = 8;
export const MIX_STEMS_CREDIT_COST = 15;
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB per file
const MAX_STEMS = 12;
const FFMPEG_TIMEOUT_MS = 900_000; // 15 min cap per pass (stem mixes are heavy)

/* Disk storage: 12 stems × 100 MB must never sit in Node heap. */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpdir()),
  filename: (_req, file, cb) => {
    const safe = (file.originalname || "audio").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    cb(null, `mixmaster-${randomUUID()}-${safe}`);
  },
});

function audioFileFilter(_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const name = (file.originalname || "").toLowerCase();
  const okMime = file.mimetype.startsWith("audio/");
  const okExt = /\.(wav|mp3|aiff|aif|flac|m4a|ogg)$/.test(name);
  if (okMime || okExt) cb(null, true);
  else cb(new Error("Only audio files (WAV, MP3, AIFF, FLAC, M4A, OGG) are allowed"));
}

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: audioFileFilter,
});

/**
 * Multer `.fields()` wrapped so middleware-level failures (file too large,
 * rejected file type, too many files) clean up any partial disk uploads
 * and return JSON instead of Express's default HTML error page.
 */
function fieldsUpload(fields: multer.Field[]) {
  const mw = upload.fields(fields);
  return (req: Request, res: Response, next: NextFunction) => {
    mw(req, res, (err: unknown) => {
      if (err) {
        const files = req.files as Record<string, Express.Multer.File[]> | undefined;
        for (const list of Object.values(files ?? {})) cleanupUploads(list);
        const code = (err as { code?: string })?.code;
        const message = err instanceof Error ? err.message : "Upload failed";
        res.status(code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
          error: "UPLOAD_FAILED",
          message: code === "LIMIT_FILE_SIZE"
            ? `A file exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB limit.`
            : message,
        });
        return;
      }
      next();
    });
  };
}

/* ── Server-owned background jobs (in-memory; not tab-dependent) ───── */

export type MixMasterJobKind = "master" | "mix";
export type MixMasterJobStatus = "queued" | "processing" | "done" | "failed";

export interface MixMasterJob {
  id: string;
  userId: string;
  kind: MixMasterJobKind;
  status: MixMasterJobStatus;
  genre: MixMasterGenre;
  intensity: MixMasterIntensity;
  loudness: MixMasterLoudness;
  sourceName: string;
  stemNames: string[];
  stemTypes: StemType[];
  inputLufs: number | null;
  inputTruePeak: number | null;
  inputLra: number | null;
  targetLufs: number;
  targetTruePeak: number;
  referenceLufs: number | null;
  outputLufs: number | null;
  outputTruePeak: number | null;
  wavUrl: string | null;
  mp3Url: string | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
}

const jobs = new Map<string, MixMasterJob>();

export function getMixMasterJob(id: string): MixMasterJob | undefined {
  return jobs.get(id);
}

/** Test hook: clear the in-memory job store. */
export function __clearMixMasterJobs(): void {
  jobs.clear();
}

/* ── ffmpeg passes ─────────────────────────────────────────────────── */

/** Run ffmpeg, returning stderr (loudnorm prints its JSON there) without throwing. */
async function runFfmpegCapture(args: string[]): Promise<string> {
  try {
    const result = (await execFileAsync("ffmpeg", args, {
      timeout: FFMPEG_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    })) as unknown as { stderr?: string };
    return result?.stderr ?? "";
  } catch (err) {
    return (err as { stderr?: string })?.stderr ?? "";
  }
}

/** Measure a plain file's loudness (used for reference tracks + output verification). */
async function measureFile(filePath: string): Promise<LoudnormMeasurement | null> {
  const stderr = await runFfmpegCapture([
    "-hide_banner", "-i", filePath,
    "-af", "loudnorm=print_format=json",
    "-f", "null", "-",
  ]);
  return parseLoudnormJson(stderr);
}

/** Master pipeline, pass 1: pre-chain + loudnorm in measure mode. */
async function measureMaster(
  inputPath: string,
  genre: MixMasterGenre,
  intensity: MixMasterIntensity,
): Promise<LoudnormMeasurement> {
  const filter = `${buildMasterPreChain(genre, intensity)},loudnorm=print_format=json`;
  const stderr = await runFfmpegCapture(["-hide_banner", "-i", inputPath, "-af", filter, "-f", "null", "-"]);
  const m = parseLoudnormJson(stderr);
  if (!m) throw new Error("Could not analyze the mix loudness — the file may be corrupt or silent.");
  return m;
}

/** Master pipeline, pass 2: render WAV + MP3 in one ffmpeg call (asplit feeds both outputs). */
async function renderMasterOutputs(
  inputPath: string,
  wavPath: string,
  mp3Path: string,
  fullChain: string,
): Promise<void> {
  await execFileAsync(
    "ffmpeg",
    [
      "-hide_banner", "-y", "-i", inputPath,
      "-filter_complex", `[0:a]${fullChain},asplit=2[o1][o2]`,
      "-map", "[o1]", "-ar", "48000", "-c:a", "pcm_s24le", wavPath,
      "-map", "[o2]", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "320k", mp3Path,
    ],
    { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
  );
}

/** Mix pipeline: build the filter_complex for a measure or render pass. */
function buildMixGraph(
  stemTypes: StemType[],
  genre: MixMasterGenre,
  intensity: MixMasterIntensity,
  vocalLevelDb: number,
  loudnormTail: string,
  splitOutputs = 1,
): { graph: string; outputs: string[] } {
  const preChain = buildMasterPreChain(genre, intensity);
  return buildMixFilterComplex(stemTypes, genre, intensity, vocalLevelDb, preChain, loudnormTail, splitOutputs);
}

/** Mix pipeline, pass 1: full graph with loudnorm in measure mode. */
async function measureMix(
  stemPaths: string[],
  stemTypes: StemType[],
  genre: MixMasterGenre,
  intensity: MixMasterIntensity,
  vocalLevelDb: number,
): Promise<LoudnormMeasurement> {
  const { graph, outputs } = buildMixGraph(stemTypes, genre, intensity, vocalLevelDb, "loudnorm=print_format=json");
  const args = ["-hide_banner", "-y"];
  for (const p of stemPaths) args.push("-i", p);
  args.push("-filter_complex", graph, "-map", outputs[0], "-f", "null", "-");
  const stderr = await runFfmpegCapture(args);
  const m = parseLoudnormJson(stderr);
  if (!m) {
    throw new Error(
      "Could not analyze the stem mix — one of the files may be corrupt, silent, or an unsupported format.",
    );
  }
  return m;
}

/** Mix pipeline, pass 2: render WAV + MP3 in one ffmpeg call (asplit feeds both outputs). */
async function renderMixOutputs(
  stemPaths: string[],
  stemTypes: StemType[],
  genre: MixMasterGenre,
  intensity: MixMasterIntensity,
  vocalLevelDb: number,
  renderTail: string,
  wavPath: string,
  mp3Path: string,
): Promise<void> {
  const { graph, outputs } = buildMixGraph(stemTypes, genre, intensity, vocalLevelDb, renderTail, 2);
  const args = ["-hide_banner", "-y"];
  for (const p of stemPaths) args.push("-i", p);
  args.push(
    "-filter_complex", graph,
    "-map", outputs[0], "-ar", "48000", "-c:a", "pcm_s24le", wavPath,
    "-map", outputs[1], "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "320k", mp3Path,
  );
  await execFileAsync("ffmpeg", args, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
}

/** Reference track: measure its integrated loudness and derive an honest target. */
async function resolveTargetFromReference(
  referencePath: string | null,
  fallback: MixMasterLoudness,
): Promise<{ targetLufs: number; targetTruePeak: number; targetLra: number; referenceLufs: number | null }> {
  const def = LOUDNESS_TARGETS[fallback];
  if (!referencePath) {
    return { targetLufs: def.targetLufs, targetTruePeak: def.targetTruePeak, targetLra: def.targetLra, referenceLufs: null };
  }
  const m = await measureFile(referencePath);
  if (!m) {
    return { targetLufs: def.targetLufs, targetTruePeak: def.targetTruePeak, targetLra: def.targetLra, referenceLufs: null };
  }
  const clamped = Math.min(-6, Math.max(-16, m.inputIntegrated));
  return {
    targetLufs: Math.round(clamped * 10) / 10,
    targetTruePeak: def.targetTruePeak,
    targetLra: def.targetLra,
    referenceLufs: m.inputIntegrated,
  };
}

async function refundJob(job: MixMasterJob, err: unknown): Promise<void> {
  job.status = "failed";
  job.error = err instanceof Error ? err.message : "Processing failed";
  try {
    await refundCredits(job.userId, job.creditsCharged, {
      action: `AI ${job.kind === "master" ? "Master" : "Mix"} — Refund (job failed)`,
    });
  } catch (refundErr) {
    void refundErr; // logged inside refundCredits; don't mask the original failure
  }
}

/* ── Background workers ────────────────────────────────────────────── */

export async function runMasterJob(
  job: MixMasterJob,
  inputPath: string,
  referencePath: string | null,
): Promise<void> {
  const workDir = join(tmpdir(), `mixmaster-${job.id}`);
  const wavPath = join(workDir, "mastered.wav");
  const mp3Path = join(workDir, "mastered.mp3");
  try {
    job.status = "processing";
    await fs.mkdir(workDir, { recursive: true });

    const target = await resolveTargetFromReference(referencePath, job.loudness);
    job.targetLufs = target.targetLufs;
    job.targetTruePeak = target.targetTruePeak;
    job.referenceLufs = target.referenceLufs;

    const measurement = await measureMaster(inputPath, job.genre, job.intensity);
    job.inputLufs = measurement.inputIntegrated;
    job.inputTruePeak = measurement.inputTruePeak;
    job.inputLra = measurement.inputLra;

    const fullChain = `${buildMasterPreChain(job.genre, job.intensity)},${buildLoudnormRender(
      target.targetLufs, target.targetTruePeak, target.targetLra, measurement,
    )}`;
    await renderMasterOutputs(inputPath, wavPath, mp3Path, fullChain);

    const outMeasure = await measureFile(wavPath);
    job.outputLufs = outMeasure?.inputIntegrated ?? null;
    job.outputTruePeak = outMeasure?.inputTruePeak ?? null;

    const stamp = `${job.userId}/${Date.now()}-${job.id}`;
    const [wavBuffer, mp3Buffer] = await Promise.all([fs.readFile(wavPath), fs.readFile(mp3Path)]);
    const wavRef = await uploadMediaToSupabaseStorage(`mix-master/${stamp}.wav`, wavBuffer, "audio/wav");
    const mp3Ref = await uploadMediaToSupabaseStorage(`mix-master/${stamp}.mp3`, mp3Buffer, "audio/mpeg");
    job.wavUrl = await refreshSupabaseStorageUrl(wavRef);
    job.mp3Url = await refreshSupabaseStorageUrl(mp3Ref);
    job.status = "done";
  } catch (err) {
    await refundJob(job, err);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fs.unlink(inputPath).catch(() => {});
    if (referencePath) await fs.unlink(referencePath).catch(() => {});
  }
}

export async function runMixJob(
  job: MixMasterJob,
  stemPaths: string[],
  referencePath: string | null,
  vocalLevelDb: number,
): Promise<void> {
  const workDir = join(tmpdir(), `mixmaster-${job.id}`);
  const wavPath = join(workDir, "mixed-mastered.wav");
  const mp3Path = join(workDir, "mixed-mastered.mp3");
  try {
    job.status = "processing";
    await fs.mkdir(workDir, { recursive: true });

    const target = await resolveTargetFromReference(referencePath, job.loudness);
    job.targetLufs = target.targetLufs;
    job.targetTruePeak = target.targetTruePeak;
    job.referenceLufs = target.referenceLufs;

    const measurement = await measureMix(stemPaths, job.stemTypes, job.genre, job.intensity, vocalLevelDb);
    job.inputLufs = measurement.inputIntegrated;
    job.inputTruePeak = measurement.inputTruePeak;
    job.inputLra = measurement.inputLra;

    const renderTail = buildLoudnormRender(
      target.targetLufs, target.targetTruePeak, target.targetLra, measurement,
    );
    await renderMixOutputs(stemPaths, job.stemTypes, job.genre, job.intensity, vocalLevelDb, renderTail, wavPath, mp3Path);

    const outMeasure = await measureFile(wavPath);
    job.outputLufs = outMeasure?.inputIntegrated ?? null;
    job.outputTruePeak = outMeasure?.inputTruePeak ?? null;

    const stamp = `${job.userId}/${Date.now()}-${job.id}`;
    const [wavBuffer, mp3Buffer] = await Promise.all([fs.readFile(wavPath), fs.readFile(mp3Path)]);
    const wavRef = await uploadMediaToSupabaseStorage(`mix-master/${stamp}.wav`, wavBuffer, "audio/wav");
    const mp3Ref = await uploadMediaToSupabaseStorage(`mix-master/${stamp}.mp3`, mp3Buffer, "audio/mpeg");
    job.wavUrl = await refreshSupabaseStorageUrl(wavRef);
    job.mp3Url = await refreshSupabaseStorageUrl(mp3Ref);
    job.status = "done";
  } catch (err) {
    await refundJob(job, err);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    for (const p of stemPaths) await fs.unlink(p).catch(() => {});
    if (referencePath) await fs.unlink(referencePath).catch(() => {});
  }
}

/* ── Shared request helpers ────────────────────────────────────────── */

function parseCommonFields(req: Request): {
  genre: MixMasterGenre;
  intensity: MixMasterIntensity;
  loudness: MixMasterLoudness;
  vocalLevelDb: number;
} | { error: string } {
  const genre = resolveGenre(req.body?.genre);
  if (!genre) return { error: "Genre must be one of: " + Object.keys(GENRE_PRESETS).join(", ") + "." };
  const intensity = resolveIntensity(req.body?.intensity) ?? "balanced";
  const loudness = resolveLoudness(req.body?.loudness) ?? "streaming";
  const rawVocal = Number(req.body?.vocalLevelDb);
  const vocalLevelDb = Number.isFinite(rawVocal) ? Math.min(4, Math.max(-6, rawVocal)) : 0;
  return { genre, intensity, loudness, vocalLevelDb };
}

async function chargeOr402(
  req: Request,
  res: Response,
  cost: number,
  action: string,
): Promise<number | null> {
  const balance = req.userCredits ?? 0;
  if (balance < cost) {
    res.status(402).json({
      error: "out_of_credits",
      message: `You need ${cost} credits for this — top up to continue.`,
    });
    return null;
  }
  try {
    return await chargeCredits(req.userId!, cost, { action });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up to continue." });
      return null;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "Could not record the credit charge. Please try again." });
      return null;
    }
    throw err;
  }
}

function cleanupUploads(files: Express.Multer.File[] | undefined): void {
  for (const f of files ?? []) fs.unlink(f.path).catch(() => {});
}

function jobResponse(job: MixMasterJob) {
  return {
    jobId: job.id,
    status: job.status,
    kind: job.kind,
    genre: job.genre,
    intensity: job.intensity,
    sourceName: job.sourceName,
    stemNames: job.stemNames,
    stemTypes: job.stemTypes,
    stats: {
      inputLufs: job.inputLufs,
      inputTruePeak: job.inputTruePeak,
      inputLra: job.inputLra,
      targetLufs: job.targetLufs,
      targetTruePeak: job.targetTruePeak,
      referenceLufs: job.referenceLufs,
      outputLufs: job.outputLufs,
      outputTruePeak: job.outputTruePeak,
    },
    wavUrl: job.wavUrl,
    mp3Url: job.mp3Url,
    error: job.error,
    creditsCharged: job.creditsCharged,
  };
}

/* ── Routes ────────────────────────────────────────────────────────── */

/**
 * POST /api/mix-master/master
 *
 * AI Master: single mixed stereo file in → radio-ready master out.
 * Real DSP: subsonic cleanup → glue compression → genre sweetening EQ →
 * stereo widening → two-pass EBU R128 loudness normalization with
 * true-peak limiting. Outputs 24-bit WAV + 320kbps MP3.
 * Optional reference track: its loudness becomes the target.
 *
 * Flow: upload + genre/intensity/loudness → charge 8 credits →
 * server-owned background job → poll GET /api/mix-master/job/:id.
 * Failed jobs are refunded automatically.
 */
router.post(
  "/api/mix-master/master",
  requireAuth,
  fieldsUpload([
    { name: "audio", maxCount: 1 },
    { name: "reference", maxCount: 1 },
  ]),
  async (req: Request, res: Response) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const audio = files?.["audio"]?.[0];
    const reference = files?.["reference"]?.[0] ?? null;

    const parsed = parseCommonFields(req);
    if ("error" in parsed) {
      cleanupUploads(files?.["audio"]);
      if (reference) cleanupUploads([reference]);
      res.status(400).json({ error: "INVALID_PARAMS", message: parsed.error });
      return;
    }
    if (!audio) {
      if (reference) cleanupUploads([reference]);
      res.status(400).json({ error: "No audio file provided" });
      return;
    }

    const creditsRemaining = await chargeOr402(
      req, res, MIX_MASTER_CREDIT_COST,
      `AI Master (${GENRE_PRESETS[parsed.genre].label})`,
    );
    if (creditsRemaining === null) {
      cleanupUploads(files?.["audio"]);
      if (reference) cleanupUploads([reference]);
      return;
    }

    const job: MixMasterJob = {
      id: randomUUID(),
      userId: req.userId!,
      kind: "master",
      status: "queued",
      genre: parsed.genre,
      intensity: parsed.intensity,
      loudness: parsed.loudness,
      sourceName: audio.originalname,
      stemNames: [],
      stemTypes: [],
      inputLufs: null,
      inputTruePeak: null,
      inputLra: null,
      targetLufs: LOUDNESS_TARGETS[parsed.loudness].targetLufs,
      targetTruePeak: LOUDNESS_TARGETS[parsed.loudness].targetTruePeak,
      referenceLufs: null,
      outputLufs: null,
      outputTruePeak: null,
      wavUrl: null,
      mp3Url: null,
      error: null,
      creditsCharged: MIX_MASTER_CREDIT_COST,
      createdAt: Date.now(),
    };
    jobs.set(job.id, job);

    // Server-owned: runs detached from the request/tab lifecycle.
    void runMasterJob(job, audio.path, reference ? reference.path : null);

    res.status(202).json({
      jobId: job.id,
      status: job.status,
      kind: job.kind,
      creditsCharged: MIX_MASTER_CREDIT_COST,
      creditsRemaining,
    });
  },
);

/**
 * POST /api/mix-master/mix
 *
 * AI Mix: up to 12 stems in → genre-aware mixdown → mastered out.
 * Stem types are auto-detected from filenames. Per-stem chain: gain
 * staging → high-pass (never on bass) → tone EQ → compression on
 * vocals/drums → small-room space on vocals → genre panning → amix bus →
 * the full master chain. Outputs 24-bit WAV + 320kbps MP3.
 *
 * Flow: upload stems + options → charge 15 credits → server-owned
 * background job → poll GET /api/mix-master/job/:id. Refund on failure.
 */
router.post(
  "/api/mix-master/mix",
  requireAuth,
  fieldsUpload([
    { name: "stems", maxCount: MAX_STEMS },
    { name: "reference", maxCount: 1 },
  ]),
  async (req: Request, res: Response) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const stems = files?.["stems"] ?? [];
    const reference = files?.["reference"]?.[0] ?? null;
    const fail = (status: number, body: object) => {
      cleanupUploads(stems);
      if (reference) cleanupUploads([reference]);
      res.status(status).json(body);
    };

    const parsed = parseCommonFields(req);
    if ("error" in parsed) {
      fail(400, { error: "INVALID_PARAMS", message: parsed.error });
      return;
    }
    if (stems.length === 0) {
      fail(400, { error: "Upload at least one stem to mix." });
      return;
    }
    if (stems.length > MAX_STEMS) {
      fail(400, { error: `Too many stems — the limit is ${MAX_STEMS}.` });
      return;
    }

    const stemTypes = stems.map((s) => detectStemType(s.originalname));

    const creditsRemaining = await chargeOr402(
      req, res, MIX_STEMS_CREDIT_COST,
      `AI Mix (${stems.length} stems, ${GENRE_PRESETS[parsed.genre].label})`,
    );
    if (creditsRemaining === null) {
      cleanupUploads(stems);
      if (reference) cleanupUploads([reference]);
      return;
    }

    const job: MixMasterJob = {
      id: randomUUID(),
      userId: req.userId!,
      kind: "mix",
      status: "queued",
      genre: parsed.genre,
      intensity: parsed.intensity,
      loudness: parsed.loudness,
      sourceName: `${stems.length} stems`,
      stemNames: stems.map((s) => s.originalname),
      stemTypes,
      inputLufs: null,
      inputTruePeak: null,
      inputLra: null,
      targetLufs: LOUDNESS_TARGETS[parsed.loudness].targetLufs,
      targetTruePeak: LOUDNESS_TARGETS[parsed.loudness].targetTruePeak,
      referenceLufs: null,
      outputLufs: null,
      outputTruePeak: null,
      wavUrl: null,
      mp3Url: null,
      error: null,
      creditsCharged: MIX_STEMS_CREDIT_COST,
      createdAt: Date.now(),
    };
    jobs.set(job.id, job);

    void runMixJob(job, stems.map((s) => s.path), reference ? reference.path : null, parsed.vocalLevelDb);

    res.status(202).json({
      jobId: job.id,
      status: job.status,
      kind: job.kind,
      stemTypes,
      creditsCharged: MIX_STEMS_CREDIT_COST,
      creditsRemaining,
    });
  },
);

/**
 * GET /api/mix-master/job/:id
 *
 * Poll job status. Returns the Master Report stats and download URLs
 * when done (reviewable output, never faked).
 */
router.get("/api/mix-master/job/:id", requireAuth, (req: Request, res: Response) => {
  const job = getMixMasterJob(req.params["id"] as string);
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(jobResponse(job));
});

export default router;
