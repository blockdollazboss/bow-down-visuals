/**
 * chat-speak.ts — Thy Cheat Code speaks a chat reply out loud.
 *
 *  GET  /api/chat/speak/status   → { ready, creditCost } — the chat
 *      drawer reads readiness + the per-reply price from here, never
 *      from a hardcoded client constant.
 *  POST /api/chat/speak          → synthesize one assistant reply in
 *      Thy Cheat Code's own voice and return a playable URL.
 *
 * Voice: the King's voice is a designed ElevenLabs voice whose id is
 * configured server-side via THY_CHEAT_CODE_VOICE_ID (the
 * PODCAST_INTRO_VOICE_ID precedent — a named env, never a code
 * constant). Until that env is set the voice is still being cast:
 * status reports ready:false and POST answers a distinct 503
 * `voice_not_ready` — and NEVER charges.
 *
 * Pricing: CHAT_SPEAK_CREDITS per spoken reply (env-overridable,
 * default 100 — owner ruling Oct 20, 2026: spoken replies cost a
 * small Visual Bucs price each). Money discipline is the voiceover
 * rail's: balance pre-check, charge BEFORE the provider call with an
 * idempotency key (a client retry of the same speak can never
 * double-charge), and any provider/storage failure refunds the
 * charge AND voids the idempotency key so a fresh attempt charges
 * again — a failed speak nets zero.
 *
 * The ElevenLabs call rides the exact pattern of
 * routes/generate/voiceover.ts (same key handling, same request
 * builder, same error discipline, same storage handoff).
 */
import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  voidChargeIdempotencyKey,
  buildChargeIdempotencyKey,
  OutOfCreditsError,
  LedgerWriteError,
} from "../lib/credits";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { refreshSupabaseStorageUrl, uploadMediaToSupabaseStorage } from "../lib/objectStorage";
import { buildTtsRequest } from "./generate/voiceover";

const router = Router();

/* ── Pricing + voice config ──────────────────────────────────────────── */

/** Visual Bucs per spoken reply (owner ruling Oct 20, 2026). */
export const CHAT_SPEAK_CREDITS =
  Number(process.env["CHAT_SPEAK_CREDITS"]) || 100;

/**
 * Hard cap on reply text, derived from the chat contract itself:
 * both chat routes cap message/history content at 2,000 chars and the
 * assistant's output is capped at CHAT_MAX_OUTPUT_TOKENS = 500
 * (lib/ai-chat-assistant.ts), so no real reply can exceed ~2,000
 * chars. Longer input is refused honestly — never truncated, since
 * truncating mid-reply would charge for a partial read.
 */
export const MAX_SPEAK_TEXT_CHARS = 2_000;

/** Thy Cheat Code's ElevenLabs voice id — unset = still being cast. */
export function kingVoiceId(): string | undefined {
  return process.env["THY_CHEAT_CODE_VOICE_ID"] || undefined;
}

function elevenKey(): string | undefined {
  return process.env["ELEVENLABS_API_KEY"];
}

/** Readiness = the voice is cast AND the voice service is configured. */
export function chatSpeakReady(): boolean {
  return Boolean(kingVoiceId() && elevenKey());
}

/* ── Request validation ──────────────────────────────────────────────── */

const speakSchema = z.object({
  text: z
    .string()
    .min(1, "Reply text is required.")
    .max(
      MAX_SPEAK_TEXT_CHARS,
      `That reply is too long to speak (max ${MAX_SPEAK_TEXT_CHARS} characters).`,
    ),
  idempotencyKey: z.string().max(128).optional(),
});

/* ── GET /api/chat/speak/status ──────────────────────────────────────── */

router.get("/chat/speak/status", (_req, res) => {
  res.json({ ready: chatSpeakReady(), creditCost: CHAT_SPEAK_CREDITS });
});

/* ── POST /api/chat/speak ────────────────────────────────────────────── */

