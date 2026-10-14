import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { requireAdmin } from "./admin";
import { getSupabaseAdmin, addCreditsAtomic } from "../lib/supabase-admin";
import { recordCreditUsageStrict } from "../lib/payment-record";

const router = Router();

/* Current period key: YYYY-MM. A new month automatically starts a new
   race (the month row is created on the first bow) — no cron needed. */
function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/* ── Anti-farming rate limit: in-memory per-user token bucket ──────────
   A bow animation takes ~2.65s, so a human can't bow faster than ~1/3s.
   Allow 1 bow per 2s sustained, burst of 5. Anything faster is a script. */
const buckets = new Map<string, { tokens: number; last: number }>();
const MAX_TOKENS = 5;
const REFILL_PER_MS = 1 / 2000; // 1 token per 2s

function bowRateLimited(userId: string): boolean {
  const now = Date.now();
  const b = buckets.get(userId) ?? { tokens: MAX_TOKENS, last: now };
  b.tokens = Math.min(MAX_TOKENS, b.tokens + (now - b.last) * REFILL_PER_MS);
  b.last = now;
  if (b.tokens < 1) {
    buckets.set(userId, b);
    return true;
  }
  b.tokens -= 1;
  buckets.set(userId, b);
  return false;
}

interface RaceRecordResult {
  o_total: number;
  o_target: number;
  o_won: boolean;
  o_race_over: boolean;
}

/* ── POST /api/bow — record one bow for the signed-in user ─────────────
   Global Bow Race: every signed-in user's bow feeds ONE site-wide monthly
   counter. Silent by design: the client never shows counts or targets.
   Returns { rewarded, rewardCredits } — when rewarded is true the client
   pops the "You Cracked the Code!" surprise, ONLY for the winner. */
router.post("/bow", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  if (bowRateLimited(userId)) {
    res.status(429).json({ error: "Slow down." });
    return;
  }

  const period = currentPeriod();
  const supabase = getSupabaseAdmin();

  try {
    // Read race config (singleton row).
    const { data: cfg } = await supabase
      .from("bow_challenge_config")
      .select("reward_credits, enabled, target_override")
      .eq("id", 1)
      .single();
    const rewardCredits = cfg?.reward_credits ?? 5000;
    const enabled = cfg?.enabled ?? true;

    if (!enabled) {
      res.json({ ok: true, rewarded: false, rewardCredits: 0 });
      return;
    }

    // Atomic increment + winner detection. The Postgres function holds a
    // row lock on the month, so concurrent bows serialize: exactly one
    // request can move the counter onto the target and be marked winner.
    const { data: raceData, error: raceErr } = await supabase.rpc(
      "bow_race_record",
      {
        p_user_id: userId,
        p_period: period,
        p_override_target: cfg?.target_override ?? null,
      },
    );
    if (raceErr) throw raceErr;
    const race = (Array.isArray(raceData) ? raceData[0] : raceData) as
      | RaceRecordResult
      | undefined;
    if (!race) throw new Error("bow_race_record returned no row");

    // Winner: grant the credits. Only this request won — the function
    // guarantees exactly-once winner marking. The grant itself is atomic
    // (increment_credits RPC — no read-modify-write window), and ANY
    // failure in the grant stage un-marks the win via bow_race_undo_win
    // so the race reopens instead of sitting won-but-unpaid: previously
    // only a ledger failure rolled back, while a profile read/write
    // failure left the prize permanently unpayable with no retry path.
    let rewarded = false;
    if (race.o_won) {
      let granted = false;
      try {
        await addCreditsAtomic(userId, rewardCredits);
        granted = true;

        // Strict ledger: negative usage = grant.
        await recordCreditUsageStrict({
          userId,
          action: "Global Bow Race",
          creditsUsed: -rewardCredits,
        });
      } catch (grantErr) {
        req.log.error({ err: grantErr, userId }, "bow: prize grant failed — compensating and reopening the race");
        if (granted) {
          // Reverse the delta (not a set-to-old-balance) so any
          // concurrent legitimate balance change is preserved.
          try {
            await addCreditsAtomic(userId, -rewardCredits);
          } catch (revertErr) {
            req.log.error({ err: revertErr, userId }, "bow: CRITICAL — prize compensation failed; manual reconciliation required");
          }
        }
        try {
          await supabase.rpc("bow_race_undo_win", { p_period: period, p_user_id: userId });
        } catch (undoErr) {
          req.log.error({ err: undoErr, userId, period }, "bow: CRITICAL — undo_win failed; race may be stuck won-but-unpaid");
        }
        throw grantErr;
      }

      // Stamp the winner's identity for the admin alert banner (best effort).
      if (req.userEmail) {
        await supabase
          .from("bow_race_months")
          .update({ winner_email: req.userEmail })
          .eq("period", period)
          .eq("winner_user_id", userId);
      }

      rewarded = true;
      req.log.info(
        { userId, period, totalBows: race.o_total, target: race.o_target, rewardCredits },
        "bow: global race won",
      );
    }

    res.json({ ok: true, rewarded, rewardCredits: rewarded ? rewardCredits : 0 });
  } catch (err) {
    req.log.error({ err, userId }, "bow: failed");
    res.status(500).json({ error: "Could not record bow." });
  }
});

