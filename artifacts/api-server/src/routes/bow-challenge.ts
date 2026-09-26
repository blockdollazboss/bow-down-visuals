import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { requireAdmin } from "./admin";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { recordCreditUsageStrict } from "../lib/payment-record";

const router = Router();

/* Current period key: YYYY-MM. Counts reset automatically every month —
   no cron needed, because each month is a fresh (user_id, period) row. */
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

/* ── POST /api/bow — record one bow for the signed-in user ─────────────
   Silent by design: the client never shows counts or targets. Returns
   { rewarded, rewardCredits } — when rewarded is true the client pops
   the "You Cracked the Code!" surprise. */
router.post("/bow", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  if (bowRateLimited(userId)) {
    res.status(429).json({ error: "Slow down." });
    return;
  }

  const period = currentPeriod();
  const supabase = getSupabaseAdmin();

  try {
    // Read challenge config (singleton row).
    const { data: cfg } = await supabase
      .from("bow_challenge_config")
      .select("target_bows, reward_credits, enabled")
      .eq("id", 1)
      .single();
    const targetBows = cfg?.target_bows ?? 100;
    const rewardCredits = cfg?.reward_credits ?? 5;
    const enabled = cfg?.enabled ?? true;

    // Increment this month's count (insert-or-bump).
    const { data: existing } = await supabase
      .from("user_bow_counts")
      .select("bow_count, rewarded")
      .eq("user_id", userId)
      .eq("period", period)
      .single();

    let bowCount: number;
    let alreadyRewarded: boolean;
    if (!existing) {
      const { data: inserted, error: insErr } = await supabase
        .from("user_bow_counts")
        .insert({ user_id: userId, period, bow_count: 1, last_bow_at: new Date().toISOString() })
        .select("bow_count, rewarded")
        .single();
      if (insErr) throw insErr;
      bowCount = inserted.bow_count;
      alreadyRewarded = inserted.rewarded;
    } else {
      bowCount = (existing.bow_count ?? 0) + 1;
      alreadyRewarded = existing.rewarded ?? false;
      const { error: updErr } = await supabase
        .from("user_bow_counts")
        .update({ bow_count: bowCount, last_bow_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("period", period);
      if (updErr) throw updErr;
    }

    // Milestone check — exactly-once via conditional update. Only the
    // request whose UPDATE flips rewarded=false→true grants credits.
    let rewarded = false;
    if (enabled && !alreadyRewarded && bowCount >= targetBows) {
      const { data: won } = await supabase
        .from("user_bow_counts")
        .update({ rewarded: true, rewarded_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("period", period)
        .eq("rewarded", false)
        .select("user_id")
        .single();

      if (won) {
        // This request won the race — grant the credits.
        const { data: profile, error: fetchErr } = await supabase
          .from("profiles")
          .select("credits")
          .eq("id", userId)
          .single();
        if (fetchErr || !profile) throw fetchErr ?? new Error("profile missing");

        const newBalance = (profile.credits ?? 0) + rewardCredits;
        const { error: updateErr } = await supabase
          .from("profiles")
          .update({ credits: newBalance })
          .eq("id", userId);
        if (updateErr) throw updateErr;

        // Strict ledger: negative usage = grant. Roll back on failure.
        try {
          await recordCreditUsageStrict({
            userId,
            action: "Secret Bow Challenge",
            creditsUsed: -rewardCredits,
          });
        } catch (ledgerErr) {
          req.log.error({ err: ledgerErr, userId }, "bow: ledger failed after grant — rolling back");
          await supabase.from("profiles").update({ credits: profile.credits ?? 0 }).eq("id", userId);
          await supabase.from("user_bow_counts")
            .update({ rewarded: false, rewarded_at: null })
            .eq("user_id", userId)
            .eq("period", period);
          throw ledgerErr;
        }

        rewarded = true;
        req.log.info({ userId, period, bowCount, rewardCredits }, "bow: secret challenge rewarded");
      }
    }

    res.json({ ok: true, rewarded, rewardCredits: rewarded ? rewardCredits : 0 });
  } catch (err) {
    req.log.error({ err, userId }, "bow: failed");
    res.status(500).json({ error: "Could not record bow." });
  }
});

/* ── Admin: read/write the secret challenge config ───────────────────── */
router.get("/admin/bow-challenge", requireAuth, requireAdmin, async (_req: Request, res: Response) => {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("bow_challenge_config")
    .select("target_bows, reward_credits, enabled, updated_at")
    .eq("id", 1)
    .single();
  if (error) {
    res.status(500).json({ error: "Could not load challenge config." });
    return;
  }
  res.json({
    targetBows: data.target_bows,
    rewardCredits: data.reward_credits,
    enabled: data.enabled,
    updatedAt: data.updated_at,
  });
});

const ConfigSchema = z.object({
  targetBows: z.number().int().min(1).max(100000).optional(),
  rewardCredits: z.number().int().min(1).max(10000).optional(),
  enabled: z.boolean().optional(),
});

router.put("/admin/bow-challenge", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const parsed = ConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid config." });
    return;
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.targetBows !== undefined) patch.target_bows = parsed.data.targetBows;
  if (parsed.data.rewardCredits !== undefined) patch.reward_credits = parsed.data.rewardCredits;
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("bow_challenge_config")
    .update(patch)
    .eq("id", 1)
    .select("target_bows, reward_credits, enabled, updated_at")
    .single();
  if (error) {
    res.status(500).json({ error: "Could not save challenge config." });
    return;
  }
  req.log.info({ admin: req.userEmail, patch }, "admin: bow challenge config updated");
  res.json({
    targetBows: data.target_bows,
    rewardCredits: data.reward_credits,
    enabled: data.enabled,
    updatedAt: data.updated_at,
  });
});

export default router;
