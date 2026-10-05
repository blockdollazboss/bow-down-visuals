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
import { db, artistVaultsTable } from "@workspace/db";
import { eq, isNull, and, sql } from "drizzle-orm";

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
    res.status(500).json({ error: "Could not grant Visual Bucs. Please try again." });
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
/* ── TEMPORARY one-shot staging schema repair (REMOVE AFTER USE) ──
   Applies the bow-race schema (0038 config table + full 0040 global race
   migration) directly through the runtime database connection.
   The container-startup drizzle-kit push was not applying these, leaving
   the shield's Bow Race section broken
   ("column bow_challenge_config.target_override does not exist").
   Admin-only. Delete this route once the shield loads. */
router.post("/admin/schema-repair", requireAuth, requireAdmin, async (req, res) => {
  const { Pool } = await import("pg");
  const { readFileSync, existsSync } = await import("fs");
  const path = await import("path");
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    res.status(500).json({ ok: false, error: "DATABASE_URL not configured" });
    return;
  }
  const results: Record<string, string> = {};
  const pool = new Pool({ connectionString, max: 2, ssl: { rejectUnauthorized: false } });
  try {
    // 1. Ensure bow_challenge_config exists with every column (0038 table
    //    plus the 0040 target_override column) and the singleton row.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bow_challenge_config (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        target_bows INTEGER NOT NULL DEFAULT 100,
        reward_credits INTEGER NOT NULL DEFAULT 50,
        enabled BOOLEAN NOT NULL DEFAULT true,
        target_override INTEGER NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      INSERT INTO bow_challenge_config (id)
      VALUES (1)
      ON CONFLICT (id) DO NOTHING;
      ALTER TABLE bow_challenge_config ADD COLUMN IF NOT EXISTS target_override INTEGER NULL;
    `);
    results.bow_challenge_config = "applied";

    // 2. Apply the full 0040 global bow race migration from the repo file
    //    (bow_race_months, winner index, reward default 50, bow_race_record
    //    + bow_race_undo_win functions). The file is fully idempotent.
    const candidates = [
      path.join(process.cwd(), "lib/db/migrations/0040_global_bow_race.sql"),
      path.join(process.cwd(), "../lib/db/migrations/0040_global_bow_race.sql"),
    ];
    const sqlPath = candidates.find((p) => existsSync(p));
    if (!sqlPath) {
      res.status(500).json({ ok: false, results, error: "0040 migration file not found on disk" });
      return;
    }
    await pool.query(readFileSync(sqlPath, "utf8"));
    results.migration_0040 = "applied";

    // 2b. Apply 0037 (artist reference video columns) — idempotent.
    //     Production was missing reference_video_path, breaking step 3 below.
    const candidates0037 = [
      path.join(process.cwd(), "lib/db/migrations/0037_artist_reference_video.sql"),
      path.join(process.cwd(), "../lib/db/migrations/0037_artist_reference_video.sql"),
    ];
    const sqlPath0037 = candidates0037.find((p) => existsSync(p));
    if (sqlPath0037) {
      await pool.query(readFileSync(sqlPath0037, "utf8"));
      results.migration_0037 = "applied";
    } else {
      results.migration_0037 = "skipped: file not found";
    }

    // 2b. Create hourly_crate_claims (global one-per-hour crate) — idempotent.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hourly_crate_claims (
        hour_slot TEXT PRIMARY KEY,
        claimed_by UUID NOT NULL,
        claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        prize_credits INTEGER NOT NULL
      );
    `);
    results.hourly_crate_claims = "applied";

    // 2c. Ensure ALL artist_vaults columns exist (explicit, not relying on
    // migration files). Production was missing description, etc.
    await pool.query(`
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS artist_type TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS genre TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS voice_style TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS visual_style TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS hair TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS tattoos TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS jewelry TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS clothing_style TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS brand_colors TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS theme_id TEXT NOT NULL DEFAULT 'gold-royalty';
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS personality TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS do_not_change_rules TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS special_style_rules TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS reference_image_url TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS reference_image_path TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS reference_video_url TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS reference_video_path TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS consistency_prompt TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS voice_id TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS voice_name TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS voice_preview_url TEXT;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
      ALTER TABLE artist_vaults ADD COLUMN IF NOT EXISTS team_id UUID;
    `);
    results.artist_vaults_columns = "ensured";

    // 2d. Apply ALL artist_vaults migrations — idempotent.
    // Production was missing multiple columns (team_id, reference_video, etc.).
    const vaultMigrations = [
      "0001_artist_voice_and_songs.sql",
      "0006_artist_outfits.sql",
      "0035_artist_theme.sql",
      "0036_character_links.sql",
      "0037_artist_reference_video.sql",
      "0043_vault_soft_delete.sql",
      "0047_teams.sql",
    ];
    for (const mig of vaultMigrations) {
      const candidates = [
        path.join(process.cwd(), `lib/db/migrations/${mig}`),
        path.join(process.cwd(), `../lib/db/migrations/${mig}`),
      ];
      const sqlPath = candidates.find((p) => existsSync(p));
      if (sqlPath) {
        try {
          await pool.query(readFileSync(sqlPath, "utf8"));
          results[mig] = "applied";
        } catch (e) {
          results[mig] = `error: ${e instanceof Error ? e.message : "unknown"}`;
        }
      } else {
        results[mig] = "skipped: file not found";
      }
    }

    // 3. TEMPORARY (user approved "ship 360 loop to staging" 2026-09-27):
    //    point the Shark King vault's reference video at the new seamless
    //    loop file shipped in public/videos/. Updates only when exactly one
    //    live "shark king" vault is found (preferring the requesting admin's).
    const LOOP_URL = "/videos/shark-king-360-loop.mp4";
    const matches = await pool.query(
      `SELECT id, user_id, artist_name, reference_video_url
       FROM artist_vaults
       WHERE deleted_at IS NULL AND artist_name ILIKE $1
       ORDER BY updated_at DESC`,
      ["%shark king%"]
    );
    if (matches.rowCount === 0) {
      results.loop_video = "skipped: no live Shark King vault found";
    } else {
      const rows = matches.rows as Array<{
        id: string; user_id: string; artist_name: string; reference_video_url: string | null;
      }>;
      const mine = rows.find((r) => r.user_id === (req as { userId?: string }).userId);
      const target = mine ?? (rows.length === 1 ? rows[0] : null);
      if (!target) {
        results.loop_video = `skipped: ${rows.length} matching vaults, ambiguous`;
      } else if (target.reference_video_url === LOOP_URL) {
        results.loop_video = `already set on "${target.artist_name}"`;
      } else {
        const before = target.reference_video_url ?? "(none)";
        await pool.query(
          `UPDATE artist_vaults
           SET reference_video_url = $1, reference_video_path = NULL, updated_at = now()
           WHERE id = $2`,
          [LOOP_URL, target.id]
        );
        results.loop_video = `updated "${target.artist_name}": ${before} -> ${LOOP_URL}`;
      }
    }

    // 2. Discord bot tables (0032) — missing, causes log spam every 10s
    await pool.query(`
      CREATE TABLE IF NOT EXISTS discord_bot_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE,
        guild_id TEXT,
        announce_channel_id TEXT,
        announce_role_id TEXT,
        mention_everyone BOOLEAN NOT NULL DEFAULT FALSE,
        streamer_discord_user_id TEXT,
        streamer_discord_username TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS discord_bot_config_user_id_idx ON discord_bot_config (user_id);
      CREATE TABLE IF NOT EXISTS discord_live_state (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE,
        is_live BOOLEAN NOT NULL DEFAULT FALSE,
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        channel_id TEXT,
        channel_name TEXT,
        stream_title TEXT,
        announcement_message_id TEXT,
        thread_id TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS discord_live_state_user_id_idx ON discord_live_state (user_id);
    `);
    results.discord_bot_tables = "applied";

    res.json({ ok: true, results });
  } catch (err) {
    req.log.error({ err }, "admin: schema repair failed");
    res.status(500).json({ ok: false, results, error: err instanceof Error ? err.message : "Unknown" });
  } finally {
    await pool.end();
  }
});