/* ── Admin: read the global race status + config ───────────────────────
   Admin-only. NEVER exposed publicly: the counter, target, and winner
   stay secret everywhere else. */
router.get("/admin/bow-challenge", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabaseAdmin();
    const { data: cfg, error: cfgErr } = await supabase
      .from("bow_challenge_config")
      .select("reward_credits, enabled, target_override, updated_at")
      .eq("id", 1)
      .single();
    if (cfgErr) {
      console.error("[bow-challenge] config load failed:", cfgErr.message);
      res.status(500).json({ error: `Could not load race config: ${cfgErr.message}` });
      return;
    }

  const period = currentPeriod();
  const { data: race } = await supabase
    .from("bow_race_months")
    .select("period, target, total_bows, winner_user_id, winner_email, won_at")
    .eq("period", period)
    .single();

  const { data: history } = await supabase
    .from("bow_race_months")
    .select("period, target, total_bows, winner_email, won_at")
    .not("winner_user_id", "is", null)
    .order("period", { ascending: false })
    .limit(12);

  res.json({
    rewardCredits: cfg.reward_credits,
    enabled: cfg.enabled,
    targetOverride: cfg.target_override,
    updatedAt: cfg.updated_at,
    race: race
      ? {
          period: race.period,
          target: race.target,
          totalBows: race.total_bows,
          winnerUserId: race.winner_user_id,
          winnerEmail: race.winner_email,
          wonAt: race.won_at,
          raceOver: race.winner_user_id !== null,
        }
      : null,
    history: (history ?? []).map((h) => ({
      period: h.period,
      target: h.target,
      totalBows: h.total_bows,
      winnerEmail: h.winner_email,
      wonAt: h.won_at,
    })),
    });
  } catch (e) {
    console.error("[bow-challenge] GET failed:", e instanceof Error ? e.message : e);
    res.status(500).json({ error: `Race load failed: ${e instanceof Error ? e.message : "unknown"}` });
  }
});

const ConfigSchema = z.object({
  rewardCredits: z.number().int().min(1).max(10000).optional(),
  enabled: z.boolean().optional(),
  /* One-shot override for the next race month (1000-5000). null clears it. */
  targetOverride: z.number().int().min(1000).max(5000).nullable().optional(),
});

router.put("/admin/bow-challenge", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const parsed = ConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid config." });
    return;
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.rewardCredits !== undefined) patch.reward_credits = parsed.data.rewardCredits;
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;
  if (parsed.data.targetOverride !== undefined) patch.target_override = parsed.data.targetOverride;

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("bow_challenge_config")
    .update(patch)
    .eq("id", 1);
  if (error) {
    res.status(500).json({ error: "Could not save race config." });
    return;
  }
  req.log.info({ admin: req.userEmail, patch }, "admin: bow race config updated");
  res.json({ ok: true });
});

export default router;
