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

/* ─── Smart silence removal ───
   Detects and removes silent sections from video/audio.
   Uses ffmpeg silenceremove filter. 200 Visual Bucs. */

const SILENCE_COST = Number(process.env["SILENCE_REMOVAL_CREDITS"]) || 200;

const silenceSchema = z.object({
  mediaUrl: z.string().trim().min(1).max(2048),
  /** Silence threshold in dB (e.g., -30). Lower = more aggressive. */
  thresholdDb: z.number().min(-60).max(-10).optional().default(-30),
  /** Minimum silence duration in seconds to remove. */
  minDuration: z.number().min(0.1).max(5).optional().default(0.5),
});

router.post("/remove-silence", requireAuth, async (req, res) => {
  const parsed = silenceSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < SILENCE_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, SILENCE_COST, {
      action: "Silence Removal",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "silence-"));
  const inputPath = join(workDir, "input");
  const outputPath = join(workDir, "output.mp4");

  try {
    const mediaRes = await fetch(parsed.data.mediaUrl, { signal: AbortSignal.timeout(120_000) });
    if (!mediaRes.ok) throw new Error("Could not download the media.");
    await writeFile(inputPath, Buffer.from(await mediaRes.arrayBuffer()));

    const { thresholdDb, minDuration } = parsed.data;
    // Remove silence from start, middle, and end
    const silenceFilter =
      `silenceremove=start_periods=1:start_threshold=${thresholdDb}dB:start_silence=${minDuration}:` +
      `stop_periods=-1:stop_threshold=${thresholdDb}dB:stop_silence=${minDuration}`;

    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-af", silenceFilter,
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      outputPath,
    ], { timeout: 300_000 });

    const buffer = await readFile(outputPath);
    const objectName = `silence-removal/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Silence removal failed.";
    req.log.error({ err: message }, "[remove-silence] failed");
    await refundCredits(req.userId!, SILENCE_COST, {
      action: "Silence Removal — Refund",
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
