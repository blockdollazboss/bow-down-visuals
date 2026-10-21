import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── Video stabilization ───
   Applies ffmpeg vidstab in two passes (detect + transform) to smooth
   out shaky camera footage. 300 Visual Bucs. */

const STABILIZE_COST = Number(process.env["STABILIZE_CREDITS"]) || 300;

const stabilizeSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  /** Detection shakiness 1-10 (higher = handles more shake). */
  shakiness: z.number().int().min(1).max(10).optional().default(10),
  /** Smoothing strength 1-100 (higher = smoother, more crop). */
  smoothing: z.number().int().min(1).max(100).optional().default(30),
});

router.post("/stabilize", requireAuth, async (req, res) => {
  const parsed = stabilizeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < STABILIZE_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, STABILIZE_COST, {
      action: "Video Stabilization",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "stabilize-"));
  const inputPath = join(workDir, "input.mp4");
  const transformsPath = join(workDir, "transforms.trf");
  const outputPath = join(workDir, "output.mp4");

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const { shakiness, smoothing } = parsed.data;

    // Pass 1: detect camera motion
    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-vf", `vidstabdetect=shakiness=${shakiness}:accuracy=15:result=${transformsPath}`,
      "-f", "null", "-",
    ], { timeout: 300_000 });

    // Pass 2: apply stabilization transform
    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-vf", `vidstabtransform=smoothing=${smoothing}:input=${transformsPath}`,
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      outputPath,
    ], { timeout: 300_000 });

    const buffer = await readFile(outputPath);
    const objectName = `stabilize/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Video stabilization failed.";
    req.log.error({ err: message }, "[stabilize] failed");
    await refundCredits(req.userId!, STABILIZE_COST, {
      action: "Video Stabilization — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(transformsPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
