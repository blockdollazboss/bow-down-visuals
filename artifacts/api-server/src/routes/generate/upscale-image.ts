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

export const UPSCALE_IMAGE_CREDIT_COST = 3;
const UPSCALE_IMAGE_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

export type ImageUpscaleFactor = "2x" | "4x";
const SCALE_FACTORS: Record<ImageUpscaleFactor, number> = {
  "2x": 2,
  "4x": 4,
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPSCALE_IMAGE_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

/* ── Pure, testable helpers ─────────────────────────────────────────── */

/**
 * Build the ffmpeg filter for CPU image upscaling.
 * Lanczos resampling raises the resolution; a light unsharp pass restores
 * a touch of perceived crispness. Like video upscaling this does NOT
 * invent detail — it cannot create information that wasn't in the source.
 */
export function buildImageScaleFilter(factor: number): string {
  return `scale=iw*${factor}:ih*${factor}:flags=lanczos,unsharp=5:5:0.5:5:5:0.0`;
}

export function buildImageFfmpegArgs(
  inputPath: string,
  outputPath: string,
  factor: number,
): string[] {
  return [
    "-y",
    "-i", inputPath,
    "-vf", buildImageScaleFilter(factor),
    outputPath,
  ];
}

/* ── Routes ─────────────────────────────────────────────────────────── */

/**
 * POST /api/upscale/image
 *
 * CPU-based image upscaling (ffmpeg Lanczos resampling to 2x or 4x),
 * delivered as PNG. This increases pixel dimensions — it does NOT add
 * detail that wasn't in the source, and the UI must never claim otherwise.
 *
 * Flow: upload image + scale (2x|4x) → charge 3 credits → process inline →
 * respond { status: "done", url, creditsRemaining }. Failed jobs are
 * refunded automatically (charged-but-failed paths hit the catch below).
 */
router.post("/api/upscale/image", requireAuth, upload.single("image"), async (req, res) => {
  const scale = (req.body?.scale as string) ?? "";
  if (scale !== "2x" && scale !== "4x") {
    res.status(400).json({ error: "INVALID_SCALE", message: "Scale must be '2x' or '4x'." });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No image file provided" });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < UPSCALE_IMAGE_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to upscale images.",
    });
    return;
  }

  let creditsRemaining = balance;
  let charged = false;
  try {
    creditsRemaining = await chargeCredits(req.userId!, UPSCALE_IMAGE_CREDIT_COST, {
      action: `Image Upscale (${scale})`,
    });
    charged = true;
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to upscale images.",
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "Could not record the credit charge. Please try again." });
      return;
    }
    throw err;
  }

  const factor = SCALE_FACTORS[scale as ImageUpscaleFactor];
  const workDir = await fs.mkdtemp(join(tmpdir(), "upscale-image-"));
  const jobId = randomUUID();
  const ext = (req.file.originalname.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const inputPath = join(workDir, `input.${ext}`);
  const outputPath = join(workDir, `upscaled-${scale}.png`);

  try {
    await fs.writeFile(inputPath, req.file.buffer);

    await execFileAsync("ffmpeg", buildImageFfmpegArgs(inputPath, outputPath, factor), {
      timeout: 300_000, // 5 min cap for CPU image upscale
    });

    const outBuffer = await fs.readFile(outputPath);
    const objectName = `upscaled-image/${req.userId!}/${Date.now()}-${jobId}.png`;
    const ref = await uploadMediaToSupabaseStorage(objectName, outBuffer, "image/png");
    const url = await refreshSupabaseStorageUrl(ref);

    res.json({
      status: "done",
      url,
      creditsRemaining,
    });
  } catch (err) {
    // Refund: the user paid for an output they didn't get.
    if (charged) {
      try {
        await refundCredits(req.userId!, UPSCALE_IMAGE_CREDIT_COST, {
          action: "Image Upscale — Refund (job failed)",
        });
      } catch (refundErr) {
        // Logged inside refundCredits; don't mask the original failure.
        void refundErr;
      }
    }
    res.status(500).json({
      error: err instanceof Error ? err.message : "Image upscale failed",
      refunded: charged,
    });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

/** Turn multer upload errors into clean JSON the frontend can display. */
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "FILE_TOO_LARGE",
        message: "This image exceeds the 25 MB upload limit. Please use a smaller file.",
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
