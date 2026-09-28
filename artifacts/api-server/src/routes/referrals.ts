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
const REFEREE_WELCOME_CREDITS = 10;
const REVENUE_SHARE_PCT = 25;
const SHARE_WINDOW_DAYS = 90;

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
      // Create a unique code (retry on collision)
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
        // Collision — try again
      }
      if (!codeRow) {
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

    res.json({
      code: codeRow.code,
      totalReferrals: (referralRows ?? []).length,
      activeReferrals: activeReferrals.length,
      creditsEarned: totalEarned,
      revenueSharePct: REVENUE_SHARE_PCT,
      shareWindowDays: SHARE_WINDOW_DAYS,
      refereeReward: REFEREE_WELCOME_CREDITS,
    });
  } catch (err: unknown) {
    req.log.error({ err }, "referrals/me error");
    res.status(500).json({ error: "Failed to load referral info." });
  }
});

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

    res.json({
      ok: true,
      refereeReward: REFEREE_WELCOME_CREDITS,
      revenueSharePct: REVENUE_SHARE_PCT,
      shareWindowDays: SHARE_WINDOW_DAYS,
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

    const pct = referral.revenue_share_pct ?? REVENUE_SHARE_PCT;
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

export default router;
