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

/* ─── Comment to Video ────────────────────────────────────────────────────
   /api/comment-to-video/scripts — 2 credits: the creator pastes comments
   from a video; the AI picks the most video-worthy ones and writes a
   complete response-video script per pick: title, first-3-seconds hook,
   full script, visual plan, and CTA. */

const router = Router();

/* 2 credits per pack — env-overridable without a deploy. Up to 3 full
   scripts is a long structured GPT-6 Sol completion; 2 credits holds a
   deep margin — and honors the standing rule that every AI feature costs
   a fee. */
const SCRIPTS_CREDITS = Number(process.env["COMMENT_TO_VIDEO_SCRIPTS_CREDITS"]) || 200;

const scriptsSchema = z.object({
  comments: z
    .array(z.string().min(1, "Comments can't be empty.").max(500))
    .min(1, "Give at least one comment.")
    .max(20, "Max 20 comments per request."),
  niche: z.string().max(120).optional().default(""),
  count: z.number().int().min(1).max(3).optional().default(2),
});

interface ScriptItem {
  title: string;
  hook: string;
  script: string;
  visualPlan: string[];
  cta: string;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function parseVisualPlan(raw: unknown): string[] {
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, 8);
}

function parseScript(e: Record<string, unknown>): ScriptItem | null {
  const title = str(e["title"]).slice(0, 120);
  const hook = str(e["hook"]).slice(0, 300);
  const script = str(e["script"]);
  if (!title || !hook || !script) return null;
  return {
    title,
    hook,
    script: script.slice(0, 4000),
    visualPlan: parseVisualPlan(e["visualPlan"]),
    cta: str(e["cta"]).slice(0, 300),
  };
}

async function refundOnFailure(userId: string, amount: number, label: string) {
  try {
    await refundCredits(userId, amount, {
      action: `${label} — Refund (generation failed)`,
    });
  } catch (refundErr) {
    logger.error({ err: refundErr, userId }, "[comment-to-video] refund failed after generation error");
  }
}

/* POST /api/comment-to-video/scripts { comments[1-20], niche?, count?(1-3, default 2) }
   → 200 { scripts[{title,hook,script,visualPlan,cta}], creditsUsed, creditsRemaining }
   Paid: 2 credits. Auth required; credits deducted BEFORE the model call.
   Provider failure or unusable output → refund + 502. */
router.post("/comment-to-video/scripts", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = scriptsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid comment-to-video request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < SCRIPTS_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to turn comments into videos.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, SCRIPTS_CREDITS, { action: "Comment to Video — Scripts" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to turn comments into videos.",
      });
      return;
    }
    throw err;
  }

  const { comments, niche, count } = parsed.data;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a content strategist for independent creators. A creator pastes comments from one of ` +
            `their videos. First, silently pick the ${count} most video-worthy comments — the ones that spark ` +
            `curiosity, debate, humor, or a story worth telling (skip spam, hate, and one-word comments). ` +
            `Then write a COMPLETE response-video script for each pick:\n` +
            `- title: a punchy working title\n` +
            `- hook: the exact first-3-seconds spoken opener that makes someone stop scrolling\n` +
            `- script: a full 45-75 second spoken script addressing the comment — natural spoken word, ` +
            `address the commenter by the comment's energy (never invent their name)\n` +
            `- visualPlan: 4-7 shot descriptions as an array of strings\n` +
            `- cta: one closing call to action\n` +
            `RULES: the response videos must feel like a genuine reply, not an ad. Never promise virality. ` +
            `Return ONLY JSON: {"scripts": [{"title": "...", "hook": "...", "script": "...", ` +
            `"visualPlan": ["...", ...], "cta": "..."}]}. Exactly ${count} scripts.`,
        },
        {
          role: "user",
          content:
            `Pick the ${count} most video-worthy comments and write response-video scripts.\n` +
            (niche.trim() ? `My niche: ${niche.trim()}\n` : "") +
            `Comments:\n${comments.map((c, i) => `${i + 1}. ${c.trim()}`).join("\n")}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 3000,
      temperature: 0.8,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let scripts: ScriptItem[] = [];
    try {
      const j = JSON.parse(raw) as { scripts?: unknown };
      if (Array.isArray(j.scripts)) {
        scripts = j.scripts
          .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
          .map(parseScript)
          .filter((s): s is ScriptItem => s !== null)
          .slice(0, count);
      }
    } catch {
      /* fall through to the empty check below */
    }
    if (scripts.length === 0) {
      throw new Error("Model returned no usable scripts");
    }

    res.json({
      scripts,
      creditsUsed: SCRIPTS_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    await refundOnFailure(req.userId!, SCRIPTS_CREDITS, "Comment to Video — Scripts");
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[comment-to-video] OpenAI rate limit / quota");
      res.status(503).json({ error: "Comment to video is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[comment-to-video] script generation failed");
    res.status(502).json({ error: "Comment to video hiccupped — your Visual Bucs were refunded." });
  }
});

export default router;
