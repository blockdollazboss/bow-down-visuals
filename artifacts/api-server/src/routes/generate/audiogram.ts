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

/* ─── Podcast audiogram generator ───
   Takes a podcast/audio URL + cover image URL and renders a 1080x1080
   square video with an animated waveform visualizer over the cover art —
   perfect for social promotion. 250 Visual Bucs. */

const AUDIOGRAM_COST = Number(process.env["AUDIOGRAM_CREDITS"]) || 250;

const WAVE_COLORS = {
  gold: "0xFFD700",
  white: "0xFFFFFF",
  cyan: "0x00E5FF",
  pink: "0xFF5DA2",
  green: "0x4ADE80",
} as const;

type WaveColorKey = keyof typeof WAVE_COLORS;

const audiogramSchema = z.object({
  audioUrl: z.string().trim().min(1).max(2048),
  coverUrl: z.string().trim().min(1).max(2048),
  waveColor: z.string().refine((v): v is WaveColorKey => v in WAVE_COLORS, {
    message: `waveColor must be one of: ${Object.keys(WAVE_COLORS).join(", ")}`,
  }).optional().default("gold"),
});

router.get("/audiogram-colors", requireAuth, (_req, res) => {
  res.json({
    colors: Object.entries(WAVE_COLORS).map(([key]) => ({ key, label: key })),
  });
});

router.post("/audiogram", requireAuth, async (req, res) => {
  const parsed = audiogramSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < AUDIOGRAM_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, AUDIOGRAM_COST, {
      action: "Podcast Audiogram",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "audiogram-"));
  const audioPath = join(workDir, "audio");
  const coverPath = join(workDir, "cover");
  const outputPath = join(workDir, "audiogram.mp4");

  try {
    const [audioRes, coverRes] = await Promise.all([
      fetch(parsed.data.audioUrl, { signal: AbortSignal.timeout(120_000) }),
      fetch(parsed.data.coverUrl, { signal: AbortSignal.timeout(120_000) }),
    ]);
    if (!audioRes.ok) throw new Error("Could not download the audio.");
    if (!coverRes.ok) throw new Error("Could not download the cover image.");
    await Promise.all([
      writeFile(audioPath, Buffer.from(await audioRes.arrayBuffer())),
      writeFile(coverPath, Buffer.from(await coverRes.arrayBuffer())),
    ]);

    const waveColor = WAVE_COLORS[parsed.data.waveColor];

    // Blurred full-bleed background from the cover + centered cover art
    // + animated waveform bars at the bottom.
    const filterComplex =
      "[0:v]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,boxblur=24:1[bg];" +
      "[0:v]scale=560:560:force_original_aspect_ratio=increase,crop=560:560[art];" +
      `[1:a]showwaves=s=900x220:mode=line:rate=30:colors=${waveColor}:draw=full,format=rgba[waves];` +
      "[bg][art]overlay=(W-w)/2:170[base];" +
      "[base][waves]overlay=(W-w)/2:800";

    await execFileAsync("ffmpeg", [
      "-y", "-loop", "1", "-framerate", "30", "-i", coverPath,
      "-i", audioPath,
      "-filter_complex", filterComplex,
      "-map", "0:v", "-map", "1:a",
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-pix_fmt", "yuv420p", "-r", "30",
      "-c:a", "aac", "-b:a", "192k",
      "-shortest",
      outputPath,
    ], { timeout: 600_000 });

    const buffer = await readFile(outputPath);
    const objectName = `audiogram/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      waveColor: parsed.data.waveColor,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Audiogram generation failed.";
    req.log.error({ err: message }, "[audiogram] failed");
    await refundCredits(req.userId!, AUDIOGRAM_COST, {
      action: "Podcast Audiogram — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(audioPath).catch(() => {});
    await unlink(coverPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
