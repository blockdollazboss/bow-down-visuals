import { Router } from "express";
import { requireAuth } from "../../middlewares/require-auth";
import { recordCreditUsage, recordGenerationHistory, markGenerationHistoryCharged } from "../../lib/payment-record";
import { deductCredits, OutOfCreditsError } from "../../lib/credits";
import { db, artistVaultsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { swapSongVocalsToVoice } from "../../lib/voice-swap";

const router = Router();
const BUCKET = "audio-stems";
const CREDIT_COST = 5;
const MIN_LENGTH_MS = 10_000;
const MAX_LENGTH_MS = 300_000;
const DEFAULT_LENGTH_MS = 60_000;

function clampLengthMs(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LENGTH_MS;
  const ms = Math.round(n * 1000);
  return Math.min(MAX_LENGTH_MS, Math.max(MIN_LENGTH_MS, ms));
}

router.post("/generate-music-audio", requireAuth, async (req, res) => {
  const { prompt, lengthSeconds, artistName, songTitle, artistVaultId } = (req.body ?? {}) as {
    prompt?: string;
    lengthSeconds?: number;
    artistName?: string;
    songTitle?: string;
    artistVaultId?: string;
  };

  if (!prompt || !prompt.trim()) {
    res.status(400).json({ error: "A music prompt is required.", code: "missing_prompt" });
    return;
  }

  const apiKey = process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) {
    req.log.error("generate-music-audio: missing ELEVENLABS_API_KEY");
    res.status(503).json({
      error: "Real audio generation isn't configured on this server yet.",
      code: "audio_gen_unavailable",
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  const isDev = process.env["NODE_ENV"] === "development";
  if (!isDev && currentCredits < CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You are out of credits. Join the waitlist or upgrade soon to keep creating.",
    });
    return;
  }

  const musicLengthMs = clampLengthMs(lengthSeconds);

  try {
    const elevenRes = await fetch("https://api.elevenlabs.io/v1/music", {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: prompt.trim().slice(0, 2000),
        music_length_ms: musicLengthMs,
      }),
    });

    if (!elevenRes.ok) {
      const errText = await elevenRes.text().catch(() => "");
      req.log.error({ status: elevenRes.status, errText }, "generate-music-audio: ElevenLabs request failed");
      res.status(502).json({
        error: "Music generation failed. Please try a different prompt or try again shortly.",
        code: "audio_gen_failed",
      });
      return;
    }

    const arrayBuffer = await elevenRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      res.status(502).json({ error: "Music generation returned no audio.", code: "audio_gen_empty" });
      return;
    }

    // Artist voice lock: if the active vault has a locked voice, swap the
    // song's vocals to it. Cost is baked into the song price (5 credits).
    // On any failure, fall back to the original mix — never fail the song.
    let finalBuffer: Buffer = buffer;
    let voiceSwapped = false;
    if (artistVaultId) {
      try {
        const [vault] = await db
          .select({ voice_id: artistVaultsTable.voice_id })
          .from(artistVaultsTable)
          .where(
            and(
              eq(artistVaultsTable.id, artistVaultId),
              eq(artistVaultsTable.user_id, req.userId!),
            ),
          )
          .limit(1);
        if (vault?.voice_id && process.env["ARTIST_VOICE_SWAP_ENABLED"] !== "false") {
          finalBuffer = await swapSongVocalsToVoice(buffer, vault.voice_id, apiKey);
          voiceSwapped = true;
          req.log.info(
            { vaultId: artistVaultId, voiceId: vault.voice_id },
            "generate-music-audio: vocals swapped to locked artist voice",
          );
        }
      } catch (swapErr) {
        req.log.error(
          { err: swapErr },
          "generate-music-audio: voice swap failed, using original mix",
        );
        finalBuffer = buffer;
        voiceSwapped = false;
      }
    }

    const sb = req.userSupabase!;
    const path = `${req.userId}/generated/${Date.now()}-music.mp3`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, finalBuffer, {
      contentType: "audio/mpeg",
      upsert: true,
    });
    if (upErr) {
      req.log.error({ err: upErr }, "generate-music-audio: upload failed");
      res.status(500).json({ error: "Could not save the generated audio.", code: "upload_failed" });
      return;
    }
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);

    // Step 1: Save to history FIRST (throws → outer catch returns 500, no credits charged)
    const genHistoryId = await recordGenerationHistory({
      userId:         req.userId!,
      generationType: "Generate Audio",
      prompt:         prompt.trim().slice(0, 500),
      content:        data.publicUrl,
      artistName:     artistName || undefined,
      songTitle:      songTitle || undefined,
      creditsUsed:    CREDIT_COST,
    });

    // Step 2: Deduct credits only after history is confirmed saved.
    // Atomic single-statement deduction — race-safe (no read-modify-write).
    let creditsAfter: number;
    try {
      creditsAfter = await deductCredits(req.userId!, CREDIT_COST);
    } catch (deductErr) {
      if (deductErr instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You are out of credits. Join the waitlist or upgrade soon to keep creating.",
        });
        return;
      }
      throw deductErr;
    }

    // Step 3: Fire-and-forget — mark charged + log usage
    markGenerationHistoryCharged(genHistoryId).catch(() => {});
    recordCreditUsage({ userId: req.userId!, action: "Generate Audio", creditsUsed: CREDIT_COST }).catch(() => {});

    res.json({
      url: data.publicUrl,
      storagePath: path,
      durationMs: musicLengthMs,
      creditsRemaining: creditsAfter,
      genHistoryId,
      voiceSwapped,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    req.log.error({ err }, "generate-music-audio: unexpected error");
    res.status(500).json({ error: message });
  }
});

export default router;
