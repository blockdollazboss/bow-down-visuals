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

export const WATERMARK_REMOVAL_CREDIT_COST = 2;
const MAX_BYTES = 80 * 1024 * 1024; // 80 MB, same guard as clip uploads

/**
 * Watermark region presets, expressed as percentages of the frame
 * (x, y = top-left corner; w, h = size). Converted to pixels after
 * ffprobe reports the actual video dimensions.
 */
export type WatermarkPreset = "bottom-right" | "bottom-left" | "top-right" | "top-left" | "custom";

export interface RegionPct { x: number; y: number; w: number; h: number; }

export const WATERMARK_PRESETS: Record<Exclude<WatermarkPreset, "custom">, RegionPct> = {
  "bottom-right": { x: 80, y: 85, w: 18, h: 12 },
  "bottom-left":  { x: 2,  y: 85, w: 18, h: 12 },
  "top-right":    { x: 80, y: 3,  w: 18, h: 12 },
  "top-left":     { x: 2,  y: 3,  w: 18, h: 12 },
};

/** Clamp a percentage to [0, 100]. */
export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/**
 * Resolve the watermark region from the request. Returns a sanitized
 * percentage region, or null when the input is invalid.
 */
export function resolveRegion(preset: string, custom: unknown): RegionPct | null {
  if (preset === "custom") {
    if (typeof custom !== "object" || custom === null) return null;
    const c = custom as Record<string, unknown>;
    const x = Number(c.x); const y = Number(c.y);
    const w = Number(c.w); const h = Number(c.h);
    if (![x, y, w, h].every(Number.isFinite)) return null;
    if (w <= 0 || h <= 0) return null;
    if (x < 0 || y < 0 || x + w > 100 || y + h > 100) return null;
    return { x: clampPct(x), y: clampPct(y), w: clampPct(w), h: clampPct(h) };
  }
  const p = WATERMARK_PRESETS[preset as Exclude<WatermarkPreset, "custom">];
  return p ? { ...p } : null;
}

/**
 * Build the ffmpeg delogo filter. Percentages are converted to integer
 * pixels from the probed frame dimensions. delogo interpolates the region
 * from surrounding pixels — effective on static corner watermarks, not on
 * moving or large complex ones.
 */
export function buildDelogoFilter(region: RegionPct, frameW: number, frameH: number): string {
  const x = Math.round((region.x / 100) * frameW);
  const y = Math.round((region.y / 100) * frameH);
  const w = Math.max(1, Math.round((region.w / 100) * frameW));
  const h = Math.max(1, Math.round((region.h / 100) * frameH));
  return `delogo=x=${x}:y=${y}:w=${w}:h=${h}:show=0`;
}

export function buildFfmpegArgs(inputPath: string, outputPath: string, filter: string): string[] {
  return [
    "-y",
    "-i", inputPath,
    "-vf", filter,
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    outputPath,
  ];
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
    }
  },
});

/* ── Server-owned background jobs (in-memory; not tab-dependent) ───── */

export type WatermarkJobStatus = "queued" | "processing" | "done" | "failed";

export interface WatermarkJob {
  id: string;
  userId: string;
  status: WatermarkJobStatus;
  preset: WatermarkPreset;
  region: RegionPct;
  sourceName: string;
  outputUrl: string | null;
  outputRef: string | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
}

const jobs = new Map<string, WatermarkJob>();

export function getWatermarkJob(id: string): WatermarkJob | undefined {
  return jobs.get(id);
}

/** Test hook: clear the in-memory job store. */
export function __clearWatermarkJobs(): void {
  jobs.clear();
}

/* ── ffprobe: read frame dimensions before computing pixel region ────── */

export interface FrameSize { width: number; height: number; }

async function probeFrameSize(inputPath: string): Promise<FrameSize | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0",
      inputPath,
    ], { timeout: 30_000 });
    const [w, h] = stdout.trim().split(",").map((s) => parseInt(s, 10));
    if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) return { width: w, height: h };
    return null;
  } catch {
    return null;
  }
}

