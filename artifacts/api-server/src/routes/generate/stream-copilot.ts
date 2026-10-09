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

/* ─── Stream Copilot ──────────────────────────────────────────────────────
   /api/stream-copilot/prep — 1 credit: PRE-STREAM prep pack — a pre-stream
   checklist, talking points / segment plan, and "clip watch-fors"
   (moment types to watch for that make good clips).
   /api/stream-copilot/clip-plan — 1 credit: POST-STREAM — the creator
   pastes a post-stream recap with timestamps; the AI identifies the most
   clip-worthy moments with title + description + why-it-works per moment.

   HONEST SCOPE — no real-time anything. Copy says "prep" and
   "post-stream" only; the frontend must not present this as live
   assistance. */

const router = Router();

/* 1 credit per prep pack — env-overridable without a deploy. Short
   structured GPT-6 Sol completions; 1 credit holds a deep margin — and
   honors the standing rule that every AI feature costs a fee. */
const PREP_CREDITS = Number(process.env["STREAM_COPILOT_PREP_CREDITS"]) || 100;
const CLIP_PLAN_CREDITS = Number(process.env["STREAM_COPILOT_CLIP_PLAN_CREDITS"]) || 100;

const prepSchema = z.object({
  streamTitle: z.string().min(1, "Stream title is required.").max(200),
  topic: z.string().min(1, "Topic is required.").max(300),
  durationMin: z.number().int().min(15).max(480).optional(),
  platform: z.string().max(40).optional().default(""),
});

const clipPlanSchema = z.object({
  recap: z.string().min(1, "Paste your post-stream recap.").max(3000),
  topic: z.string().max(300).optional().default(""),
});

interface ClipMoment {
  timestampHint: string;
  title: string;
  description: string;
  whyItWorks: string;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function parseStringArray(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, max);
}

function parseMoment(e: Record<string, unknown>): ClipMoment | null {
  const title = str(e["title"]).slice(0, 120);
  const description = str(e["description"]).slice(0, 600);
  if (!title || !description) return null;
  return {
    timestampHint: str(e["timestampHint"]).slice(0, 60),
    title,
    description,
    whyItWorks: str(e["whyItWorks"]).slice(0, 400),
  };
}

async function refundOnFailure(userId: string, amount: number, label: string) {
  try {
    await refundCredits(userId, amount, {
      action: `${label} — Refund (generation failed)`,
    });
  } catch (refundErr) {
    logger.error({ err: refundErr, userId }, "[stream-copilot] refund failed after generation error");
  }
}

async function guardCredits(req: { userCredits?: number }, amount: number, topupMsg: string, res: { status: (c: number) => { json: (b: unknown) => void } }, chargeLabel: string, userId: string): Promise<number | null> {
  const balance = req.userCredits ?? 0;
  if (balance < amount) {
    res.status(402).json({ error: "out_of_credits", message: topupMsg });
    return null;
  }
  try {
    return await chargeCredits(userId, amount, { action: chargeLabel });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: topupMsg });
      return null;
    }
    throw err;
  }
}

/* POST /api/stream-copilot/prep { streamTitle, topic, durationMin?, platform? }
   → 200 { checklist[], talkingPoints[], clipWatchFors[], creditsUsed, creditsRemaining }
   Paid: 1 credit. Pre-stream prep pack — NOT live assistance. Auth required;
   credits deducted BEFORE the model call. Provider failure or unusable
   output → refund + 502. */
