import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { logger } from "../../lib/logger";
import { refreshSupabaseStorageUrl, uploadMediaToSupabaseStorage } from "../../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── AI Podcast Intro Generator ───
   POST /podcast-intro: takes a podcast name, host name, tagline, and music
   style, then produces a 15-second intro: an ElevenLabs voiceover read over
   a generated instrumental music bed, mixed with the bed ducked under the
   voice. 300 Visual Bucs (env-overridable via PODCAST_INTRO_CREDITS). */

const PODCAST_INTRO_COST = Number(process.env["PODCAST_INTRO_CREDITS"]) || 300;

/** Fixed output length — a tight podcast intro. */
const INTRO_SECONDS = 15;

/** Default ElevenLabs voice for the intro read (env-overridable). */
function defaultVoiceId(): string {
  return process.env["PODCAST_INTRO_VOICE_ID"] || "21m00Tcm4TlvDq8ikWAM";
}

function elevenKey(): string | undefined {
  return process.env["ELEVENLABS_API_KEY"];
}

function ttsModel(): string {
  return process.env["ELEVENLABS_TTS_MODEL"] || "eleven_multilingual_v2";
}

const MUSIC_STYLES = [
  { id: "upbeat", label: "Upbeat Pop", blurb: "Bright, punchy energy — great for entertainment and comedy shows" },
  { id: "chill", label: "Chill Lo-Fi", blurb: "Relaxed, cozy vibe — perfect for interview and storytelling shows" },
  { id: "epic", label: "Epic Cinematic", blurb: "Big trailer energy — for true crime, documentaries, and deep dives" },
  { id: "corporate", label: "Corporate Clean", blurb: "Polished and professional — business, tech, and news shows" },
  { id: "jazz", label: "Smooth Jazz", blurb: "Sophisticated swing — culture, arts, and lifestyle podcasts" },
  { id: "electronic", label: "Electronic Drive", blurb: "Driving synths — gaming, sports, and high-energy shows" },
] as const;

const podcastIntroSchema = z.object({
  podcastName: z.string().trim().min(1).max(80),
  hostName: z.string().trim().min(1).max(80),
  tagline: z.string().trim().min(1).max(200),
  musicStyle: z.enum(["upbeat", "chill", "epic", "corporate", "jazz", "electronic"]).optional().default("upbeat"),
  /** Optional ElevenLabs voice id for the voiceover read. */
  voiceId: z.string().trim().max(64).optional(),
});

router.get("/podcast-intro-styles", requireAuth, (_req, res) => {
  res.json({ styles: MUSIC_STYLES, durationSec: INTRO_SECONDS, price: PODCAST_INTRO_COST });
});

