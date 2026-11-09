import { randomUUID, createHash } from "crypto";
import { execFile } from "child_process";
import { promises as fs } from "fs";
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
import { withReplayProtection, ReplayShortCircuit } from "./ca6-replay-guard";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

const UPSCALE_IMAGE_CREDIT_COST = 300;
const UPSCALE_IMAGE_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

type ImageUpscaleFactor = "2x" | "4x";
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

const upscaleImageSchema = z.object({
  scale: z.enum(["2x", "4x"]),
});

/* ── Pure, testable helpers ─────────────────────────────────────────── */

/**
 * Build the ffmpeg filter for CPU image upscaling.
 * Lanczos resampling raises the resolution; a light unsharp pass restores
 * a touch of perceived crispness. Like video upscaling this does NOT
 * invent detail — it cannot create information that wasn't in the source.
 */
function buildImageScaleFilter(factor: number): string {
  return `scale=iw*${factor}:ih*${factor}:flags=lanczos,unsharp=5:5:0.5:5:5:0.0`;
}

function buildImageFfmpegArgs(
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
router.post("/upscale/image", requireAuth, upload.single("image"), async (req, res) => {
  const parsed = upscaleImageSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { scale } = parsed.data;
  if (!req.file) {
    res.status(400).json({ error: "No image file provided" });
    return;
  }
  const file = req.file;

  /* CA-6 replay protection (charge audit B6): the intent is the
     uploaded image's bytes + the scale ask; the guard's stored-result
     pre-check runs before the balance gate and any funding. A failed
     upscale refunds as before and voids the key. */
  const idempotencyKey = buildChargeIdempotencyKey("upscale-image", req.userId!, null, {
    scale,
    fileHash: createHash("sha256").update(file.buffer).digest("hex"),
  });

  try {
    const outcome = await withReplayProtection("upscale-image", idempotencyKey, req.userId!, async () => {
  const balance = req.userCredits ?? 0;
  if (balance < UPSCALE_IMAGE_CREDIT_COST) {
    throw new ReplayShortCircuit(402, {
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to upscale images.",
    });
  }

  let creditsRemaining = balance;
  let charged = false;
  try {
    creditsRemaining = await chargeCredits(req.userId!, UPSCALE_IMAGE_CREDIT_COST, {
      action: `Image Upscale (${scale})`,
    }, { idempotencyKey });
    charged = true;
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      throw new ReplayShortCircuit(402, {
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to upscale images.",
      });
    }
    if (err instanceof LedgerWriteError) {
      throw new ReplayShortCircuit(500, { error: "Could not record the Visual Buc charge. Please try again." });
    }
    throw err;
  }

  const factor = SCALE_FACTORS[scale];
  const workDir = await fs.mkdtemp(join(tmpdir(), "upscale-image-"));
  const jobId = randomUUID();
  const ext = (file.originalname.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const inputPath = join(workDir, `input.${ext}`);
  const outputPath = join(workDir, `upscaled-${scale}.png`);

  try {
    await fs.writeFile(inputPath, file.buffer);

    await execFileAsync("ffmpeg", buildImageFfmpegArgs(inputPath, outputPath, factor), {
      timeout: 300_000, // 5 min cap for CPU image upscale
    });

    const outBuffer = await fs.readFile(outputPath);
    const objectName = `upscaled-image/${req.userId!}/${Date.now()}-${jobId}.png`;
    const ref = await uploadMediaToSupabaseStorage(objectName, outBuffer, "image/png");
    const url = await refreshSupabaseStorageUrl(ref);

    return {
      status: "done",
      url,
      creditsRemaining,
    };
  } catch (err) {
    // Refund: the user paid for an output they didn't get.
    let refundedFlag = false;
    if (charged) {
      try {
        await refundCredits(req.userId!, UPSCALE_IMAGE_CREDIT_COST, {
          action: "Image Upscale — Refund (job failed)",
        });
        refundedFlag = true;
      } catch (refundErr) {
        // Logged inside refundCredits; don't mask the original failure.
        void refundErr;
      }
    }
    /* CA-6: a landed refund voids the key, so the retry re-charges. */
    if (refundedFlag) {
      await voidChargeIdempotencyKey(idempotencyKey).catch(() => false);
    }
    /* Preserve the original failure body ({error, refunded}) verbatim. */
    throw new ReplayShortCircuit(500, {
      error: err instanceof Error ? err.message : "Image upscale failed",
      refunded: charged,
    });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
    });
    res.json(outcome.replayed ? { ...outcome.body, replayed: true } : outcome.body);
  } catch (err) {
    if (err instanceof ReplayShortCircuit) {
      res.status(err.status).json(err.body);
      return;
    }
    throw err;
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
