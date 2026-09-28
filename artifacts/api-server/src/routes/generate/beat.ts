import { Router } from "express";
import { requireAuth } from "../../middlewares/require-auth";
import { recordGenerationHistory, markGenerationHistoryCharged } from "../../lib/payment-record";
import { chargeCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";

const router = Router();
const BUCKET = "audio-stems";
const CREDIT_COST = 3;
const MIN_LENGTH_MS = 10_000;
const MAX_LENGTH_MS = 180_000;
const DEFAULT_LENGTH_MS = 60_000;

const GENRES = [
  "hip-hop", "trap", "drill", "r&b", "afrobeats", "pop", "edm",
  "lofi", "rock", "latin", "dancehall", "jersey-club",
] as const;

function clampLengthMs(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LENGTH_MS;
  const ms = Math.round(n * 1000);
  return Math.min(MAX_LENGTH_MS, Math.max(MIN_LENGTH_MS, ms));
}

function clampBpm(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(200, Math.max(60, Math.round(n)));
}

/* Build an instrumental-only prompt for the music model: no vocals, ever. */
function buildBeatPrompt(opts: {
  vibe: string;
  genre?: string;
  bpm: number | null;
  musicalKey?: string;
}): string {
  const parts: string[] = ["Instrumental beat, absolutely no vocals or singing"];
  const genre = (opts.genre ?? "").toLowerCase().trim();
  if ((GENRES as readonly string[]).includes(genre)) parts.push(`${genre} style`);
  if (opts.bpm) parts.push(`${opts.bpm} BPM`);
  if (opts.musicalKey?.trim()) parts.push(`key of ${opts.musicalKey.trim()}`);
  parts.push(opts.vibe.trim().slice(0, 1500));
  parts.push("studio quality, full arrangement with intro and outro");
  return parts.join(", ");
}

router.post("/beat/generate", requireAuth, async (req, res) => {
  const { vibe, genre, bpm, musicalKey, lengthSeconds, beatTitle } = (req.body ?? {}) as {
    vibe?: string;
    genre?: string;
    bpm?: number;
    musicalKey?: string;
    lengthSeconds?: number;
    beatTitle?: string;
  };

  if (!vibe || !vibe.trim()) {
    res.status(400).json({ error: "Describe the vibe for your beat.", code: "missing_vibe" });
    return;
  }

  const apiKey = process.env["ELEVENLABS_API_KEY"];
  if (!apiKey) {
    req.log.error("beat/generate: missing ELEVENLABS_API_KEY");
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
      message: "You are out of Visual Bucs. Top up to keep making beats.",
    });
    return;
  }

  const prompt = buildBeatPrompt({
    vibe,
    genre,
    bpm: clampBpm(bpm),
    musicalKey,
  });
  const musicLengthMs = clampLengthMs(lengthSeconds);
  const musicModel = process.env["ELEVENLABS_MUSIC_MODEL"] ?? "music_v2_5";

  try {
    const elevenRes = await fetch("https://api.elevenlabs.io/v1/music", {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: prompt.slice(0, 2000),
        music_length_ms: musicLengthMs,
        model_id: musicModel,
      }),
    });

    if (!elevenRes.ok) {
      const errText = await elevenRes.text().catch(() => "");
      req.log.error({ status: elevenRes.status, errText }, "beat/generate: ElevenLabs request failed");
      res.status(502).json({
        error: "Beat generation failed. Try a different vibe or try again shortly.",
        code: "audio_gen_failed",
      });
      return;
    }

    const arrayBuffer = await elevenRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      res.status(502).json({ error: "Beat generation returned no audio.", code: "audio_gen_empty" });
      return;
    }

    const sb = req.userSupabase!;
    const path = `${req.userId}/generated/${Date.now()}-beat.mp3`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buffer, {
      contentType: "audio/mpeg",
      upsert: true,
    });
    if (upErr) {
      req.log.error({ err: upErr }, "beat/generate: upload failed");
      res.status(500).json({ error: "Could not save the generated beat.", code: "upload_failed" });
      return;
    }
    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);

    // Step 1: Save to history FIRST (throws → outer catch returns 500, no credits charged)
    const genHistoryId = await recordGenerationHistory({
      userId:         req.userId!,
      generationType: "Generate Beat",
      prompt:         prompt.slice(0, 500),
      content:        data.publicUrl,
      songTitle:      beatTitle?.trim() || undefined,
      creditsUsed:    CREDIT_COST,
    });

    // Step 2: Deduct credits only after history is confirmed saved.
    let creditsAfter: number;
    try {
      creditsAfter = await chargeCredits(req.userId!, CREDIT_COST, { action: "Generate Beat" });
    } catch (deductErr) {
      if (deductErr instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You are out of Visual Bucs. Top up to keep making beats.",
        });
        return;
      }
      if (deductErr instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed — no Visual Bucs were charged. Please try again." });
        return;
      }
      throw deductErr;
    }

    // Step 3: Fire-and-forget — mark charged + log usage
    markGenerationHistoryCharged(genHistoryId).catch(() => {});

    res.json({
      url: data.publicUrl,
      storagePath: path,
      durationMs: musicLengthMs,
      creditsRemaining: creditsAfter,
      genHistoryId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    req.log.error({ err }, "beat/generate: unexpected error");
    res.status(500).json({ error: message });
  }
});

export default router;