/* ── Background worker ──────────────────────────────────────────────── */

/** Exported for tests. */
export async function runWatermarkJob(job: WatermarkJob, inputBuffer: Buffer, originalName: string): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "delogo-"));
  const ext = (originalName.split(".").pop() ?? "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const inputPath = join(workDir, `input.${ext}`);
  const outputPath = join(workDir, `clean-${job.id}.mp4`);

  try {
    job.status = "processing";
    await fs.writeFile(inputPath, inputBuffer);

    const size = await probeFrameSize(inputPath);
    if (!size) {
      throw new Error("Could not read this video's dimensions — the file may be corrupt.");
    }
    const filter = buildDelogoFilter(job.region, size.width, size.height);

    await execFileAsync("ffmpeg", buildFfmpegArgs(inputPath, outputPath, filter), {
      timeout: 600_000, // 10 min cap for CPU processing
    });

    const outBuffer = await fs.readFile(outputPath);
    const objectName = `delogo/${job.userId}/${Date.now()}-${job.id}.mp4`;
    const ref = await uploadMediaToSupabaseStorage(objectName, outBuffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(ref);

    job.status = "done";
    job.outputUrl = url;
    job.outputRef = ref;
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Watermark removal failed";
    // Refund: the user paid for an output they didn't get.
    try {
      await refundCredits(job.userId, job.creditsCharged, {
        action: "Watermark Removal — Refund (job failed)",
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
 * POST /api/watermark-removal
 *
 * Removes a static watermark/logo from the user's own video using the
 * ffmpeg delogo filter, which interpolates the region from surrounding
 * pixels. Honest framing (also in the UI): this works well on small,
 * static corner watermarks. It will NOT cleanly remove large, moving,
 * or semi-transparent animated watermarks — those smear instead.
 *
 * Flow: upload video + preset (or custom x/y/w/h percentages) →
 * charge 2 credits → server-owned background job →
 * poll GET /api/watermark-removal/:jobId → download/stream result.
 * Failed jobs are refunded automatically.
 */
router.post("/api/watermark-removal", requireAuth, upload.single("video"), async (req, res) => {
  let custom: unknown = null;
  if (typeof req.body?.custom === "string") {
    try { custom = JSON.parse(req.body.custom); } catch { custom = null; }
  }
  const preset = (req.body?.preset as string) ?? "";
  const region = resolveRegion(preset, custom);
  if (!region) {
    res.status(400).json({
      error: "INVALID_REGION",
      message: "Pick a watermark location preset, or provide a custom region (x, y, w, h as 0–100 percentages within the frame).",
    });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No video file provided" });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < WATERMARK_REMOVAL_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to remove watermarks.",
    });
    return;
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, WATERMARK_REMOVAL_CREDIT_COST, {
      action: `Watermark Removal (${preset === "custom" ? "custom region" : preset})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to remove watermarks.",
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "Could not record the credit charge. Please try again." });
      return;
    }
    throw err;
  }

  const job: WatermarkJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    preset: preset as WatermarkPreset,
    region,
    sourceName: req.file.originalname,
    outputUrl: null,
    outputRef: null,
    error: null,
    creditsCharged: WATERMARK_REMOVAL_CREDIT_COST,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  // Server-owned: runs detached from the request/tab lifecycle.
  void runWatermarkJob(job, req.file.buffer, req.file.originalname);

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    preset: job.preset,
    creditsCharged: WATERMARK_REMOVAL_CREDIT_COST,
    creditsRemaining,
  });
});

/**
 * GET /api/watermark-removal/:jobId
 *
 * Poll job status. Returns outputUrl when done (a signed, reviewable URL
 * for the cleaned video retained in Supabase storage).
 */
router.get("/api/watermark-removal/:jobId", requireAuth, (req, res) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = jobs.get(jobId);
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    preset: job.preset,
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
