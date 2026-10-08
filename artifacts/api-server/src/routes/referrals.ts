import { Router } from "express";
import { randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { getSupabaseAdmin, addCreditsToProfile } from "../lib/supabase-admin";
import { logger } from "../lib/logger";

const router = Router();

/* ── Referral revenue-share program ──────────────────────────────────────
   - Referee (new user) gets 10 welcome credits when they apply a code.
   - Referrer gets 25% of the referee's credit PURCHASES, paid in site
     credits, for 90 days after the referral. No upfront referrer payout,
     so fake signups earn nothing.
   - One referral per user. No self-referrals.
   - Purchase payouts are idempotent: one referral_payouts row per Stripe
     session, so webhook retries can never double-pay. */
const REFEREE_WELCOME_CREDITS = 1000;
const REVENUE_SHARE_PCT = 25;
const SHARE_WINDOW_DAYS = 90;

/* ── Promoter Program — 6-star Kingpin ranks ───────────────────────────────
   The referral program is a job: promoters climb stars, unlock higher
   commission rates and one-time milestone bonuses. Rates apply at the
   promoter's CURRENT tier (rank-ups boost every active referral).
   House always stays on top: payouts are site credits (redeemed at
   2.5–8x margins), windows are 90 days, and the top tiers demand dozens
   of real referred creators. */
interface PromoterTier {
  stars: number;
  title: string;
  minReferrals: number;
  ratePct: number;
  milestoneBonus: number;
}
const PROMOTER_TIERS: PromoterTier[] = [
  { stars: 1, title: "Street Soldier", minReferrals: 1,  ratePct: 25, milestoneBonus: 0 },
  { stars: 2, title: "Hustler",        minReferrals: 3,  ratePct: 28, milestoneBonus: 1500 },
  { stars: 3, title: "Shot Caller",    minReferrals: 6,  ratePct: 30, milestoneBonus: 4000 },
  { stars: 4, title: "Big Boss",       minReferrals: 12, ratePct: 33, milestoneBonus: 10000 },
  { stars: 5, title: "Kingpin",        minReferrals: 25, ratePct: 35, milestoneBonus: 25000 },
  { stars: 6, title: "The Don",        minReferrals: 50, ratePct: 40, milestoneBonus: 60000 },
];
function getPromoterTier(referralCount: number): { tier: PromoterTier | null; next: PromoterTier | null } {
  let tier: PromoterTier | null = null;
  let next: PromoterTier | null = null;
  for (const t of PROMOTER_TIERS) {
    if (referralCount >= t.minReferrals) tier = t;
    else { next = t; break; }
  }
  return { tier, next };
}

/* Boot-time self-heal: create tables if they don't exist (idempotent). */
let tablesEnsured = false;
async function ensureReferralTables(): Promise<void> {
  if (tablesEnsured) return;
  tablesEnsured = true;
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS referral_codes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS referral_codes_user_id_idx ON referral_codes (user_id);
    CREATE INDEX IF NOT EXISTS referral_codes_code_idx ON referral_codes (code);
    CREATE TABLE IF NOT EXISTS referrals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      referrer_user_id UUID NOT NULL,
      referee_user_id UUID NOT NULL UNIQUE,
      referrer_credits_awarded INTEGER NOT NULL DEFAULT 0,
      referee_credits_awarded INTEGER NOT NULL DEFAULT 10,
      revenue_share_pct INTEGER NOT NULL DEFAULT 25,
      share_expires_at TIMESTAMPTZ,
      total_referrer_earned INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_user_id);
    CREATE INDEX IF NOT EXISTS referrals_referee_idx ON referrals (referee_user_id);
    ALTER TABLE referrals
      ADD COLUMN IF NOT EXISTS revenue_share_pct INTEGER NOT NULL DEFAULT 25,
      ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS total_referrer_earned INTEGER NOT NULL DEFAULT 0;
    UPDATE referrals
    SET share_expires_at = created_at + INTERVAL '90 days'
    WHERE share_expires_at IS NULL;
    CREATE TABLE IF NOT EXISTS referral_payouts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      referral_id UUID NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
      stripe_session_id TEXT NOT NULL UNIQUE,
      referee_credits_purchased INTEGER NOT NULL,
      referrer_credits_awarded INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS referral_payouts_referral_idx ON referral_payouts (referral_id);
    CREATE TABLE IF NOT EXISTS referral_milestones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      referrer_user_id UUID NOT NULL,
      stars INTEGER NOT NULL,
      bonus_credits INTEGER NOT NULL,
      awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(referrer_user_id, stars)
    );
    CREATE INDEX IF NOT EXISTS referral_milestones_referrer_idx ON referral_milestones (referrer_user_id);
    CREATE TABLE IF NOT EXISTS referral_contests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      period TEXT NOT NULL UNIQUE,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      prizes JSONB NOT NULL DEFAULT '[]',
      min_signups_to_qualify INTEGER NOT NULL DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'open',
      settled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS referral_contests_period_idx ON referral_contests (period);
    CREATE TABLE IF NOT EXISTS referral_contest_prizes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      contest_id UUID NOT NULL REFERENCES referral_contests(id) ON DELETE CASCADE,
      rank INTEGER NOT NULL,
      referrer_user_id UUID NOT NULL,
      signups INTEGER NOT NULL DEFAULT 0,
      revenue_earned INTEGER NOT NULL DEFAULT 0,
      prize_credits INTEGER NOT NULL DEFAULT 0,
      awarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (contest_id, referrer_user_id)
    );
    CREATE INDEX IF NOT EXISTS referral_contest_prizes_contest_idx ON referral_contest_prizes (contest_id);
    CREATE INDEX IF NOT EXISTS referral_contest_prizes_referrer_idx ON referral_contest_prizes (referrer_user_id);
  `));
}

function generateCode(): string {
  // 8-char alphanumeric, easy to share (no confusing 0/O, 1/I/l)
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

/* GET /api/referrals/me — get (or create) the caller's referral code + stats. */
router.get("/referrals/me", requireAuth, async (req, res) => {
  try {
    await ensureReferralTables();
    const userId = req.userId!;
    const supabase = getSupabaseAdmin();

    // Get or create code
    let { data: codeRow } = await supabase
      .from("referral_codes")
      .select("code")
      .eq("user_id", userId)
      .single();

    if (!codeRow) {
      // Create a unique code (retry on code collision)
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateCode();
        const { data, error } = await supabase
          .from("referral_codes")
          .insert({ user_id: userId, code })
          .select("code")
          .single();
        if (!error) {
          codeRow = data;
          break;
        }
        lastError = error;
        // Only a unique-violation is worth retrying (code collision or a
        // parallel request creating the row). Anything else will fail the
        // same way on retry — stop early.
        if ((error as { code?: string } | null)?.code !== "23505") break;
      }
      if (!codeRow) {
        // Race safety: a parallel request may have created the row between
        // our read and our inserts — re-read before giving up.
        const { data: raced } = await supabase
          .from("referral_codes")
          .select("code")
          .eq("user_id", userId)
          .maybeSingle();
        if (raced) codeRow = raced;
      }
      if (!codeRow) {
        req.log.error({ err: lastError, userId }, "referral code creation failed");
        res.status(500).json({ error: "Could not create referral code." });
        return;
      }
    }

    // Stats: referrals + revenue-share earnings
    const { data: referralRows } = await supabase
      .from("referrals")
      .select("id, referee_user_id, total_referrer_earned, share_expires_at, created_at")
      .eq("referrer_user_id", userId);

    const now = new Date();
    const activeReferrals = (referralRows ?? []).filter(
      (r) => r.share_expires_at && new Date(r.share_expires_at) > now
    );
    const totalEarned = (referralRows ?? []).reduce(
      (sum, r) => sum + (r.total_referrer_earned ?? 0),
      0
    );

    /* Per-referral detail for the manage/track view. No referee PII —
       only join date, earnings, and window status. */
    const referralList = (referralRows ?? []).map((r) => {
      const expires = r.share_expires_at ? new Date(r.share_expires_at) : null;
      const active = !!expires && expires > now;
      const daysLeft = active
        ? Math.max(0, Math.ceil((expires.getTime() - now.getTime()) / 86400000))
        : 0;
      return {
        joinedAt: r.created_at,
        creditsEarned: r.total_referrer_earned ?? 0,
        shareExpiresAt: r.share_expires_at,
        daysLeft,
        active,
      };
    }).sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime());

    const totalCount = (referralRows ?? []).length;
    const { tier, next } = getPromoterTier(totalCount);

    /* Virality wave: the caller's rank on each leaderboard window. */
    let ranks: { weekly: number | null; monthly: number | null; alltime: number | null } = {
      weekly: null, monthly: null, alltime: null,
    };
    try {
      const [weekly, monthly, alltime] = await Promise.all([
        getStandings("weekly"),
        getStandings("monthly"),
        getStandings("alltime"),
      ]);
      const findRank = (rows: StandingRow[]) => {
        const idx = rows.findIndex((r) => r.referrerUserId === userId);
        return idx === -1 ? null : idx + 1;
      };
      ranks = { weekly: findRank(weekly), monthly: findRank(monthly), alltime: findRank(alltime) };
    } catch { /* ranks stay null — non-fatal */ }
    const { data: milestoneRows } = await supabase
      .from("referral_milestones")
      .select("stars")
      .eq("referrer_user_id", userId);
    const claimedStars = new Set((milestoneRows ?? []).map((m) => m.stars));

    res.json({
      code: codeRow.code,
      totalReferrals: totalCount,
      activeReferrals: activeReferrals.length,
      creditsEarned: totalEarned,
      revenueSharePct: tier?.ratePct ?? REVENUE_SHARE_PCT,
      shareWindowDays: SHARE_WINDOW_DAYS,
      refereeReward: REFEREE_WELCOME_CREDITS,
      referrals: referralList,
      tier: tier ? {
        stars: tier.stars,
        title: tier.title,
        ratePct: tier.ratePct,
      } : null,
      nextTier: next ? {
        stars: next.stars,
        title: next.title,
        minReferrals: next.minReferrals,
        ratePct: next.ratePct,
        milestoneBonus: next.milestoneBonus,
      } : null,
      claimedMilestones: Array.from(claimedStars),
      ranks,
      tierLadder: PROMOTER_TIERS.map((t) => ({
        stars: t.stars,
        title: t.title,
        minReferrals: t.minReferrals,
        ratePct: t.ratePct,
        milestoneBonus: t.milestoneBonus,
      })),
    });
  } catch (err: unknown) {
    req.log.error({ err }, "referrals/me error");
    res.status(500).json({ error: "Failed to load referral info." });
  }
});

/* ── Milestone bonuses ─────────────────────────────────────────────────────
   When a promoter's referral count crosses a tier threshold, award the
   one-time milestone bonus. Idempotent: UNIQUE(referrer_user_id, stars)
   means retries can never double-award. Returns newly awarded tiers. */
async function awardMilestoneBonuses(referrerUserId: string): Promise<PromoterTier[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { count } = await supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_user_id", referrerUserId);
    const total = count ?? 0;
    const awarded: PromoterTier[] = [];
    for (const t of PROMOTER_TIERS) {
      if (total < t.minReferrals || t.milestoneBonus <= 0) continue;
      const { error } = await supabase.from("referral_milestones").insert({
        referrer_user_id: referrerUserId,
        stars: t.stars,
        bonus_credits: t.milestoneBonus,
      });
      if (!error) {
        await addCreditsToProfile(referrerUserId, t.milestoneBonus);
        awarded.push(t);
      }
      // Conflict = already awarded — skip silently
    }
    return awarded;
  } catch {
    return [];
  }
}

/* POST /api/referrals/apply — apply a referral code for the caller (after signup).
   Body: { code: string } */
router.post("/referrals/apply", requireAuth, async (req, res) => {
  try {
    await ensureReferralTables();
    const userId = req.userId!;
    const { code } = req.body as { code?: string };

    if (!code || typeof code !== "string") {
      res.status(400).json({ error: "Referral code is required." });
      return;
    }

    const supabase = getSupabaseAdmin();
    const normalized = code.trim().toUpperCase();

    // Already referred? (one per user)
    const { data: existing } = await supabase
      .from("referrals")
      .select("id")
      .eq("referee_user_id", userId)
      .single();
    if (existing) {
      res.status(400).json({ error: "You've already used a referral code." });
      return;
    }

    // Find the code
    const { data: codeRow } = await supabase
      .from("referral_codes")
      .select("user_id")
      .eq("code", normalized)
      .single();
    if (!codeRow) {
      res.status(404).json({ error: "Invalid referral code." });
      return;
    }

    // No self-referrals
    if (codeRow.user_id === userId) {
      res.status(400).json({ error: "You can't use your own referral code." });
      return;
    }

    // Record the referral with a 90-day revenue-share window.
    // Referee gets 10 welcome credits now; referrer earns 25% of future
    // purchases — no upfront referrer payout.
    const shareExpiresAt = new Date(
      Date.now() + SHARE_WINDOW_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const { error: insertError } = await supabase.from("referrals").insert({
      referrer_user_id: codeRow.user_id,
      referee_user_id: userId,
      referrer_credits_awarded: 0,
      referee_credits_awarded: REFEREE_WELCOME_CREDITS,
      revenue_share_pct: REVENUE_SHARE_PCT,
      share_expires_at: shareExpiresAt,
      total_referrer_earned: 0,
    });
    if (insertError) {
      // Race: someone else already recorded this referee
      res.status(400).json({ error: "You've already used a referral code." });
      return;
    }

    await addCreditsToProfile(userId, REFEREE_WELCOME_CREDITS);

    // Promoter Program: check for newly unlocked star milestones (idempotent).
    const newMilestones = await awardMilestoneBonuses(codeRow.user_id);

    res.json({
      ok: true,
      refereeReward: REFEREE_WELCOME_CREDITS,
      revenueSharePct: REVENUE_SHARE_PCT,
      shareWindowDays: SHARE_WINDOW_DAYS,
      milestonesAwarded: newMilestones.map((t) => ({
        stars: t.stars,
        title: t.title,
        bonus: t.milestoneBonus,
      })),
    });
  } catch (err: unknown) {
    req.log.error({ err }, "referrals/apply error");
    res.status(500).json({ error: "Failed to apply referral code." });
  }
});

/* ── Revenue-share payout ────────────────────────────────────────────────
   Called by the Stripe webhook after a successful credit-pack purchase.
   Awards the referrer 25% of the purchased credits (rounded down) if the
   referral is still inside its 90-day window. Idempotent: the UNIQUE
   constraint on referral_payouts.stripe_session_id means a retried webhook
   can never double-pay. Returns the awarded amount (0 when no payout). */
export async function awardReferralPayout(
  refereeUserId: string,
  creditsPurchased: number,
  stripeSessionId: string,
): Promise<number> {
  try {
    await ensureReferralTables();
    const supabase = getSupabaseAdmin();

    // Find an active referral for this buyer
    const { data: referral } = await supabase
      .from("referrals")
      .select("id, referrer_user_id, revenue_share_pct, share_expires_at")
      .eq("referee_user_id", refereeUserId)
      .single();
    if (!referral) return 0;

    if (!referral.share_expires_at || new Date(referral.share_expires_at) <= new Date()) {
      return 0; // window expired
    }

    /* Promoter Program: the payout rate follows the referrer's CURRENT star
       tier — ranking up boosts every active referral. Falls back to the
       rate stored on the row, then the default. */
    const { count: referrerCount } = await supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_user_id", referral.referrer_user_id);
    const { tier: currentTier } = getPromoterTier(referrerCount ?? 0);
    const pct = currentTier?.ratePct ?? referral.revenue_share_pct ?? REVENUE_SHARE_PCT;
    const awarded = Math.floor((creditsPurchased * pct) / 100);
    if (awarded <= 0) return 0;

    // Idempotent insert — UNIQUE(stripe_session_id) dedupes retries
    const { error: payoutError } = await supabase.from("referral_payouts").insert({
      referral_id: referral.id,
      stripe_session_id: stripeSessionId,
      referee_credits_purchased: creditsPurchased,
      referrer_credits_awarded: awarded,
    });
    if (payoutError) {
      // Duplicate session (webhook retry) or other conflict — never double-pay
      logger.info(
        { stripeSessionId, refereeUserId, payoutError: payoutError.message },
        "Referral payout skipped (likely duplicate webhook)"
      );
      return 0;
    }

    await addCreditsToProfile(referral.referrer_user_id, awarded);

    // Bump the running total (best-effort; the payouts table is the ledger)
    await supabase.rpc("increment_referrer_earned", {
      p_referral_id: referral.id,
      p_amount: awarded,
    }).then(
      () => {},
      async () => {
        // Fallback if the RPC doesn't exist: read-modify-write
        const { data: cur } = await supabase
          .from("referrals")
          .select("total_referrer_earned")
          .eq("id", referral.id)
          .single();
        await supabase
          .from("referrals")
          .update({ total_referrer_earned: (cur?.total_referrer_earned ?? 0) + awarded })
          .eq("id", referral.id);
      }
    );

    logger.info(
      { referralId: referral.id, referrer: referral.referrer_user_id, awarded, stripeSessionId },
      "Referral revenue-share payout awarded"
    );
    return awarded;
  } catch (err: unknown) {
    logger.error({ err, refereeUserId, stripeSessionId }, "Referral payout failed");
    return 0;
  }
}

/* ── Viral leaderboard + monthly contest ─────────────────────────────────
   The loop: referrers compete publicly → top referrers win Visual Bucs →
   everyone recruits harder → new users.

   Leaderboard: ranked by signups in the window, tiebreak = revenue
   generated (Visual Bucs paid out to the referrer in-window). Windows:
   weekly (rolling 7 days), monthly (calendar month), all-time.
   Public names resolve from creator_profiles (public profiles only);
   everyone else shows as "Anonymous Recruiter".

   Contest: one contest per calendar month. Winners are the top 3 by
   in-month signups (tiebreak = revenue). Prizes are site credits —
   marginal cost to the house is tiny (redeemed at 2.5–8x margins), so a
   40,000 Buc pool is safe. Minimum 5 signups to qualify, so a dead month
   pays nothing. Settlement is idempotent: UNIQUE(contest_id,
   referrer_user_id) + a settle-once promise guard. */

const CONTEST_PRIZES = [
  { rank: 1, prizeCredits: 25000 },
  { rank: 2, prizeCredits: 10000 },
  { rank: 3, prizeCredits: 5000 },
];
const CONTEST_MIN_SIGNUPS = 5;

const CONTEST_RULES = [
  "Every creator who joins with your link during the month = 1 entry.",
  "Top 3 by monthly signups win — ties broken by revenue your referrals generated.",
  `At least ${CONTEST_MIN_SIGNUPS} signups to qualify for a prize.`,
  "Prizes are paid automatically in Visual Bucs within 24 hours of month-end.",
  "Only real creators count — fake signups void your winnings.",
];

type LeaderboardWindow = "weekly" | "monthly" | "alltime";

function windowBounds(window: LeaderboardWindow): { start: Date | null; end: Date | null } {
  const now = new Date();
  if (window === "weekly") {
    return { start: new Date(now.getTime() - 7 * 86400000), end: now };
  }
  if (window === "monthly") {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    };
  }
  return { start: null, end: null };
}

interface StandingRow {
  referrerUserId: string;
  signups: number;
  revenue: number;
  firstSignup: string;
  displayName: string | null;
  slug: string | null;
}

async function getStandings(window: LeaderboardWindow): Promise<StandingRow[]> {
  await ensureReferralTables();
  const { start, end } = windowBounds(window);
  const result = await db.execute(sql`
    SELECT r.referrer_user_id AS "referrerUserId",
           COUNT(*)::int AS signups,
           COALESCE(p.awarded, 0)::int AS revenue,
           MIN(r.created_at)::text AS "firstSignup",
           cp.display_name AS "displayName",
           cp.slug AS slug
    FROM referrals r
    LEFT JOIN (
      SELECT rp.referral_id, SUM(rp.referrer_credits_awarded)::int AS awarded
      FROM referral_payouts rp
      ${start && end ? sql`WHERE rp.created_at >= ${start.toISOString()} AND rp.created_at < ${end.toISOString()}` : sql``}
      GROUP BY rp.referral_id
    ) p ON p.referral_id = r.id
    LEFT JOIN creator_profiles cp
      ON cp.user_id = r.referrer_user_id AND cp.is_public = true
    ${start && end ? sql`WHERE r.created_at >= ${start.toISOString()} AND r.created_at < ${end.toISOString()}` : sql``}
    GROUP BY r.referrer_user_id, cp.display_name, cp.slug
    ORDER BY signups DESC, revenue DESC, "firstSignup" ASC
    LIMIT 50
  `);
  return result.rows as unknown as StandingRow[];
}

function badgeForSignups(signups: number): { stars: number; title: string } | null {
  const { tier } = getPromoterTier(signups);
  return tier ? { stars: tier.stars, title: tier.title } : null;
}

/* Public badge for a user — used on creator profiles (/artist/:slug) and
   the leaderboard. Returns null when the user has no referrals yet. */
export async function getRecruiterBadgeForUser(userId: string): Promise<
  { stars: number; title: string; signups: number; ratePct: number } | null
> {
  try {
    await ensureReferralTables();
    const supabase = getSupabaseAdmin();
    const { count } = await supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_user_id", userId);
    const signups = count ?? 0;
    const badge = badgeForSignups(signups);
    if (!badge) return null;
    return { ...badge, signups, ratePct: PROMOTER_TIERS.find((t) => t.stars === badge.stars)?.ratePct ?? 25 };
  } catch {
    return null;
  }
}

/* GET /api/referrals/leaderboard?window=weekly|monthly|alltime — public.
   The competitive layer: names, signups, revenue, tier badges. */
router.get("/referrals/leaderboard", async (req, res) => {
  try {
    const window = (String(req.query["window"] ?? "monthly") as LeaderboardWindow);
    if (!["weekly", "monthly", "alltime"].includes(window)) {
      res.status(400).json({ error: "Invalid window." });
      return;
    }
    const rows = await getStandings(window);
    res.json({
      window,
      entries: rows.map((r, i) => ({
        rank: i + 1,
        name: r.displayName ?? "Anonymous Recruiter",
        slug: r.slug,
        signups: r.signups,
        revenue: r.revenue,
        badge: badgeForSignups(r.signups),
      })),
    });
  } catch (err: unknown) {
    req.log.error({ err }, "referrals/leaderboard error");
    res.status(500).json({ error: "Failed to load leaderboard." });
  }
});

/* ── Monthly contest settlement ──────────────────────────────────────────
   Runs lazily on /api/referrals/contest hits (guarded so concurrent hits
   can't double-settle) and is exported for any future cron. Exactly-once
   payouts: a prize row is inserted only if none exists for
   (contest_id, referrer_user_id); the UNIQUE constraint is the last guard. */
let settleInFlight: Promise<void> | null = null;

function monthPeriod(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function ensureOpenContest(period: string, startsAt: Date, endsAt: Date): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase
    .from("referral_contests")
    .select("id")
    .eq("period", period)
    .maybeSingle();
  if (existing) return existing.id as string;
  const { data: created, error } = await supabase
    .from("referral_contests")
    .insert({
      period,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      prizes: CONTEST_PRIZES,
      min_signups_to_qualify: CONTEST_MIN_SIGNUPS,
      status: "open",
    })
    .select("id")
    .single();
  if (error || !created) throw new Error("Could not create contest row");
  return created.id as string;
}

async function settleOneContest(contestId: string, startsAt: Date, endsAt: Date): Promise<void> {
  const supabase = getSupabaseAdmin();
  const rows = await db.execute(sql`
    SELECT r.referrer_user_id AS "referrerUserId",
           COUNT(*)::int AS signups,
           COALESCE(p.awarded, 0)::int AS revenue,
           MIN(r.created_at)::text AS "firstSignup"
    FROM referrals r
    LEFT JOIN (
      SELECT rp.referral_id, SUM(rp.referrer_credits_awarded)::int AS awarded
      FROM referral_payouts rp
      WHERE rp.created_at >= ${startsAt.toISOString()} AND rp.created_at < ${endsAt.toISOString()}
      GROUP BY rp.referral_id
    ) p ON p.referral_id = r.id
    WHERE r.created_at >= ${startsAt.toISOString()} AND r.created_at < ${endsAt.toISOString()}
    GROUP BY r.referrer_user_id
    ORDER BY signups DESC, revenue DESC, "firstSignup" ASC
  `);
  const standings = rows.rows as unknown as StandingRow[];
  const qualifiers = standings.filter((s) => s.signups >= CONTEST_MIN_SIGNUPS);

  for (const prize of CONTEST_PRIZES) {
    const winner = qualifiers[prize.rank - 1];
    if (!winner) continue; // nobody qualified at this rank — pool keeps it
    // Idempotency: skip if a prize row already exists for this winner
    const { data: existing } = await supabase
      .from("referral_contest_prizes")
      .select("id")
      .eq("contest_id", contestId)
      .eq("referrer_user_id", winner.referrerUserId)
      .maybeSingle();
    if (existing) continue;
    const { error } = await supabase.from("referral_contest_prizes").insert({
      contest_id: contestId,
      rank: prize.rank,
      referrer_user_id: winner.referrerUserId,
      signups: winner.signups,
      revenue_earned: winner.revenue,
      prize_credits: prize.prizeCredits,
    });
    if (error) {
      // Unique-violation = a parallel settler already paid — never double-pay
      logger.info({ contestId, winner: winner.referrerUserId, error: error.message }, "Contest prize skipped (already awarded)");
      continue;
    }
    await addCreditsToProfile(winner.referrerUserId, prize.prizeCredits);
    logger.info(
      { contestId, rank: prize.rank, winner: winner.referrerUserId, prize: prize.prizeCredits },
      "Referral contest prize awarded"
    );
  }

  await supabase
    .from("referral_contests")
    .update({ status: "settled", settled_at: new Date().toISOString() })
    .eq("id", contestId);
}

export async function settleReferralContests(): Promise<void> {
  if (settleInFlight) return settleInFlight;
  settleInFlight = (async () => {
    try {
      await ensureReferralTables();
      const supabase = getSupabaseAdmin();
      // Ensure a row exists for the current month (so the frontend always
      // has a contest to render), then settle every ended-but-open month.
      const now = new Date();
      const curPeriod = monthPeriod(now);
      const curStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const curEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      await ensureOpenContest(curPeriod, curStart, curEnd);

      const { data: open } = await supabase
        .from("referral_contests")
        .select("id, period, starts_at, ends_at")
        .eq("status", "open");
      for (const c of open ?? []) {
        if (new Date(c.ends_at as string) >= now) continue;
        const start = new Date(c.starts_at as string);
        const end = new Date(c.ends_at as string);
        // Double-check nobody settled it between our read and now
        const { data: fresh } = await supabase
          .from("referral_contests")
          .select("status")
          .eq("id", c.id)
          .single();
        if (fresh?.status !== "open") continue;
        await settleOneContest(c.id as string, start, end);
      }
    } catch (err: unknown) {
      logger.error({ err }, "settleReferralContests failed");
    } finally {
      settleInFlight = null;
    }
  })();
  return settleInFlight;
}

/* GET /api/referrals/contest — public. Current contest: countdown, rules,
   prizes, live standings, and the last settled month's winners (shareable). */
router.get("/referrals/contest", async (req, res) => {
  try {
    await ensureReferralTables();
    // Lazy settlement: ended months pay out on the next hit after month-end.
    settleReferralContests().catch(() => {});
    const supabase = getSupabaseAdmin();
    const now = new Date();
    const period = monthPeriod(now);
    const curStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const curEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    await ensureOpenContest(period, curStart, curEnd);

    const standings = await getStandings("monthly");

    // Last settled month — the winner announcement
    const { data: lastSettled } = await supabase
      .from("referral_contests")
      .select("id, period")
      .eq("status", "settled")
      .order("period", { ascending: false })
      .limit(1)
      .maybeSingle();
    let winners: Array<{
      rank: number; name: string; slug: string | null; signups: number;
      prizeCredits: number; badge: { stars: number; title: string } | null;
    }> = [];
    let winnerPeriod: string | null = null;
    if (lastSettled) {
      const { data: prizeRows } = await supabase
        .from("referral_contest_prizes")
        .select("rank, referrer_user_id, signups, prize_credits")
        .eq("contest_id", lastSettled.id)
        .order("rank", { ascending: true });
      const ids = (prizeRows ?? []).map((p) => p.referrer_user_id as string);
      const { data: profiles } = ids.length
        ? await supabase.from("creator_profiles").select("user_id, display_name, slug, is_public").in("user_id", ids)
        : { data: [] as Array<{ user_id: string; display_name: string; slug: string; is_public: boolean }> };
      const byId = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
      winners = (prizeRows ?? []).map((p) => {
        const prof = byId.get(p.referrer_user_id as string);
        const publicName = prof && (prof.is_public as boolean) ? (prof.display_name as string) : null;
        return {
          rank: p.rank as number,
          name: publicName ?? "Anonymous Recruiter",
          slug: (prof && (prof.is_public as boolean) ? (prof.slug as string) : null),
          signups: p.signups as number,
          prizeCredits: p.prize_credits as number,
          badge: badgeForSignups(p.signups as number),
        };
      });
      winnerPeriod = lastSettled.period as string;
    }

    res.json({
      period,
      endsAt: curEnd.toISOString(),
      nowMs: now.getTime(),
      rules: CONTEST_RULES,
      prizes: CONTEST_PRIZES,
      minSignupsToQualify: CONTEST_MIN_SIGNUPS,
      standings: standings.slice(0, 10).map((r, i) => ({
        rank: i + 1,
        name: r.displayName ?? "Anonymous Recruiter",
        slug: r.slug,
        signups: r.signups,
        revenue: r.revenue,
        badge: badgeForSignups(r.signups),
      })),
      lastWinners: winners,
      lastWinnerPeriod: winnerPeriod,
    });
  } catch (err: unknown) {
    req.log.error({ err }, "referrals/contest error");
    res.status(500).json({ error: "Failed to load contest." });
  }
});

export default router;
