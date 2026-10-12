import { Router } from "express";
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
   localStorage so it only attempts the call until the first success.
   NOTE: trial_credits_claimed must exist in the SUPABASE profiles table
   (supabase/migrations/0055_trial_credits.sql — run once in the Supabase
   SQL Editor). There is deliberately NO runtime DDL here: the api-server's
   drizzle `db` points at DATABASE_URL (Render Postgres), a different
   database from Supabase, so any ALTER executed here could never create
   the column where it is actually read. A previous ensureTrialColumn()
   did exactly that — DDL against the wrong database — and was removed. */
const TRIAL_CREDITS = 1000;

/** PostgREST code for "column does not exist" — the 0055 migration was never run. */
const PG_UNDEFINED_COLUMN = "42703";

function isMissingTrialColumn(err: { code?: string; message?: string } | null): boolean {
  return (
    err?.code === PG_UNDEFINED_COLUMN &&
    /trial_credits_claimed/.test(err.message ?? "")
  );
}

router.post("/credits/claim-trial", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const supabase = getSupabaseAdmin();

    const { data: profile, error: fetchError } = await supabase
      .from("profiles")
      .select("trial_credits_claimed")
      .eq("id", userId)
      .maybeSingle();
    if (fetchError) {
      if (isMissingTrialColumn(fetchError)) {
        // Schema drift: the 0055 migration was never run in Supabase.
        // Fail safe (no grant — the flag can't be recorded, so granting
        // would allow unlimited re-claims) and say exactly what's wrong.
        req.log.error(
          { userId },
          "credits/claim-trial: profiles.trial_credits_claimed is missing in Supabase — run supabase/migrations/0055_trial_credits.sql in the Supabase SQL Editor",
        );
        res.status(503).json({
          granted: false,
          reason: "trial_unavailable",
          error: "Trial credits are temporarily unavailable. Please try again later.",
        });
        return;
      }
      throw new Error(`Failed to read profile: ${fetchError.message}`);
    }

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
