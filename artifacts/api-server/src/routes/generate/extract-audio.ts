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

/* ─── Extract audio from video ───
   Pulls the audio track out of a video and returns it as a download —
   MP3 (default) or WAV. ffmpeg only, no AI, no provider spend:
   fast and cheap at 50 Visual Bucs. */

const EXTRACT_COST = Number(process.env["EXTRACT_AUDIO_CREDITS"]) || 50;

const FORMATS = {
  mp3: { ext: "mp3", mime: "audio/mpeg", ffmpegArgs: ["-vn", "-c:a", "libmp3lame", "-b:a", "192k"], label: "MP3" },
  wav: { ext: "wav", mime: "audio/wav",  ffmpegArgs: ["-vn", "-c:a", "pcm_s16le"],               label: "WAV" },
} as const;

type FormatKey = keyof typeof FORMATS;

const extractSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  format: z.enum(["mp3", "wav"]).optional().default("mp3"),
});

router.post("/extract-audio", requireAuth, async (req, res) => {
  const parsed = extractSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const format: FormatKey = parsed.data.format;
  const fmt = FORMATS[format];

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < EXTRACT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
      creditsRequired: EXTRACT_COST,
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, EXTRACT_COST, {
      action: `Extract Audio (${fmt.label})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "extract-audio-"));
  const inputPath = join(workDir, "input.mp4");
  const outputPath = join(workDir, `audio.${fmt.ext}`);

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(180_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", inputPath, ...fmt.ffmpegArgs, outputPath],
      { timeout: 300_000 },
    );

    const durationSec = await probeDurationSeconds(outputPath);
    const buffer = await readFile(outputPath);
    if (buffer.length === 0) throw new Error("The video has no audio track to extract.");

    const objectName = `extract-audio/${req.userId}/${randomUUID()}.${fmt.ext}`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, fmt.mime);
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      format,
      formatLabel: fmt.label,
      mime: fmt.mime,
      durationSec: Math.round(durationSec * 10) / 10,
      sizeBytes: buffer.length,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Audio extraction failed.";
    req.log.error({ err: message }, "[extract-audio] failed");
    await refundCredits(req.userId!, EXTRACT_COST, {
      action: "Extract Audio — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

async function probeDurationSeconds(mediaPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1",
      mediaPath,
    ], { timeout: 60_000 });
    const n = parseFloat(String(stdout).trim());
    return isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export default router;
