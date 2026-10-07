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

/* ─── AI video thumbnail extractor ───
   Extracts evenly-spaced frames from a video as thumbnail images.
   100 Visual Bucs. */

const THUMB_EXTRACT_COST = Number(process.env["THUMB_EXTRACT_CREDITS"]) || 100;

const extractSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  count: z.number().int().min(1).max(10).default(5),
});

async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ],
    { timeout: 30_000 },
  );
  const d = Number(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error("Could not determine video duration.");
  return d;
}

router.post("/extract-thumbnails", requireAuth, async (req, res) => {
  const parsed = extractSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const { videoUrl, count } = parsed.data;

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < THUMB_EXTRACT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, THUMB_EXTRACT_COST, {
      action: "Thumbnail Extractor",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "thumb-extract-"));
  const inputPath = join(workDir, "input.mp4");
  const jobId = randomUUID();

  try {
    // Download the video
    const vidRes = await fetch(videoUrl, { signal: AbortSignal.timeout(180_000) });
    if (!vidRes.ok) throw new Error("Could not download video from the provided URL.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const duration = await getVideoDuration(inputPath);

    // Evenly-spaced timestamps, skipping the very first/last frames
    const timestamps: number[] = [];
    for (let i = 0; i < count; i++) {
      const t = (duration * (i + 1)) / (count + 1);
      timestamps.push(Number(t.toFixed(3)));
    }

    const thumbnails: Array<{
      timestamp: number;
      imageUrl: string;
      storageRef: string;
    }> = [];

    for (let i = 0; i < timestamps.length; i++) {
      const outPath = join(workDir, `thumb-${i}.jpg`);
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-ss", String(timestamps[i]),
          "-i", inputPath,
          "-frames:v", "1",
          "-q:v", "2",
          "-vf", "scale=1280:-2",
          outPath,
        ],
        { timeout: 60_000 },
      );
      const buf = await readFile(outPath);
      const objectName = `thumb-extract/${jobId}/thumb-${i}.jpg`;
      const storageRef = await uploadMediaToSupabaseStorage(objectName, buf, "image/jpeg");
      thumbnails.push({
        timestamp: timestamps[i],
        storageRef,
        imageUrl: await refreshSupabaseStorageUrl(storageRef),
      });
    }

    // Cleanup temp files
    try {
      await unlink(inputPath);
      for (let i = 0; i < timestamps.length; i++) {
        await unlink(join(workDir, `thumb-${i}.jpg`)).catch(() => {});
      }
    } catch {
      /* best effort */
    }

    res.json({
      ok: true,
      duration,
      thumbnails,
      creditsCharged: THUMB_EXTRACT_COST,
      creditsAfter,
    });
  } catch (err) {
    try {
      await refundCredits(req.userId!, THUMB_EXTRACT_COST, {
        action: "Thumbnail Extractor (failure refund)",
      });
    } catch {
      /* best effort */
    }
    const message = err instanceof Error ? err.message : "Thumbnail extraction failed.";
    res.status(500).json({ error: "extraction_failed", message });
  }
});

export default router;
