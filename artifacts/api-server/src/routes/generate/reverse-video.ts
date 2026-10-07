import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, mkdtemp, rm } from "fs/promises";
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

/* ─── Video reverse & boomerang maker ───
   Reverse a video end-to-end, or build a boomerang loop that plays
   forward then backward seamlessly. 150 Visual Bucs. */

const REVERSE_COST = Number(process.env["REVERSE_VIDEO_CREDITS"]) || 150;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

const reverseSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  mode: z.enum(["reverse", "boomerang"]).default("reverse"),
});

router.post("/reverse-video", requireAuth, async (req, res) => {
  const parsed = reverseSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const { videoUrl, mode } = parsed.data;

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < REVERSE_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, REVERSE_COST, {
      action: mode === "boomerang" ? "Video boomerang" : "Video reverse",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "reverse-"));
  const inputPath = join(workDir, "input.mp4");
  const outputPath = join(workDir, "output.mp4");

  try {
    // Download the source video
    const vidRes = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    const inputBytes = Buffer.from(await vidRes.arrayBuffer());
    if (inputBytes.length > MAX_DOWNLOAD_BYTES) {
      throw new Error("Video is too large (max 100 MB).");
    }
    await writeFile(inputPath, inputBytes);

    // Does the source have an audio track? (areverse fails without one)
    const hasAudio = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", inputPath],
    )
      .then((r) => r.stdout.trim().length > 0)
      .catch(() => false);

    const args = ["-y", "-i", inputPath];
    if (mode === "boomerang") {
      // Forward then backward — the reversed half starts at the last
      // frame of the forward half, so the loop bounce is seamless.
      let filter = "[0:v]split[f][r];[r]reverse[rev];[f][rev]concat=n=2:v=1[v]";
      if (hasAudio) {
        filter += ";[0:a]asplit[af][ar];[ar]areverse[arev];[af][arev]concat=n=2:v=0:a=1[a]";
      }
      args.push("-filter_complex", filter, "-map", "[v]");
      if (hasAudio) args.push("-map", "[a]");
    } else {
      // Straight reverse
      args.push("-vf", "reverse", "-map", "0:v:0");
      if (hasAudio) {
        args.push("-af", "areverse", "-map", "0:a?");
      } else {
        args.push("-an");
      }
    }
    args.push(
      "-c:v", "libx264",
      "-crf", "18",
      "-preset", "veryfast",
      "-c:a", "aac",
      "-movflags", "+faststart",
      outputPath,
    );

    await execFileAsync("ffmpeg", args, { timeout: 300_000 });

    const buffer = await readFile(outputPath);
    const objectName = `reverse/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      mode,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Video reverse failed.";
    req.log.error({ err: message }, "[reverse-video] failed");
    await refundCredits(req.userId!, REVERSE_COST, {
      action: "Video reverse — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
