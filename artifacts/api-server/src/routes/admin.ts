/**
 * admin.ts — owner-only controls.
 *
 * Guarded by ADMIN_EMAILS (comma-separated, case-insensitive). If unset,
 * every admin route denies access — fail closed.
 *
 *  GET  /api/admin/status          { isAdmin: boolean } (requires auth)
 *  POST /api/admin/credits/grant   { amount, userId?, email? } — grant credits
 *                                  to yourself (default), another user by id,
 *                                  or a friend by email.
 *  POST /api/admin/plan/set        { tier, userId?, email? } — set a user's plan tier.
 *                                  Tier N caps Creator Level at N stars.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { recordCreditUsageStrict } from "../lib/payment-record";

const router = Router();

function adminEmails(): string[] {
  return (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const email = (req.userEmail ?? "").toLowerCase();
  if (!email || !adminEmails().includes(email)) {
    res.status(403).json({ error: "Not authorized." });
    return;
  }
  next();
}

router.get("/admin/status", requireAuth, async (req, res) => {
  const email = (req.userEmail ?? "").toLowerCase();
  res.json({ isAdmin: !!email && adminEmails().includes(email) });
});

const GrantSchema = z.object({
  amount: z.number().int().min(1).max(100000),
  /** Optional target user id — defaults to the admin themself. */
  userId: z.string().uuid().optional(),
  /** Optional target email (friend's email) — resolved to a user id. */
  email: z.string().email().max(320).optional(),
});

router.post("/admin/credits/grant", requireAuth, requireAdmin, async (req, res) => {
  const parsed = GrantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request. Amount must be 1–100000." });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    // Resolve the target: explicit userId wins, then email lookup, then self.
    let targetUserId = parsed.data.userId ?? req.userId!;
    let targetLabel = "yourself";
    if (!parsed.data.userId && parsed.data.email) {
      const { data: match, error: matchErr } = await supabase
        .from("profiles")
        .select("id")
        .ilike("email", parsed.data.email)
        .limit(1)
        .maybeSingle();
      if (matchErr || !match) {
        res.status(404).json({ error: "No user found with that email." });
        return;
      }
      targetUserId = match.id;
      targetLabel = parsed.data.email;
    }
    const { data: profile, error: fetchErr } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", targetUserId)
      .single();
    if (fetchErr || !profile) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    const newBalance = (profile.credits ?? 0) + parsed.data.amount;
    const { error: updateErr } = await supabase
      .from("profiles")
      .update({ credits: newBalance })
      .eq("id", targetUserId);
    if (updateErr) throw updateErr;

    // Strict ledger write: a grant must never land without a ledger trace.
    // On failure, roll the grant back and fail loudly (500).
    try {
      await recordCreditUsageStrict({
        userId: targetUserId,
        action: "Admin Credit Grant",
        creditsUsed: -parsed.data.amount,
      });
    } catch (ledgerErr) {
      req.log.error({ err: ledgerErr, targetUserId }, "admin: ledger write failed after grant — rolling back the grant");
      try {
        await supabase
          .from("profiles")
          .update({ credits: profile.credits ?? 0 })
          .eq("id", targetUserId);
      } catch (rollbackErr) {
        req.log.error({ err: rollbackErr, targetUserId }, "admin: CRITICAL — grant ledger failed AND rollback failed, manual reconciliation required");
      }
      throw ledgerErr;
    }

    req.log.info(
      { admin: req.userEmail, targetUserId, targetLabel, amount: parsed.data.amount, newBalance },
      "admin: credits granted",
    );
    res.json({
      userId: targetUserId,
      granted: parsed.data.amount,
      credits: newBalance,
    });
  } catch (err) {
    req.log.error({ err }, "admin: grant credits failed");
    res.status(500).json({ error: "Could not grant credits. Please try again." });
  }
});

const PLAN_RANKS = ["Street Punk", "Hustler", "Gangster", "Shot Caller", "Crime Boss", "Kingpin"] as const;