router.post("/podcast-intro", requireAuth, async (req, res) => {
  const parsed = podcastIntroSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < PODCAST_INTRO_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, PODCAST_INTRO_COST, {
      action: "Podcast Intro",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const fail = async (message: string, status = 500) => {
    await refundCredits(req.userId!, PODCAST_INTRO_COST, {
      action: "Podcast Intro — Refund",
    }).catch(() => {});
    res.status(status).json({ error: message });
  };

  const { podcastName, hostName, tagline, musicStyle, voiceId } = parsed.data;
  const voice = voiceId || defaultVoiceId();

  const apiKey = elevenKey();
  if (!apiKey) {
    await fail("Voice synthesis is not configured. Your Visual Bucs were refunded.", 503);
    return;
  }

  /* Build a tight ~15s read: ~35 words at ~150 wpm. */
  const script =
    `Welcome to ${podcastName}, with your host ${hostName}. ` +
    `${tagline} New episodes dropping soon — let's get into it.`;

  let voiceBytes: Buffer;
  try {
    const ttsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: script,
          model_id: ttsModel(),
          voice_settings: { stability: 0.4, similarity_boost: 0.85, style: 0.7, use_speaker_boost: true },
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!ttsRes.ok) {
      const errText = await ttsRes.text().catch(() => "");
      logger.error({ status: ttsRes.status, errText: errText.slice(0, 300) }, "[podcast-intro] TTS failed");
      throw new Error(`Voiceover generation failed (${ttsRes.status})`);
    }
    voiceBytes = Buffer.from(await ttsRes.arrayBuffer());
    if (voiceBytes.length === 0) throw new Error("Voiceover generation returned empty audio.");
  } catch (err) {
    await fail(err instanceof Error ? err.message : "Voiceover generation failed.");
    return;
  }

  /* Instrumental music bed via the existing in-house music pipeline. */
  let bedBytes: Buffer;
  try {
    const musicRes = await fetch(
      `${process.env.API_BASE_URL || "http://localhost:3001"}/api/generate-music-audio`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": req.headers.authorization || "",
        },
        body: JSON.stringify({
          prompt: `Instrumental podcast intro music, ${musicStyle} style. Punchy opening, builds anticipation, fades out at the end. No vocals. ${INTRO_SECONDS} seconds.`,
          instrumental: true,
          duration: INTRO_SECONDS,
          style: `${musicStyle} podcast intro`,
        }),
        signal: AbortSignal.timeout(300_000),
      },
    );
    if (!musicRes.ok) throw new Error("Music bed generation failed.");
    const musicData = (await musicRes.json()) as { url?: string; audioUrl?: string };
    const bedUrl = musicData.url || musicData.audioUrl;
    if (!bedUrl) throw new Error("No music bed URL returned.");
    const bedDl = await fetch(bedUrl, { signal: AbortSignal.timeout(120_000) });
    if (!bedDl.ok) throw new Error("Music bed download failed.");
    bedBytes = Buffer.from(await bedDl.arrayBuffer());
    if (bedBytes.length === 0) throw new Error("Music bed download returned empty audio.");
  } catch (err) {
    await fail(err instanceof Error ? err.message : "Music bed generation failed.");
    return;
  }

  /* Mix: duck the bed under the voice, trim to the 15s intro length. */
  let mixedBytes: Buffer;
  const workDir = mkdtempSync(join(tmpdir(), "podcast-intro-"));
  try {
    const voicePath = join(workDir, "voice.mp3");
    const bedPath = join(workDir, "bed.mp3");
    const outPath = join(workDir, "intro.mp3");
    writeFileSync(voicePath, voiceBytes);
    writeFileSync(bedPath, bedBytes);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", voicePath,
      "-i", bedPath,
      "-filter_complex",
      `[1:a]volume=0.25,atrim=duration=${INTRO_SECONDS}[bed];` +
        `[0:a][bed]amix=inputs=2:duration=first:normalize=0,atrim=duration=${INTRO_SECONDS},alimiter=limit=0.95[mix]`,
      "-map", "[mix]",
      "-t", String(INTRO_SECONDS),
      "-codec:a", "libmp3lame",
      "-b:a", "128k",
      outPath,
    ]);
    const { readFileSync } = await import("fs");
    mixedBytes = readFileSync(outPath);
    if (mixedBytes.length === 0) throw new Error("Mix produced empty audio.");
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err }, "[podcast-intro] mix failed");
    rmSync(workDir, { recursive: true, force: true });
    await fail("Audio mixing failed.");
    return;
  }
  rmSync(workDir, { recursive: true, force: true });

  /* Upload + signed playable URL. */
  try {
    const ref = await uploadMediaToSupabaseStorage(
      `podcast-intro/${req.userId}/${randomUUID()}.mp3`,
      mixedBytes,
      "audio/mpeg",
    );
    const playUrl = await refreshSupabaseStorageUrl(ref);
    res.json({
      url: playUrl,
      storageRef: ref,
      podcastName,
      hostName,
      tagline,
      musicStyle,
      durationSec: INTRO_SECONDS,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err }, "[podcast-intro] upload failed");
    await fail("Intro mixed but upload failed.");
  }
});

export default router;
