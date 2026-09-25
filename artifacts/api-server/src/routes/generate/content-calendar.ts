import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

/* ─── AI Content Calendar ────────────────────────────────────────────────
   Creators input their niche + platforms, GPT-6 generates a 30-day posting
   calendar: each day gets a post concept, format, platform, hook line, and
   best posting time. 1 credit per calendar (env-overridable). Credits are
   charged BEFORE the model call and automatically refunded on any provider
   failure — the user never pays for a calendar they didn't get.
   NOTE: uses max_completion_tokens (NOT max_tokens) — GPT-6 rejects
   max_tokens. */

export const CALENDAR_CREDIT_COST = Number(process.env["CONTENT_CALENDAR_CREDIT_COST"]) || 1;
export const CALENDAR_DAYS = 30;

const PLATFORMS = ["tiktok", "youtube", "instagram"] as const;
export type CalendarPlatform = (typeof PLATFORMS)[number];

const FORMATS = ["video", "carousel", "live", "story"] as const;
export type CalendarFormat = (typeof FORMATS)[number];

export interface CalendarDay {
  date: string; // YYYY-MM-DD
  dayLabel: string; // "Mon, Sep 28"
  post: boolean;
  title: string;
  format: CalendarFormat | "";
  platform: CalendarPlatform | "";
  hook: string;
  bestTime: string;
}

export const contentCalendarSchema = z.object({
  niche: z.string().min(1, "Tell us your niche.").max(120),
  platforms: z.array(z.enum(PLATFORMS)).min(1, "Pick at least one platform.").max(3),
  postsPerWeek: z.number().int().min(1).max(14),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be YYYY-MM-DD.")
    .refine((d) => !Number.isNaN(Date.parse(d + "T00:00:00Z")), "Invalid start date."),
});

/** Build the 30 YYYY-MM-DD date strings starting from startDate (UTC). */
export function buildCalendarDates(startDate: string): string[] {
  const base = Date.parse(startDate + "T00:00:00Z");
  const dates: string[] = [];
  for (let i = 0; i < CALENDAR_DAYS; i++) {
    dates.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  }
  return dates;
}

/** How many posting days the 30-day window should hold for a weekly cadence. */
export function targetPostCount(postsPerWeek: number): number {
  return Math.max(1, Math.min(CALENDAR_DAYS, Math.round((postsPerWeek / 7) * CALENDAR_DAYS)));
}

/** "Mon, Sep 28" style label for a YYYY-MM-DD date. */
export function dayLabel(date: string): string {
  return new Date(date + "T00:00:00Z").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function cleanStr(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * Parse + sanitize the model's JSON into 30 CalendarDay entries.
 * Dates are attached by index (never trusted from the model). Short or
 * malformed model output is padded with rest days so the grid always
 * renders a full 30-day window.
 */
export function parseCalendarDays(
  raw: string,
  dates: string[],
  platforms: readonly CalendarPlatform[],
): CalendarDay[] {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Model returned invalid JSON");
  }
  const arr = (parsed as { days?: unknown })?.days;
  const items: unknown[] = Array.isArray(arr) ? arr : [];
  const days: CalendarDay[] = [];
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i]!;
    const item = (items[i] ?? {}) as Record<string, unknown>;
    const isPost = item.post === true;
    const platformRaw = cleanStr(item.platform, 20).toLowerCase();
    const formatRaw = cleanStr(item.format, 20).toLowerCase();
    days.push({
      date,
      dayLabel: dayLabel(date),
      post: isPost,
      title: isPost ? cleanStr(item.title, 120) || "Post idea" : "",
      format: isPost && (FORMATS as readonly string[]).includes(formatRaw)
        ? (formatRaw as CalendarFormat)
        : "",
      platform: isPost && (platforms as readonly string[]).includes(platformRaw)
        ? (platformRaw as CalendarPlatform)
        : isPost
          ? platforms[i % platforms.length]!
          : "",
      hook: isPost ? cleanStr(item.hook, 200) : "",
      bestTime: isPost ? cleanStr(item.bestTime, 20) || "6:00 PM" : "",
    });
  }
  if (!days.some((d) => d.post)) {
    throw new Error("Model returned no posting days");
  }
  return days;
}

const router = Router();

/* POST /api/content-calendar → 200 { days, creditsUsed, creditsRemaining }
   Paid: 1 credit per calendar. Auth required. */
router.post("/content-calendar", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = contentCalendarSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid content calendar request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { niche, platforms, postsPerWeek, startDate } = parsed.data;

  const balance = req.userCredits ?? 0;
  if (balance < CALENDAR_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to generate your content calendar.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, CALENDAR_CREDIT_COST, {
      action: "AI Content Calendar",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to generate your content calendar.",
      });
      return;
    }
    throw err;
  }

  async function refund() {
    try {
      await refundCredits(req.userId!, CALENDAR_CREDIT_COST, {
        action: "AI Content Calendar — Refund (generation failed)",
      });
    } catch (refundErr) {
      void refundErr; // logged inside refundCredits; don't mask the original failure
    }
  }

  try {
    const dates = buildCalendarDates(startDate);
    const target = targetPostCount(postsPerWeek);
    const platformList = platforms.join(", ");

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a content strategist for independent creators. ` +
            `Generate a 30-day posting calendar for a creator in the "${niche}" niche, ` +
            `posting on: ${platformList}. They post ~${postsPerWeek} times per week, ` +
            `so mark exactly ~${target} of the 30 days as posting days ("post": true) and the ` +
            `rest as rest days ("post": false). Spread posting days evenly across the 30 days — ` +
            `never cluster more than 3 posting days in a row. ` +
            `Each posting day: a specific, concrete post concept (title, max 15 words — no generic ` +
            `"post about your niche" filler), a format (video, carousel, live, or story), ` +
            `one of these platforms: ${platformList}, an opening hook line (the exact first ` +
            `spoken/on-screen line, max 18 words, curiosity-driven), and a best posting time ` +
            `like "6:00 PM". Vary formats and rotate platforms. Speak to a creator audience. ` +
            `Rest days: ONLY {"post": false} — no other fields. ` +
            `Return ONLY JSON: {"days": [{"post": true, "title": "...", "format": "video", ` +
            `"platform": "tiktok", "hook": "...", "bestTime": "6:00 PM"}, {"post": false}, ...]} ` +
            `with exactly 30 entries in order, one per day starting ${dates[0]}.`,
        },
        {
          role: "user",
          content:
            `Build my 30-day content calendar. Niche: ${niche}. ` +
            `Platforms: ${platformList}. Cadence: ${postsPerWeek} posts/week. ` +
            `Day 1 is ${dates[0]}.`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 6000,
      temperature: 0.8,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const days = parseCalendarDays(raw, dates, platforms);

    res.json({ days, creditsUsed: CALENDAR_CREDIT_COST, creditsRemaining });
  } catch (err) {
    await refund();
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[content-calendar] OpenAI rate limit / quota");
      res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[content-calendar] generation failed");
    res.status(502).json({ error: "The calendar hiccupped — your credit was refunded. Try again." });
  }
});

export default router;
