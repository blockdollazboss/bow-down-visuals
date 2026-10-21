import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, mkdtemp } from "fs/promises";
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

/* ─── AI Slow Motion (optical flow) ───
   True optical-flow slow motion: ffmpeg's minterpolate filter synthesizes
   interpolated frames between real ones, so 2x/4x/8x slow-mo stays buttery
   smooth instead of choppy frame duplication. Pure ffmpeg — no paid
   provider calls. 300 Visual Bucs. */

const SLOW_MOTION_COST = Number(process.env["SLOW_MOTION_CREDITS"]) || 300;

const slowMotionSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  slowFactor: z.union([z.literal(2), z.literal(4), z.literal(8)]),
});

interface ProbeInfo {
  fps: number;
  duration: number;
}

async function probeVideo(inputPath: string): Promise<ProbeInfo> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=avg_frame_rate:format=duration",
      "-of", "default=nw=1:nk=1",
      inputPath,
    ],
    { timeout: 30_000 },
  );
  const lines = stdout.trim().split("\n");
  // avg_frame_rate comes first (stream=), then format duration
  const rateStr = (lines[0] ?? "").trim();
  const dur = parseFloat((lines[1] ?? "").trim());
  let fps = 30;
  const m = rateStr.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m && Number(m[2]) > 0) {
    const f = Number(m[1]) / Number(m[2]);
    if (Number.isFinite(f) && f > 0 && f <= 240) fps = f;
  }
  return { fps, duration: Number.isFinite(dur) && dur > 0 ? dur : 0 };
}

/** Build an atempo chain for a given speed (atempo only accepts 0.5–2.0). */
function atempoChain(speed: number): string {
  const parts: string[] = [];
  let s = speed;
  while (s > 2.0) {
    parts.push("atempo=2.0");
    s /= 2.0;
  }
  while (s < 0.5) {
    parts.push("atempo=0.5");
    s /= 0.5;
  }
  parts.push(`atempo=${s.toFixed(3)}`);
  return parts.join(",");
}

router.post("/slow-motion", requireAuth, async (req, res) => {
  const parsed = slowMotionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const factor = parsed.data.slowFactor;

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < SLOW_MOTION_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, SLOW_MOTION_COST, {
      action: `AI Slow Motion (${factor}x)`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "slowmo-"));
  const inputPath = join(workDir, "input.mp4");
  const outputPath = join(workDir, "output.mp4");

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const { fps, duration } = await probeVideo(inputPath);

    // minterpolate synthesizes (factor - 1) interpolated frames between every
    // pair of real frames; the setpts then stretches the timeline so the
    // output plays at the ORIGINAL frame rate for true smooth slow motion.
    const targetFps = Math.round(fps * factor);
    const filterGraph =
      `[0:v]minterpolate=fps=${targetFps}:mi_mode=blend,setpts=${factor}*PTS[v];` +
      `[0:a]${atempoChain(1 / factor)}[a]`;

    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i", inputPath,
        "-filter_complex", filterGraph,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-r", String(Math.round(fps)),
        "-c:a", "aac",
        outputPath,
      ],
      // Optical-flow interpolation is CPU-heavy; give it room to finish.
      { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 },
    );

    const buffer = await readFile(outputPath);
    const objectName = `slowmo/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      slowFactor: factor,
      sourceFps: Number(fps.toFixed(3)),
      sourceDuration: duration,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Slow motion render failed.";
    req.log.error({ err: message }, "[slow-motion] failed");
    await refundCredits(req.userId!, SLOW_MOTION_COST, {
      action: "AI Slow Motion — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