router.post(
  "/chat/speak",
  publicApiLimiter,
  requireAuth,
  async (req, res) => {
    const parsed = speakSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid speak request.",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }

    /* Not-ready gate — before any balance check or charge. An unset
       voice env is a casting state, not an error the user pays for. */
    const voiceId = kingVoiceId();
    if (!voiceId) {
      res.status(503).json({
        error: "voice_not_ready",
        message:
          "Thy Cheat Code's voice is still being cast — spoken replies aren't ready yet. Nothing was charged.",
      });
      return;
    }

    const apiKey = elevenKey();
    if (!apiKey) {
      res.status(503).json({ error: "Voice service is not configured on this server." });
      return;
    }

    const { text } = parsed.data;
    const actionName = "Thy Cheat Code — Spoken Reply";

    const balance = req.userCredits ?? 0;
    if (balance < CHAT_SPEAK_CREDITS) {
      res.status(402).json({
        error: "out_of_credits",
        message: `Hearing Thy Cheat Code speak costs ${CHAT_SPEAK_CREDITS} Visual Bucs — top up to keep creating.`,
        creditsRequired: CHAT_SPEAK_CREDITS,
      });
      return;
    }

    /* One key per (user, speak-intent): the client sends a stable key
       per reply it wants spoken; the derived fallback hashes the text
       itself. Either way a retry of the same speak can't double-charge. */
    const idempotencyKey = buildChargeIdempotencyKey(
      "chat-speak",
      req.userId!,
      parsed.data.idempotencyKey,
      text,
    );

    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, CHAT_SPEAK_CREDITS, {
        action: actionName,
      }, { idempotencyKey });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: `Hearing Thy Cheat Code speak costs ${CHAT_SPEAK_CREDITS} Visual Bucs — top up to keep creating.`,
          creditsRequired: CHAT_SPEAK_CREDITS,
        });
        return;
      }
      if (err instanceof LedgerWriteError) {
        res.status(500).json({
          error: "ledger_write_failed",
          message: "Credit ledger write failed — no Visual Bucs were charged. Please try again.",
        });
        return;
      }
      throw err;
    }

    /* Shared failure path: refund the charge and void its idempotency
       key, so the failed speak nets zero and a retry charges fresh. */
    const refundAndVoid = async (reason: string) => {
      await refundCredits(req.userId!, CHAT_SPEAK_CREDITS, {
        action: `${actionName} — Refund (${reason})`,
      }).catch((refundErr) =>
        logger.error({ refundErr }, "chat-speak: refund after failure failed"),
      );
      await voidChargeIdempotencyKey(idempotencyKey);
    };

    /* Provider call — the voiceover rail's ElevenLabs pattern. */
    let audioBytes: Buffer;
    try {
      const ttsRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          /* The King's register: dramatic delivery, natural speed. */
          body: JSON.stringify(buildTtsRequest(text, "dramatic", 1.0)),
          signal: AbortSignal.timeout(120_000),
        },
      );
      if (!ttsRes.ok) {
        const errText = await ttsRes.text().catch(() => "");
        logger.error(
          { status: ttsRes.status, errText: errText.slice(0, 500) },
          "chat-speak: ElevenLabs TTS failed",
        );
        throw new Error(`ElevenLabs TTS failed (${ttsRes.status})`);
      }
      audioBytes = Buffer.from(await ttsRes.arrayBuffer());
      if (audioBytes.length === 0) {
        throw new Error("ElevenLabs returned empty audio");
      }
    } catch (err) {
      await refundAndVoid("provider failed");
      res.status(502).json({
        error: "Voice generation failed — your Visual Bucs were refunded. Please try again.",
      });
      return;
    }

    /* Storage handoff — same bucket/shape as the voiceover rail. */
    let audioUrl: string;
    let audioRef: string;
    try {
      const fileName = `${req.userId!}/chat-speak/${randomUUID()}.mp3`;
      audioUrl = await uploadMediaToSupabaseStorage(fileName, audioBytes, "audio/mpeg");
      audioRef = `generated-clips/${fileName}`;
    } catch (err) {
      logger.error({ err }, "chat-speak: upload failed");
      await refundAndVoid("upload failed");
      res.status(502).json({
        error: "Voice generated but upload failed — your Visual Bucs were refunded. Please try again.",
      });
      return;
    }

    /* Playable URL for immediate playback. The stable storage ref in
       audioUrl can't be played directly by browsers. */
    const audioPlayUrl = await refreshSupabaseStorageUrl(audioUrl);

    res.json({
      audioUrl,
      audioRef,
      audioPlayUrl,
      creditsUsed: CHAT_SPEAK_CREDITS,
      creditsRemaining,
    });
  },
);

export default router;
