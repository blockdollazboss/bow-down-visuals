import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel, LOW_REASONING_PARAMS } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError, buildChargeIdempotencyKey, voidChargeIdempotencyKey } from "../../lib/credits";
import { recordCreditUsage } from "../../lib/payment-record";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../../lib/generation-stored-results";

/* CA-5: replay note served with a stored result (C-36 honesty). */
const REPLAY_NOTE = "These are the ideas you already rolled for this request — pick a different category for a fresh roll.";

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
const RANDOMIZER_CREDITS = Number(process.env["RANDOMIZER_CREDIT_COST"]) || 100;

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

/* Text model: centralized in getTextModel() (default gpt-6.1-sol, env-overridable
   via OPENAI_TEXT_MODEL). Called per-request like every other route —
   do not hardcode model IDs. */

/* The charge lands BEFORE the model call; any failure after it refunds
   the exact charged amount (D5 sweep G12 — the refundOnFailure pattern
   from academy.ts). CA-5: a landed refund also VOIDS the charge's
   idempotency key, so the retry charges fresh instead of being
   suppressed as a replay and running free. */
async function refundOnFailure(userId: string, idempotencyKey?: string): Promise<void> {
  let refunded = true;
  try {
    await refundCredits(userId, RANDOMIZER_CREDITS, {
      action: "Content Randomizer (AI) — Refund (generation failed)",
    });
  } catch (refundErr) {
    refunded = false;
    /* Logged inside refundCredits; don't mask the original failure. */
    void refundErr;
  }
  if (refunded && idempotencyKey) {
    await voidChargeIdempotencyKey(idempotencyKey).catch(() => false);
  }
}

/* POST /api/randomizer { category } → 200 { ideas: string[5], creditsUsed, creditsRemaining }
   Paid: 1 credit per AI roll. Auth required; credits are deducted BEFORE the
   model call using the same pre-check + deductCredits + recordCreditUsage
   pattern as the chat paid mode. */
router.post("/randomizer", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = randomizerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid randomizer request: category is required." });
    return;
  }
  const { category } = parsed.data;

  /* CA-5 (house stored-result pattern): one key per (member, intent).
     The stored-result pre-check runs BEFORE any funding — a replay of
     a landed roll is served from the durable table (migration 0333),
     never re-charged and never re-rolled. Fail-open. */
  const idempotencyKey = buildChargeIdempotencyKey("randomizer", req.userId!, null, {
    category,
  });
  const durable = await findStoredGenerationResult("randomizer", idempotencyKey, req.userId!);
  if (durable && Array.isArray(durable["ideas"])) {
    res.json({ ...durable, replayed: true, replayNote: REPLAY_NOTE });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < RANDOMIZER_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to keep rolling fresh ideas.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, RANDOMIZER_CREDITS, { action: "Content Randomizer (AI)" }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to keep rolling fresh ideas.",
      });
      return;
    }
    throw err;
  }

  try {
    const completion = await getOpenAI().chat.completions.create({
      ...LOW_REASONING_PARAMS,
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
      max_completion_tokens: 600,
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

    const body = { ideas, creditsUsed: RANDOMIZER_CREDITS, creditsRemaining };
    /* Persist BEFORE answering: the row is what a replay is served
       from. Fail-open inside the helper. */
    await storeGenerationResult("randomizer", idempotencyKey, req.userId!, { ...body });
    res.json(body);
  } catch (err) {
    await refundOnFailure(req.userId!, idempotencyKey);
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
