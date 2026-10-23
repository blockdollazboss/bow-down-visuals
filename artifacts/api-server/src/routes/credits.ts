import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { getPaymentHistory, getCreditUsage } from "../lib/payment-record";
import { getSupabaseAdmin, addCreditsAtomic } from "../lib/supabase-admin";
import { logger } from "../lib/logger";

const router = Router();

router.get("/credits/history", requireAuth, async (req, res) => {
  const userId = req.userId!;
  /* Per-ledger settle (earnings.ts pattern, S27-39): purchases and usage
     are independent ledgers, so one failing returns the other's data with
     the failed side's empty shape ([]) and partial: true — never a fake
     history and never a whole-page 500 over a single ledger. Only when
     BOTH ledgers fail does the request keep the old 500. */
  const settle = async <T,>(
    source: string,
    fn: () => Promise<T[]>,
  ): Promise<{ items: T[]; failed: boolean }> => {
    try {
      return { items: await fn(), failed: false };
    } catch (err) {
      req.log.error({ err, source }, "credits/history ledger failed");
      return { items: [], failed: true };
    }
  };

  const purchases = await settle("purchases", () => getPaymentHistory(userId));
  const usage = await settle("usage", () => getCreditUsage(userId));

  if (purchases.failed && usage.failed) {
    res.status(500).json({ error: "Failed to load Visual Buc history." });
    return;
  }

  res.json({
    purchases: purchases.items,
    usage: usage.items,
    /* Additive + backward-compatible: older clients ignore this. */
    partial: purchases.failed || usage.failed,
  });
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
      /* Claim the flag FIRST with a compare-and-swap (only rows still
         unclaimed match), then grant. The old order — grant, then set the
         flag — let two concurrent first-claims both pass the read check
         and double-grant, and a crash between grant and flag update
         double-granted on retry. CAS-first is fail-closed: the only
         failure mode left is a granted-flag-without-credits, which the
         rollback below undoes; if the rollback itself fails the user
         loses a trial (support-fixable) instead of the pool leaking a
         duplicate grant. */
      const { data: claimed, error: claimError } = await supabase
        .from("profiles")
        .update({ trial_credits_claimed: true })
        .eq("id", userId)
        .eq("trial_credits_claimed", false)
        .select("id");
      if (claimError) {
        throw new Error(`Failed to claim trial flag: ${claimError.message}`);
      }
      if (!claimed || claimed.length === 0) {
        // A concurrent claim won the CAS between our read and this update.
        res.json({ granted: false, reason: "already_claimed" });
        return;
      }
      try {
        await addCreditsAtomic(userId, TRIAL_CREDITS);
      } catch (grantErr) {
        // Best-effort rollback so the user can retry the claim.
        await supabase
          .from("profiles")
          .update({ trial_credits_claimed: false })
          .eq("id", userId)
          .then(
            () => {},
            () => {},
          );
        throw grantErr;
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
