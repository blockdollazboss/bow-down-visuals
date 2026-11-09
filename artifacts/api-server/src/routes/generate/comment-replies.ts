import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel, LOW_REASONING_PARAMS } from "../../lib/ai-clients";
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

const router = Router();

/* Tones for the Comment Reply Assistant — keep in sync with the frontend
   /comment-replies page. */
const TONES = ["hype", "grateful", "playful", "professional"] as const;
type Tone = (typeof TONES)[number];

const TONE_DIRECTION: Record<Tone, string> = {
  hype: "high-energy hype — caps-lock energy is fine, exclamation marks welcome, make the fan feel like a superstar",
  grateful:
    "warm and grateful — sincere thank-yous, humble, make the fan feel genuinely appreciated",
  playful:
    "playful and witty — light jokes, fun comebacks, a little mischief, never mean",
  professional:
    "professional and polished — friendly but composed, brand-safe, no slang overload",
};

/* 1 credit per batch (up to 10 replies) — env-overridable without a deploy.
   A batch is one short GPT-6 Sol completion (a fraction of a cent in
   provider fees), so 1 credit holds a deep margin while staying an impulse
   buy — and honors the standing rule that every AI feature costs a fee. */
const COMMENT_REPLIES_CREDITS =
  Number(process.env["COMMENT_REPLIES_CREDIT_COST"]) || 100;

const MAX_COMMENTS = 10;

/* GET /api/comment-replies/meta → { cost, tones, maxComments }
   The price a drafting bench shows MUST come from the server (house
   law: displayed prices are real server charges) — the charge below
   and this meta read the same constant, so they can never drift.
   Free to read; drafting itself is the paid call. */
router.get("/comment-replies/meta", requireAuth, (_req, res) => {
  res.json({
    cost: COMMENT_REPLIES_CREDITS,
    tones: TONES,
    maxComments: MAX_COMMENTS,
  });
});

const commentRepliesSchema = z.object({
  comments: z
    .array(z.string().min(1, "Comment can't be empty.").max(500))
    .min(1, "Paste at least one comment.")
    .max(MAX_COMMENTS, `Up to ${MAX_COMMENTS} comments per batch.`),
  tone: z.enum(TONES),
  voiceNotes: z.string().max(300).optional().default(""),
});

/* Text model: centralized in getTextModel() (default gpt-6.1-sol, env-overridable
   via OPENAI_TEXT_MODEL). Called per-request like every other route —
   do not hardcode model IDs. GPT-6 rejects the legacy `max_tokens` param,
   so this route uses `max_completion_tokens`. */

/* POST /api/comment-replies { comments, tone, voiceNotes } →
   200 { replies: string[], creditsUsed, creditsRemaining }
   Paid: 1 credit per batch (up to 10 comments). Auth required; credits are
   deducted BEFORE the model call and refunded if the provider call fails. */
router.post(
  "/comment-replies",
  requireAuth,
  publicApiLimiter,
  async (req, res) => {
    const parsed = commentRepliesSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid comment-replies request.",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }

    /* Idempotency (CA-2): server-derived key on EVERY call — this rail's
       schema accepts no client key, so the intent hash IS the key.
       Intent = the request's defining inputs. */
    const idempotencyKey = buildChargeIdempotencyKey("comment-replies", req.userId!, undefined, {
      comments: parsed.data.comments,
      tone: parsed.data.tone,
      voiceNotes: parsed.data.voiceNotes,
    });

    /* Stored-result pre-check BEFORE any funding: a replay under a
       landed key is answered from the stored body — no charge, no
       provider call. */
    const storedResult = await findStoredGenerationResult("comment-replies", idempotencyKey, req.userId!);
    if (storedResult) {
      res.json({ ...storedResult, replayed: true });
      return;
    }

    const balance = req.userCredits ?? 0;
    if (balance < COMMENT_REPLIES_CREDITS) {
      res.status(402).json({
        error: "out_of_credits",
        message:
          "You're out of Visual Bucs — top up to keep using the Comment Reply Assistant.",
      });
      return;
    }
    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, COMMENT_REPLIES_CREDITS, {
        action: "Comment Reply Assistant",
      }, { idempotencyKey });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message:
            "You're out of Visual Bucs — top up to keep using the Comment Reply Assistant.",
        });
        return;
      }
      throw err;
    }

    const refundOnFailure = async () => {
      try {
        await refundCredits(req.userId!, COMMENT_REPLIES_CREDITS, {
          action: "Comment Reply Assistant — Refund (generation failed)",
        });
        /* The refund landed — VOID the charge's idempotency key so a
           retry charges fresh instead of running FREE as a replay. */
        await voidChargeIdempotencyKey(idempotencyKey);
      } catch (refundErr) {
        logger.error(
          { err: refundErr, userId: req.userId },
          "[comment-replies] refund failed after generation error",
        );
      }
    };

    try {
      const { comments, tone, voiceNotes } = parsed.data;
      const direction = TONE_DIRECTION[tone];
      const voiceLine = voiceNotes.trim()
        ? ` The creator's personal voice notes (match their slang and catchphrases): "${voiceNotes.trim()}".`
        : "";
      const numbered = comments
        .map((c, i) => `${i + 1}. "${c.trim()}"`)
        .join("\n");

      const completion = await getOpenAI().chat.completions.create({
        ...LOW_REASONING_PARAMS,
        model: getTextModel(),
        messages: [
          {
            role: "system",
            content:
              `You are a social media engagement expert writing replies for an independent ` +
              `music creator. For each fan comment, draft ONE reply in the creator's voice. ` +
              `Tone: ${direction}.${voiceLine} ` +
              `Every reply must: (1) feel personal, never copy-paste corporate; (2) be under 40 words; ` +
              `(3) end with a question back or a soft call-to-action (follow, share, comment again) ` +
              `where it feels natural — engagement is the goal; (4) never be rude, never argue with ` +
              `critics — kill negativity with kindness or playful confidence; ` +
              `(5) never use hashtags. ` +
              `Return ONLY JSON: {"replies": ["...", ...]} with exactly one reply per comment, ` +
              `in the same order as the comments.`,
          },
          {
            role: "user",
            content: `Draft a reply for each of these fan comments:\n${numbered}`,
          },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 1200,
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      let replies: string[] = [];
      try {
        const parsedJson = JSON.parse(raw) as { replies?: unknown };
        if (Array.isArray(parsedJson.replies)) {
          replies = parsedJson.replies
            .filter(
              (r): r is string => typeof r === "string" && r.trim().length > 0,
            )
            .map((r) => r.trim())
            .slice(0, comments.length);
        }
      } catch {
        /* fall through to the length check below */
      }
      if (replies.length !== comments.length) {
        throw new Error("Model returned an incomplete set of replies");
      }

      const body: Record<string, unknown> = {
        replies,
        creditsUsed: COMMENT_REPLIES_CREDITS,
        creditsRemaining,
      };
      /* Store BEFORE answering: a retry after this response is served
         from the stored body. Fail-open inside the helper. */
      await storeGenerationResult("comment-replies", idempotencyKey, req.userId!, body);
      res.json(body);
    } catch (err) {
      await refundOnFailure();
      if (
        err instanceof OpenAI.APIError &&
        (err.status === 429 || err.code === "insufficient_quota")
      ) {
        logger.warn({ err }, "[comment-replies] OpenAI rate limit / quota");
        res.status(503).json({
          error: "The studio is catching its breath — try again in a moment.",
        });
        return;
      }
      logger.error({ err }, "[comment-replies] generation failed");
      res.status(502).json({ error: "The studio hiccupped — try again." });
    }
  },
);

export default router;
