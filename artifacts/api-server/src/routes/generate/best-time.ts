import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { logger } from "../../lib/logger";

/* ─── Best Time to Post Optimizer ─────────────────────────────────────────
   POST /api/best-time — the scheduler's posting-time intelligence.

   Scheduler intelligence gap: the site could schedule posts and analyze
   them, but nothing told a creator WHEN to post. This route computes
   per-platform recommended posting slots for the next 7 days, each with a
   score (0-100), a human-readable reason, and an honest source label.

   Data hierarchy:
   1. Platform benchmark tables (always on — no AI key needed). Compiled
      from 2025 published platform benchmarks (Hootsuite, Buffer, Sprout
      Social benchmark reports). General patterns, not guarantees — the
      response says so in plain language.
   2. Personalization (when the caller passes `analytics`: the user's own
      post history). Windows where the user's past posts averaged high
      engagement get a boost and are labeled `personalized` so the UI can
      visually separate "your data" from "platform benchmarks".
   3. Niche tuning via the text model (only when OPENAI_API_KEY is set).
      If the key is missing the route still returns benchmark (+history)
      slots — the button never dies.

   75 Visual Bucs (env-overridable via BEST_TIME_CREDITS). 402 pre-check →
   charge → auto-refund on failure.

   Designed next step (analytics feedback loop, not yet wired): after a
   scheduled post fires, the analytics pipeline should record
   { platform, postedAt, engagement } so a later /api/best-time call can
   personalize automatically — no user input needed. */

export const BEST_TIME_CREDIT_COST = Number(process.env["BEST_TIME_CREDITS"]) || 75;

export const BEST_TIME_PLATFORMS = ["tiktok", "instagram", "youtube", "x"] as const;
export type BestTimePlatform = (typeof BEST_TIME_PLATFORMS)[number];

export const PLATFORM_LABELS: Record<BestTimePlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
};

export const BENCHMARK_NOTE =
  "Platform benchmarks compiled from 2025 published reports (Hootsuite, Buffer, Sprout Social). " +
  "General audience patterns — not guarantees. Your own data beats benchmarks every time.";

const analyticsEntrySchema = z.object({
  /** Which platform the post went to. */
  platform: z.enum(BEST_TIME_PLATFORMS),
  /** When it was posted (ISO datetime). */
  postedAt: z.string().datetime({ offset: true }),
  /** Engagement score 0-100 (whatever the analytics pipeline measures). */
  engagement: z.number().min(0).max(100),
});

export const bestTimeSchema = z.object({
  platforms: z.array(z.enum(BEST_TIME_PLATFORMS)).min(1, "Pick at least one platform.").max(4),
  niche: z.string().trim().min(1).max(60).optional(),
  timezone: z.string().max(80).default("America/New_York"),
  postsPerWeek: z.number().int().min(1).max(14).default(3),
  /** Optional own post history for personalization. */
  analytics: z.array(analyticsEntrySchema).max(500).optional().default([]),
});

/* ─── Benchmark tables ────────────────────────────────────────────────────
   Each window: weekday list (0 = Sunday), [startHour, endHour) in the
   creator's local timezone, a base score, and a human label. Scores are
   deliberately coarse — they are population averages, not predictions. */

interface BenchmarkWindow {
  days: number[];
  start: number;
  end: number;
  score: number;
  label: string;
}

const NIGHT_SCORE = 14;
const BASE_SCORE = 30;

