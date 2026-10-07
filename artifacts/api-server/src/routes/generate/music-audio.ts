import { Router } from "express";
import { requireAuth } from "../../middlewares/require-auth";
import { recordGenerationHistory, markGenerationHistoryCharged } from "../../lib/payment-record";
import { chargeCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import { db, artistVaultsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { swapSongVocalsToVoice } from "../../lib/voice-swap";

const router = Router();
const BUCKET = "audio-stems";
const MIN_LENGTH_MS = 10_000;
const MAX_LENGTH_MS = 300_000;
const DEFAULT_LENGTH_MS = 60_000;

/**
 * Tiered pricing by song length — provider cost scales with duration,
 * so the credit price does too. Keeps margins at ~4x+ across all tiers.
 * - Up to 1 min:  400 Visual Bucs (~$2.00, ~$0.30 cost)
 * - Up to 3 min:  800 Visual Bucs (~$4.00, ~$0.90 cost)
 * - Up to 5 min: 1200 Visual Bucs (~$6.00, ~$1.50 cost)
 */
function creditCostForLength(lengthMs: number): number {
  if (lengthMs <= 60_000) return 400;
  if (lengthMs <= 180_000) return 800;
  return 1200;
}

function clampLengthMs(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LENGTH_MS;
  const ms = Math.round(n * 1000);
  return Math.min(MAX_LENGTH_MS, Math.max(MIN_LENGTH_MS, ms));
}

router.post("/generate-music-audio", requireAuth, async (req, res) => {
  const { prompt, lengthSeconds, artistName, songTitle, artistVaultId,
    lyrics, instrumental, vocalGender, variants } = (req.body ?? {}) as {
    prompt?: string;
    lengthSeconds?: number;
    artistName?: string;
    songTitle?: string;
    artistVaultId?: string;
    /** Custom lyrics (Suno-style custom mode) — embedded into the music prompt. */
    lyrics?: string;
    /** Force instrumental, no vocals. */
    instrumental?: boolean;
    /** "male" | "female" | undefined — appended to the prompt as vocal direction. */
    vocalGender?: string;
    /** 1 or 2 — generate two variants (Suno-style A/B). Costs 2x credits. */
    variants?: number;
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
  const musicLengthMs = clampLengthMs(lengthSeconds);
  const variantCount = variants === 2 ? 2 : 1;
  const baseCost = creditCostForLength(musicLengthMs);
  // Dual-variant costs 2x — two provider calls.
  const creditCost = baseCost * variantCount;
  if (!isDev && currentCredits < creditCost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You are out of Visual Bucs. Join the waitlist or upgrade soon to keep creating.",
    });
    return;
  }


  // Pin the music model explicitly — the API default can lag behind releases.
  // Override with ELEVENLABS_MUSIC_MODEL if a newer model ships.
  const musicModel = process.env["ELEVENLABS_MUSIC_MODEL"] ?? "music_v2_5";

  // Build the full music prompt: style + vocal direction + custom lyrics.
  let fullPrompt = prompt.trim().slice(0, 2000);
  const cleanGender = vocalGender === "male" || vocalGender === "female" ? vocalGender : null;
  if (cleanGender && !instrumental) {
    fullPrompt += ` ${cleanGender} vocals.`;
  }
  const cleanLyrics = typeof lyrics === "string" ? lyrics.trim().slice(0, 5000) : "";
  if (cleanLyrics && !instrumental) {
    fullPrompt += `\n\nLyrics:\n${cleanLyrics}`;
  }
  const forceInstrumental = instrumental === true;

  async function generateOne(): Promise<Buffer> {
    const elevenRes = await fetch("https://api.elevenlabs.io/v1/music", {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: fullPrompt,
        music_length_ms: musicLengthMs,
        model_id: musicModel,
        force_instrumental: forceInstrumental,
      }),
    });

    if (!elevenRes.ok) {
      const errText = await elevenRes.text().catch(() => "");
      throw new Error(`ElevenLabs ${elevenRes.status}: ${errText.slice(0, 200)}`);
    }

    const arrayBuffer = await elevenRes.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    if (buf.length === 0) throw new Error("Music generation returned no audio.");
    return buf;
  }

  try {
    // Generate variants sequentially (provider rate limits favor this).
    const buffers: Buffer[] = [];
    for (let v = 0; v < variantCount; v++) {
      buffers.push(await generateOne());
    }

    // Artist voice lock: if the active vault has a locked voice, swap each
    // variant's vocals to it. Cost is baked into the song price.
    // On any failure, fall back to the original mix — never fail the song.
    let voiceSwapped = false;
    const finalBuffers: Buffer[] = [];
    for (const buffer of buffers) {
      let finalBuffer: Buffer = buffer;
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
        }
      }
      finalBuffers.push(finalBuffer);
    }

    // Upload each variant.
    const sb = req.userSupabase!;
    const variantsOut: Array<{ url: string; storagePath: string; label: string }> = [];
    for (let v = 0; v < finalBuffers.length; v++) {
      const path = `${req.userId}/generated/${Date.now()}-music-v${v + 1}.mp3`;
      const { error: upErr } = await sb.storage.from(BUCKET).upload(path, finalBuffers[v], {
        contentType: "audio/mpeg",
        upsert: true,
      });
      if (upErr) {
        req.log.error({ err: upErr }, "generate-music-audio: upload failed");
        res.status(500).json({ error: "Could not save the generated audio.", code: "upload_failed" });
        return;
      }
      const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
      variantsOut.push({
        url: data.publicUrl,
        storagePath: path,
        label: variantCount > 1 ? (v === 0 ? "A" : "B") : "A",
      });
    }

    // Step 1: Save to history FIRST (throws → outer catch returns 500, no credits charged)
    const genHistoryId = await recordGenerationHistory({
      userId:         req.userId!,
      generationType: "Generate Audio",
      prompt:         fullPrompt.slice(0, 500),
      content:        variantsOut[0].url,
      artistName:     artistName || undefined,
      songTitle:      songTitle || undefined,
      creditsUsed:    creditCost,
    });

    // Step 2: Deduct credits only after history is confirmed saved.
    let creditsAfter: number;
    try {
      creditsAfter = await chargeCredits(req.userId!, creditCost, { action: "Generate Audio" });
    } catch (deductErr) {
      if (deductErr instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You are out of Visual Bucs. Join the waitlist or upgrade soon to keep creating.",
        });
        return;
      }
      if (deductErr instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed \u2014 no Visual Bucs were charged. Please try again." });
        return;
      }
      throw deductErr;
    }

    // Step 3: Fire-and-forget — mark charged + log usage
    markGenerationHistoryCharged(genHistoryId).catch(() => {});

    res.json({
      // Back-compat: single-variant shape
      url: variantsOut[0].url,
      storagePath: variantsOut[0].storagePath,
      variants: variantsOut,
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
