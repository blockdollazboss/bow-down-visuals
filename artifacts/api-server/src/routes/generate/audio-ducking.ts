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

/* ─── Audio ducking (podcast/video narration parity) ───
   Mixes a narration track over background music, automatically ducking
   (lowering) the music whenever the voice is present via ffmpeg
   sidechaincompress. 150 Visual Bucs per mix. */

const DUCK_COST = Number(process.env["DUCK_AUDIO_CREDITS"]) || 150;

const duckSchema = z.object({
  voiceUrl: z.string().trim().min(1).max(2048),
  musicUrl: z.string().trim().min(1).max(2048),
  /** Attack time in ms — how fast the music ducks (default 200). */
  attackMs: z.number().min(20).max(2000).optional().default(200),
  /** Release time in ms — how fast the music returns (default 500). */
  releaseMs: z.number().min(50).max(3000).optional().default(500),
  /** Base music level multiplier before ducking (default 0.6). */
  musicLevel: z.number().min(0.1).max(1).optional().default(0.6),
});

router.post("/duck-audio", requireAuth, async (req, res) => {
  const parsed = duckSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < DUCK_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, DUCK_COST, {
      action: "Audio Ducking",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "duck-audio-"));
  const voicePath = join(workDir, "voice.mp3");
  const musicPath = join(workDir, "music.mp3");
  const outputPath = join(workDir, "mixed.mp3");

  try {
    const [voiceRes, musicRes] = await Promise.all([
      fetch(parsed.data.voiceUrl, { signal: AbortSignal.timeout(120_000) }),
      fetch(parsed.data.musicUrl, { signal: AbortSignal.timeout(120_000) }),
    ]);
    if (!voiceRes.ok) throw new Error("Could not download the narration audio.");
    if (!musicRes.ok) throw new Error("Could not download the background music.");
    await Promise.all([
      writeFile(voicePath, Buffer.from(await voiceRes.arrayBuffer())),
      writeFile(musicPath, Buffer.from(await musicRes.arrayBuffer())),
    ]);

    const { attackMs, releaseMs, musicLevel } = parsed.data;
    // sidechaincompress uses the voice (input 1) to duck the music (input 0).
    // Threshold 0.02 triggers on voice presence; ratio 20 gives strong ducking.
    const filterComplex =
      `[1:a]asplit=2[voice_out][sc];` +
      `[0:a]volume=${musicLevel}[music_leveled];` +
      `[music_leveled][sc]sidechaincompress=threshold=0.02:ratio=20:attack=${attackMs}:release=${releaseMs}[ducked];` +
      `[ducked][voice_out]amix=inputs=2:duration=longest:normalize=0[aout]`;

    await execFileAsync("ffmpeg", [
      "-y", "-i", musicPath, "-i", voicePath,
      "-filter_complex", filterComplex,
      "-map", "[aout]",
      "-c:a", "libmp3lame", "-b:a", "192k",
      outputPath,
    ], { timeout: 300_000 });

    const buffer = await readFile(outputPath);
    const objectName = `duck-audio/${req.userId}/${randomUUID()}.mp3`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "audio/mpeg");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Audio ducking failed.";
    req.log.error({ err: message }, "[duck-audio] failed");
    await refundCredits(req.userId!, DUCK_COST, {
      action: "Audio Ducking — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(voicePath).catch(() => {});
    await unlink(musicPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