const BENCHMARKS: Record<BestTimePlatform, BenchmarkWindow[]> = {
  tiktok: [
    { days: [2, 3, 4], start: 19, end: 22, score: 94, label: "Evening scroll peak" },
    { days: [6], start: 11, end: 14, score: 84, label: "Weekend late-morning scroll" },
    { days: [0], start: 19, end: 22, score: 80, label: "Sunday wind-down scroll" },
    { days: [1, 2, 3, 4, 5], start: 12, end: 14, score: 78, label: "Lunch scroll rush" },
    { days: [1, 2, 3, 4, 5], start: 7, end: 9, score: 70, label: "Morning commute scroll" },
    { days: [5], start: 19, end: 23, score: 82, label: "Friday night scroll" },
  ],
  instagram: [
    { days: [1, 2, 3, 4, 5], start: 11, end: 14, score: 88, label: "Lunch browse peak" },
    { days: [1, 2, 3, 4], start: 17, end: 20, score: 86, label: "After-work scroll" },
    { days: [1, 2, 3, 4, 5], start: 7, end: 10, score: 82, label: "Morning check-in" },
    { days: [6, 0], start: 9, end: 13, score: 80, label: "Weekend brunch scroll" },
    { days: [5], start: 17, end: 21, score: 74, label: "Friday evening browse" },
  ],
  youtube: [
    { days: [4, 5, 6, 0], start: 13, end: 17, score: 88, label: "Afternoon watch session" },
    { days: [0, 1, 2, 3, 4, 5, 6], start: 19, end: 22, score: 84, label: "Prime-time viewing" },
    { days: [6, 0], start: 9, end: 13, score: 78, label: "Weekend morning viewing" },
    { days: [1, 2, 3, 4, 5], start: 12, end: 14, score: 72, label: "Midday watch break" },
  ],
  x: [
    { days: [1, 2, 3, 4, 5], start: 12, end: 15, score: 90, label: "Lunch debate peak" },
    { days: [1, 2, 3, 4, 5], start: 9, end: 12, score: 84, label: "Morning news cycle" },
    { days: [3], start: 15, end: 18, score: 82, label: "Midweek afternoon surge" },
    { days: [6], start: 9, end: 13, score: 72, label: "Saturday morning catch-up" },
    { days: [1, 2, 3, 4, 5], start: 17, end: 19, score: 68, label: "Commute scroll" },
  ],
};

/** Base score for a platform / weekday / hour from the benchmark tables. */
export function benchmarkScore(platform: BestTimePlatform, weekday: number, hour: number): { score: number; label: string } {
  if (hour < 6) return { score: NIGHT_SCORE, label: "Overnight — most audiences asleep" };
  let best = BASE_SCORE;
  let label = "Average reach window";
  for (const w of BENCHMARKS[platform]) {
    if (w.days.includes(weekday) && hour >= w.start && hour < w.end && w.score > best) {
      best = w.score;
      label = w.label;
    }
  }
  return { score: best, label };
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

interface DayInfo {
  date: string; // YYYY-MM-DD in the creator's timezone
  weekday: number; // 0 = Sunday
}

function weekdayFromName(name: string): number {
  const idx = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(name.slice(0, 3).toLowerCase());
  return idx === -1 ? 0 : idx;
}

/** Next 7 calendar days (today + 6) expressed in the creator's timezone. */
export function daysInTimezone(tz: string): DayInfo[] {
  let timeZone = tz;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    timeZone = "America/New_York";
  }
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const out: DayInfo[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() + i * 86_400_000);
    const parts = fmt.formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    out.push({ date: `${get("year")}-${get("month")}-${get("day")}`, weekday: weekdayFromName(get("weekday")) });
  }
  return out;
}

/** Current hour (0-23) and today's date in the creator's timezone — for filtering out past slots. */
export function nowInTimezone(tz: string): { date: string; hour: number } {
  let timeZone = tz;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    timeZone = "America/New_York";
  }
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

export interface NicheWindow {
  platform: BestTimePlatform;
  weekday: number;
  startHour: number;
  endHour: number;
  boost: number;
  reason: string;
}

/** Validate/sanitize the AI niche-tuning payload — never trust model output blindly. */
export function parseNicheWindows(raw: unknown): NicheWindow[] {
  if (typeof raw !== "object" || raw === null) return [];
  const windows = (raw as { windows?: unknown }).windows;
  if (!Array.isArray(windows)) return [];
  const out: NicheWindow[] = [];
  for (const w of windows.slice(0, 10)) {
    if (typeof w !== "object" || w === null) continue;
    const r = w as Record<string, unknown>;
    if (typeof r.platform !== "string" || !(BEST_TIME_PLATFORMS as readonly string[]).includes(r.platform)) continue;
    const weekday = Number(r.weekday);
    const startHour = Number(r.startHour);
    const endHour = Number(r.endHour);
    const boost = Number(r.boost);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) continue;
    if (!Number.isInteger(endHour) || endHour < 1 || endHour > 24 || endHour <= startHour) continue;
    if (!Number.isFinite(boost) || boost < 1 || boost > 15) continue;
    out.push({
      platform: r.platform as BestTimePlatform,
      weekday,
      startHour,
      endHour,
      boost: Math.round(boost),
      reason: typeof r.reason === "string" ? r.reason.slice(0, 80) : "",
    });
  }
  return out;
}