/* ── TEMPORARY one-shot production repair (REMOVE AFTER USE) ──
   Fixes the 2026-10-02 deploy where drizzle-kit push failed (TTY prompt),
   leaving tables missing and the 0054 data migration unapplied on Render
   Postgres. Applies: 0011 distribution_releases, 0051 NFC tables, 0052
   jewelry, 0053 spotlight, and the 0054 ×100 data migration. All idempotent.
   Admin-only. Delete this route once verified. */
router.post("/admin/schema-repair-0054", requireAuth, requireAdmin, async (req, res) => {
  const { Pool } = await import("pg");
  const { readFileSync, existsSync } = await import("fs");
  const path = await import("path");
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    res.status(500).json({ ok: false, error: "DATABASE_URL not configured" });
    return;
  }
  const results: Record<string, string> = {};
  const pool = new Pool({ connectionString, max: 2, ssl: { rejectUnauthorized: false } });
  try {
    const candidates = (f: string) => [
      path.join(process.cwd(), `lib/db/migrations/${f}`),
      path.join(process.cwd(), `../lib/db/migrations/${f}`),
    ];
    const runFile = async (file: string, label: string) => {
      const sqlPath = candidates(file).find((p) => existsSync(p));
      if (!sqlPath) {
        results[label] = "skipped: file not found";
        return;
      }
      await pool.query(readFileSync(sqlPath, "utf8"));
      results[label] = "applied";
    };
    await runFile("0011_distribution_releases.sql", "0011_distribution_releases");
    await runFile("0051_nfc_cards.sql", "0051_nfc_cards");
    await runFile("0052_jewelry_orders.sql", "0052_jewelry_orders");
    await runFile("0053_spotlight_inquiries.sql", "0053_spotlight_inquiries");
    await runFile("0054_visual_bucs_hundreds.sql", "0054_visual_bucs_hundreds");
    res.json({ ok: true, results });
  } catch (err) {
    req.log.error({ err }, "admin: schema repair 0054 failed");
    res.status(500).json({ ok: false, results, error: err instanceof Error ? err.message : "Unknown" });
  } finally {
    await pool.end();
  }
});

