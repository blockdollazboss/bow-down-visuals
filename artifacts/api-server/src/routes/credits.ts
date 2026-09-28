import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { getPaymentHistory, getCreditUsage } from "../lib/payment-record";
import { getSupabaseAdmin, addCreditsToProfile } from "../lib/supabase-admin";
import { logger } from "../lib/logger";

const router = Router();

router.get("/credits/history", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const [purchases, usage] = await Promise.all([
      getPaymentHistory(userId),
      getCreditUsage(userId),
    ]);
    res.json({ purchases, usage });
  } catch (err: unknown) {
    req.log.error({ err }, "credits/history error");
    res.status(500).json({ error: "Failed to load Visual Buc history." });
  }
});

/* ── One-time trial credits ─────────────────────────────────────────────
   Every account can claim a single grant of free credits so new signups can
   try the tools before buying. Idempotent: the trial_credits_claimed flag on
   profiles makes repeat calls a no-op, and the frontend gates on
   localStorage so it only attempts the call until the first success. */
const TRIAL_CREDITS = 10;
let trialColumnEnsured = false;

async function ensureTrialColumn(): Promise<void> {
  if (trialColumnEnsured) return;
  trialColumnEnsured = true;
  await db.execute(sql.raw(`
    ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS trial_credits_claimed BOOLEAN NOT NULL DEFAULT FALSE;
  `));
}

router.post("/credits/claim-trial", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    await ensureTrialColumn();
    const supabase = getSupabaseAdmin();

    const { data: profile, error: fetchError } = await supabase
      .from("profiles")
      .select("trial_credits_claimed")
      .eq("id", userId)
      .maybeSingle();
    if (fetchError) throw new Error(`Failed to read profile: ${fetchError.message}`);

    if (profile?.trial_credits_claimed) {
      res.json({ granted: false, reason: "already_claimed" });
      return;
    }

    if (!profile) {
      // No profile row yet — create it with the trial credits in one insert.
      const { error: insertError } = await supabase.from("profiles").insert({
        id: userId,
        credits: TRIAL_CREDITS,
        trial_credits_claimed: true,
      });
      if (insertError) {
        // Lost a race with a concurrent claim — treat as already claimed.
        if (insertError.code === "23505") {
          res.json({ granted: false, reason: "already_claimed" });
          return;
        }
        throw new Error(`Failed to create profile: ${insertError.message}`);
      }
    } else {
      await addCreditsToProfile(userId, TRIAL_CREDITS);
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ trial_credits_claimed: true })
        .eq("id", userId);
      if (updateError) {
        throw new Error(`Failed to mark trial claimed: ${updateError.message}`);
      }
    }

    logger.info({ userId, credits: TRIAL_CREDITS }, "trial credits granted");
    res.json({ granted: true, credits: TRIAL_CREDITS });
  } catch (err: unknown) {
    req.log.error({ err }, "credits/claim-trial error");
    res.status(500).json({ error: "Failed to claim trial Visual Bucs." });
  }
});

export default router;
