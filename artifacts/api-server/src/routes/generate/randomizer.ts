import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import { recordCreditUsage } from "../../lib/payment-record";

const router = Router();

/* Category keys — keep in sync with the frontend randomizer page. */
const CATEGORIES = [
  "video-ideas",
  "hooks",
  "thumbnails",
  "song-concepts",
  "niche-picker",
  "challenges",
] as const;
type Category = (typeof CATEGORIES)[number];

/* 1 credit per AI roll — env-overridable without a deploy. At GPT-6 Sol
   pricing a 5-idea roll costs a fraction of a cent in provider fees, so the
   margin is deep; 1 credit keeps it an impulse buy while honoring the
   standing rule that every AI feature costs a fee. */
const RANDOMIZER_CREDITS = Number(process.env["RANDOMIZER_CREDIT_COST"]) || 1;

const randomizerSchema = z.object({
  category: z.enum(CATEGORIES),
});

const CATEGORY_DIRECTION: Record<Category, string> = {
  "video-ideas": "scroll-stopping music video and content ideas for independent artists",
  "hooks": "first-3-second opening hooks that stop the scroll on TikTok, Reels, and Shorts",
  "thumbnails": "high-click-through YouTube thumbnail concepts (describe the visual + the on-image text)",
  "song-concepts": "original song concepts, each with a theme, a fresh angle, and an emotional core",
  "niche-picker": "distinct creator niches and positioning angles a music creator could own",
  "challenges": "content challenges that force daily output and audience growth",
};

/* Text model: centralized in getTextModel() (default gpt-6-sol, env-overridable
   via OPENAI_TEXT_MODEL). Called per-request like every other route —
   do not hardcode model IDs. */

/* POST /api/randomizer { category } → 200 { ideas: string[5], creditsUsed, creditsRemaining }
   Paid: 1 credit per AI roll. Auth required; credits are deducted BEFORE the
   model call using the same pre-check + deductCredits + recordCreditUsage
   pattern as the chat paid mode. */
router.post("/randomizer", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = randomizerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid randomizer request: category is required." });
    return;
  }
  const { category } = parsed.data;

  const balance = req.userCredits ?? 0;
  if (balance < RANDOMIZER_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to keep rolling fresh ideas.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, RANDOMIZER_CREDITS, { action: "Content Randomizer (AI)" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to keep rolling fresh ideas.",
      });
      return;
    }
    throw err;
  }

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a viral content strategist for independent music creators. ` +
            `Generate exactly 5 fresh, specific, actionable ${CATEGORY_DIRECTION[category]}. ` +
            `Each idea must be one punchy sentence (max 25 words), concrete enough to execute today — ` +
            `no generic advice, no duplicates, no filler. Speak directly to the creator ("you"). ` +
            `Return ONLY JSON: {"ideas": ["...", "...", "...", "...", "..."]}.`,
        },
        { role: "user", content: `Give me 5 fresh ${CATEGORY_DIRECTION[category]}.` },
      ],
      response_format: { type: "json_object" },
      max_tokens: 600,
      temperature: 0.9,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let ideas: string[] = [];
    try {
      const parsedJson = JSON.parse(raw) as { ideas?: unknown };
      if (Array.isArray(parsedJson.ideas)) {
        ideas = parsedJson.ideas
          .filter((i): i is string => typeof i === "string" && i.trim().length > 0)
          .map((i) => i.trim())
          .slice(0, 5);
      }
    } catch {
      /* fall through to the empty check below */
    }
    if (ideas.length === 0) {
      throw new Error("Model returned no usable ideas");
    }

    res.json({ ideas, creditsUsed: RANDOMIZER_CREDITS, creditsRemaining });
  } catch (err) {
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err, category }, "[randomizer] OpenAI rate limit / quota");
      res.status(503).json({ error: "The idea machine is catching its breath — try rolling again in a moment." });
      return;
    }
    logger.error({ err, category }, "[randomizer] AI roll failed");
    res.status(502).json({ error: "The idea machine hiccupped — try rolling again." });
  }
});

export default router;
