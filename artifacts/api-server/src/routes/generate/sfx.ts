import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import {
  recordGenerationHistory,
  markGenerationHistoryCharged,
} from "../../lib/payment-record";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  LedgerWriteError,
} from "../../lib/credits";
import {
  SFX_CREDIT_COST,
  SFX_CATEGORY_KEYS,
  isSfxCategoryKey,
  clampSfxDuration,
  buildSfxPrompt,
  type SfxCategoryKey,
} from "./sfx-pricing";

const router = Router();
const BUCKET = "audio-stems";

/* ElevenLabs Text to Sound Effects.
   POST https://api.elevenlabs.io/v1/sound-generation
   { text, duration_seconds, prompt_influence } → audio/mpeg bytes.
   Model choice is implicit (ElevenLabs' current SFX model); override the
   endpoint via ELEVENLABS_SFX_URL if they ever version it. */
const SFX_URL =
  process.env["ELEVENLABS_SFX_URL"] ??
  "https://api.elevenlabs.io/v1/sound-generation";

const generateSfxSchema = z.object({
  prompt: z
    .string()
    .min(3, "Describe the sound in a few words.")
    .max(500, "Keep the description under 500 characters."),
  durationSeconds: z.number().min(1).max(10).optional().default(3),
  category: z
    .string()
    .refine(isSfxCategoryKey, {
      message: `category must be one of: ${SFX_CATEGORY_KEYS.join(", ")}`,
    })
    .optional()
    .default("foley"),
});

/* POST /api/generate-sfx { prompt, durationSeconds, category } →
   200 { url, storagePath, durationSeconds, category, creditsUsed, creditsRemaining, genHistoryId }
   Paid: 1 credit per SFX. Auth required; credits are charged BEFORE the
   provider call and refunded if generation or storage fails. */
router.post(
  "/generate-sfx",
  publicApiLimiter,
  requireAuth,
  async (req, res) => {
    const parsed = generateSfxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid text-to-sfx request.",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }

    const apiKey = process.env["ELEVENLABS_API_KEY"];
    if (!apiKey) {
      logger.error("[sfx] missing ELEVENLABS_API_KEY");
      res.status(503).json({
        error: "Sound generation isn't configured on this server yet.",
        code: "sfx_unavailable",
      });
      return;
    }

    const balance = req.userCredits ?? 0;
    if (balance < SFX_CREDIT_COST) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to keep generating sound effects.",
      });
      return;
    }

    /* Charge BEFORE the provider call; refund on any failure below. */
    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, SFX_CREDIT_COST, {
        action: "Text-to-SFX",
      });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You're out of credits — top up to keep generating sound effects.",
        });
        return;
      }
      throw err;
    }

    const refundOnFailure = async () => {
      try {
        await refundCredits(req.userId!, SFX_CREDIT_COST, {
          action: "Text-to-SFX — Refund (generation failed)",
        });
      } catch (refundErr) {
        logger.error(
          { err: refundErr, userId: req.userId },
          "[sfx] refund failed after generation error",
        );
      }
    };

    try {
      const { prompt, durationSeconds, category } = parsed.data;
      const safeDuration = clampSfxDuration(durationSeconds);
      const categoryKey = category as SfxCategoryKey;
      const providerPrompt = buildSfxPrompt(prompt, categoryKey);

      const elevenRes = await fetch(SFX_URL, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: providerPrompt,
          duration_seconds: safeDuration,
          prompt_influence: 0.3,
        }),
      });

      if (!elevenRes.ok) {
        const errText = await elevenRes.text().catch(() => "");
        logger.error(
          { status: elevenRes.status, errText },
          "[sfx] ElevenLabs sound-generation failed",
        );
        await refundOnFailure();
        res.status(502).json({
          error: "Sound generation failed. Try a different description or try again shortly.",
          code: "sfx_gen_failed",
        });
        return;
      }

      const buffer = Buffer.from(await elevenRes.arrayBuffer());
      if (buffer.length === 0) {
        await refundOnFailure();
        res.status(502).json({
          error: "Sound generation returned no audio.",
          code: "sfx_gen_empty",
        });
        return;
      }

      const sb = req.userSupabase!;
      const path = `${req.userId}/sfx/${Date.now()}-sfx.mp3`;
      const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buffer, {
        contentType: "audio/mpeg",
        upsert: true,
      });
      if (upErr) {
        logger.error({ err: upErr }, "[sfx] bucket upload failed");
        await refundOnFailure();
        res.status(500).json({
          error: "Could not save the generated sound.",
          code: "upload_failed",
        });
        return;
      }
      const { data } = sb.storage.from(BUCKET).getPublicUrl(path);

      /* Save to history FIRST (throws → 500, and we refund below via catch). */
      const genHistoryId = await recordGenerationHistory({
        userId: req.userId!,
        generationType: "Generate SFX",
        prompt: prompt.trim().slice(0, 500),
        content: data.publicUrl,
        creditsUsed: SFX_CREDIT_COST,
      });

      /* Fire-and-forget — mark charged + log usage. */
      markGenerationHistoryCharged(genHistoryId).catch(() => {});

      res.json({
        url: data.publicUrl,
        storagePath: path,
        durationSeconds: safeDuration,
        category: categoryKey,
        creditsUsed: SFX_CREDIT_COST,
        creditsRemaining,
        genHistoryId,
      });
    } catch (err: unknown) {
      await refundOnFailure();
      if (err instanceof LedgerWriteError) {
        res.status(500).json({
          error: "ledger_write_failed",
          message: "Credit ledger write failed — no credits were charged. Please try again.",
        });
        return;
      }
      logger.error({ err }, "[sfx] unexpected error");
      res.status(500).json({ error: "Sound generation failed — try again." });
    }
  },
);

/* GET /api/sfx/library — the user's saved SFX, newest first.
   Reads generation history filtered to the "Generate SFX" type so the
   library survives restarts (no in-memory state). Free — pure data read. */
router.get("/sfx/library", requireAuth, async (req, res) => {
  try {
    const { getGenerationHistory } = await import("../../lib/payment-record");
    const rows = await getGenerationHistory(req.userId!);
    const items = rows
      .filter((r) => r.generationType === "Generate SFX" && !r.refunded)
      .map((r) => {
        const result =
          typeof r.result === "object" && r.result !== null
            ? (r.result as { content?: string })
            : {};
        return {
          id: r.id,
          prompt: r.prompt ?? "",
          url: result.content ?? "",
          creditsUsed: r.creditsUsed,
          createdAt: r.createdAt,
        };
      })
      .filter((i) => i.url);
    res.json({ items });
  } catch (err: unknown) {
    logger.error({ err }, "[sfx] library load failed");
    res.status(500).json({ error: "Failed to load your SFX library." });
  }
});

export default router;