interface ScoredCell {
  date: string;
  weekday: number;
  hour: number;
  score: number;
  label: string;
  personalized: boolean;
  avgEngagement: number | null;
  aiTuned: boolean;
}

export interface BestTimeSlot {
  date: string;
  time: string;
  platform: BestTimePlatform;
  score: number;
  reason: string;
  source: "benchmark" | "personalized";
}

/**
 * Build the full 7-day x 24-hour scored grid for each platform:
 * benchmark base → personalization boost (own history) → AI niche boost.
 */
export function buildScoredCells(
  platforms: BestTimePlatform[],
  tz: string,
  niche: string | undefined,
  analytics: z.infer<typeof analyticsEntrySchema>[],
  nicheWindows: NicheWindow[],
): { heatmap: Record<string, { dates: string[]; scores: number[][]; personalized: boolean[][]; aiTuned: boolean[][] }>; slots: BestTimeSlot[] } {
  const days = daysInTimezone(tz);
  const now = nowInTimezone(tz);
  const nicheWord = niche?.trim() ? ` for ${niche.trim()} audiences` : "";

  /* Personalization index: platform → weekday → hour → { total, count } */
  const perf = new Map<string, { total: number; count: number }>();
  for (const a of analytics) {
    const d = new Date(a.postedAt);
    if (Number.isNaN(d.getTime())) continue;
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const wd = weekdayFromName(get("weekday"));
    const hour = Number(get("hour")) % 24;
    const key = `${a.platform}:${wd}:${hour}`;
    const cur = perf.get(key) ?? { total: 0, count: 0 };
    cur.total += a.engagement;
    cur.count += 1;
    perf.set(key, cur);
  }

  const heatmap: Record<string, { dates: string[]; scores: number[][]; personalized: boolean[][]; aiTuned: boolean[][] }> = {};
  const allSlots: (BestTimeSlot & { sortKey: number })[] = [];

  for (const platform of platforms) {
    const scores: number[][] = [];
    const personalized: boolean[][] = [];
    const aiTuned: boolean[][] = [];
    const cells: ScoredCell[] = [];

    for (const day of days) {
      const sRow: number[] = [];
      const pRow: boolean[] = [];
      const aRow: boolean[] = [];
      for (let hour = 0; hour < 24; hour++) {
        const { score: base, label } = benchmarkScore(platform, day.weekday, hour);
        let score = base;
        let isPersonalized = false;
        let avgEngagement: number | null = null;
        let isAiTuned = false;
        let reason = `${label}${nicheWord} (platform benchmark)`;

        const stat = perf.get(`${platform}:${day.weekday}:${hour}`);
        if (stat && stat.count >= 2) {
          const avg = Math.round(stat.total / stat.count);
          if (avg >= 60) {
            const boost = Math.min(15, Math.round(((avg - 60) / 40) * 15));
            score += boost;
            isPersonalized = true;
            avgEngagement = avg;
            reason = `Your ${PLATFORM_LABELS[platform]} posts here average ${avg}% engagement${nicheWord} — your audience is active`;
          }
        }

        for (const w of nicheWindows) {
          if (w.platform === platform && w.weekday === day.weekday && hour >= w.startHour && hour < w.endHour) {
            score += w.boost;
            isAiTuned = true;
            if (w.reason) reason = `${reason} · ${w.reason}`;
          }
        }

        score = Math.max(0, Math.min(100, Math.round(score)));
        sRow.push(score);
        pRow.push(isPersonalized);
        aRow.push(isAiTuned);
        cells.push({ date: day.date, weekday: day.weekday, hour, score, label, personalized: isPersonalized, avgEngagement, aiTuned: isAiTuned });
      }
      scores.push(sRow);
      personalized.push(pRow);
      aiTuned.push(aRow);
    }

    heatmap[platform] = { dates: days.map((d) => d.date), scores, personalized, aiTuned };

    /* Top slots: future cells only, highest scores first, 3 per platform. */
    const future = cells.filter((c) => c.date > now.date || (c.date === now.date && c.hour > now.hour));
    future.sort((a, b) => b.score - a.score);
    for (const c of future.slice(0, 3)) {
      const time = `${String(c.hour).padStart(2, "0")}:00`;
      const dayName = WEEKDAY_NAMES[c.weekday];
      const baseReason = c.personalized && c.avgEngagement !== null
        ? `Your ${PLATFORM_LABELS[platform]} posts on ${dayName}s at ${time} average ${c.avgEngagement}% engagement${nicheWord} — your audience is active`
        : `${c.label}${nicheWord} (platform benchmark)`;
      const tunedNote = c.aiTuned ? " · niche-tuned" : "";
      allSlots.push({
        date: c.date,
        time,
        platform,
        score: c.score,
        reason: `${baseReason}${tunedNote}`,
        source: c.personalized ? "personalized" : "benchmark",
        sortKey: c.score,
      });
    }
  }

  allSlots.sort((a, b) => b.sortKey - a.sortKey);
  const slots: BestTimeSlot[] = allSlots.map(({ sortKey: _sortKey, ...rest }) => rest);
  return { heatmap, slots };
}

