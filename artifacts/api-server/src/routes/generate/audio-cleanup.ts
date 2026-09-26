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

export const AUDIO_CLEANUP_CREDIT_COST = 3;
const AUDIO_CLEANUP_MAX_BYTES = 50 * 1024 * 1024; // 50 MB upload cap

export type AudioCleanupMode = "voice" | "music" | "denoise";
const MODES: AudioCleanupMode[] = ["voice", "music", "denoise"];

const MODE_LABELS: Record<AudioCleanupMode, string> = {
  voice: "Voice Isolation",
  music: "Music Cleanup",
  denoise: "Full Denoise",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AUDIO_CLEANUP_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed (MP3, WAV, M4A)"));
    }
  },
});

/* ── Pure, testable helpers ─────────────────────────────────────────── */

/**
 * Build the ffmpeg audio filter chain for a cleanup mode.
 *
 * All modes use afftdn (FFT-based spectral denoiser, zero extra
 * dependencies) with mode-appropriate aggression, plus a high-pass to
 * kill rumble that denoisers leave behind. "denoise" adds anlmdn
 * (non-local means) for stubborn non-stationary noise and a light
 * dynamic normalizer to even out the result.
 *
 * This is real DSP denoising — it removes noise energy that exists in
 * the recording. It cannot recover signal buried under loud noise, and
 * aggressive settings can introduce light artifacts. The UI copy must
 * never promise "studio quality" from a noisy phone recording.
 */
export function buildDenoiseFilter(mode: AudioCleanupMode): string {
  switch (mode) {
    case "voice":
      // Podcasts / voiceovers / stream clips: kill rumble, moderate
      // spectral denoise tuned for speech, then even out levels.
      return "highpass=f=75,afftdn=nr=12:nf=-50,dynaudnorm=f=150:g=7";
    case "music":
      // Live recordings: gentle — preserve transients and crowd
      // energy while pulling down venue hiss/hum.
      return "highpass=f=40,afftdn=nr=8:nf=-40";
    case "denoise":
      // Maximum suppression: aggressive spectral denoise + non-local
      // means smoothing for non-stationary noise.
      return "highpass=f=80,afftdn=nr=25:nf=-60,anlmdn=s=7:p=0.002:r=0.002:m=11,dynaudnorm=f=150:g=7";
  }
}

export function buildFfmpegArgs(inputPath: string, filter: string, outputPath: string): string[] {
  return [
    "-y",
    "-i", inputPath,
    "-af", filter,
    "-codec:a", "libmp3lame",
    "-b:a", "192k",
    "-ar", "44100",
    outputPath,
  ];
}

/**
 * Estimate noise reduction in dB from the energy removed by denoising.
 *
 * removedFraction = 1 - 10^((rmsAfter - rmsBefore)/10)
 * reductionDb     = 10 * log10(removedFraction)
 *
 * This measures energy that the denoiser took out of the signal —
 * overwhelmingly background noise for speech/music recordings. It is
 * an estimate, not a lab measurement, and the UI must label it as one.
 * Returns null when the measurement is not meaningful.
 */
export function estimateNoiseReductionDb(rmsBeforeDb: number, rmsAfterDb: number): number | null {
  if (!Number.isFinite(rmsBeforeDb) || !Number.isFinite(rmsAfterDb)) return null;
  const removedFraction = 1 - Math.pow(10, (rmsAfterDb - rmsBeforeDb) / 10);
  if (removedFraction <= 0 || removedFraction >= 1) return null;
  const db = 10 * Math.log10(removedFraction);
  if (!Number.isFinite(db) || db >= 0) return null;
  return Math.round(Math.abs(db) * 10) / 10;
}

export function parseRmsLevelDb(ffmpegStderr: string): number | null {
  const match = ffmpegStderr.match(/RMS level dB:\s*(-?[\d.]+)/);
  if (!match) return null;
  const v = parseFloat(match[1]);
  return Number.isFinite(v) ? v : null;
}

/* ── Server-owned background jobs (in-memory; not tab-dependent) ───── */

export type AudioCleanupJobStatus = "queued" | "processing" | "done" | "failed";

export interface AudioCleanupJob {
  id: string;
  userId: string;
  status: AudioCleanupJobStatus;
  mode: AudioCleanupMode;
  sourceName: string;
  outputUrl: string | null;
  outputRef: string | null;
  noiseReductionDb: number | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
}

const jobs = new Map<string, AudioCleanupJob>();

export function getAudioCleanupJob(id: string): AudioCleanupJob | undefined {
  return jobs.get(id);
}

