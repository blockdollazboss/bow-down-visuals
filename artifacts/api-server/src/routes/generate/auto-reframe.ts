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

/* ─── Auto-reframe (CapCut parity) ───
   Smartly crops video to a target aspect ratio, keeping the action centered.
   Uses ffmpeg's crop with scene detection for v1.
   200 Visual Bucs per reframe. */

const REFRAME_COST = Number(process.env["REFRAME_CREDITS"]) || 200;

const reframeSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  aspect: z.enum(["16:9", "9:16", "1:1", "4:5"]),
});

const ASPECT_RATIOS: Record<string, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:5": 4 / 5,
};

/* Output canvas per requested aspect — the old code hardcoded 1080x1920
   for every ratio. Long side is 1920 for landscape, 1080-wide for the rest. */
const OUTPUT_SIZE: Record<string, [number, number]> = {
  "16:9": [1920, 1080],
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
};

router.post("/auto-reframe", requireAuth, async (req, res) => {
  const parsed = reframeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < REFRAME_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, REFRAME_COST, {
      action: "Auto Reframe",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "reframe-"));
  const inputPath = join(workDir, "input.mp4");
  const outputPath = join(workDir, "output.mp4");

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const targetRatio = ASPECT_RATIOS[parsed.data.aspect]!;
    const [outW, outH] = OUTPUT_SIZE[parsed.data.aspect]!;
    // Smart crop: keep center, crop to target aspect.
    // For 9:16 from 16:9, crop width; for 16:9 from 9:16, crop height.
    const cropFilter =
      `crop='if(gt(iw/ih,${targetRatio.toFixed(6)}),ih*${targetRatio.toFixed(6)},iw)':` +
      `'if(gt(iw/ih,${targetRatio.toFixed(6)}),ih,iw/${targetRatio.toFixed(6)})'`;

    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-vf", `${cropFilter},scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}`,
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      outputPath,
    ], { timeout: 300_000 });

    const buffer = await readFile(outputPath);
    const objectName = `reframe/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      aspect: parsed.data.aspect,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auto-reframe failed.";
    req.log.error({ err: message }, "[auto-reframe] failed");
    await refundCredits(req.userId!, REFRAME_COST, {
      action: "Auto Reframe — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
