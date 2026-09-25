import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { Request, Response, Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

export const MASTERING_CREDIT_COST = 4;
const MASTERING_MAX_BYTES = 100 * 1024 * 1024; // 100 MB
const FFMPEG_TIMEOUT_MS = 600_000; // 10 min cap per pass

import {
  MASTERING_PRESETS,
  resolveMasteringPreset,
  buildPreChain,
  parseLoudnormJson,
  buildLoudnormSecondPass,
  buildFullChain,
  type MasteringPreset,
  type MasteringPresetDef,
  type LoudnormMeasurement,
} from "./mastering-chain";
export {
  MASTERING_PRESETS,
  resolveMasteringPreset,
  buildPreChain,
  parseLoudnormJson,
  buildLoudnormSecondPass,
  buildFullChain,
  type MasteringPreset,
  type MasteringPresetDef,
  type LoudnormMeasurement,
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MASTERING_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname || "").toLowerCase();
    const okMime = file.mimetype.startsWith("audio/");
    const okExt = /\.(wav|mp3|aiff|aif|flac|m4a|ogg)$/.test(name);
    if (okMime || okExt) cb(null, true);
    else cb(new Error("Only audio files (WAV, MP3, AIFF, FLAC, M4A, OGG) are allowed"));
  },
});

/* ── Server-owned background jobs (in-memory; not tab-dependent) ───── */

export type MasteringJobStatus = "queued" | "processing" | "done" | "failed";

export interface MasteringJob {
  id: string;
  userId: string;
  status: MasteringJobStatus;
  preset: MasteringPreset;
  sourceName: string;
  inputLufs: number | null;
  inputTruePeak: number | null;
  inputLra: number | null;
  targetLufs: number;
  targetTruePeak: number;
  outputLufs: number | null;
  wavUrl: string | null;
  wavRef: string | null;
  mp3Url: string | null;
  mp3Ref: string | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
}

const jobs = new Map<string, MasteringJob>();

export function getMasteringJob(id: string): MasteringJob | undefined {
  return jobs.get(id);
}

/** Test hook: clear the in-memory job store. */
export function __clearMasteringJobs(): void {
  jobs.clear();
}

/* ── ffmpeg passes ─────────────────────────────────────────────────── */

/** Pass 1: run the pre-chain + loudnorm in measure mode, parse the JSON. */
async function measureLoudness(inputPath: string, preset: MasteringPreset): Promise<LoudnormMeasurement> {
  const filter = `${buildPreChain(preset)},loudnorm=print_format=json`;
  // Note: the measure pass may exit 0 OR nonzero depending on ffmpeg build —
  // the JSON is on stderr either way, so read it from both outcomes.
  let stderr = "";
  try {
    const result = (await execFileAsync("ffmpeg", ["-hide_banner", "-i", inputPath, "-af", filter, "-f", "null", "-"], {
      timeout: FFMPEG_TIMEOUT_MS,
    })) as unknown as { stderr?: string };
    stderr = result?.stderr ?? "";
  } catch (err) {
    stderr = (err as { stderr?: string })?.stderr ?? "";
  }
  const m = parseLoudnormJson(stderr);
  if (!m) {
    throw new Error("Could not analyze the mix loudness — the file may be corrupt or silent.");
  }
  return m;
}

/** Pass 2: render one output with the full chain. */
async function renderMaster(
  inputPath: string,
  outputPath: string,
  fullChain: string,
  codecArgs: string[],
): Promise<void> {
  await execFileAsync(
    "ffmpeg",
    ["-hide_banner", "-y", "-i", inputPath, "-af", fullChain, "-ar", "48000", ...codecArgs, outputPath],
    { timeout: FFMPEG_TIMEOUT_MS },
  );
}

/** Best-effort: measure the rendered master's integrated loudness for the A/B stats. */
async function measureOutputLufs(outputPath: string): Promise<number | null> {
  let stderr = "";
  try {
    const result = (await execFileAsync(
      "ffmpeg",
      ["-hide_banner", "-i", outputPath, "-af", "loudnorm=print_format=json", "-f", "null", "-"],
      { timeout: FFMPEG_TIMEOUT_MS },
    )) as unknown as { stderr?: string };
    stderr = result?.stderr ?? "";
  } catch (err) {
    stderr = (err as { stderr?: string })?.stderr ?? "";
  }
  return parseLoudnormJson(stderr)?.inputIntegrated ?? null;
}

/* ── Background worker ──────────────────────────────────────────────── */