const PlanSetSchema = z.object({
  tier: z.number().int().min(1).max(6),
  /** Optional target user id — defaults to the admin themself. */
  userId: z.string().uuid().optional(),
  /** Optional target email — resolved to a user id. */
  email: z.string().email().max(320).optional(),
});

async function resolveTargetUser(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  userId: string | undefined,
  email: string | undefined,
  fallbackUserId: string,
): Promise<{ userId: string } | { error: string }> {
  if (userId) return { userId };
  if (email) {
    const { data: match, error: matchErr } = await supabase
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (matchErr || !match) return { error: "No user found with that email." };
    return { userId: match.id };
  }
  return { userId: fallbackUserId };
}

router.post("/admin/plan/set", requireAuth, requireAdmin, async (req, res) => {
  const parsed = PlanSetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request. Tier must be 1–6." });
    return;
  }
  try {
    const supabase = getSupabaseAdmin();
    const resolved = await resolveTargetUser(supabase, parsed.data.userId, parsed.data.email, req.userId!);
    if ("error" in resolved) {
      res.status(404).json({ error: resolved.error });
      return;
    }
    const { error: updateErr } = await supabase
      .from("profiles")
      .update({ plan_tier: parsed.data.tier })
      .eq("id", resolved.userId);
    if (updateErr) throw updateErr;

    req.log.info(
      { admin: req.userEmail, targetUserId: resolved.userId, tier: parsed.data.tier },
      "admin: plan tier set",
    );
    res.json({
      userId: resolved.userId,
      tier: parsed.data.tier,
      rank: PLAN_RANKS[parsed.data.tier - 1],
    });
  } catch (err) {
    req.log.error({ err }, "admin: set plan tier failed");
    /* Return the specific error to the admin for debugging — this is an admin-only route. */
    const detail = err instanceof Error ? err.message : "Unknown error.";
    res.status(500).json({ error: `Could not set plan tier: ${detail}` });
  }
});

/* ── TEMPORARY: one-shot production schema repair ──────────────────────
   Admin-only. Runs the missing non-destructive schema changes that the
   failed drizzle-kit push skipped. Idempotent — safe to call multiple
   times. REMOVE THIS ENDPOINT after the repair is verified. */
router.post("/admin/schema-repair", requireAuth, requireAdmin, async (req, res) => {
  const { Pool } = await import("pg");
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    res.status(500).json({ ok: false, error: "DATABASE_URL not configured" });
    return;
  }
  const pool = new Pool({ connectionString, max: 2, ssl: { rejectUnauthorized: false } });
  const results: Record<string, string> = {};
  try {
    // 1. artist_vaults.theme_id (fixes Creator Vault 500)
    await pool.query(
      "ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS theme_id TEXT NOT NULL DEFAULT 'gold-royalty';"
    );
    results.theme_id = "applied";

    // 1b. artist_vaults.deleted_at (soft delete — used by save/list/delete)
    await pool.query(
      "ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;"
    );
    results.deleted_at = "applied";

    // 1c. artist_vaults.reference_video_url (video reference — used by save)
    await pool.query(
      "ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS reference_video_url TEXT NULL;"
    );
    results.reference_video_url = "applied";

    // 2. Bow race tables (idempotent)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bow_race_months (
        period TEXT PRIMARY KEY,
        target INTEGER NOT NULL,
        total_bows INTEGER NOT NULL DEFAULT 0,
        winner_user_id UUID NULL,
        winner_email TEXT NULL,
        won_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    results.bow_race_months = "applied";

    await pool.query(`
      ALTER TABLE bow_challenge_config ADD COLUMN IF NOT EXISTS target_override INTEGER NULL;
    `);
    results.target_override = "applied";

    res.json({ ok: true, results });
  } catch (err) {
    req.log.error({ err }, "admin: schema repair failed");
    res.status(500).json({ ok: false, results, error: err instanceof Error ? err.message : "Unknown" });
  } finally {
    await pool.end();
  }
});
export default router;
