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

/* ─── AI video GIF converter ───
   Converts a slice of a video into an optimized GIF using ffmpeg's
   two-pass palette generation (palettegen + paletteuse) for best quality.
   150 Visual Bucs. */

const GIF_COST = Number(process.env["GIF_CONVERTER_CREDITS"]) || 150;

const MAX_DURATION = 10; // seconds
const MAX_GIF_WIDTH = 480;
const GIF_FPS = 15;

const gifSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  startTime: z.number().min(0).max(36000).default(0),
  duration: z.number().min(0.5).max(MAX_DURATION).default(3),
});

router.post("/video-to-gif", requireAuth, async (req, res) => {
  const parsed = gifSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const { videoUrl, startTime, duration } = parsed.data;

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < GIF_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, GIF_COST, {
      action: "Video to GIF",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "gif-"));
  const inputPath = join(workDir, "input.mp4");
  const palettePath = join(workDir, "palette.png");
  const outputPath = join(workDir, "output.gif");

  try {
    // Download the source video
    const vidRes = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const filters = `fps=${GIF_FPS},scale=${MAX_GIF_WIDTH}:-1:flags=lanczos`;

    // Pass 1: generate palette from the selected segment
    await execFileAsync("ffmpeg", [
      "-y",
      "-ss", String(startTime),
      "-t", String(duration),
      "-i", inputPath,
      "-vf", `${filters},palettegen=max_colors=256`,
      palettePath,
    ], { timeout: 180_000 });

    // Pass 2: render the GIF using the palette
    await execFileAsync("ffmpeg", [
      "-y",
      "-ss", String(startTime),
      "-t", String(duration),
      "-i", inputPath,
      "-i", palettePath,
      "-lavfi", `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
      outputPath,
    ], { timeout: 180_000 });

    const buffer = await readFile(outputPath);
    const objectName = `gif/${req.userId}/${randomUUID()}.gif`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "image/gif");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      startTime,
      duration,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "GIF conversion failed.";
    req.log.error({ err: message }, "[gif-converter] failed");
    await refundCredits(req.userId!, GIF_COST, {
      action: "Video to GIF — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(palettePath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
