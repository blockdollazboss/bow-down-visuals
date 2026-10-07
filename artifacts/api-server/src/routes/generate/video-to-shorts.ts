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

/* ─── Smart clips (unified auto-clip extraction) ───
   Analyzes a video, finds the most energetic segments, and extracts
   them as vertical shorts (9:16). Configurable count (1-5) and duration
   (15-60s). Replaces the old auto-teaser + video-to-shorts endpoints.
   200 Visual Bucs per clip. */

const SMART_CLIPS_PER_CLIP = 200;
const MAX_CLIPS = 5;

const smartClipsSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  count: z.number().int().min(1).max(5).optional().default(3),
  durationSec: z.number().int().min(15).max(60).optional().default(45),
});

interface Segment {
  start: number;
  energy: number;
}

async function findEnergeticSegments(videoPath: string, count: number, clipDuration: number): Promise<Segment[]> {
  const { stdout: durOut } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", videoPath,
  ], { timeout: 30_000 });
  const duration = parseFloat(durOut.trim());
  if (!Number.isFinite(duration) || duration <= clipDuration) {
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
    const overlaps = picked.some((p) => Math.abs(p.start - seg.start) < clipDuration);
    if (!overlaps) {
      // Center the clip on the energetic window
      const clipStart = Math.max(0, Math.min(duration - clipDuration, seg.start - (clipDuration - windowSec) / 2));
      picked.push({ start: Math.round(clipStart * 10) / 10, energy: seg.energy });
    }
  }

  // Sort by timeline order for a natural viewing sequence
  picked.sort((a, b) => a.start - b.start);
  return picked;
}

router.post("/smart-clips", requireAuth, async (req, res) => {
  const parsed = smartClipsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const totalCost = SMART_CLIPS_PER_CLIP * parsed.data.count;
  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < totalCost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, totalCost, {
      action: `Smart Clips (${parsed.data.count})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "smart-clips-"));
  const inputPath = join(workDir, "input.mp4");

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const segments = await findEnergeticSegments(inputPath, parsed.data.count, parsed.data.durationSec);
    req.log.info({ segments: segments.length }, "[smart-clips] found segments");

    const clips: Array<{ url: string; storageRef: string; startTime: number }> = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const outputPath = join(workDir, `clip-${i}.mp4`);

      // Extract segment AND reframe to 9:16 in one pass
      await execFileAsync("ffmpeg", [
        "-y", "-ss", seg.start.toFixed(1), "-i", inputPath,
        "-t", parsed.data.durationSec.toFixed(0),
        "-vf", "crop='if(gt(iw/ih,0.5625),ih*0.5625,iw)':'if(gt(iw/ih,0.5625),ih,iw/0.5625)',scale=1080:1920",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        outputPath,
      ], { timeout: 300_000 });

      const buffer = await readFile(outputPath);
      const objectName = `smart-clips/${req.userId}/${randomUUID()}.mp4`;
      const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
      const url = await refreshSupabaseStorageUrl(storageRef);

      clips.push({ url, storageRef, startTime: seg.start });
      await unlink(outputPath).catch(() => {});
    }

    res.json({
      clips,
      count: clips.length,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Smart clips failed.";
    req.log.error({ err: message }, "[smart-clips] failed");
    await refundCredits(req.userId!, totalCost, {
      action: "Smart Clips — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(inputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
