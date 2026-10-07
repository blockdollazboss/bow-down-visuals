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

/* ─── Long video to shorts (OpusClip/CapCut parity) ───
   Analyzes a long video, finds the most energetic segments, and extracts
   them as vertical shorts (9:16). Returns up to 3 shorts.
   800 Visual Bucs (covers analysis + 3 reframes). */

const SHORTS_COST = Number(process.env["VIDEO_TO_SHORTS_CREDITS"]) || 800;
const SHORT_DURATION = 45; // seconds per short
const MAX_SHORTS = 3;

const videoToShortsSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  count: z.number().int().min(1).max(3).optional().default(3),
});

interface Segment {
  start: number;
  energy: number;
}

async function findEnergeticSegments(videoPath: string, count: number): Promise<Segment[]> {
  const { stdout: durOut } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", videoPath,
  ], { timeout: 30_000 });
  const duration = parseFloat(durOut.trim());
  if (!Number.isFinite(duration) || duration <= SHORT_DURATION) {
    return [{ start: 0, energy: 0 }];
  }

  // Analyze 10-second windows for audio energy
  const windowSec = 10;
  const numWindows = Math.floor(duration / windowSec);
  const segments: Segment[] = [];

  for (let w = 0; w < numWindows; w++) {
    const start = w * windowSec;
    try {
      const { stdout } = await execFileAsync("ffmpeg", [
        "-ss", start.toFixed(1), "-t", windowSec.toFixed(1),
        "-i", videoPath,
        "-af", "astats=metadata=1:reset=1",
        "-f", "null", "-",
      ], { timeout: 30_000 });
      const rmsMatch = /RMS level dB:\s*(-?\d+\.?\d*)/.exec(stdout);
      const energy = rmsMatch ? parseFloat(rmsMatch[1]!) : -Infinity;
      segments.push({ start, energy });
    } catch {
      // Skip
    }
  }

  // Sort by energy, pick top N non-overlapping segments
  segments.sort((a, b) => b.energy - a.energy);
  const picked: Segment[] = [];
  for (const seg of segments) {
    if (picked.length >= count) break;
    // Ensure no overlap with already-picked segments
    const overlaps = picked.some((p) => Math.abs(p.start - seg.start) < SHORT_DURATION);
    if (!overlaps) {
      // Center the short on the energetic window
      const shortStart = Math.max(0, Math.min(duration - SHORT_DURATION, seg.start - (SHORT_DURATION - windowSec) / 2));
      picked.push({ start: Math.round(shortStart * 10) / 10, energy: seg.energy });
    }
  }

  // Sort by timeline order for a natural viewing sequence
  picked.sort((a, b) => a.start - b.start);
  return picked;
}

router.post("/video-to-shorts", requireAuth, async (req, res) => {
  const parsed = videoToShortsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < SHORTS_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, SHORTS_COST, {
      action: "Video to Shorts",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "video-shorts-"));
  const inputPath = join(workDir, "input.mp4");

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const segments = await findEnergeticSegments(inputPath, parsed.data.count);
    req.log.info({ segments: segments.length }, "[video-to-shorts] found segments");

    const shorts: Array<{ url: string; storageRef: string; startTime: number }> = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const outputPath = join(workDir, `short-${i}.mp4`);

      // Extract segment AND reframe to 9:16 in one pass
      await execFileAsync("ffmpeg", [
        "-y", "-ss", seg.start.toFixed(1), "-i", inputPath,
        "-t", SHORT_DURATION.toFixed(0),
        "-vf", "crop='if(gt(iw/ih,0.5625),ih*0.5625,iw)':'if(gt(iw/ih,0.5625),ih,iw/0.5625)',scale=1080:1920",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        outputPath,
      ], { timeout: 300_000 });

      const buffer = await readFile(outputPath);
      const objectName = `video-shorts/${req.userId}/${randomUUID()}.mp4`;
      const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
      const url = await refreshSupabaseStorageUrl(storageRef);

      shorts.push({ url, storageRef, startTime: seg.start });
      await unlink(outputPath).catch(() => {});
    }

    res.json({
      shorts,
      count: shorts.length,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Video to shorts failed.";
    req.log.error({ err: message }, "[video-to-shorts] failed");
    await refundCredits(req.userId!, SHORTS_COST, {
      action: "Video to Shorts — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(inputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
