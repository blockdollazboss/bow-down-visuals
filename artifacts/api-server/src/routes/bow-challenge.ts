import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { requireAdmin } from "./admin";
import { getSupabaseAdmin } from "../lib/supabase-admin";
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
    const rewardCredits = cfg?.reward_credits ?? 50;
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
    // guarantees exactly-once winner marking.
    let rewarded = false;
    if (race.o_won) {
      const { data: profile, error: fetchErr } = await supabase
        .from("profiles")
        .select("credits")
        .eq("id", userId)
        .single();
      if (fetchErr || !profile) throw fetchErr ?? new Error("profile missing");

      const oldBalance = profile.credits ?? 0;
      const newBalance = oldBalance + rewardCredits;
      const { error: updateErr } = await supabase
        .from("profiles")
        .update({ credits: newBalance })
        .eq("id", userId);
      if (updateErr) throw updateErr;

      // Strict ledger: negative usage = grant. Roll back everything on failure.
      try {
        await recordCreditUsageStrict({
          userId,
          action: "Global Bow Race",
          creditsUsed: -rewardCredits,
        });
      } catch (ledgerErr) {
        req.log.error({ err: ledgerErr, userId }, "bow: ledger failed after grant — rolling back");
        await supabase.from("profiles").update({ credits: oldBalance }).eq("id", userId);
        await supabase.rpc("bow_race_undo_win", { p_period: period, p_user_id: userId });
        throw ledgerErr;
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
  const supabase = getSupabaseAdmin();
  const { data: cfg, error: cfgErr } = await supabase
    .from("bow_challenge_config")
    .select("reward_credits, enabled, target_override, updated_at")
    .eq("id", 1)
    .single();
  if (cfgErr) {
    res.status(500).json({ error: "Could not load race config." });
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
