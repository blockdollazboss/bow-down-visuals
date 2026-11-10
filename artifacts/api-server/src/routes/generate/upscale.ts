import { randomUUID, createHash } from "crypto";
import { execFile } from "child_process";
import { createReadStream, promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  LedgerWriteError,
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
} from "../../lib/credits";
import { findStoredGenerationResult } from "../../lib/generation-stored-results";
import { deterministicJobId, storeCompletedJobResult } from "./ca6-replay-guard";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";
import { attachJobMapTtl } from "../../lib/job-map-sweeper";
import { DurableJobStore } from "../../lib/durable-job-store";
import { tmpUploadStorage, createAdminAwareUpload } from "../../lib/upload-storage";

const router = Router();
const execFileAsync = promisify(execFile);

export const UPSCALE_CREDIT_COST = 300;
const UPSCALE_MAX_BYTES = 80 * 1024 * 1024; // 80 MB, same guard as clip uploads

type UpscaleTarget = "1080p" | "4k";
const TARGET_HEIGHTS: Record<UpscaleTarget, number> = {
  "1080p": 1080,
  "4k": 2160,
};

/* ── Request body validation (multipart: fields arrive as strings) ───── */

const upscaleSchema = z.object({
  target: z.enum(["1080p", "4k"]).optional(),
});

