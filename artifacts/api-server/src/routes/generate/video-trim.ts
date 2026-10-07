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

/* ─── AI video trimmer ───
   Trims a video to a [startTime, endTime] window using ffmpeg. 100 Visual Bucs. */

const TRIM_COST = Number(process.env["VIDEO_TRIM_CREDITS"]) || 100;

/** Accept seconds (number) or "HH:MM:SS" / "MM:SS" strings; returns seconds. */
function parseTime(v: number | string): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(":").map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;
  const nums = parts.map(Number);
  if (parts.length === 2) return nums[0]! * 60 + nums[1]!;
  return nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
}

const timeInput = z.union([z.number(), z.string()]);

const trimSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  startTime: timeInput,
  endTime: timeInput,
});

router.post("/trim-video", requireAuth, async (req, res) => {
  const parsed = trimSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const start = parseTime(parsed.data.startTime);
  const end = parseTime(parsed.data.endTime);
  if (start === null || end === null || !(end > start)) {
    res.status(400).json({
      error: "Invalid trim window.",
      message: "startTime must be >= 0 and endTime must be after startTime (seconds or HH:MM:SS).",
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < TRIM_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, TRIM_COST, {
      action: "Video trim",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "trim-"));
  const inputPath = join(workDir, "input.mp4");
  const outputPath = join(workDir, "output.mp4");

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const duration = end - start;

    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-ss", String(start),
        "-i", inputPath,
        "-t", String(duration),
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        outputPath,
      ],
      { timeout: 300_000 },
    );

    const buffer = await readFile(outputPath);
    const objectName = `trim/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      startTime: start,
      endTime: end,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Video trim failed.";
    req.log.error({ err: message }, "[trim-video] failed");
    await refundCredits(req.userId!, TRIM_COST, {
      action: "Video trim — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