/** Test hook: clear the in-memory job store. */
export function __clearAudioCleanupJobs(): void {
  jobs.clear();
}

async function measureRmsDb(filePath: string): Promise<number | null> {
  try {
    const { stderr } = await execFileAsync(
      "ffmpeg",
      ["-hide_banner", "-i", filePath, "-af", "astats=metadata=1:reset=0", "-f", "null", "-"],
      { timeout: 60_000 },
    );
    return parseRmsLevelDb(stderr);
  } catch {
    return null;
  }
}

/** Exported for tests. */
export async function runAudioCleanupJob(
  job: AudioCleanupJob,
  inputBuffer: Buffer,
  originalName: string,
): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "audio-cleanup-"));
  const ext = (originalName.split(".").pop() ?? "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
  const inputPath = join(workDir, `input.${ext}`);
  const outputPath = join(workDir, `cleaned.mp3`);

  try {
    job.status = "processing";
    await fs.writeFile(inputPath, inputBuffer);

    // Baseline loudness for the noise-reduction estimate.
    const rmsBefore = await measureRmsDb(inputPath);

    const filter = buildDenoiseFilter(job.mode);
    await execFileAsync("ffmpeg", buildFfmpegArgs(inputPath, filter, outputPath), {
      timeout: 600_000, // 10 min cap
    });

    const rmsAfter = await measureRmsDb(outputPath);
    job.noiseReductionDb =
      rmsBefore != null && rmsAfter != null ? estimateNoiseReductionDb(rmsBefore, rmsAfter) : null;

    const outBuffer = await fs.readFile(outputPath);
    const objectName = `audio-cleanup/${job.userId}/${Date.now()}-${job.id}.mp3`;
    const ref = await uploadMediaToSupabaseStorage(objectName, outBuffer, "audio/mpeg");
    const url = await refreshSupabaseStorageUrl(ref);

    job.status = "done";
    job.outputUrl = url;
    job.outputRef = ref;
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Audio cleanup failed";
    // Refund: the user paid for an output they didn't get.
    try {
      await refundCredits(job.userId, job.creditsCharged, {
        action: "Audio Cleanup — Refund (job failed)",
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
 * POST /api/audio-cleanup
 *
 * Server-side background-noise removal for creator audio (podcasts,
 * voiceovers, stream clips, live recordings). Real DSP via ffmpeg
 * (afftdn spectral denoising + mode-specific chains) — no fake
 * processing, no new ML dependencies.
 *
 * Flow: upload audio + mode → charge 3 credits → server-owned
 * background job → poll GET /api/audio-cleanup/:jobId → download
 * result. Failed jobs are refunded automatically.
 */
router.post("/api/audio-cleanup", requireAuth, upload.single("audio"), async (req: Request, res: Response) => {
  const mode = (req.body?.mode as string) ?? "";
  if (!(MODES as string[]).includes(mode)) {
    res.status(400).json({
      error: "INVALID_MODE",
      message: "Mode must be one of: voice, music, denoise.",
    });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No audio file provided" });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < AUDIO_CLEANUP_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to clean up audio.",
    });
    return;
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, AUDIO_CLEANUP_CREDIT_COST, {
      action: `Audio Cleanup (${MODE_LABELS[mode as AudioCleanupMode]})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to clean up audio.",
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "Could not record the credit charge. Please try again." });
      return;
    }
    throw err;
  }

  const job: AudioCleanupJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    mode: mode as AudioCleanupMode,
    sourceName: req.file.originalname,
    outputUrl: null,
    outputRef: null,
    noiseReductionDb: null,
    error: null,
    creditsCharged: AUDIO_CLEANUP_CREDIT_COST,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  // Server-owned: runs detached from the request/tab lifecycle.
  void runAudioCleanupJob(job, req.file.buffer, req.file.originalname);

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    mode: job.mode,
    creditsCharged: AUDIO_CLEANUP_CREDIT_COST,
    creditsRemaining,
  });
});

/**
 * GET /api/audio-cleanup/:jobId
 *
 * Poll job status. Returns outputUrl + noiseReductionDb when done
 * (a signed, reviewable URL for the cleaned audio retained in
 * Supabase storage).
 */
router.get("/api/audio-cleanup/:jobId", requireAuth, (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = jobs.get(jobId);
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    mode: job.mode,
    sourceName: job.sourceName,
    outputUrl: job.outputUrl,
    noiseReductionDb: job.noiseReductionDb,
    error: job.error,
    createdAt: job.createdAt,
  });
});

export default router;
