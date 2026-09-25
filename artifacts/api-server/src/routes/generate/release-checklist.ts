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

/* Release types — keep in sync with the frontend /release page. */
const RELEASE_TYPES = ["single", "ep", "album"] as const;
type ReleaseType = (typeof RELEASE_TYPES)[number];

/* 2 credits per AI release plan — env-overridable without a deploy.
   A release plan is a long GPT-6 Sol JSON completion (~1-2k tokens),
   so 2 credits holds a deep margin while staying an impulse buy — and
   honors the standing rule that every AI feature costs a fee.
   Task check-off on the frontend is pure UI (localStorage) — free. */
const RELEASE_PLAN_CREDITS = Number(process.env["RELEASE_PLAN_CREDIT_COST"]) || 2;

const releaseChecklistSchema = z.object({
  releaseType: z.enum(RELEASE_TYPES),
  title: z.string().min(1, "Release title is required.").max(200),
  genre: z.string().max(120).optional().default(""),
  /* ISO date string (yyyy-mm-dd). Must be a real date in the future —
     a checklist for a past release makes no sense. */
  releaseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Release date must be yyyy-mm-dd.")
    .refine((d) => {
      const t = new Date(`${d}T00:00:00Z`).getTime();
      return Number.isFinite(t) && t > Date.now();
    }, "Release date must be in the future."),
});

/* Text model: centralized in getTextModel() (default gpt-6-sol, env-overridable
   via OPENAI_TEXT_MODEL). Called per-request like every other route —
   do not hardcode model IDs. */

/* POST /api/release-checklist { releaseType, title, genre, releaseDate }
   → 200 { plan: { weeks: [{ label, tasks: [{ id, title, detail, category, tool }] }, summary, preSaveTip }, creditsUsed, creditsRemaining }
   Paid: 2 credits. Auth required; credits are deducted BEFORE the model
   call and auto-refunded on any provider failure or unusable output. */
router.post("/release-checklist", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = releaseChecklistSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid release checklist request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < RELEASE_PLAN_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to build your release plan.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, RELEASE_PLAN_CREDITS, {
      action: "Release Checklist",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to build your release plan.",
      });
      return;
    }
    throw err;
  }

  async function refund(reason: string) {
    try {
      await refundCredits(req.userId!, RELEASE_PLAN_CREDITS, {
        action: "Release Checklist — Refund (generation failed)",
      });
    } catch (refundErr) {
      logger.error({ refundErr, reason }, "[release-checklist] refund failed");
    }
  }

  try {
    const { releaseType, title, genre, releaseDate } = parsed.data;
    const genreLine = genre.trim() ? ` Genre/vibe: "${genre.trim()}".` : "";

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a music-release strategist for independent artists. ` +
            `Build a week-by-week release checklist for a ${releaseType} titled "${title}" ` +
            `dropping on ${releaseDate}.${genreLine} ` +
            `Cover the real indie workflow: distribution setup (distributor upload lead time), ` +
            `pre-save campaign, playlist pitching (editorial + independent), social teaser cadence, ` +
            `cover art, press/press-kit, email list announcement, release-day blitz, and post-release ` +
            `momentum. Tailor week count to the time available (minimum 3 weeks of prep, maximum 8). ` +
            `Each task needs: a short punchy title, one-line detail of exactly what to do, a category ` +
            `(one of: distribution, playlist, social, press, pre-save, email, creative, release-day, follow-up), ` +
            `and an optional tool hint — one of: playlist-pitcher (/playlist-pitch), content-scheduler (/scheduler), ` +
            `press-kit (/press-kit), cover-art (/cover-art), email-list (/email-list), or null. ` +
            `Be specific and actionable — no generic advice like "promote your music". ` +
            `Return ONLY JSON: {"weeks": [{"label": "Week 1 — <theme>", "tasks": [{"title": "...", "detail": "...", "category": "...", "tool": "..."|null}]}], "summary": "<2-sentence overview>", "preSaveTip": "<one pre-save tactic>"}.`,
        },
        {
          role: "user",
          content:
            `Build my ${releaseType} release checklist. Title: "${title}". ` +
            `Release date: ${releaseDate}.${genreLine}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 2500,
      temperature: 0.5,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let weeks: Array<{
      label: string;
      tasks: Array<{ title: string; detail: string; category: string; tool: string | null }>;
    }> = [];
    let summary = "";
    let preSaveTip = "";
    try {
      const parsedJson = JSON.parse(raw) as {
        weeks?: unknown; summary?: unknown; preSaveTip?: unknown;
      };
      if (Array.isArray(parsedJson.weeks)) {
        weeks = parsedJson.weeks
          .filter(
            (w): w is { label: unknown; tasks: unknown } =>
              !!w && typeof (w as { label?: unknown }).label === "string" && Array.isArray((w as { tasks?: unknown }).tasks)
          )
          .map((w) => ({
            label: (w.label as string).trim(),
            tasks: ((w.tasks as unknown[]) ?? [])
              .filter(
                (t): t is { title: unknown; detail: unknown; category: unknown; tool?: unknown } =>
                  !!t &&
                  typeof (t as { title?: unknown }).title === "string" &&
                  typeof (t as { detail?: unknown }).detail === "string" &&
                  typeof (t as { category?: unknown }).category === "string"
              )
              .map((t) => ({
                title: (t.title as string).trim().slice(0, 120),
                detail: (t.detail as string).trim().slice(0, 300),
                category: (t.category as string).trim().toLowerCase().slice(0, 40),
                tool:
                  typeof t.tool === "string" && t.tool.trim()
                    ? t.tool.trim().slice(0, 60)
                    : null,
              }))
              .slice(0, 12),
          }))
          .filter((w) => w.tasks.length > 0)
          .slice(0, 8);
      }
      if (typeof parsedJson.summary === "string" && parsedJson.summary.trim()) {
        summary = parsedJson.summary.trim().slice(0, 500);
      }
      if (typeof parsedJson.preSaveTip === "string" && parsedJson.preSaveTip.trim()) {
        preSaveTip = parsedJson.preSaveTip.trim().slice(0, 300);
      }
    } catch {
      /* fall through to the empty check below */
    }
    if (weeks.length === 0) {
      await refund("unusable model output");
      res.status(502).json({ error: "The release planner hiccupped — credits refunded, try again." });
      return;
    }

    res.json({
      plan: { weeks, summary, preSaveTip },
      creditsUsed: RELEASE_PLAN_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    await refund("provider failure");
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[release-checklist] OpenAI rate limit / quota");
      res.status(503).json({ error: "The planner is catching its breath — credits refunded, try again in a moment." });
      return;
    }
    logger.error({ err }, "[release-checklist] generation failed");
    res.status(502).json({ error: "The planner hiccupped — credits refunded, try again." });
  }
});

export default router;
