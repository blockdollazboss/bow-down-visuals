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

/* ─── Video volume normalizer ───
   Normalizes a video's audio track to broadcast loudness standards using
   ffmpeg's two-pass loudnorm filter (EBU R128 / ITU-R BS.1770). 100 Visual Bucs
   per normalization. */

const NORM_COST = Number(process.env["VOLUME_NORM_CREDITS"]) || 100;

// Broadcast presets: integrated loudness (LUFS), loudness range (LU), true peak (dBTP).
const PRESETS = {
  youtube: { I: -14, LRA: 11, TP: -1.0, label: "YouTube / social" },
  "ebu-r128": { I: -16, LRA: 11, TP: -1.5, label: "EBU R128 broadcast" },
  podcast: { I: -16, LRA: 11, TP: -1.5, label: "Podcast (-16 LUFS)" },
  atsc: { I: -24, LRA: 7, TP: -2.0, label: "ATSC A/85 (-24 LKFS)" },
} as const;

const normSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  /** Loudness preset: youtube (default), ebu-r128, podcast, atsc. */
  preset: z.enum(["youtube", "ebu-r128", "podcast", "atsc"]).optional().default("youtube"),
  /** Output container: mp4 (default) or mov. */
  format: z.enum(["mp4", "mov"]).optional().default("mp4"),
});

router.post("/normalize-volume", requireAuth, async (req, res) => {
  const parsed = normSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < NORM_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, NORM_COST, {
      action: "Video Volume Normalizer",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const { videoUrl, preset, format } = parsed.data;
  const { I, LRA, TP, label } = PRESETS[preset];

  const workDir = await mkdtemp(join(tmpdir(), "vol-norm-"));
  const inputPath = join(workDir, "input.mp4");
  const outputPath = join(workDir, `normalized.${format}`);

  try {
    const videoRes = await fetch(videoUrl, { signal: AbortSignal.timeout(180_000) });
    if (!videoRes.ok) throw new Error("Could not download the video. Check the URL and try again.");
    await writeFile(inputPath, Buffer.from(await videoRes.arrayBuffer()));

    // Pass 1: measure loudness (stderr carries the JSON summary).
    let measured: Record<string, string>;
    try {
      const pass1 = await execFileAsync(
        "ffmpeg",
        ["-hide_banner", "-i", inputPath, "-filter:a", `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`, "-f", "null", "-"],
        { timeout: 300_000, maxBuffer: 64 * 1024 * 1024 }
      );
      measured = JSON.parse((pass1.stderr.match(/\{[\s\S]*\}/) ?? ["{}"])[0]);
    } catch (err: unknown) {
      // ffmpeg exits non-zero on -f null in some builds; loudnorm still prints JSON to stderr.
      const stderr = (err as { stderr?: string })?.stderr ?? "";
      const match = stderr.match(/\{[\s\S]*\}/);
      if (!match) throw err;
      measured = JSON.parse(match[0]);
    }

    // Pass 2: apply measured values with linear=true for accurate correction.
    const measuredI = measured["input_i"];
    const measuredTP = measured["input_tp"];
    const measuredLRA = measured["input_lra"];
    const measuredThresh = measured["input_thresh"];
    const offset = measured["target_offset"];
    if (!measuredI || !measuredTP || !measuredLRA || !measuredThresh || !offset) {
      throw new Error("Could not measure the audio loudness. The video may have no audio track.");
    }

    await execFileAsync(
      "ffmpeg",
      [
        "-y", "-i", inputPath,
        "-filter:a",
        `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:measured_I=${measuredI}:measured_TP=${measuredTP}:measured_LRA=${measuredLRA}:measured_thresh=${measuredThresh}:offset=${offset}:linear=true`,
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        outputPath,
      ],
      { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 }
    );

    const buffer = await readFile(outputPath);
    const contentType = format === "mov" ? "video/quicktime" : "video/mp4";
    const objectName = `volume-norm/${req.userId}/${randomUUID()}.${format}`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, contentType);
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      preset,
      presetLabel: label,
      measured: {
        integratedLoudness: measuredI,
        truePeak: measuredTP,
        loudnessRange: measuredLRA,
      },
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Volume normalization failed.";
    req.log.error({ err: message }, "[normalize-volume] failed");
    await refundCredits(req.userId!, NORM_COST, {
      action: "Video Volume Normalizer — Refund",
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
