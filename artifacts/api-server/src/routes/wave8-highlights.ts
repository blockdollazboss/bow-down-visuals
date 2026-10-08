import { Router } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../lib/credits";

/* ─── Wave 8 — Stream Highlight Auto-Editor ──────────────────────────────────
   HONEST DESIGN: this endpoint does NOT cut video. It scores moments from a
   pasted chat log and/or transcript, and returns a scored reel PLAN (edit
   decision list: segments, captions, and per-moment scores + reasons). The
   creator cuts the actual video in their own editor — nothing here pretends
   otherwise.

   Endpoints (router mounted at /api — coordinator wires routes/index.ts):
     POST /wave8/highlights/cut   300 VB — scored moments + reel plan (JSON)

   Credit discipline (standing): AI availability check BEFORE charging →
   charge BEFORE the model call → refund on ANY failure. No charge without
   delivery, ever. */

const router = Router();

const HIGHLIGHT_CREDITS = 300;

const highlightsRequestSchema = z.object({
  vodUrl: z.string().trim().max(2000).optional().default(""),
  vodTitle: z.string().trim().max(200).optional().default(""),
  chatLog: z.string().trim().max(20000).optional().default(""),
  transcript: z.string().trim().max(20000).optional().default(""),
  targetSeconds: z.number().int().min(30).max(180).optional().default(60),
});

const momentSchema = z.object({
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  score: z.number().int().min(0).max(100),
  label: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(400),
});

const reelSegmentSchema = z.object({
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  caption: z.string().trim().min(1).max(160),
});

const highlightsResponseSchema = z.object({
  moments: z.array(momentSchema).min(1).max(12),
  reelPlan: z.object({
    totalSec: z.number().min(0),
    segments: z.array(reelSegmentSchema).min(1).max(8),
  }),
  summary: z.string().trim().min(1).max(600),
});

type HighlightsResponse = z.infer<typeof highlightsResponseSchema>;

/* ─── POST /wave8/highlights/cut — 300 VB ─── */
router.post("/wave8/highlights/cut", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = highlightsRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid highlight request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const { vodUrl, vodTitle, chatLog, transcript, targetSeconds } = parsed.data;

  /* We score from provided material only — never hallucinate a VOD. */
  if (!vodUrl && !chatLog && !transcript) {
    res.status(400).json({
      error:
        "Give the editor something to work with: a VOD URL, a pasted chat log, or a transcript.",
    });
    return;
  }

  /* 1) AI availability check BEFORE charging. */
  try {
    getOpenAI();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(503).json({
      error: "ai_unavailable",
      message: msg.includes("OPENAI_API_KEY")
        ? "OPENAI_API_KEY is not configured — the Stream Highlight Auto-Editor is unavailable."
        : "The Stream Highlight Auto-Editor is unavailable right now.",
    });
    return;
  }

  /* 2) Charge BEFORE the model call. */
  let remaining: number;
  try {
    remaining = await chargeCredits(req.userId!, HIGHLIGHT_CREDITS, {
      action: "Stream Highlight Auto-Editor",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "Not enough Visual Bucs — top up to cut a highlight reel plan.",
      });
      return;
    }
    throw err;
  }

  try {
    const sources: string[] = [];
    if (vodTitle) sources.push(`VOD title: "${vodTitle}"`);
    if (vodUrl) sources.push(`VOD URL: ${vodUrl} (analyze it by title/context only — you cannot fetch it)`);
    if (chatLog) sources.push(`Chat log (timestamps relative to stream start):\n${chatLog}`);
    if (transcript) sources.push(`Stream transcript (timestamps relative to stream start):\n${transcript}`);

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            "You are the highlight editor for Bow Down Visuals — the cheat code for streamers. " +
            "You find the moments that make a clip travel: hype peaks, chat explosions, funny " +
            "fails, clutch plays, quotable one-liners, emotional payoffs. IMPORTANT: you are NOT " +
            "cutting video — you are producing a scored EDIT DECISION LIST the creator cuts in " +
            "their own editor. Timestamps are seconds from the stream/VOD start (0). When timing " +
            "is inferred rather than explicit in the source material, say so plainly in the " +
            "reason — never present a guess as a certainty. You must return ONLY valid JSON " +
            "with this exact shape:\n" +
            '{ "moments": [ { "startSec": <number>, "endSec": <number>, "score": <0-100>, ' +
            '"label": "<short title>", "reason": "<why this moment travels>" } ], ' +
            '"reelPlan": { "totalSec": <number>, "segments": [ { "startSec": <number>, ' +
            '"endSec": <number>, "caption": "<on-screen caption text>" } ] }, ' +
            '"summary": "<one punchy paragraph: what the reel is and the story it tells>" }\n' +
            `Rules: 4 to 10 moments sorted by score DESC; reel segments total roughly ${targetSeconds} ` +
            "seconds and must tell a story (hook → peak → payoff), preferring the highest-scored " +
            "moments; captions are punchy on-screen text, max 8 words; no fields outside this " +
            "shape; plain text, no markdown.",
        },
        {
          role: "user",
          content:
            `Target reel length: ~${targetSeconds} seconds.\n\n` +
            sources.join("\n\n") +
            "\n\nScore the moments and build the reel plan.",
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 2200,
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let plan: HighlightsResponse;
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      plan = highlightsResponseSchema.parse(json);
    } catch {
      throw new Error("Model returned an unusable highlight plan");
    }

    /* Sanitize: clamp timestamps, sort moments by score desc, keep plan within target. */
    plan.moments = plan.moments
      .map((m) => ({
        ...m,
        startSec: Math.max(0, Math.round(m.startSec)),
        endSec: Math.max(0, Math.round(m.endSec)),
        score: Math.min(100, Math.max(0, Math.round(m.score))),
      }))
      .filter((m) => m.endSec > m.startSec)
      .sort((a, b) => b.score - a.score);
    plan.reelPlan.segments = plan.reelPlan.segments
      .map((s) => ({
        ...s,
        startSec: Math.max(0, Math.round(s.startSec)),
        endSec: Math.max(0, Math.round(s.endSec)),
      }))
      .filter((s) => s.endSec > s.startSec);
    if (plan.moments.length === 0 || plan.reelPlan.segments.length === 0) {
      throw new Error("Model returned an empty highlight plan");
    }

    res.json({
      ...plan,
      creditsUsed: HIGHLIGHT_CREDITS,
      creditsRemaining: remaining,
    });
  } catch (err) {
    /* 3) Refund on ANY failure — no charge without delivery. */
    logger.error({ err, userId: req.userId }, "[wave8-highlights] cut failed — refunding");
    try {
      await refundCredits(req.userId!, HIGHLIGHT_CREDITS, {
        action: "Stream Highlight Auto-Editor — Refund",
      });
    } catch (refundErr) {
      logger.error(
        { userId: req.userId, refundErr },
        "[wave8-highlights] CRITICAL: refund failed after generation failure"
      );
    }
    res.status(500).json({
      error: "The highlight editor hiccupped — your Visual Bucs were refunded.",
      refunded: true,
    });
  }
});

export default router;
