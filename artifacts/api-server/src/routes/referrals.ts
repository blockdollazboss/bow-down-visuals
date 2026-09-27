import { Router } from "express";
import { randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { getSupabaseAdmin, addCreditsToProfile } from "../lib/supabase-admin";

const router = Router();

const REFERRER_REWARD = 5;
const REFEREE_REWARD = 3;

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
      referrer_credits_awarded INTEGER NOT NULL DEFAULT 5,
      referee_credits_awarded INTEGER NOT NULL DEFAULT 3,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_user_id);
    CREATE INDEX IF NOT EXISTS referrals_referee_idx ON referrals (referee_user_id);
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

    // Stats
    const { count: totalReferrals } = await supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_user_id", userId);

    const { data: creditRows } = await supabase
      .from("referrals")
      .select("referrer_credits_awarded")
      .eq("referrer_user_id", userId);

    const creditsEarned = (creditRows ?? []).reduce(
      (sum, r) => sum + (r.referrer_credits_awarded ?? 0),
      0
    );

    res.json({
      code: codeRow.code,
      totalReferrals: totalReferrals ?? 0,
      creditsEarned,
      referrerReward: REFERRER_REWARD,
      refereeReward: REFEREE_REWARD,
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

    // Record + award (5 to referrer, 3 to referee)
    const { error: insertError } = await supabase.from("referrals").insert({
      referrer_user_id: codeRow.user_id,
      referee_user_id: userId,
      referrer_credits_awarded: REFERRER_REWARD,
      referee_credits_awarded: REFEREE_REWARD,
    });
    if (insertError) {
      // Race: someone else already recorded this referee
      res.status(400).json({ error: "You've already used a referral code." });
      return;
    }

    await Promise.all([
      addCreditsToProfile(codeRow.user_id, REFERRER_REWARD),
      addCreditsToProfile(userId, REFEREE_REWARD),
    ]);

    res.json({
      ok: true,
      referrerReward: REFERRER_REWARD,
      refereeReward: REFEREE_REWARD,
    });
  } catch (err: unknown) {
    req.log.error({ err }, "referrals/apply error");
    res.status(500).json({ error: "Failed to apply referral code." });
  }
});

export default router;
