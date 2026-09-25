import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
} from "../../lib/credits";

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
  Number(process.env["COMMENT_REPLIES_CREDIT_COST"]) || 1;

const MAX_COMMENTS = 10;

const commentRepliesSchema = z.object({
  comments: z
    .array(z.string().min(1, "Comment can't be empty.").max(500))
    .min(1, "Paste at least one comment.")
    .max(MAX_COMMENTS, `Up to ${MAX_COMMENTS} comments per batch.`),
  tone: z.enum(TONES),
  voiceNotes: z.string().max(300).optional().default(""),
});

/* Text model: centralized in getTextModel() (default gpt-6-sol, env-overridable
   via OPENAI_TEXT_MODEL). Called per-request like every other route —
   do not hardcode model IDs. GPT-6 rejects the legacy `max_tokens` param,
   so this route uses `max_completion_tokens`. */

/* POST /api/comment-replies { comments, tone, voiceNotes } →
   200 { replies: string[], creditsUsed, creditsRemaining }
   Paid: 1 credit per batch (up to 10 comments). Auth required; credits are
   deducted BEFORE the model call and refunded if the provider call fails. */
router.post(
  "/comment-replies",
  publicApiLimiter,
  requireAuth,
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

    const balance = req.userCredits ?? 0;
    if (balance < COMMENT_REPLIES_CREDITS) {
      res.status(402).json({
        error: "out_of_credits",
        message:
          "You're out of credits — top up to keep using the Comment Reply Assistant.",
      });
      return;
    }
    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, COMMENT_REPLIES_CREDITS, {
        action: "Comment Reply Assistant",
      });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message:
            "You're out of credits — top up to keep using the Comment Reply Assistant.",
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
        temperature: 0.85,
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

      res.json({
        replies,
        creditsUsed: COMMENT_REPLIES_CREDITS,
        creditsRemaining,
      });
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