router.post("/stream-copilot/prep", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = prepSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid stream-copilot prep request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const creditsRemaining = await guardCredits(
    req,
    PREP_CREDITS,
    "You're out of Visual Bucs — top up to prep your stream.",
    res,
    "Stream Copilot — Prep",
    req.userId!
  );
  if (creditsRemaining === null) return;

  const { streamTitle, topic, durationMin, platform } = parsed.data;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a stream strategist for independent creators. A creator gives you their upcoming ` +
            `stream's title, topic, planned length, and platform. You write their PRE-STREAM prep pack — ` +
            `this is prep work done BEFORE going live, never live assistance:\n` +
            `- checklist: 8-12 pre-stream checklist items — tech checks (audio, overlays, alerts), content ` +
            `checks (segments ready, links queued), and promo checks (announcement posted, title set)\n` +
            `- talkingPoints: a talking-points / segment plan for the topic — 5-8 ordered segments with ` +
            `what to cover and a transition line into the next\n` +
            `- clipWatchFors: 5-8 specific MOMENT TYPES to watch for during the stream that make good ` +
            `clips later (e.g. "hot takes that split chat", "unexpected fails", "story peaks") — each one ` +
            `a pattern to recognize, not a prediction\n` +
            `RULES: practical, creator-sized, no fluff. Never promise viewership or virality. ` +
            `Return ONLY JSON: {"checklist": ["...", ...], "talkingPoints": ["...", ...], ` +
            `"clipWatchFors": ["...", ...]}.`,
        },
        {
          role: "user",
          content:
            `Write my pre-stream prep pack.\n` +
            `Stream title: ${streamTitle.trim()}\n` +
            `Topic: ${topic.trim()}` +
            (durationMin ? `\nPlanned length: ${durationMin} minutes` : "") +
            (platform.trim() ? `\nPlatform: ${platform.trim()}` : ""),
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 2000,
      temperature: 0.7,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let checklist: string[] = [];
    let talkingPoints: string[] = [];
    let clipWatchFors: string[] = [];
    try {
      const j = JSON.parse(raw) as { checklist?: unknown; talkingPoints?: unknown; clipWatchFors?: unknown };
      checklist = parseStringArray(j.checklist, 15);
      talkingPoints = parseStringArray(j.talkingPoints, 12);
      clipWatchFors = parseStringArray(j.clipWatchFors, 10);
    } catch {
      /* fall through to the empty check below */
    }
    if (checklist.length === 0 || talkingPoints.length === 0 || clipWatchFors.length === 0) {
      throw new Error("Model returned no usable prep pack");
    }

    res.json({
      checklist,
      talkingPoints,
      clipWatchFors,
      creditsUsed: PREP_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    await refundOnFailure(req.userId!, PREP_CREDITS, "Stream Copilot — Prep");
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[stream-copilot] OpenAI rate limit / quota");
      res.status(503).json({ error: "Stream copilot is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[stream-copilot] prep generation failed");
    res.status(502).json({ error: "Stream copilot hiccupped — your Visual Bucs were refunded." });
  }
});

/* POST /api/stream-copilot/clip-plan { recap, topic? }
   → 200 { moments[{timestampHint,title,description,whyItWorks}], creditsUsed, creditsRemaining }
   Paid: 1 credit. Post-stream clip planning from the creator's recap with
   timestamps — NOT live assistance. Same charge-then-refund-on-failure flow. */
router.post("/stream-copilot/clip-plan", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = clipPlanSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid stream-copilot clip-plan request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const creditsRemaining = await guardCredits(
    req,
    CLIP_PLAN_CREDITS,
    "You're out of Visual Bucs — top up to plan your clips.",
    res,
    "Stream Copilot — Clip Plan",
    req.userId!
  );
  if (creditsRemaining === null) return;

  const { recap, topic } = parsed.data;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a clip editor for independent streamers. A creator pastes their POST-STREAM recap with ` +
            `timestamps — what happened in the stream they already finished. You identify the 4-7 most ` +
            `clip-worthy moments and for each write:\n` +
            `- timestampHint: where in the recap the moment happens (copy the timestamp style they used)\n` +
            `- title: a punchy clip title under 60 characters\n` +
            `- description: 2-3 sentences describing the moment and why a viewer who missed the stream ` +
            `would care\n` +
            `- whyItWorks: one line on the clip psychology (surprise, relatability, controversy, payoff)\n` +
            `RULES: pick moments that stand ALONE — a viewer who never saw the stream must get it. Rank ` +
            `best first. Never promise views or virality. ` +
            `Return ONLY JSON: {"moments": [{"timestampHint": "...", "title": "...", "description": "...", ` +
            `"whyItWorks": "..."}, ...]}. 4-7 moments.`,
        },
        {
          role: "user",
          content:
            `Find my most clip-worthy moments from this post-stream recap.\n` +
            (topic.trim() ? `Topic: ${topic.trim()}\n` : "") +
            `Recap:\n${recap.trim()}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 2500,
      temperature: 0.75,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let moments: ClipMoment[] = [];
    try {
      const j = JSON.parse(raw) as { moments?: unknown };
      if (Array.isArray(j.moments)) {
        moments = j.moments
          .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
          .map(parseMoment)
          .filter((m): m is ClipMoment => m !== null)
          .slice(0, 7);
      }
    } catch {
      /* fall through to the empty check below */
    }
    if (moments.length === 0) {
      throw new Error("Model returned no usable clip moments");
    }

    res.json({
      moments,
      creditsUsed: CLIP_PLAN_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    await refundOnFailure(req.userId!, CLIP_PLAN_CREDITS, "Stream Copilot — Clip Plan");
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[stream-copilot] OpenAI rate limit / quota");
      res.status(503).json({ error: "Stream copilot is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[stream-copilot] clip-plan generation failed");
    res.status(502).json({ error: "Stream copilot hiccupped — your Visual Bucs were refunded." });
  }
});

export default router;