/**
 * GET /api/admin/export-my-artists
 * Returns the requesting admin's artist vaults as JSON.
 * Used by staging to pull the owner's data from production (auto-sync).
 * Temporary — remove after use.
 */
router.get("/admin/export-my-artists", requireAuth, requireAdmin, async (req, res) => {
  try {
    const vaults = await db
      .select()
      .from(artistVaultsTable)
      .where(and(eq(artistVaultsTable.user_id, req.userId!), isNull(artistVaultsTable.deleted_at)))
      .orderBy(artistVaultsTable.created_at);
    res.json({ ok: true, vaults });
  } catch (err) {
    req.log.error({ err }, "admin: export artists failed");
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown" });
  }
});

/**
 * POST /api/admin/import-artists
 * One-time: import artist vaults from staging to production.
 * Body: { vaults: [...] } — vault objects from staging's GET /api/artist-vaults.
 * Skips vaults that already exist (by id) to avoid duplicates.
 * Temporary — remove after use.
 */
router.post("/admin/import-artists", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { vaults } = req.body as { vaults?: Record<string, unknown>[] };
    if (!Array.isArray(vaults) || vaults.length === 0) {
      res.status(400).json({ ok: false, error: "No vaults provided" });
      return;
    }
    const userId = req.userId!;
    let imported = 0;
    let skipped = 0;

    // Bulletproof: discover which columns actually exist on production's
    // artist_vaults table, and only insert those. Handles schema drift
    // between staging and production without guessing at migrations.
    // Uses Drizzle's own connection (not a separate Pool) to guarantee
    // we're inspecting the same database we're inserting into.
    const { sql } = await import("drizzle-orm");
    let existingCols: Set<string>;
    {
      const colRes = await db.execute(
        sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'artist_vaults' AND table_schema = 'public'`
      );
      const rows = (colRes as any).rows ?? colRes;
      existingCols = new Set((rows as any[]).map((r: any) => r.column_name));
    }

    for (const v of vaults) {
      const vid = String(v["id"] ?? "");
      if (!vid) continue;
      // Skip if already exists
      const [existing] = await db
        .select({ id: artistVaultsTable.id })
        .from(artistVaultsTable)
        .where(eq(artistVaultsTable.id, vid))
        .limit(1);
      if (existing) {
        skipped++;
        continue;
      }
      // Only keep columns that exist on production. Always set id/user_id.
      // Drop timestamps so DB defaults apply.
      const filtered: Record<string, unknown> = { id: vid, user_id: userId };
      for (const [k, val] of Object.entries(v)) {
        if (k === "id" || k === "user_id") continue;
        if (k === "created_at" || k === "updated_at" || k === "deleted_at") continue;
        if (!existingCols.has(k)) continue;
        // Drop empty strings — Postgres can't cast "" to UUID/timestamp/etc.
        // Let the column default (usually NULL) apply instead.
        if (val === "") continue;
        filtered[k] = val;
      }
      // Retry loop: if Postgres reports a missing column (42703), drop it
      // and retry. Handles any schema drift the information_schema check missed.
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          await db.insert(artistVaultsTable).values(filtered as typeof artistVaultsTable.$inferInsert);
          break;
        } catch (insertErr) {
          const code = (insertErr as any)?.cause?.code;
          const msg = (insertErr as any)?.cause?.message || "";
          const m = msg.match(/column "([^"]+)" of relation/);
          if (code === "42703" && m && m[1] && m[1] in filtered) {
            delete filtered[m[1]];
            existingCols.delete(m[1]);
            continue;
          }
          throw insertErr;
        }
      }
      imported++;
    }
    res.json({ ok: true, imported, skipped });
  } catch (err) {
    req.log.error({ err }, "admin: import artists failed");
    // Include the root Postgres error (code/detail) not just Drizzle's wrapper
    const cause = (err as any)?.cause;
    const rootMsg = cause?.message || cause?.detail || "";
    const rootCode = cause?.code ? ` [${cause.code}]` : "";
    const fullError = err instanceof Error ? err.message : "Unknown";
    res.status(500).json({
      ok: false,
      error: fullError,
      rootError: rootMsg ? `${rootMsg}${rootCode}` : undefined,
    });
  }
});

/**
 * POST /api/admin/remove-duplicate-shark
 * Removes the old SINGER-type Shark King duplicate, keeping the CHARACTER
 * type (staging copy). Soft delete only.
 */
router.post("/admin/remove-duplicate-shark", requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = req.userId!;
    // Find all live Shark King vaults for this user
    const vaults = await db
      .select({ id: artistVaultsTable.id, artist_type: artistVaultsTable.artist_type })
      .from(artistVaultsTable)
      .where(
        and(
          eq(artistVaultsTable.user_id, userId),
          isNull(artistVaultsTable.deleted_at),
          sql`artist_name ILIKE 'shark king'`
        )
      );
    // Keep CHARACTER (staging copy), delete SINGER (old production)
    const toDelete = vaults.filter((v) => v.artist_type === "singer" || v.artist_type === "SINGER");
    // If no SINGER found but multiple exist, delete all but the CHARACTER one
    let deleted = 0;
    if (toDelete.length > 0) {
      for (const v of toDelete) {
        await db
          .update(artistVaultsTable)
          .set({ deleted_at: new Date(), updated_at: new Date() })
          .where(eq(artistVaultsTable.id, v.id));
        deleted++;
      }
    } else if (vaults.length > 1) {
      // Fallback: keep the CHARACTER type, delete others
      const keep = vaults.find((v) => (v.artist_type || "").toLowerCase() === "character");
      for (const v of vaults) {
        if (keep && v.id === keep.id) continue;
        await db
          .update(artistVaultsTable)
          .set({ deleted_at: new Date(), updated_at: new Date() })
          .where(eq(artistVaultsTable.id, v.id));
        deleted++;
      }
    }
    res.json({ ok: true, deleted, total: vaults.length });
  } catch (err) {
    req.log.error({ err }, "admin: remove duplicate shark failed");
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Unknown" });
  }
});

export default router;
