import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel, LOW_REASONING_PARAMS } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, buildChargeIdempotencyKey, voidChargeIdempotencyKey } from "../../lib/credits";
import { findStoredGenerationResult, storeGenerationResult } from "../../lib/generation-stored-results";

/* ─── Home of Gamers: AI Stream Title & Idea Generator ─────────────────────
   Game + niche + content-type → click-ready stream titles, video ideas, and
   tags for gaming creators. Paid: 100 Visual Bucs per generation.
   Credits are deducted BEFORE the model call (charge-before-generate) and
   auto-refunded when generation fails — the academy refund pattern. */

export const CONTENT_TYPES = ["stream", "video", "shorts"] as const;
type GamersContentType = (typeof CONTENT_TYPES)[number];

const CONTENT_TYPE_DIRECTION: Record<GamersContentType, string> = {
  stream: "a live stream — the titles must work as clickable Twitch/YouTube/Kick stream titles",
  video: "a long-form YouTube gaming video (8-20 minutes)",
  shorts: "short-form vertical clips (TikTok / Shorts / Reels under 60 seconds)",
};

/* 100 Visual Bucs per generation — env-overridable without a deploy.
   The pre-rescale price was 1 Buc; the default moved with the site-wide
   ×100 rescale, and the FE registry row for /api/gamers/ideas records
   the same 100 — display surfaces derive from that row, never from a
   second literal (QC-200 fix #5 closed the last "1 Buc" stat). */
export const GAMERS_CREDIT_COST = Number(process.env["GAMERS_CREDIT_COST"]) || 100;

export const gamersIdeasSchema = z.object({
  game: z.string().min(1, "Tell us which game.").max(120),
  niche: z.string().max(120).optional().default(""),
  contentType: z.enum(CONTENT_TYPES),
});


const router = Router();

async function refundOnFailure(userId: string, action: string, idempotencyKey: string): Promise<void> {
  try {
    await refundCredits(userId, GAMERS_CREDIT_COST, {
      action: `${action} — Refund (generation failed)`,
    });
    await voidChargeIdempotencyKey(idempotencyKey);
  } catch (refundErr) {
    /* Logged inside refundCredits; don't mask the original failure. */
    void refundErr;
  }
}

/* POST /api/gamers/ideas { game, niche?, contentType }
   → 200 { titles[5], videoIdeas[5], tags[10], creditsUsed, creditsRemaining }
   Paid: 100 Visual Bucs per generation. Auth required. */
router.post("/gamers/ideas", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = gamersIdeasSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid gamers ideas request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const idempotencyKey = buildChargeIdempotencyKey(
    "gamers", req.userId!, undefined,
    { game: parsed.data.game, niche: parsed.data.niche, contentType: parsed.data.contentType },
  );
  const storedReplay = await findStoredGenerationResult("gamers", idempotencyKey, req.userId!);
  if (storedReplay) {
    res.json({ ...storedReplay, replayed: true });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < GAMERS_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to keep generating stream ideas.",
    });
    return;
  }

  const actionName = "Gamers AI: Stream Title & Idea Generator";
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, GAMERS_CREDIT_COST, { action: actionName }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to keep generating stream ideas.",
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
      ...LOW_REASONING_PARAMS,
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

    const body = { titles, videoIdeas, tags, creditsUsed: GAMERS_CREDIT_COST, creditsRemaining };
    await storeGenerationResult("gamers", idempotencyKey, req.userId!, body as Record<string, unknown>);
    res.json(body);
    return;
  } catch (err) {
    await refundOnFailure(req.userId!, actionName, idempotencyKey);
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[gamers] OpenAI rate limit / quota");
      res.status(503).json({ error: "The arena is packed — try again in a moment." });
      return;
    }
    logger.error({ err }, "[gamers] ideas generation failed");
    res.status(502).json({ error: "Lag spike — the generator hiccupped. Your Visual Bucs were refunded." });
  }
});

export default router;
