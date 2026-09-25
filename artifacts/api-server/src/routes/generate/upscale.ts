import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

export const UPSCALE_CREDIT_COST = 3;
const UPSCALE_MAX_BYTES = 80 * 1024 * 1024; // 80 MB, same guard as clip uploads

export type UpscaleTarget = "1080p" | "4k";
const TARGET_HEIGHTS: Record<UpscaleTarget, number> = {
  "1080p": 1080,
  "4k": 2160,
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPSCALE_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
    }
  },
});

/* ── Pure, testable helpers ─────────────────────────────────────────── */

/**
 * Build the ffmpeg scale filter for CPU upscaling.
 * Uses Lanczos (high-quality resampling) and preserves aspect ratio:
 * height is set to the target, width is computed automatically (-2 keeps
 * it even, which H.264 requires). Never stretches the image.
 */
export function buildScaleFilter(targetHeight: number): string {
  return `scale=-2:${targetHeight}:flags=lanczos`;
}

/**
 * Decide whether upscaling makes sense. Returns null when the source
 * already meets or exceeds the target (upscaling would add nothing),
 * otherwise returns the target height to scale to.
 */
export function resolveUpscaleTarget(
  sourceHeight: number | null,
  target: UpscaleTarget,
): number | null {
  const targetHeight = TARGET_HEIGHTS[target];
  if (sourceHeight == null || sourceHeight <= 0) return targetHeight; // unknown: attempt it
  if (sourceHeight >= targetHeight) return null; // already at/above target
  return targetHeight;
}

export function buildFfmpegArgs(inputPath: string, outputPath: string, targetHeight: number): string[] {
  return [
    "-y",
    "-i", inputPath,
    "-vf", buildScaleFilter(targetHeight),
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    outputPath,
  ];
}

/* ── Server-owned background jobs (in-memory; not tab-dependent) ───── */

export type UpscaleJobStatus = "queued" | "processing" | "done" | "failed";

export interface UpscaleJob {
  id: string;
  userId: string;
  status: UpscaleJobStatus;
  target: UpscaleTarget;
  sourceName: string;
  outputUrl: string | null;
  outputRef: string | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
}

const jobs = new Map<string, UpscaleJob>();

export function getUpscaleJob(id: string): UpscaleJob | undefined {
  return jobs.get(id);
}

/** Test hook: clear the in-memory job store. */
export function __clearUpscaleJobs(): void {
  jobs.clear();
}

/* ── ffprobe: read source resolution before deciding ────────────────── */

async function probeVideoHeight(inputPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=height",
      "-of", "csv=p=0",
      inputPath,
    ], { timeout: 30_000 });
    const h = parseInt(stdout.trim(), 10);
    return Number.isFinite(h) && h > 0 ? h : null;
  } catch {
    return null;
  }
}

/* ── Background worker ──────────────────────────────────────────────── */

/** Exported for tests. */
export async function runUpscaleJob(job: UpscaleJob, inputBuffer: Buffer, originalName: string): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "upscale-"));
  const ext = (originalName.split(".").pop() ?? "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const inputPath = join(workDir, `input.${ext}`);
  const outputPath = join(workDir, `upscaled-${job.target}.mp4`);

  try {
    job.status = "processing";
    await fs.writeFile(inputPath, inputBuffer);

    // Honest gate: don't "upscale" a video that's already at/above target.
    const sourceHeight = await probeVideoHeight(inputPath);
    const targetHeight = resolveUpscaleTarget(sourceHeight, job.target);
    if (targetHeight == null) {
      throw new Error(
        `This video is already ${sourceHeight}p — upscaling to ${job.target} would not improve it. No point spending credits on that.`,
      );
    }

    await execFileAsync("ffmpeg", buildFfmpegArgs(inputPath, outputPath, targetHeight), {
      timeout: 600_000, // 10 min cap for CPU upscale
    });

    const outBuffer = await fs.readFile(outputPath);
    const objectName = `upscaled/${job.userId}/${Date.now()}-${job.id}.mp4`;
    const ref = await uploadMediaToSupabaseStorage(objectName, outBuffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(ref);

    job.status = "done";
    job.outputUrl = url;
    job.outputRef = ref;
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Upscale failed";
    // Refund: the user paid for an output they didn't get.
    try {
      await refundCredits(job.userId, job.creditsCharged, {
        action: "Video Upscale — Refund (job failed)",
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
 * POST /api/upscale
 *
 * CPU-based video upscaling (ffmpeg Lanczos resampling). This increases the
 * output resolution while preserving aspect ratio — it does NOT add detail
 * that wasn't in the source, and the UI must never claim otherwise.
 *
 * Flow: upload video + target (1080p|4k) → charge 3 credits → server-owned
 * background job → poll GET /api/upscale/:jobId → download/stream result.
 * Failed jobs are refunded automatically.
 */
router.post("/api/upscale", requireAuth, upload.single("video"), async (req, res) => {
  const target = (req.body?.target as string) ?? "";
  if (target !== "1080p" && target !== "4k") {
    res.status(400).json({ error: "INVALID_TARGET", message: "Target must be '1080p' or '4k'." });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No video file provided" });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < UPSCALE_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to upscale videos.",
    });
    return;
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, UPSCALE_CREDIT_COST, {
      action: `Video Upscale (${target})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to upscale videos.",
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "Could not record the credit charge. Please try again." });
      return;
    }
    throw err;
  }

  const job: UpscaleJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    target: target as UpscaleTarget,
    sourceName: req.file.originalname,
    outputUrl: null,
    outputRef: null,
    error: null,
    creditsCharged: UPSCALE_CREDIT_COST,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  // Server-owned: runs detached from the request/tab lifecycle.
  void runUpscaleJob(job, req.file.buffer, req.file.originalname);

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    target: job.target,
    creditsCharged: UPSCALE_CREDIT_COST,
    creditsRemaining,
  });
});

/**
 * GET /api/upscale/:jobId
 *
 * Poll job status. Returns outputUrl when done (a signed, reviewable URL
 * for the upscaled video retained in Supabase storage).
 */
router.get("/api/upscale/:jobId", requireAuth, (req, res) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = jobs.get(jobId);
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    target: job.target,
    sourceName: job.sourceName,
    outputUrl: job.outputUrl,
    error: job.error,
    createdAt: job.createdAt,
  });
});

/** Turn multer upload errors into clean JSON the frontend can display. */
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "FILE_TOO_LARGE",
        message: "This video exceeds the 80 MB upload limit. Please use a smaller file.",
      });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof Error) {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
});

export default router;
