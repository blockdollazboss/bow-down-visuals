import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

/* ─── Home of Gamers: AI Stream Title & Idea Generator ─────────────────────
   Game + niche + content-type → click-ready stream titles, video ideas, and
   tags for gaming creators. Paid: 1 credit per generation on GPT-6 Sol.
   Credits are deducted BEFORE the model call (charge-before-generate) and
   auto-refunded when generation fails — the academy refund pattern. */

export const CONTENT_TYPES = ["stream", "video", "shorts"] as const;
export type GamersContentType = (typeof CONTENT_TYPES)[number];

const CONTENT_TYPE_DIRECTION: Record<GamersContentType, string> = {
  stream: "a live stream — the titles must work as clickable Twitch/YouTube/Kick stream titles",
  video: "a long-form YouTube gaming video (8-20 minutes)",
  shorts: "short-form vertical clips (TikTok / Shorts / Reels under 60 seconds)",
};

/* 1 credit per generation — env-overridable without a deploy. A titles/ideas
   call is a short GPT-6 Sol completion (a fraction of a cent in provider
   fees), so 1 credit holds a deep margin while staying an impulse buy —
   and honors the standing rule that every AI feature costs a fee. */
export const GAMERS_CREDIT_COST = Number(process.env["GAMERS_CREDIT_COST"]) || 1;

export const gamersIdeasSchema = z.object({
  game: z.string().min(1, "Tell us which game.").max(120),
  niche: z.string().max(120).optional().default(""),
  contentType: z.enum(CONTENT_TYPES),
});

export type GamersIdeasRequest = z.infer<typeof gamersIdeasSchema>;

const router = Router();

async function refundOnFailure(userId: string, action: string): Promise<void> {
  try {
    await refundCredits(userId, GAMERS_CREDIT_COST, {
      action: `${action} — Refund (generation failed)`,
    });
  } catch (refundErr) {
    /* Logged inside refundCredits; don't mask the original failure. */
    void refundErr;
  }
}

/* POST /api/gamers/ideas { game, niche?, contentType }
   → 200 { titles[5], videoIdeas[5], tags[10], creditsUsed, creditsRemaining }
   Paid: 1 credit per generation. Auth required. */
router.post("/gamers/ideas", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = gamersIdeasSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid gamers ideas request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < GAMERS_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to keep generating stream ideas.",
    });
    return;
  }

  const actionName = "Gamers AI: Stream Title & Idea Generator";
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, GAMERS_CREDIT_COST, { action: actionName });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to keep generating stream ideas.",
      });
      return;
    }
    throw err;
  }

  try {
    const { game, niche, contentType } = parsed.data;
    const direction = CONTENT_TYPE_DIRECTION[contentType];
    const nicheLine = niche.trim() ? ` Niche/angle: "${niche.trim()}".` : "";

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a gaming content strategist who lives on Twitch, YouTube Gaming, and Kick. ` +
            `Generate packaging for ${direction} about the game "${game.trim()}".${nicheLine} ` +
            `Write like a creator with 500K subs — hype, specific, zero generic advice. ` +
            `Rules: every title punchy and clickable (max 70 characters, no clickbait lies, no ALL CAPS spam); ` +
            `every video idea a concrete concept with a hook baked in (max 25 words each); ` +
            `tags lowercase, no # symbol, gaming-relevant, mix of broad and niche (max 25 characters each). ` +
            `No duplicates. Return ONLY JSON: {"titles": ["...", "...", "...", "...", "..."], ` +
            `"videoIdeas": ["...", "...", "...", "...", "..."], "tags": ["...", "...", "...", "...", "...", "...", "...", "...", "...", "..."]}.`,
        },
        {
          role: "user",
          content: `Generate stream packaging for "${game.trim()}" (${contentType}).${nicheLine}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 900,
      temperature: 0.9,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let titles: string[] = [];
    let videoIdeas: string[] = [];
    let tags: string[] = [];
    try {
      const parsedJson = JSON.parse(raw) as {
        titles?: unknown; videoIdeas?: unknown; tags?: unknown;
      };
      const clean = (v: unknown, max: number): string[] =>
        Array.isArray(v)
          ? v
              .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
              .map((s) => s.trim().replace(/^#/, ""))
              .slice(0, max)
          : [];
      titles = clean(parsedJson.titles, 5);
      videoIdeas = clean(parsedJson.videoIdeas, 5);
      tags = clean(parsedJson.tags, 10);
    } catch {
      /* fall through to the empty check below */
    }
    if (titles.length === 0 || videoIdeas.length === 0) {
      throw new Error("Model returned no usable ideas");
    }

    res.json({ titles, videoIdeas, tags, creditsUsed: GAMERS_CREDIT_COST, creditsRemaining });
    return;
  } catch (err) {
    await refundOnFailure(req.userId!, actionName);
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[gamers] OpenAI rate limit / quota");
      res.status(503).json({ error: "The arena is packed — try again in a moment." });
      return;
    }
    logger.error({ err }, "[gamers] ideas generation failed");
    res.status(502).json({ error: "Lag spike — the generator hiccupped. Your credit was refunded." });
  }
});

export default router;