/** Exported for tests. */
export async function runMasteringJob(job: MasteringJob, inputBuffer: Buffer, originalName: string): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "mastering-"));
  const ext = (originalName.split(".").pop() ?? "wav").toLowerCase().replace(/[^a-z0-9]/g, "") || "wav";
  const inputPath = join(workDir, `input.${ext}`);
  const wavPath = join(workDir, `mastered-${job.preset}.wav`);
  const mp3Path = join(workDir, `mastered-${job.preset}.mp3`);

  try {
    job.status = "processing";
    await fs.writeFile(inputPath, inputBuffer);

    // Pass 1 — measure the processed mix.
    const measurement = await measureLoudness(inputPath, job.preset);
    job.inputLufs = measurement.inputIntegrated;
    job.inputTruePeak = measurement.inputTruePeak;
    job.inputLra = measurement.inputLra;

    // Pass 2 — render WAV (24-bit) + MP3 (320k) with the measured loudnorm.
    const fullChain = buildFullChain(job.preset, measurement);
    await renderMaster(inputPath, wavPath, fullChain, ["-c:a", "pcm_s24le"]);
    await renderMaster(inputPath, mp3Path, fullChain, ["-c:a", "libmp3lame", "-b:a", "320k"]);

    // Best-effort output loudness for the before/after stats.
    job.outputLufs = await measureOutputLufs(wavPath);

    const stamp = `${job.userId}/${Date.now()}-${job.id}`;
    const wavBuffer = await fs.readFile(wavPath);
    const mp3Buffer = await fs.readFile(mp3Path);
    const wavRef = await uploadMediaToSupabaseStorage(`mastered/${stamp}.wav`, wavBuffer, "audio/wav");
    const mp3Ref = await uploadMediaToSupabaseStorage(`mastered/${stamp}.mp3`, mp3Buffer, "audio/mpeg");
    job.wavUrl = await refreshSupabaseStorageUrl(wavRef);
    job.mp3Url = await refreshSupabaseStorageUrl(mp3Ref);
    job.wavRef = wavRef;
    job.mp3Ref = mp3Ref;

    job.status = "done";
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Mastering failed";
    // Refund: the user paid for a master they didn't get.
    try {
      await refundCredits(job.userId, job.creditsCharged, {
        action: "AI Mastering — Refund (job failed)",
      });
    } catch (refundErr) {
      // Logged inside refundCredits; don't mask the original failure.
      void refundErr;
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ── Routes ─────────────────────────────────────────────────────────── */

/**
 * POST /api/mastering
 *
 * Real DSP mastering chain (ffmpeg): subsonic cleanup → glue compression →
 * sweetening EQ → stereo widening → two-pass EBU R128 loudness normalization
 * with true-peak limiting. Outputs 24-bit WAV + 320kbps MP3.
 *
 * Flow: upload mix + preset → charge 4 credits → server-owned background
 * job → poll GET /api/mastering/:jobId → A/B + download. Failed jobs are
 * refunded automatically.
 */
router.post("/api/mastering", requireAuth, upload.single("audio"), async (req: Request, res: Response) => {
  const preset = resolveMasteringPreset(req.body?.preset);
  if (!preset) {
    res.status(400).json({
      error: "INVALID_PRESET",
      message: "Preset must be one of: streaming, club, radio, lofi.",
    });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No audio file provided" });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < MASTERING_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to master your track.",
    });
    return;
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, MASTERING_CREDIT_COST, {
      action: `AI Mastering (${MASTERING_PRESETS[preset].label})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to master your track.",
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "Could not record the credit charge. Please try again." });
      return;
    }
    throw err;
  }

  const job: MasteringJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    preset,
    sourceName: req.file.originalname,
    inputLufs: null,
    inputTruePeak: null,
    inputLra: null,
    targetLufs: MASTERING_PRESETS[preset].targetLufs,
    targetTruePeak: MASTERING_PRESETS[preset].targetTruePeak,
    outputLufs: null,
    wavUrl: null,
    wavRef: null,
    mp3Url: null,
    mp3Ref: null,
    error: null,
    creditsCharged: MASTERING_CREDIT_COST,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  // Server-owned: runs detached from the request/tab lifecycle.
  void runMasteringJob(job, req.file.buffer, req.file.originalname);

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    preset: job.preset,
    creditsCharged: MASTERING_CREDIT_COST,
    creditsRemaining,
  });
});

/**
 * GET /api/mastering/:jobId
 *
 * Poll job status. Returns the before/after loudness stats and download
 * URLs when done (reviewable output, never faked).
 */
router.get("/api/mastering/:jobId", requireAuth, (req: Request, res: Response) => {
  const job = getMasteringJob(req.params.jobId as string);
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    preset: job.preset,
    sourceName: job.sourceName,
    stats: {
      inputLufs: job.inputLufs,
      inputTruePeak: job.inputTruePeak,
      inputLra: job.inputLra,
      targetLufs: job.targetLufs,
      targetTruePeak: job.targetTruePeak,
      outputLufs: job.outputLufs,
    },
    wavUrl: job.wavUrl,
    mp3Url: job.mp3Url,
    error: job.error,
    creditsCharged: job.creditsCharged,
  });
});

export default router;
