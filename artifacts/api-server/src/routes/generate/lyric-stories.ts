import { Router } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { generateCoverImageBuffer, storeGeneratedArtwork } from "./cover-art";

const router = Router();

/* ─── Lyric Stories ────────────────────────────────────────────────────────
   POST /api/lyric-stories/generate — 200 Visual Bucs per card (3-5 cards).

   GPT-6 Sol splits the lyrics into `count` story-card moments (each: a lyric
   excerpt + a visual description). Then one 9:16 image per card is generated
   with the SAME image pipeline as cover-art.ts — generateCoverImageBuffer
   and storeGeneratedArtwork are imported from cover-art, not duplicated.

   Billing: 200 × count charged upfront. Images generate sequentially; if a
   card's image fails we refund 200 per failed card and return the successful
   ones with `partial: true`. If ALL fail → full refund + 502. */

const CREDITS_PER_CARD =
  Number(process.env["LYRIC_STORIES_CREDITS_PER_CARD"]) || 200;
const MIN_CARDS = 3;
const MAX_CARDS = 5;

const storiesSchema = z.object({
  lyrics: z.string().min(1, "Lyrics are required.").max(3000),
  count: z.number().int().min(MIN_CARDS).max(MAX_CARDS).optional().default(4),
  style: z.string().max(120).optional().default(""),
});

interface StoryMoment {
  lyricExcerpt: string;
  visualDescription: string;
}

interface StoryCard extends StoryMoment {
  imageUrl: string;
}

function parseMoments(raw: unknown, count: number): StoryMoment[] {
  if (!Array.isArray(raw)) return [];
  const out: StoryMoment[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const e = m as Record<string, unknown>;
    const lyricExcerpt = String(e["lyricExcerpt"] ?? "").trim().slice(0, 500);
    const visualDescription = String(e["visualDescription"] ?? "").trim().slice(0, 800);
    if (!lyricExcerpt || !visualDescription) continue;
    out.push({ lyricExcerpt, visualDescription });
    if (out.length >= count) break;
  }
  return out;
}

/** GPT-6 Sol splits the lyrics into story-card moments. */
async function planStoryMoments(lyrics: string, count: number, style: string): Promise<StoryMoment[]> {
  const completion = await getOpenAI().chat.completions.create({
    model: getTextModel(),
    messages: [
      {
        role: "system",
        content:
          `You are a visual storyteller for music creators. A creator gives you song lyrics; ` +
          `you split them into exactly ${count} story-card moments for vertical 9:16 social ` +
          `stories (Instagram/TikTok/Shorts).\n\n` +
          `For each moment: pick a short lyric excerpt (1-3 lines, VERBATIM from the input, ` +
          `never invented) that hits emotionally on its own, then write a visual description ` +
          `for the artwork behind it — a cinematic 9:16 scene that amplifies the lyric's mood ` +
          `(setting, light, color, subject, atmosphere). Spread the moments across the song: ` +
          `opening image, emotional peak, contrast/bridge moment, closing image. ` +
          `${style ? `Style direction: ${style}.` : ""}\n\n` +
          `Return ONLY JSON:\n` +
          `{"moments": [{"lyricExcerpt": "<verbatim 1-3 lines>", "visualDescription": "<9:16 scene>"}, ...]}\n` +
          `Exactly ${count} moments.`,
      },
      {
        role: "user",
        content: `Split these lyrics into ${count} story cards.\n\n${lyrics.trim()}`,
      },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 2000,
    temperature: 0.7,
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  let moments: StoryMoment[] = [];
  try {
    const j = JSON.parse(raw) as { moments?: unknown };
    moments = parseMoments(j.moments, count);
  } catch { /* fall through to the empty check below */ }
  if (moments.length === 0) {
    throw new Error("The story planner returned no usable lyric moments.");
  }
  return moments;
}

/* POST /api/lyric-stories/generate { lyrics, count?, style? }
   → 200 { cards[{lyricExcerpt, imageUrl, visualDescription}], partial?, creditsUsed, creditsRemaining } */
router.post("/lyric-stories/generate", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = storiesSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid lyric stories request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const { lyrics, count, style } = parsed.data;
  const totalCost = CREDITS_PER_CARD * count;

  const balance = req.userCredits ?? 0;
  if (balance < totalCost) {
    res.status(402).json({
      error: "out_of_credits",
      message: `Not enough Visual Bucs — ${count} lyric story cards cost ${totalCost} Visual Bucs.`,
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, totalCost, {
      action: `Lyric Stories (${count} cards)`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: `Not enough Visual Bucs — ${count} lyric story cards cost ${totalCost} Visual Bucs.`,
      });
      return;
    }
    throw err;
  }

  const refund = async (amount: number, note: string) => {
    try {
      await refundCredits(req.userId!, amount, { action: `Lyric Stories — ${note}` });
    } catch (refundErr) {
      logger.error({ err: refundErr, userId: req.userId }, "[lyric-stories] refund failed");
    }
  };

  try {
    const moments = await planStoryMoments(lyrics, count, style.trim());

    /* Generate sequentially — one card's failure must not kill the others. */
    const cards: StoryCard[] = [];
    let failedCards = 0;
    for (const moment of moments) {
      try {
        const prompt =
          `Vertical 9:16 story card artwork for a music lyric, no text, no words, no letters, no logos. ` +
          `${moment.visualDescription} ` +
          `Mood tied to the lyric "${moment.lyricExcerpt.slice(0, 200)}". ` +
          (style.trim() ? `Style: ${style.trim()}. ` : "") +
          `Cinematic, high detail, premium music-industry quality, composition centered for vertical viewing.`;
        const buffer = await generateCoverImageBuffer({ prompt: prompt.slice(0, 4000), ratio: "9:16", tier: "standard" });
        const stored = await storeGeneratedArtwork(req.userId!, buffer, "lyric-stories");
        cards.push({ ...moment, imageUrl: stored.url });
      } catch (cardErr) {
        failedCards++;
        logger.error(
          { err: cardErr, userId: req.userId, lyricExcerpt: moment.lyricExcerpt.slice(0, 60) },
          "[lyric-stories] card image failed — continuing with remaining cards",
        );
      }
    }

    if (cards.length === 0) {
      /* Total failure — nothing usable. Full refund + 502. */
      await refund(totalCost, "Refund (all cards failed)");
      res.status(502).json({ error: "Story generation failed on every card — your Visual Bucs were refunded.", refunded: true });
      return;
    }

    if (failedCards > 0) {
      /* Partial success — refund the failed cards' share, flag partial. */
      const refundAmount = failedCards * CREDITS_PER_CARD;
      await refund(refundAmount, `Refund (${failedCards} card${failedCards > 1 ? "s" : ""} failed)`);
      const creditsUsed = totalCost - refundAmount;
      res.json({
        cards,
        partial: true,
        creditsUsed,
        creditsRemaining: creditsRemaining + refundAmount,
      });
      return;
    }

    res.json({ cards, creditsUsed: totalCost, creditsRemaining });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lyric story generation failed";
    logger.error({ err, userId: req.userId }, "[lyric-stories] generation failed");
    await refund(totalCost, "Refund (generation failed)");
    res.status(502).json({ error: msg, refunded: true });
  }
});

export default router;
