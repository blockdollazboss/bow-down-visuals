import { Router, type Response } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
} from "../../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../../lib/generation-stored-results";
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


/* ── CA-3 replay protection (charge audit C-38) ───────────────────────
   This rail used to charge with NO idempotency key: a retry of a
   SUCCESSFUL request re-charged and re-ran the work. Now the server
   derives the key from the request intent on EVERY call, a
   stored-result pre-check (durable table, migration 0333, then the
   in-process cache) answers a replay with no charge and no provider
   call, and a failed attempt refunds AND voids its key so a genuine
   retry charges fresh. An identical ask serves the stored result
   with replayed: true instead of charging again (C-36 ruling). */
const LYRIC_STORIES_SCOPE = "lyric-stories";
const LYRIC_STORIES_REPLAY_NOTE =
  "These are the story cards you already made for these lyrics — change the lyrics, count or style for a fresh set.";

interface StoredResult { body: Record<string, unknown>; at: number }
const storedResults = new Map<string, StoredResult>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/** Test hook: forget every stored result and in-flight wait. */
export function __resetLyricStoriesReplayCache(): void {
  storedResults.clear();
  inFlight.clear();
}

/**
 * Serve one replayable run: durable + in-process stored-result
 * pre-checks before any funding, the in-flight twin wait for a
 * concurrent duplicate, then the run itself. A success is stored
 * BEFORE answering (contracts / post-assist pattern); an error body
 * (carrying __status) is answered bare and never stored.
 */
async function serveReplayableRun(args: {
  res: Response;
  userId: string;
  idempotencyKey: string;
  run: () => Promise<Record<string, unknown>>;
}): Promise<void> {
  const { res, userId, idempotencyKey } = args;
  const replayOf = (body: Record<string, unknown>) => ({
    ...body, replayed: true, replayNote: LYRIC_STORIES_REPLAY_NOTE,
  });

  const durable = await findStoredGenerationResult(LYRIC_STORIES_SCOPE, idempotencyKey, userId);
  if (durable) {
    res.json(replayOf(durable));
    return;
  }
  const stored = storedResults.get(idempotencyKey);
  if (stored) {
    res.json(replayOf(stored.body));
    return;
  }
  const pending = inFlight.get(idempotencyKey);
  if (pending) {
    const twinBody = await pending.catch(() => null);
    if (twinBody && typeof twinBody["__status"] !== "number") {
      res.json(replayOf(twinBody));
      return;
    }
    /* The twin failed (refunded + key voided) — fall through fresh. */
  }

  const runPromise = args.run();
  inFlight.set(idempotencyKey, runPromise);
  let body: Record<string, unknown>;
  try {
    body = await runPromise;
  } finally {
    if (inFlight.get(idempotencyKey) === runPromise) inFlight.delete(idempotencyKey);
  }

  const status = typeof body["__status"] === "number" ? (body["__status"] as number) : 200;
  if (status !== 200) {
    const { __status: _ignored, ...errorBody } = body;
    res.status(status).json(errorBody);
    return;
  }

  try {
    if (storedResults.size >= MAX_STORED_RESULTS) {
      const oldest = storedResults.keys().next().value as string | undefined;
      if (oldest !== undefined) storedResults.delete(oldest);
    }
    storedResults.set(idempotencyKey, { body, at: Date.now() });
    await storeGenerationResult(LYRIC_STORIES_SCOPE, idempotencyKey, userId, { ...body });
  } catch { /* storing is best-effort — never fail a paid success over it */ }

  const postCharge = storedResults.get(idempotencyKey);
  if (postCharge && postCharge.body !== body) {
    res.json(replayOf(postCharge.body));
    return;
  }
  res.json(body);
}

async function runLyricStories(
  userId: string,
  userCredits: number,
  data: z.infer<typeof storiesSchema>,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  const { lyrics, count, style } = data;
  const totalCost = CREDITS_PER_CARD * count;

  const balance = userCredits;
  if (balance < totalCost) {
    return {
      __status: 402,
      error: "out_of_credits",
      message: `Not enough Visual Bucs — ${count} lyric story cards cost ${totalCost} Visual Bucs.`,
    };
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(userId, totalCost, {
      action: `Lyric Stories (${count} cards)`,
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return {
        __status: 402,
        error: "out_of_credits",
        message: `Not enough Visual Bucs — ${count} lyric story cards cost ${totalCost} Visual Bucs.`,
      };
    }
    throw err;
  }

  const refund = async (amount: number, note: string): Promise<boolean> => {
    try {
      await refundCredits(userId, amount, { action: `Lyric Stories — ${note}` });
      return true;
    } catch (refundErr) {
      logger.error({ err: refundErr, userId }, "[lyric-stories] refund failed");
      return false;
    }
  };

  /* A TOTAL failure refunds everything: the refunded charge's key is
     VOIDED (CA-3) so a genuine retry charges fresh. A PARTIAL refund
     (some cards made it) is a successful, stored outcome — its key
     stays, and a replay serves the stored cards without re-billing. */
  const refundFullAndVoid = async (note: string) => {
    if (await refund(totalCost, note)) {
      await voidChargeIdempotencyKey(idempotencyKey);
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
        const stored = await storeGeneratedArtwork(userId, buffer, "lyric-stories");
        cards.push({ ...moment, imageUrl: stored.url });
      } catch (cardErr) {
        failedCards++;
        logger.error(
          { err: cardErr, userId, lyricExcerpt: moment.lyricExcerpt.slice(0, 60) },
          "[lyric-stories] card image failed — continuing with remaining cards",
        );
      }
    }

    if (cards.length === 0) {
      /* Total failure — nothing usable. Full refund + 502. */
      await refundFullAndVoid("Refund (all cards failed)");
      return { __status: 502, error: "Story generation failed on every card — your Visual Bucs were refunded.", refunded: true };
    }

    if (failedCards > 0) {
      /* Partial success — refund the failed cards' share, flag partial. */
      const refundAmount = failedCards * CREDITS_PER_CARD;
      await refund(refundAmount, `Refund (${failedCards} card${failedCards > 1 ? "s" : ""} failed)`);
      const creditsUsed = totalCost - refundAmount;
      return {
        cards,
        partial: true,
        creditsUsed,
        creditsRemaining: creditsRemaining + refundAmount,
      };
    }

    return { cards, creditsUsed: totalCost, creditsRemaining };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lyric story generation failed";
    logger.error({ err, userId }, "[lyric-stories] generation failed");
    await refundFullAndVoid("Refund (generation failed)");
    return { __status: 502, error: msg, refunded: true };
  }
}

/* POST /api/lyric-stories/generate { lyrics, count?, style? }
   → 200 { cards[{lyricExcerpt, imageUrl, visualDescription}], partial?, creditsUsed, creditsRemaining } */
router.post("/lyric-stories/generate", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = storiesSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid lyric stories request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const idempotencyKey = buildChargeIdempotencyKey(
    LYRIC_STORIES_SCOPE, req.userId!, undefined, parsed.data,
  );
  await serveReplayableRun({
    res,
    userId: req.userId!,
    idempotencyKey,
    run: () => runLyricStories(req.userId!, req.userCredits ?? 0, parsed.data, idempotencyKey),
  });
});

export default router;