/** Ask the text model for niche-specific peak windows. Returns [] when no key / any failure. */
async function fetchNicheWindows(
  platforms: BestTimePlatform[],
  niche: string | undefined,
): Promise<NicheWindow[]> {
  if (!niche?.trim() || !process.env["OPENAI_API_KEY"]) return [];
  try {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: getTextModel(),
      max_completion_tokens: 800,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a social media audience strategist. Given a creator niche and platforms, " +
            "identify up to 8 niche-specific peak posting windows (when that niche's audience is most " +
            "active) as small boosts on top of general platform benchmarks. " +
            "Respond ONLY with JSON: { \"windows\": [ { \"platform\": \"tiktok|instagram|youtube|x\", " +
            "\"weekday\": 0-6 (0=Sunday), \"startHour\": 0-23, \"endHour\": 1-24, \"boost\": 1-15, " +
            "\"reason\": \"short why, max 60 chars\" } ] }. Be specific to the niche, not generic.",
        },
        {
          role: "user",
          content: JSON.stringify({ niche: niche.trim(), platforms }),
        },
      ],
    }, { timeout: 45_000 });
    const text = completion.choices[0]?.message?.content ?? "";
    return parseNicheWindows(JSON.parse(text));
  } catch (err) {
    logger.warn({ err }, "[best-time] niche tuning skipped — benchmark slots still returned");
    return [];
  }
}

const router = Router();

router.post("/best-time", requireAuth, async (req, res) => {
  const parsed = bestTimeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { platforms, niche, timezone, analytics } = parsed.data;

  /* 402 pre-check */
  const balance = req.userCredits ?? 0;
  if (balance < BEST_TIME_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: `Best-time optimization costs ${BEST_TIME_CREDIT_COST} Visual Bucs — top up to continue.`,
    });
    return;
  }

  /* charge */
  try {
    await chargeCredits(req.userId!, BEST_TIME_CREDIT_COST, { action: "Best Time to Post" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs for best-time optimization." });
      return;
    }
    throw err;
  }

  const refund = async () => {
    try {
      await refundCredits(req.userId!, BEST_TIME_CREDIT_COST, { action: "Best Time to Post Refund" });
    } catch (refundErr) {
      logger.error({ err: refundErr, userId: req.userId }, "[best-time] FAILED to refund best-time credits");
    }
  };

  try {
    /* Niche tuning is a bonus — benchmark slots are the guaranteed floor. */
    const nicheWindows = await fetchNicheWindows(platforms, niche);
    const { heatmap, slots } = buildScoredCells(platforms, timezone, niche, analytics, nicheWindows);
    const usedHistory = analytics.length > 0 && slots.some((s) => s.source === "personalized");

    res.json({
      slots,
      heatmap,
      platforms,
      niche: niche?.trim() || null,
      timezone,
      personalized: usedHistory,
      aiNicheTuning: nicheWindows.length > 0,
      benchmarkNote: BENCHMARK_NOTE,
      creditsUsed: BEST_TIME_CREDIT_COST,
    });
  } catch (err) {
    await refund();
    logger.error({ err, userId: req.userId }, "[best-time] optimization failed");
    res.status(502).json({
      error: "best_time_failed",
      message: "Couldn't build best-time slots — your Visual Bucs were refunded.",
    });
  }
});

export default router;
