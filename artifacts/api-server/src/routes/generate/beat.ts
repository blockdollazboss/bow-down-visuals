import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { recordGenerationHistory, markGenerationHistoryCharged } from "../../lib/payment-record";
import {
  chargeCredits,
  refundCredits,
  refundCreditsGuaranteed,
  OutOfCreditsError,
  LedgerWriteError,
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
} from "../../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../../lib/generation-stored-results";

/* CA-1 replay note (CA-KEY wording pattern). */
const BEAT_REPLAY_NOTE =
  "This is the beat you already made for this request — change the vibe or settings for a fresh one.";
import { r2Upload, r2PublicUrl } from "../../lib/r2-client";

const router = Router();
const BUCKET = "audio-stems";
const CREDIT_COST = 300;
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

/* ── Request validation ── */
const beatGenerateSchema = z.object({
  vibe: z.string().min(1, "Describe the vibe for your beat.").max(2000),
  genre: z.string().max(100).optional(),
  bpm: z.number().finite().min(40).max(220).optional(),
  musicalKey: z.string().max(20).optional(),
  lengthSeconds: z.number().finite().min(1).max(600).optional(),
  beatTitle: z.string().max(200).optional(),
});

router.post("/beat/generate", requireAuth, async (req, res) => {
  const parsed = beatGenerateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid beat request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { vibe, genre, bpm, musicalKey, lengthSeconds, beatTitle } = parsed.data;

  if (!vibe.trim()) {
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

  /* CA-1: server-derived key + stored-result pre-check BEFORE funding.
     Intent uses the same clamped values the provider call is built from,
     so two requests that would generate the same beat share one key. */
  const idempotencyKey = buildChargeIdempotencyKey(
    "beat-generate", req.userId!, undefined,
    {
      vibe: vibe.trim(),
      genre: genre ?? null,
      bpm: clampBpm(bpm),
      musicalKey: musicalKey ?? null,
      lengthMs: clampLengthMs(lengthSeconds),
      beatTitle: beatTitle ?? null,
    },
  );
  const stored = await findStoredGenerationResult("beat-generate", idempotencyKey, req.userId!);
  if (stored) {
    res.json({ ...stored, replayed: true, replayNote: BEAT_REPLAY_NOTE });
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

  /* ── Reserve at job start (spend-pacing, stack1000 P2) ──
     The charge lands BEFORE the ElevenLabs call; every failure exit
     below refunds it. This handler used to generate, upload, and save
     history first and charge last — the pre-check above reads the
     auth-time balance snapshot, so concurrent requests all passed it
     against one balance, each burned real provider money, and all but
     the first charge failed. Same price, same action name. */
  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, CREDIT_COST, { action: "Generate Beat" }, { idempotencyKey });
  } catch (deductErr) {
    if (deductErr instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You are out of Visual Bucs. Top up to keep making beats.",
      });
      return;
    }
    if (deductErr instanceof LedgerWriteError) {
      res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed \\u2014 no Visual Bucs were charged. Please try again." });
      return;
    }
    res.status(500).json({ error: deductErr instanceof Error ? deductErr.message : "Generation failed" });
    return;
  }
  let chargeLive = true;
  const refundCharge = async () => {
    if (!chargeLive) return;
    chargeLive = false;
    /* CA-1: a landed refund VOIDS the key so the retry charges fresh. */
    await refundCreditsGuaranteed(req.userId!, CREDIT_COST, { action: "Generate Beat — Refund" }, { idempotencyKey: idempotencyKey });
  };

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
      await refundCharge();
      res.status(502).json({
        error: "Beat generation failed. Try a different vibe or try again shortly.",
        code: "audio_gen_failed",
      });
      return;
    }

    const arrayBuffer = await elevenRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      await refundCharge();
      res.status(502).json({ error: "Beat generation returned no audio.", code: "audio_gen_empty" });
      return;
    }

    const path = `${req.userId}/generated/${Date.now()}-beat.mp3`;
    const r2Key = `audio-stems/${path}`;
    try {
      await r2Upload(r2Key, buffer, "audio/mpeg");
    } catch (upErr) {
      req.log.error({ err: upErr }, "beat/generate: upload failed");
      await refundCharge();
      res.status(500).json({ error: "Could not save the generated beat.", code: "upload_failed" });
      return;
    }
    const beatUrl = r2PublicUrl(r2Key);

    // Save to history (throws → outer catch refunds the reserve).
    const genHistoryId = await recordGenerationHistory({
      userId:         req.userId!,
      generationType: "Generate Beat",
      prompt:         prompt.slice(0, 500),
      content:        beatUrl,
      songTitle:      beatTitle?.trim() || undefined,
      creditsUsed:    CREDIT_COST,
    });

    // (The charge already landed at reserve-at-start, above.)
    // Step 3: Fire-and-forget — mark charged + log usage
    markGenerationHistoryCharged(genHistoryId).catch(() => {});

    const resultBody = {
      url: beatUrl,
      storagePath: path,
      durationMs: musicLengthMs,
      creditsRemaining: creditsAfter,
      genHistoryId,
    };
    await storeGenerationResult("beat-generate", idempotencyKey, req.userId!, resultBody);
    res.json(resultBody);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    req.log.error({ err }, "beat/generate: unexpected error");
    await refundCharge();
    res.status(500).json({ error: message });
  }
});

export default router;
