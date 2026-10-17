import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { eq, ne, and, desc, sql } from "drizzle-orm";
import {
  db,
  songsTable,
  distributionReleasesTable,
  creatorProfilesTable,
  storeProductsTable,
  fanTiersTable,
} from "@workspace/db";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import { recordCreditUsage } from "../../lib/payment-record";

const router = Router();

/* Platforms supported by the coach — keep in sync with the frontend /coach page. */
const PLATFORMS = ["youtube", "tiktok", "instagram"] as const;
type Platform = (typeof PLATFORMS)[number];

const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
};

/* 1 credit per money plan — env-overridable without a deploy. A coach call is a
   medium-length GPT-6 Sol completion (a fraction of a cent in provider fees),
   so 1 credit holds a deep margin while staying an impulse buy — and honors
   the standing rule that every AI feature costs a fee. */
const COACH_CREDITS = Number(process.env["MONETIZATION_COACH_CREDIT_COST"]) || 100;

/* ── DE-19: the coach reads the creator's REAL catalog ──────────────────
   The plan used to be identical for a creator with no songs and one
   with fifty, because the route never looked at the catalog. This
   read assembles the state the advice must respect — library,
   releases, store, memberships, and the same earnings totals the
   /api/earnings view shows — from the creator's OWN rows only.
   Every source is isolated: one failing read degrades that field to
   zero, never the whole plan. */
export interface CreatorState {
  songs: number;
  latestSongTitle: string | null;
  releases: number;
  submittedReleases: number;
  storeProducts: number;
  membershipTiers: number;
  earningsCents: number;
  tipsVb: number;
}

const EMPTY_STATE: CreatorState = {
  songs: 0,
  latestSongTitle: null,
  releases: 0,
  submittedReleases: 0,
  storeProducts: 0,
  membershipTiers: 0,
  earningsCents: 0,
  tipsVb: 0,
};

