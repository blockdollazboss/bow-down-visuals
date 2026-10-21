import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

const router = Router();

/* ─── CTA Generator ────────────────────────────────────────────────────────
   Every video needs a strong call-to-action. Generates 10 CTA variants for
   a video topic + goal + platform + tone, ranked by strength (descending),
   each tagged with a placement (opener / mid-roll / closer / pinned-comment).
   50 Visual Bucs per generation (env-overridable). Mounted inside Hook
   Studio (/hooks) as the "CTA Generator" tab. */

const CTA_GOALS = ["subscribe", "comment", "share", "follow", "buy", "stream"] as const;
type CtaGoal = (typeof CTA_GOALS)[number];

const PLATFORMS = ["tiktok", "instagram", "youtube", "twitter", "facebook"] as const;

const PLACEMENTS = ["opener", "mid-roll", "closer", "pinned-comment"] as const;
type Placement = (typeof PLACEMENTS)[number];

const GOAL_DIRECTION: Record<CtaGoal, string> = {
  subscribe: "get viewers to subscribe to the channel",
  comment: "spark comments and conversation under the video",
  share: "get viewers to share the video with someone who needs it",
  follow: "get viewers to follow the creator's profile",
  buy: "drive purchases of the product, merch, or release being featured",
  stream: "drive streams/plays of the song or release being featured",
};

const CTA_GENERATOR_CREDITS = Number(process.env["CTA_GENERATOR_CREDITS"]) || 50;

const ctaSchema = z.object({
  videoTopic: z.string().min(1, "Tell us what the video is about.").max(300),
  ctaGoal: z.enum(CTA_GOALS),
  platform: z.enum(PLATFORMS).default("tiktok"),
  tone: z.string().max(100).optional().default(""),
});

interface CtaVariant {
  text: string;
  placement: Placement;
  strength: number;
}

/* POST /api/generate-cta { videoTopic, ctaGoal, platform?, tone? }
   → 200 { ctas: [{ text, placement, strength }] (ranked desc), creditsUsed, creditsRemaining }
   Paid: 50 Visual Bucs per generation. Auth required. 402 pre-check, then
   chargeCredits BEFORE the model call, auto-refund on model failure. */
router.post("/generate-cta", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = ctaSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid CTA request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < CTA_GENERATOR_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to keep using the CTA Generator.",
    });
    return;
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, CTA_GENERATOR_CREDITS, {
      action: "CTA Generator",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to keep using the CTA Generator.",
      });
      return;
    }
    throw err;
  }

  try {
    const { videoTopic, ctaGoal, platform, tone } = parsed.data;
    const direction = GOAL_DIRECTION[ctaGoal];
    const toneLine = tone.trim() ? ` Tone/vibe: "${tone.trim()}".` : "";

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a direct-response copywriter for content creators. Write calls-to-action ` +
            `that actually convert — one punchy line each, spoken-style, no corporate speak, no ` +
            `passive voice, no begging. Every CTA must drive ONE goal: ${direction}. ` +
            `Write for ${platform} (match its native format and culture). ` +
            `Generate exactly 10 distinct CTA variants and tag each with the best placement: ` +
            `"opener" (first 5 seconds), "mid-roll" (mid-video retention save), "closer" (final ` +
            `5 seconds), or "pinned-comment" (written to pin under the video). Vary placements — ` +
            `do not put all 10 in one bucket. Score each variant's strength 0-100 (specificity, ` +
            `urgency, curiosity, ease of action) and rank the list strongest first. ` +
            `Return ONLY JSON: {"ctas": [{"text": "...", "placement": "<opener|mid-roll|closer|pinned-comment>", ` +
            `"strength": <0-100>}, ...]} with exactly 10 entries.`,
        },
        {
          role: "user",
          content: `Write 10 ranked CTAs for a video about: "${videoTopic.trim()}".${toneLine}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1200,
      temperature: 0.85,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let ctas: CtaVariant[] = [];
    try {
      const parsedJson = JSON.parse(raw) as { ctas?: unknown };
      if (Array.isArray(parsedJson.ctas)) {
        ctas = parsedJson.ctas
          .filter(
            (c): c is { text: string; placement: string; strength: number } =>
              !!c &&
              typeof (c as { text?: unknown }).text === "string" &&
              (c as { text: string }).text.trim().length > 0 &&
              typeof (c as { strength?: unknown }).strength === "number"
          )
          .map((c) => ({
            text: c.text.trim(),
            placement: (PLACEMENTS as readonly string[]).includes(c.placement)
              ? (c.placement as Placement)
              : "closer",
            strength: Math.max(0, Math.min(100, Math.round(c.strength))),
          }))
          .slice(0, 10);
      }
    } catch {
      /* fall through to the empty check below */
    }
    if (ctas.length === 0) {
      throw new Error("Model returned no usable CTAs");
    }
    ctas.sort((a, b) => b.strength - a.strength);

    res.json({ ctas, creditsUsed: CTA_GENERATOR_CREDITS, creditsRemaining });
  } catch (err) {
    await refundCredits(req.userId!, CTA_GENERATOR_CREDITS, {
      action: "CTA Generator — Refund",
    }).catch(() => {});
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[cta-generator] OpenAI rate limit / quota");
      res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[cta-generator] generation failed");
    res.status(502).json({ error: "The studio hiccupped — try again." });
  }
});

export default router;
