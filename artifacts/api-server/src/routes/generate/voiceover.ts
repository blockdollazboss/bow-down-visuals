/**
 * voiceover.ts — AI Voiceover Studio backend.
 *
 *  POST /api/voiceover/generate   generate studio-quality narration audio
 *                                 from a script (ElevenLabs TTS)
 *
 * Pricing: 2 credits per minute of generated audio (env-overridable via
 * VOICEOVER_CREDITS_PER_MINUTE). Duration is estimated from word count at
 * ~150 wpm; the charge is taken BEFORE generation (charge-before-generate)
 * and automatically refunded if the provider call fails. If the actual audio
 * comes back shorter than the estimate, the unused minutes are refunded.
 *
 * Voice list comes from the existing GET /api/voices (artist-voices.ts) —
 * this route only handles generation.
 */
import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  LedgerWriteError,
} from "../../lib/credits";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { uploadMediaToSupabaseStorage } from "../../lib/objectStorage";

const router = Router();

/* ── Pricing ─────────────────────────────────────────────────────────── */

/** Credits charged per minute of generated audio. */
export const VOICEOVER_CREDITS_PER_MINUTE =
  Number(process.env["VOICEOVER_CREDITS_PER_MINUTE"]) || 2;

/** Average English speaking rate used for duration estimates. */
export const WORDS_PER_MINUTE = 150;

/** Hard cap on script length (roughly 20 minutes of audio). */
export const MAX_SCRIPT_CHARS = 18_000;

/** ElevenLabs TTS model (env-overridable). */
function ttsModel(): string {
  return process.env["ELEVENLABS_TTS_MODEL"] || "eleven_multilingual_v2";
}

function elevenKey(): string | undefined {
  return process.env["ELEVENLABS_API_KEY"];
}

/* ── Emotional direction → ElevenLabs voice settings ─────────────────── */

export const EMOTIONS = [
  "energetic",
  "calm",
  "dramatic",
  "conversational",
] as const;
export type Emotion = (typeof EMOTIONS)[number];

export const EMOTION_BLURBS: Record<Emotion, string> = {
  energetic: "High energy, punchy delivery — hype intros, ads, announcements",
  calm: "Steady and soothing — tutorials, explainers, meditations",
  dramatic: "Cinematic weight — trailers, storytelling, powerful moments",
  conversational: "Natural and friendly — vlogs, podcasts, casual narration",
};

/**
 * ElevenLabs voice_settings per emotion. Stability controls expressiveness
 * (lower = more varied), style exaggeration pushes the emotional read.
 */
export const EMOTION_SETTINGS: Record<
  Emotion,
  { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean }
> = {
  energetic: { stability: 0.35, similarity_boost: 0.8, style: 0.75, use_speaker_boost: true },
  calm: { stability: 0.7, similarity_boost: 0.7, style: 0.2, use_speaker_boost: true },
  dramatic: { stability: 0.4, similarity_boost: 0.85, style: 0.9, use_speaker_boost: true },
  conversational: { stability: 0.5, similarity_boost: 0.75, style: 0.5, use_speaker_boost: true },
};

/* ── Cost estimation (shared by frontend lib — keep in sync) ─────────── */

export interface VoiceoverEstimate {
  wordCount: number;
  estimatedSeconds: number;
  billableMinutes: number;
  credits: number;
}

export function estimateVoiceoverCost(script: string): VoiceoverEstimate {
  const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
  const estimatedSeconds = Math.ceil((wordCount / WORDS_PER_MINUTE) * 60);
  const billableMinutes = Math.max(1, Math.ceil(estimatedSeconds / 60));
  return {
    wordCount,
    estimatedSeconds,
    billableMinutes,
    credits: billableMinutes * VOICEOVER_CREDITS_PER_MINUTE,
  };
}

/* ── Request validation ──────────────────────────────────────────────── */

const generateSchema = z.object({
  script: z
    .string()
    .min(1, "Script is required.")
    .max(MAX_SCRIPT_CHARS, `Script is too long (max ${MAX_SCRIPT_CHARS} characters).`),
  voiceId: z.string().min(1, "Voice is required.").max(100),
  emotion: z.enum(EMOTIONS).default("conversational"),
  format: z.enum(["mp3", "wav"]).default("mp3"),
  speed: z.number().min(0.7).max(1.2).default(1.0),
});

