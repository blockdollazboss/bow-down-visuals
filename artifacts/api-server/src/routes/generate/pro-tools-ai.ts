import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { logger } from "../../lib/logger";

/* ── Pro Tools: AI Auto-Grade ─────────────────────────────────────────────
 * POST /api/pro-tools/auto-grade { frameDataUrl?, look? }
 * → 200 { correction: ColorCorrectionSettings, usedVision: boolean,
 *         creditsUsed, creditsRemaining }
 *
 * Paid: 1 credit per generation (env-overridable via PRO_TOOLS_AI_CREDITS).
 * Credits are deducted BEFORE the model call (charge-before-generate) and
 * auto-refunded when generation fails.
 *
 * How it works:
 *  1. The frontend captures the current clip frame as a JPEG data URL and
 *     optionally a text description of the desired look ("warm cinematic").
 *  2. The vision-capable text model (getTextModel(), default gpt-6-sol)
 *     analyzes the frame and returns optimal -100..100 slider values.
 *  3. If the model rejects the image input (no vision support), we retry
 *     text-only from the `look` description so the feature still works.
 *     usedVision=false flags the fallback in the response.
 */

export const PRO_TOOLS_AI_CREDITS = Number(process.env["PRO_TOOLS_AI_CREDITS"] ?? 1) || 1;

const SLIDER_KEYS = [
  "brightness", "contrast", "saturation", "temperature", "tint",
  "highlights", "shadows", "vibrance", "exposure",
] as const;

type SliderKey = (typeof SLIDER_KEYS)[number];

const autoGradeSchema = z.object({
  /** JPEG data URL of the current clip frame (from canvas capture). */
  frameDataUrl: z.string().max(2_000_000).optional().default(""),
  /** Optional look description, e.g. "warm cinematic music video". */
  look: z.string().max(200).optional().default(""),
});

const router = Router();

function clampSlider(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
  return Math.max(-100, Math.min(100, n));
}

function parseCorrection(raw: string): Record<SliderKey, number> | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = {} as Record<SliderKey, number>;
    for (const k of SLIDER_KEYS) out[k] = clampSlider(parsed[k]);
    return out;
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT =
  `You are a professional colorist for music videos. Given a video frame (and/or a ` +
  `description of the desired look), return optimal color-correction slider values. ` +
  `Every value is an integer from -100 to 100, 0 = neutral:\n` +
  `- brightness: overall lift (-100 dark … 100 bright)\n` +
  `- contrast: punch (-100 flat … 100 punchy)\n` +
  `- saturation: color intensity (-100 B&W … 100 vivid)\n` +
  `- temperature: white balance (-100 cool/blue … 100 warm/orange)\n` +
  `- tint: green↔magenta (-100 green … 100 magenta)\n` +
  `- highlights: highlight rolloff (-100 crushed … 100 lifted)\n` +
  `- shadows: shadow detail (-100 crushed … 100 lifted)\n` +
  `- vibrance: smart saturation protecting skin tones (-100 … 100)\n` +
  `- exposure: exposure lift (-100 … 100)\n` +
  `Fix exposure problems you see in the frame first, then apply the requested look. ` +
  `Be decisive — avoid all-zeros unless the frame is already perfect. ` +
  `Return ONLY JSON: {"brightness":0,"contrast":0,"saturation":0,"temperature":0,` +
  `"tint":0,"highlights":0,"shadows":0,"vibrance":0,"exposure":0}.`;

async function refundOnFailure(userId: string): Promise<void> {
  try {
    await refundCredits(userId, PRO_TOOLS_AI_CREDITS, {
      action: "AI Auto-Grade — Refund (generation failed)",
    });
  } catch (refundErr) {
    void refundErr; // Logged inside refundCredits; don't mask the original failure.
  }
}

router.post("/pro-tools/auto-grade", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = autoGradeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid auto-grade request." });
    return;
  }
  const { frameDataUrl, look } = parsed.data;
  if (!frameDataUrl && !look.trim()) {
    res.status(400).json({ error: "Provide a frame capture or a look description." });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < PRO_TOOLS_AI_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to use AI Auto-Grade.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, PRO_TOOLS_AI_CREDITS, {
      action: "AI Auto-Grade",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to use AI Auto-Grade.",
      });
      return;
    }
    throw err;
  }

  try {
    const userText = look.trim()
      ? `Desired look: "${look.trim()}". Analyze the frame and return slider values for this look.`
      : "Analyze the frame and return balanced, professional slider values.";

    let usedVision = false;
    let raw: string | null = null;

    // Attempt 1: vision analysis when a frame was provided.
    if (frameDataUrl.startsWith("data:image/")) {
      try {
        const completion = await getOpenAI().chat.completions.create({
          model: getTextModel(),
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: userText },
                { type: "image_url", image_url: { url: frameDataUrl } },
              ],
            },
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 400,
          temperature: 0.4,
        });
        raw = completion.choices[0]?.message?.content ?? null;
        usedVision = true;
      } catch (visionErr) {
        // Model may not support image input — fall through to text-only retry.
        logger.warn({ err: visionErr }, "[pro-tools] vision auto-grade failed, retrying text-only");
      }
    }

    // Attempt 2: text-only fallback (no frame, or vision unsupported).
    if (!raw) {
      const completion = await getOpenAI().chat.completions.create({
        model: getTextModel(),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: look.trim()
              ? `No frame available. ${userText}`
              : "No frame available. Return a balanced, professional music-video grade.",
          },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 400,
        temperature: 0.4,
      });
      raw = completion.choices[0]?.message?.content ?? null;
    }

    const correction = raw ? parseCorrection(raw) : null;
    if (!correction) throw new Error("Model returned unparseable correction JSON");

    res.json({ correction, usedVision, creditsUsed: PRO_TOOLS_AI_CREDITS, creditsRemaining });
  } catch (err) {
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[pro-tools] OpenAI rate limit / quota");
      await refundOnFailure(req.userId!);
      res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[pro-tools] auto-grade failed");
    await refundOnFailure(req.userId!);
    res.status(502).json({ error: "The studio hiccupped — try again." });
  }
});

export default router;
