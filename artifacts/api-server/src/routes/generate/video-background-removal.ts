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

/* ─── AI-assisted video background removal ───
   Samples the first frame to detect the background color, then applies
   an optimized chroma-key across the whole video. Outputs ProRes 4444
   (alpha channel preserved) for use as an overlay.
   Works best with solid-color backgrounds. 500 Visual Bucs per video. */

const VIDEO_BG_REMOVAL_COST = Number(process.env["VIDEO_BG_REMOVAL_CREDITS"]) || 500;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB

const removeVideoBgSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  aggressiveness: z.number().min(0).max(1).optional().default(0.5),
});

async function detectVideoBackgroundColor(videoPath: string): Promise<string> {
  // Extract the first frame, then sample its corners.
  const id = randomUUID();
  const framePath = join(tmpdir(), `${id}-frame.png`);
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-i", videoPath,
      "-vframes", "1",
      framePath,
    ], { timeout: 30_000 });

    // Sample corners of the frame
    const corners = [
      "crop=iw*0.1:ih*0.1:iw*0.05:ih*0.05",
      "crop=iw*0.1:ih*0.1:iw*0.85:ih*0.05",
      "crop=iw*0.1:ih*0.1:iw*0.05:ih*0.85",
      "crop=iw*0.1:ih*0.1:iw*0.85:ih*0.85",
    ];

    const colors: Array<[number, number, number]> = [];
    for (const crop of corners) {
      try {
        const { stdout } = await execFileAsync("ffmpeg", [
          "-i", framePath,
          "-vf", `${crop},signalstats`,
          "-f", "null", "-",
        ], { timeout: 30_000 });
        const yMatch = /YAVG:(\d+)/.exec(stdout);
        const uMatch = /UAVG:(\d+)/.exec(stdout);
        const vMatch = /VAVG:(\d+)/.exec(stdout);
        if (yMatch && uMatch && vMatch) {
          const y = parseInt(yMatch[1]!);
          const u = parseInt(uMatch[1]!) - 128;
          const v = parseInt(vMatch[1]!) - 128;
          const r = Math.min(255, Math.max(0, Math.round(y + 1.402 * v)));
          const g = Math.min(255, Math.max(0, Math.round(y - 0.344136 * u - 0.714136 * v)));
          const b = Math.min(255, Math.max(0, Math.round(y + 1.772 * u)));
          colors.push([r, g, b]);
        }
      } catch {
        // Skip failed corner
      }
    }

    if (colors.length === 0) return "0x00FF00";

    const r = Math.round(colors.reduce((a, c) => a + c[0], 0) / colors.length);
    const g = Math.round(colors.reduce((a, c) => a + c[1], 0) / colors.length);
    const b = Math.round(colors.reduce((a, c) => a + c[2], 0) / colors.length);

    return `0x${r.toString(16).padStart(2, "0").toUpperCase()}${g.toString(16).padStart(2, "0").toUpperCase()}${b.toString(16).padStart(2, "0").toUpperCase()}`;
  } finally {
    await unlink(framePath).catch(() => {});
  }
}

router.post("/remove-video-background", requireAuth, async (req, res) => {
  const parsed = removeVideoBgSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < VIDEO_BG_REMOVAL_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, VIDEO_BG_REMOVAL_COST, {
      action: "Video Background Removal",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "video-bg-removal-"));
  const inputPath = join(workDir, "input.mp4");
  const outputPath = join(workDir, "output.mov");

  try {
    // 1. Download the video
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    const videoBuffer = Buffer.from(await vidRes.arrayBuffer());
    if (videoBuffer.length > MAX_VIDEO_BYTES) {
      throw new Error("Video exceeds the 100 MB limit.");
    }
    await writeFile(inputPath, videoBuffer);

    // 2. Detect background color from first frame
    const bgColor = await detectVideoBackgroundColor(inputPath);
    req.log.info({ bgColor }, "[remove-video-background] detected background color");

    // 3. Apply chromakey across the video, output ProRes 4444 with alpha
    const similarity = (0.1 + parsed.data.aggressiveness * 0.3).toFixed(3);
    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-vf", `chromakey=${bgColor}:${similarity}:0.1,format=yuva420p`,
      "-c:v", "prores_ks", "-profile:v", "4444",
      "-c:a", "aac",
      outputPath,
    ], { timeout: 300_000 }); // 5 min for video processing

    // 4. Upload result
    const buffer = await readFile(outputPath);
    const objectName = `video-background-removal/${req.userId}/${randomUUID()}.mov`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/quicktime");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      backgroundColor: bgColor,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Video background removal failed.";
    req.log.error({ err: message }, "[remove-video-background] failed");
    await refundCredits(req.userId!, VIDEO_BG_REMOVAL_COST, {
      action: "Video Background Removal — Refund",
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