export async function readCreatorState(userId: string): Promise<CreatorState> {
  const state: CreatorState = { ...EMPTY_STATE };
  const attempt = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      logger.warn({ err, userId, source: name }, "[monetization-coach] creator-state source failed — treating as zero");
    }
  };

  await attempt("songs", async () => {
    const [countRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(songsTable)
      .where(eq(songsTable.user_id, userId));
    state.songs = countRow?.n ?? 0;
    if (state.songs > 0) {
      const [latest] = await db
        .select({ title: songsTable.title })
        .from(songsTable)
        .where(eq(songsTable.user_id, userId))
        .orderBy(desc(songsTable.created_at))
        .limit(1);
      state.latestSongTitle = latest?.title ?? null;
    }
  });

  await attempt("releases", async () => {
    const [allRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(distributionReleasesTable)
      .where(eq(distributionReleasesTable.user_id, userId));
    state.releases = allRow?.n ?? 0;
    const [subRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(distributionReleasesTable)
      .where(and(eq(distributionReleasesTable.user_id, userId), ne(distributionReleasesTable.status, "draft")));
    state.submittedReleases = subRow?.n ?? 0;
  });

  await attempt("store+memberships", async () => {
    const [profile] = await db
      .select({ id: creatorProfilesTable.id })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId))
      .limit(1);
    if (profile) {
      const [prodRow] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(storeProductsTable)
        .where(eq(storeProductsTable.profileId, profile.id));
      state.storeProducts = prodRow?.n ?? 0;
    }
    const [tierRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(fanTiersTable)
      .where(eq(fanTiersTable.user_id, userId));
    state.membershipTiers = tierRow?.n ?? 0;
  });

  await attempt("earnings", async () => {
    // The same four sources (and the same total definition) as
    // GET /api/earnings — the coach's numbers must agree with the
    // money view the creator already sees.
    const orders = await db.execute(sql`
      SELECT COALESCE(SUM(o.creator_amount_cents), 0)::int AS cents
      FROM store_orders o
      JOIN creator_profiles cp ON cp.id = o.profile_id
      WHERE cp.user_id = ${userId} AND o.status = 'completed'
    `);
    const shop = await db.execute(sql`
      SELECT COALESCE(SUM(amount_cents - platform_fee_cents), 0)::int AS cents
      FROM shop_events
      WHERE user_id = ${userId} AND event_type = 'sale'
    `);
    const members = await db.execute(sql`
      SELECT COALESCE(SUM(price_cents), 0)::int AS cents
      FROM fan_members
      WHERE user_id = ${userId} AND stripe_session_id IS NOT NULL
    `);
    const deals = await db.execute(sql`
      SELECT COALESCE(SUM(net_cents), 0)::int AS cents
      FROM sponsor_payouts
      WHERE creator_user_id = ${userId} AND status = 'released'
    `);
    const centsOf = (r: { rows: unknown[] }) => Number(((r.rows as Array<{ cents?: unknown }>)[0]?.cents) ?? 0);
    state.earningsCents = centsOf(orders) + centsOf(shop) + centsOf(members) + centsOf(deals);
    const tips = await db.execute(sql`
      SELECT COALESCE(SUM(amount_vb), 0)::int AS vb
      FROM live_stream_tips
      WHERE creator_user_id = ${userId} AND creator_credited_at IS NOT NULL
    `);
    state.tipsVb = Number(((tips.rows as Array<{ vb?: unknown }>)[0]?.vb) ?? 0);
  });

  return state;
}

/* The ONE next move, derived from the state itself — deterministic,
   never model-invented: walk the canonical chain (create → release
   → sell → membership → promote) and point at the first gap. */
export interface CoachNextAction {
  label: string;
  href: string;
}

export function nextActionForState(state: CreatorState): CoachNextAction {
  if (state.songs === 0) return { label: "Make your first song", href: "/make-song" };
  if (state.releases === 0) return { label: "Distribute your songs", href: "/distribute" };
  if (state.storeProducts === 0) return { label: "Stock your profile store", href: "/storefronts/builder" };
  if (state.membershipTiers === 0) return { label: "Launch a fan membership", href: "/memberships" };
  return { label: "Promote your latest release", href: "/promote" };
}

/* The catalog facts as prompt lines — stated as facts about THIS
   creator's business, like the Money Tracker snapshot. */
export function creatorStateLines(state: CreatorState): string[] {
  const dollars = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const lines = [
    `Song library: ${state.songs} song${state.songs === 1 ? "" : "s"}${state.latestSongTitle ? ` (latest: “${state.latestSongTitle}”)` : ""}.`,
    `Distribution: ${state.releases} release${state.releases === 1 ? "" : "s"} on file, ${state.submittedReleases} submitted past draft.`,
    `Profile store: ${state.storeProducts} product${state.storeProducts === 1 ? "" : "s"}. Fan memberships: ${state.membershipTiers} tier${state.membershipTiers === 1 ? "" : "s"} defined.`,
    `Earnings to date on the platform: ${dollars(state.earningsCents)}${state.tipsVb > 0 ? `, plus ${state.tipsVb.toLocaleString("en-US")} Visual Bucs in stream tips` : ""}.`,
  ];
  if (state.songs > 0 && state.releases === 0) {
    lines.push("IMPORTANT GAP: this creator has songs in the library but has NEVER distributed one — the first money move must push distribution of the existing catalog, not making more content.");
  }
  if (state.songs === 0) {
    lines.push("IMPORTANT GAP: this creator's library is EMPTY — the first money move must be creating the first song, not distribution or promotion of work that doesn't exist.");
  }
  return lines;
}

const coachSchema = z.object({
  niche: z.string().min(1, "Niche is required.").max(120),
  platforms: z.array(z.enum(PLATFORMS)).min(1, "Pick at least one platform.").max(3),
  followers: z
    .object({
      youtube: z.number().int().min(0).max(1000000000).optional().default(0),
      tiktok: z.number().int().min(0).max(1000000000).optional().default(0),
      instagram: z.number().int().min(0).max(1000000000).optional().default(0),
    })
    .optional()
    .default({ youtube: 0, tiktok: 0, instagram: 0 }),
  cadence: z.number().int().min(0).max(100),
  /* Optional real tracked money from the Money Tracker tab (/coach?tab=money).
     Free data (no credits) — grounds the plan in the creator's actual P&L
     instead of pure estimates. */
  moneySnapshot: z
    .object({
      monthIncomeCents: z.number().int().min(0).optional(),
      monthExpenseCents: z.number().int().min(0).optional(),
      monthNetCents: z.number().int().optional(),
      allTimeIncomeCents: z.number().int().min(0).optional(),
      allTimeExpenseCents: z.number().int().min(0).optional(),
      allTimeNetCents: z.number().int().optional(),
      topIncomeCategory: z.string().max(60).optional().nullable(),
      topExpenseCategory: z.string().max(60).optional().nullable(),
      monthLabel: z.string().max(40).optional(),
    })
    .optional()
    .nullable(),
});

/* Text model: centralized in getTextModel() (default gpt-6-sol, env-overridable
   via OPENAI_TEXT_MODEL). Called per-request like every other route —
   do not hardcode model IDs. */

/* POST /api/monetization-coach { niche, platforms, followers, cadence }
   → 200 { eligibility[], earnings, moneyMoves[], creditsUsed, creditsRemaining }
   Paid: 1 credit per plan. Auth required; credits are deducted BEFORE the
   model call using the same pre-check + deductCredits + recordCreditUsage
   pattern as hook-studio and the randomizer. */
router.post("/monetization-coach", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = coachSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid money plan request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < COACH_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to build your money plan.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, COACH_CREDITS, { action: "Monetization Coach" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to build your money plan.",
      });
      return;
    }
    throw err;
  }

  /* ── money plan generation ──────────────────────────────────────────────
     Honest framing: thresholds and RPMs shift over time and vary by region,
     so the model must label figures as estimates ("as of 2026", ranges not
     promises) and tell the creator to verify current program terms. */
  const { niche, platforms, followers, cadence } = parsed.data;
  const platformLines = platforms
    .map((p) => `- ${PLATFORM_LABEL[p]}: ${followers[p] ?? 0} followers/subscribers`)
    .join("\n");

  /* DE-19: the creator's real catalog state, read server-side from
     their own rows. Grounds the prompt (below) and derives the one
     structured next action returned with the plan. */
  const creatorState = await readCreatorState(req.userId!);
  const catalogContext =
    `The creator's REAL catalog on Bow Down Visuals (treat as fact, and tailor the money moves to it — ` +
    `reference the actual gaps, e.g. undistributed songs or an empty store, instead of generic advice): ` +
    creatorStateLines(creatorState).join(" ");

  /* Real tracked money (if the creator uses the Money Tracker): treat these
     as facts about their business and reference them in the money moves. */
  const snap = parsed.data.moneySnapshot;
  const moneyDollars = (c: number | undefined | null) =>
    c == null ? null : `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const moneyLines: string[] = [];
  if (snap) {
    const label = snap.monthLabel || "this month";
    if (snap.monthIncomeCents != null && snap.monthExpenseCents != null) {
      moneyLines.push(
        `${label}: ${moneyDollars(snap.monthIncomeCents)} income, ${moneyDollars(snap.monthExpenseCents)} expenses, net ${moneyDollars(snap.monthNetCents ?? snap.monthIncomeCents - snap.monthExpenseCents)}.`,
      );
    }
    if (snap.allTimeIncomeCents != null && snap.allTimeExpenseCents != null) {
      moneyLines.push(
        `All time: ${moneyDollars(snap.allTimeIncomeCents)} income, ${moneyDollars(snap.allTimeExpenseCents)} expenses, net ${moneyDollars(snap.allTimeNetCents ?? snap.allTimeIncomeCents - snap.allTimeExpenseCents)}.`,
      );
    }
    if (snap.topIncomeCategory) moneyLines.push(`Top income category: ${snap.topIncomeCategory.replace(/_/g, " ")}.`);
    if (snap.topExpenseCategory) moneyLines.push(`Top expense category: ${snap.topExpenseCategory.replace(/_/g, " ")}.`);
  }
  const moneyContext =
    moneyLines.length > 0
      ? `The creator's REAL tracked finances (treat as fact, reference them in the money moves when relevant): ${moneyLines.join(" ")}`
      : "";

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a no-nonsense monetization coach for independent content creators. ` +
            `A creator tells you their niche, platforms, follower counts, and posting cadence. ` +
            `You return a concrete money plan as JSON. Be specific and practical — no vague ` +
            `"post consistently" fluff. ` +
            `Eligibility: for each platform state the monetization program name, the entry ` +
            `threshold (use your best knowledge as of 2026, e.g. YouTube Partner Program: ` +
            `1,000 subs + 4,000 watch hours/12mo or 10M Shorts views/90d; TikTok Creator ` +
            `Rewards: 10k followers + 100k views/30d on 1min+ videos, 18+; Instagram: ` +
            `invitation-based bonuses plus gifts/subscriptions), estimate progress 0-100 ` +
            `from their follower count, set status to "eligible", "close", or "building", ` +
            `and give ONE specific next step to hit the threshold faster. ` +
            `Earnings: give realistic RPM/revenue ranges for their niche per platform as ` +
            `estimates (label them estimates — never promises), name which format ` +
            `(long-form, Shorts/Reels, TikTok 1min+) earns most for THEIR situation, and ` +
            `recommend a weekly cadence. Money moves: exactly 3 prioritized actions for ` +
            `the next 30 days, each one sentence, ordered by revenue impact. ` +
            `Return ONLY JSON: {"eligibility": [{"platform": "...", "program": "...", ` +
            `"threshold": "...", "progress": <0-100>, "status": "eligible|close|building", ` +
            `"nextStep": "..."}], "earnings": {"rpmNotes": "...", "bestFormat": "...", ` +
            `"bestCadence": "..."}, "moneyMoves": ["...", "...", "..."], ` +
            `"note": "Thresholds and RPMs are estimates as of 2026 — verify current program terms."}` +
            (moneyContext ? ` ${moneyContext}` : "") +
            ` ${catalogContext}`,
        },
        {
          role: "user",
          content:
            `Build my money plan.\n` +
            `Niche: ${niche.trim()}\n` +
            `Platforms:\n${platformLines}\n` +
            `Posting cadence: ${cadence} videos per week`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1500,
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    interface EligibilityItem { platform: string; program: string; threshold: string; progress: number; status: string; nextStep: string }
    interface PlanJson {
      eligibility?: unknown; earnings?: unknown; moneyMoves?: unknown; note?: unknown;
    }
    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
    let eligibility: EligibilityItem[] = [];
    let earnings: { rpmNotes: string; bestFormat: string; bestCadence: string } = {
      rpmNotes: "", bestFormat: "", bestCadence: "",
    };
    let moneyMoves: string[] = [];
    let note = "Thresholds and RPMs are estimates as of 2026 — verify current program terms.";
    try {
      const j = JSON.parse(raw) as PlanJson;
      if (Array.isArray(j.eligibility)) {
        eligibility = j.eligibility
          .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
          .map((e) => ({
            platform: String(e["platform"] ?? "").trim(),
            program: String(e["program"] ?? "").trim(),
            threshold: String(e["threshold"] ?? "").trim(),
            progress: typeof e["progress"] === "number" ? clamp(e["progress"]) : 0,
            status: ["eligible", "close", "building"].includes(String(e["status"]))
              ? String(e["status"])
              : "building",
            nextStep: String(e["nextStep"] ?? "").trim(),
          }))
          .filter((e) => e.platform && e.program)
          .slice(0, 3);
      }
      if (j.earnings && typeof j.earnings === "object") {
        const er = j.earnings as Record<string, unknown>;
        earnings = {
          rpmNotes: String(er["rpmNotes"] ?? "").trim(),
          bestFormat: String(er["bestFormat"] ?? "").trim(),
          bestCadence: String(er["bestCadence"] ?? "").trim(),
        };
      }
      if (Array.isArray(j.moneyMoves)) {
        moneyMoves = j.moneyMoves
          .filter((m): m is string => typeof m === "string" && m.trim().length > 0)
          .map((m) => m.trim())
          .slice(0, 3);
      }
      if (typeof j.note === "string" && j.note.trim()) note = j.note.trim();
    } catch {
      /* fall through to the empty check below */
    }
    if (eligibility.length === 0 || moneyMoves.length === 0) {
      throw new Error("Model returned no usable money plan");
    }

    res.json({
      eligibility,
      earnings,
      moneyMoves,
      note,
      /* DE-19: the one structured next move (state-derived, above)
         — the page renders it as the plan's primary button — plus
         the state it was derived from, so the creator can see the
         coach actually read their catalog. */
      nextAction: nextActionForState(creatorState),
      creatorState,
      creditsUsed: COACH_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[monetization-coach] OpenAI rate limit / quota");
      res.status(503).json({ error: "The coach is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[monetization-coach] generation failed");
    res.status(502).json({ error: "The coach hiccupped — try again." });
  }
});

export default router;