export interface TtsRequestBody {
  text: string;
  model_id: string;
  voice_settings: {
    stability: number;
    similarity_boost: number;
    style: number;
    use_speaker_boost: boolean;
    speed: number;
  };
}

export function buildTtsRequest(
  script: string,
  emotion: Emotion,
  speed: number,
): TtsRequestBody {
  return {
    text: script,
    model_id: ttsModel(),
    voice_settings: {
      ...EMOTION_SETTINGS[emotion],
      speed,
    },
  };
}

/* ── Supabase upload ─────────────────────────────────────────────────── */

async function uploadVoiceover(
  userId: string,
  audioBytes: Buffer,
  format: "mp3" | "wav",
): Promise<{ url: string; ref: string }> {
  const fileName = `${userId}/voiceover/${randomUUID()}.${format}`;
  const url = await uploadMediaToSupabaseStorage(
    fileName,
    audioBytes,
    format === "wav" ? "audio/wav" : "audio/mpeg",
  );
  return { url, ref: `generated-clips/${fileName}` };
}

/* ── POST /api/voiceover/generate ────────────────────────────────────── */

router.post(
  "/voiceover/generate",
  publicApiLimiter,
  requireAuth,
  async (req, res) => {
    const parsed = generateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid voiceover request.",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }

    const apiKey = elevenKey();
    if (!apiKey) {
      res.status(503).json({ error: "Voice service is not configured on this server." });
      return;
    }

    const { script, voiceId, emotion, format, speed } = parsed.data;
    const estimate = estimateVoiceoverCost(script);
    const actionName = "AI Voiceover";

    const balance = req.userCredits ?? 0;
    if (balance < estimate.credits) {
      res.status(402).json({
        error: "out_of_credits",
        message: `This voiceover needs ${estimate.credits} credits — top up to keep creating.`,
        creditsRequired: estimate.credits,
      });
      return;
    }

    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, estimate.credits, {
        action: actionName,
      });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: `This voiceover needs ${estimate.credits} credits — top up to keep creating.`,
          creditsRequired: estimate.credits,
        });
        return;
      }
      throw err;
    }

    /* Provider call — any failure refunds the full charge. */
    let audioBytes: Buffer;
    try {
      const outputFormat =
        format === "wav" ? "wav_44100_128" : "mp3_44100_128";
      const ttsRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${outputFormat}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildTtsRequest(script, emotion, speed)),
          signal: AbortSignal.timeout(120_000),
        },
      );
      if (!ttsRes.ok) {
        const errText = await ttsRes.text().catch(() => "");
        logger.error(
          { status: ttsRes.status, errText: errText.slice(0, 500) },
          "voiceover: ElevenLabs TTS failed",
        );
        throw new Error(`ElevenLabs TTS failed (${ttsRes.status})`);
      }
      audioBytes = Buffer.from(await ttsRes.arrayBuffer());
      if (audioBytes.length === 0) {
        throw new Error("ElevenLabs returned empty audio");
      }
    } catch (err) {
      await refundCredits(req.userId!, estimate.credits, {
        action: `${actionName} — Refund (provider failed)`,
      }).catch((refundErr) =>
        logger.error({ refundErr }, "voiceover: refund after provider failure failed"),
      );
      res.status(502).json({
        error: "Voice generation failed — your credits were refunded. Please try again.",
      });
      return;
    }

    /* Upload — storage failure also refunds. */
    let upload: { url: string; ref: string };
    try {
      upload = await uploadVoiceover(req.userId!, audioBytes, format);
    } catch (err) {
      logger.error({ err }, "voiceover: upload failed");
      await refundCredits(req.userId!, estimate.credits, {
        action: `${actionName} — Refund (upload failed)`,
      }).catch((refundErr) =>
        logger.error({ refundErr }, "voiceover: refund after upload failure failed"),
      );
      res.status(502).json({
        error: "Voice generated but upload failed — your credits were refunded. Please try again.",
      });
      return;
    }

    res.json({
      audioUrl: upload.url,
      audioRef: upload.ref,
      format,
      emotion,
      voiceId,
      wordCount: estimate.wordCount,
      estimatedSeconds: estimate.estimatedSeconds,
      creditsUsed: estimate.credits,
      creditsRemaining,
    });
  },
);

export default router;