const upload = createAdminAwareUpload({
  storage: tmpUploadStorage,
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

type UpscaleJobStatus = "queued" | "processing" | "done" | "failed";

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
  /* CA-6: the charge's idempotency key + the create-time balance, so
     the async runner can void on refund and the create body can be
     stored/replayed verbatim. */
  idempotencyKey?: string;
  creditsRemaining?: number;
  /** Durable jobs (0335): the exactly-once refund claim — claimed in
   *  the persisted row before any refund moves. */
  creditsRefunded?: boolean;
  /** Durable jobs (0335): the worker's inputs, persisted with the job
   *  so a worker resumed after a restart re-runs the exact ask. The
   *  upload is disk-backed; if the file did not survive, the job
   *  settles (failed + refunded exactly once). */
  workerInput?: { uploadedPath: string; originalName: string };
}

const jobs = new Map<string, UpscaleJob>();
attachJobMapTtl(jobs); // 2026-10-12 OOM fix: TTL eviction (lib/job-map-sweeper)

/* ── Durable job storage (migration 0335) ─────────────────────────
   The Map above is the working cache; generation_jobs is the
   record. Jobs persist at creation, mirror on settle, and a lookup
   that misses the Map rehydrates from the table — a job survives
   a server restart: its worker resumes from the persisted upload
   path when the file survived, and settles (failed + refunded
   exactly once, claim first) when it did not. Fail-open throughout
   (lib/generation-jobs). */
const jobStore = new DurableJobStore<UpscaleJob>(jobs, {
  rail: "upscale",
  statusOf: (j) => j.status,
  isTerminalStatus: (s) => s === "done" || s === "failed",
  setFailed: (j, error) => {
    j.status = "failed";
    j.error = error;
  },
  amountOf: (j) => j.creditsCharged,
  chargeKeyOf: (j) => j.idempotencyKey ?? null,
  refundAction: "Video Upscale — Refund (job failed)",
  settleError: "Upscale was interrupted by a server restart — your Visual Bucs were refunded.",
  resume: async (job) => {
    const input = job.workerInput;
    if (!input) return false;
    const survived = await fs.access(input.uploadedPath).then(
      () => true,
      () => false,
    );
    if (!survived) return false;
    void runUpscaleJob(job, input.uploadedPath, input.originalName);
    return true;
  },
});

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
export async function runUpscaleJob(job: UpscaleJob, uploadedPath: string, originalName: string): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "upscale-"));
  const ext = (originalName.split(".").pop() ?? "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const inputPath = join(workDir, `input.${ext}`);
  const outputPath = join(workDir, `upscaled-${job.target}.mp4`);

  try {
    job.status = "processing";
    await fs.copyFile(uploadedPath, inputPath); // 2026-10-12 OOM fix: upload is disk-backed, never a RAM Buffer

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
    /* CA-6: the job landed — persist the create body durably so a
       replayed create after a restart is served from the store,
       never re-charged or re-run. Fail-open. */
    if (job.idempotencyKey) {
      await storeCompletedJobResult("upscale", job.idempotencyKey, job.userId, {
        jobId: job.id,
        status: "queued",
        target: job.target,
        creditsCharged: job.creditsCharged,
        creditsRemaining: job.creditsRemaining,
      });
    }
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Upscale failed";
    /* Durable (0335): claim the refund BEFORE it moves — a job whose
       refund already landed never refunds twice. */
    const claimed = await jobStore.claimRefund(job);
    if (claimed) {
      // Refund: the user paid for an output they didn't get.
      let refunded = true;
      try {
        await refundCredits(job.userId, job.creditsCharged, {
          action: "Video Upscale — Refund (job failed)",
        });
      } catch (refundErr) {
        refunded = false;
        // Logged inside refundCredits; don't mask the original failure.
        void refundErr;
      }
      /* CA-6: a landed refund voids the key, so the retry re-charges. */
      if (refunded && job.idempotencyKey) {
        await voidChargeIdempotencyKey(job.idempotencyKey).catch(() => false);
        await storeCompletedJobResult("upscale", job.idempotencyKey, job.userId, null);
      }
    }
  } finally {
    void jobStore.sync(job); // durable: the settled state is the post-restart record
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fs.unlink(uploadedPath).catch(() => {});
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
router.post("/upscale", requireAuth, upload.single("video"), async (req, res) => {
  const parsed = upscaleSchema.safeParse(req.body ?? {});
  const target = parsed.success ? parsed.data.target : undefined;
  if (target !== "1080p" && target !== "4k") {
    res.status(400).json({ error: "INVALID_TARGET", message: "Target must be '1080p' or '4k'." });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No video file provided" });
    return;
  }

  /* CA-6 replay protection (charge audit B6, Pattern B): the intent
     is the uploaded video's bytes (streamed hash — the upload is
     disk-backed and never buffered whole) + the target ask. The job
     id is DETERMINISTIC from the server-derived charge key, so a
     replayed create finds the existing job instead of minting (and
     charging for) a second one; a durable stored result covers the
     after-restart case once the job has succeeded. A failed job's
     refund voids the key (in runUpscaleJob), so a genuine retry
     falls through and re-charges. Fresh responses are byte-identical. */
  const fileHash = await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(req.file!.path);
    stream.on("data", (chunk) => hash.update(chunk as Buffer));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
  const idempotencyKey = buildChargeIdempotencyKey("upscale", req.userId!, null, {
    target,
    fileHash,
  });
  const jobId = deterministicJobId(idempotencyKey);
  const createBodyOf = (j: UpscaleJob): Record<string, unknown> => ({
    jobId: j.id,
    status: j.status,
    target: j.target,
    creditsCharged: UPSCALE_CREDIT_COST,
    creditsRemaining: j.creditsRemaining,
  });
  const existing = await jobStore.find(jobId); // Map first, durable store on a miss (0335)
  if (existing && existing.userId === req.userId! && existing.status !== "failed") {
    res.status(202).json({ ...createBodyOf(existing), replayed: true });
    return;
  }
  const storedCreate = await findStoredGenerationResult("upscale", idempotencyKey, req.userId!);
  if (storedCreate) {
    res.status(202).json({ ...storedCreate, replayed: true });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < UPSCALE_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to upscale videos.",
    });
    return;
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, UPSCALE_CREDIT_COST, {
      action: `Video Upscale (${target})`,
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to upscale videos.",
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "Could not record the Visual Buc charge. Please try again." });
      return;
    }
    throw err;
  }

  /* A concurrent twin may have created the job while this charge was
     in flight — the ledger deduped the charge, so answer with the
     twin's job instead of starting a second ffmpeg run. */
  const twin = await jobStore.find(jobId); // Map first, durable store on a miss (0335)
  if (twin && twin.userId === req.userId! && twin.status !== "failed") {
    res.status(202).json({ ...createBodyOf(twin), replayed: true });
    return;
  }

  const job: UpscaleJob = {
    id: jobId,
    userId: req.userId!,
    status: "queued",
    target: target as UpscaleTarget,
    sourceName: req.file.originalname,
    outputUrl: null,
    outputRef: null,
    error: null,
    creditsCharged: UPSCALE_CREDIT_COST,
    createdAt: Date.now(),
    idempotencyKey,
    creditsRemaining,
    creditsRefunded: false,
    workerInput: { uploadedPath: req.file.path, originalName: req.file.originalname },
  };
  jobs.set(job.id, job);
  await jobStore.persist(job); // durable (0335): the row lands before the worker fires

  // Server-owned: runs detached from the request/tab lifecycle.
  void runUpscaleJob(job, req.file.path, req.file.originalname);

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
router.get("/upscale/:jobId", requireAuth, async (req, res) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = await jobStore.find(jobId); // Map first, durable store on a miss (0335)
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
