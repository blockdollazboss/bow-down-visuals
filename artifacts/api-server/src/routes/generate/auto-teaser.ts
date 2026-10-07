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

/* ─── Auto-teaser (auto mode) ───
   Analyzes a video to find the most energetic 15-second segment
   (loudest audio = most exciting moment) and extracts it as a teaser.
   200 Visual Bucs. */

const TEASER_COST = Number(process.env["TEASER_CREDITS"]) || 200;
const TEASER_DURATION = 15;

const teaserSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
});

async function findEnergeticSegment(videoPath: string): Promise<number> {
  // Get video duration
  const { stdout: durOut } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", videoPath,
  ], { timeout: 30_000 });
  const duration = parseFloat(durOut.trim());
  if (!Number.isFinite(duration) || duration <= TEASER_DURATION) return 0;

  // Analyze audio volume in 5-second windows to find the loudest segment
  // Use astats to get RMS level per window
  const windowSec = 5;
  const numWindows = Math.floor(duration / windowSec);
  let maxEnergy = -Infinity;
  let bestStart = 0;

  for (let w = 0; w < numWindows; w++) {
    const start = w * windowSec;
    try {
      const { stdout } = await execFileAsync("ffmpeg", [
        "-ss", start.toFixed(1), "-t", windowSec.toFixed(1),
        "-i", videoPath,
        "-af", "astats=metadata=1:reset=1",
        "-f", "null", "-",
      ], { timeout: 30_000 });
      // Parse RMS level from astats
      const rmsMatch = /RMS level dB:\s*(-?\d+\.?\d*)/.exec(stdout);
      if (rmsMatch) {
        const rms = parseFloat(rmsMatch[1]!);
        if (rms > maxEnergy) {
          maxEnergy = rms;
          bestStart = start;
        }
      }
    } catch {
      // Skip failed window
    }
  }

  // Center the 15s teaser on the most energetic window
  const teaserStart = Math.max(0, Math.min(duration - TEASER_DURATION, bestStart - (TEASER_DURATION - windowSec) / 2));
  return Math.round(teaserStart * 10) / 10;
}

router.post("/auto-teaser", requireAuth, async (req, res) => {
  const parsed = teaserSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < TEASER_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, TEASER_COST, {
      action: "Auto Teaser",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "teaser-"));
  const inputPath = join(workDir, "input.mp4");
  const outputPath = join(workDir, "teaser.mp4");

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const startTime = await findEnergeticSegment(inputPath);
    req.log.info({ startTime }, "[auto-teaser] found energetic segment");

    await execFileAsync("ffmpeg", [
      "-y", "-ss", startTime.toFixed(1), "-i", inputPath,
      "-t", TEASER_DURATION.toFixed(0),
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      outputPath,
    ], { timeout: 300_000 });

    const buffer = await readFile(outputPath);
    const objectName = `teaser/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      startTime,
      duration: TEASER_DURATION,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auto-teaser failed.";
    req.log.error({ err: message }, "[auto-teaser] failed");
    await refundCredits(req.userId!, TEASER_COST, {
      action: "Auto Teaser — Refund",
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
