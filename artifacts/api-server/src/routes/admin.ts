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
import { db, artistVaultsTable, spotlightInquiriesTable, contactMessagesTable } from "@workspace/db";
import { eq, isNull, and, sql, desc } from "drizzle-orm";

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

/**
 * GET /api/admin/spotlight-inquiries
 * Owner inbox for Spotlight Takeover leads — newest first.
 */
router.get("/admin/spotlight-inquiries", requireAuth, requireAdmin, async (req, res) => {
  try {
    const inquiries = await db
      .select({
        id: spotlightInquiriesTable.id,
        name: spotlightInquiriesTable.name,
        email: spotlightInquiriesTable.email,
        videoUrl: spotlightInquiriesTable.videoUrl,
        targetUrl: spotlightInquiriesTable.targetUrl,
        status: spotlightInquiriesTable.status,
        createdAt: spotlightInquiriesTable.createdAt,
      })
      .from(spotlightInquiriesTable)
      .orderBy(desc(spotlightInquiriesTable.createdAt));
    res.json({ inquiries });
  } catch (err) {
    req.log.error({ err }, "admin: list spotlight inquiries failed");
    res.status(500).json({ error: "Could not load Spotlight inquiries." });
  }
});

const SpotlightStatusSchema = z.object({
  status: z.enum(["new", "contacted", "approved", "rejected"]),
});

const IdParamSchema = z.object({
  id: z.string().uuid(),
});

/**
 * PATCH /api/admin/spotlight-inquiries/:id
 * Move a lead through the pipeline: new → contacted → approved / rejected.
 */
router.patch("/admin/spotlight-inquiries/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = SpotlightStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid status. Must be one of: new, contacted, approved, rejected." });
    return;
  }
  const parsedParams = IdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid inquiry id." });
    return;
  }
  try {
    const [inquiry] = await db
      .update(spotlightInquiriesTable)
      .set({ status: parsed.data.status })
      .where(eq(spotlightInquiriesTable.id, parsedParams.data.id))
      .returning({
        id: spotlightInquiriesTable.id,
        name: spotlightInquiriesTable.name,
        email: spotlightInquiriesTable.email,
        videoUrl: spotlightInquiriesTable.videoUrl,
        targetUrl: spotlightInquiriesTable.targetUrl,
        status: spotlightInquiriesTable.status,
        createdAt: spotlightInquiriesTable.createdAt,
      });
    if (!inquiry) {
      res.status(404).json({ error: "Inquiry not found." });
      return;
    }
    req.log.info(
      { admin: req.userEmail, inquiryId: inquiry.id, status: inquiry.status },
      "admin: spotlight inquiry status updated",
    );
    res.json({ inquiry });
  } catch (err) {
    req.log.error({ err }, "admin: update spotlight inquiry failed");
    res.status(500).json({ error: "Could not update the inquiry." });
  }
});

/**
 * GET /api/admin/contact-messages
 * Owner inbox for contact-form messages — newest first.
 */
router.get("/admin/contact-messages", requireAuth, requireAdmin, async (req, res) => {
  try {
    const messages = await db
      .select({
        id: contactMessagesTable.id,
        name: contactMessagesTable.name,
        email: contactMessagesTable.email,
        message: contactMessagesTable.message,
        read: contactMessagesTable.read,
        createdAt: contactMessagesTable.createdAt,
      })
      .from(contactMessagesTable)
      .orderBy(desc(contactMessagesTable.createdAt));
    res.json({ messages });
  } catch (err) {
    req.log.error({ err }, "admin: list contact messages failed");
    res.status(500).json({ error: "Could not load contact messages." });
  }
});

const ContactReadSchema = z.object({
  read: z.boolean(),
});

/**
 * PATCH /api/admin/contact-messages/:id
 * Mark a contact message read/unread.
 */
router.patch("/admin/contact-messages/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = ContactReadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request. Body must be { read: boolean }." });
    return;
  }
  const parsedParams = IdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid message id." });
    return;
  }
  try {
    const [message] = await db
      .update(contactMessagesTable)
      .set({ read: parsed.data.read })
      .where(eq(contactMessagesTable.id, parsedParams.data.id))
      .returning({
        id: contactMessagesTable.id,
        name: contactMessagesTable.name,
        email: contactMessagesTable.email,
        message: contactMessagesTable.message,
        read: contactMessagesTable.read,
        createdAt: contactMessagesTable.createdAt,
      });
    if (!message) {
      res.status(404).json({ error: "Message not found." });
      return;
    }
    res.json({ message });
  } catch (err) {
    req.log.error({ err }, "admin: update contact message failed");
    res.status(500).json({ error: "Could not update the message." });
  }
});

/**
 * GET /api/admin/users/lookup?email=
 * Look up a user by email — auth record + profile row. Returns { user: null }
 * when nobody matches.
 */
router.get("/admin/users/lookup", requireAuth, requireAdmin, async (req, res) => {
  const email = String(req.query["email"] ?? "").trim();
  if (!email) {
    res.status(400).json({ error: "Missing ?email= query parameter." });
    return;
  }
  try {
    const supabase = getSupabaseAdmin();
    // Resolve via profiles (case-insensitive), like the credit-grant route.
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("id, email, display_name, credits, plan, created_at")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (profileErr) throw profileErr;
    if (!profile) {
      res.json({ user: null });
      return;
    }
    // Auth record for ban state + authoritative email/created_at.
    const { data: authData, error: authErr } = await supabase.auth.admin.getUserById(profile.id);
    if (authErr) throw authErr;
    const authUser = authData.user;
    const bannedUntil = authUser?.banned_until ? new Date(authUser.banned_until).getTime() : NaN;
    const banned = Number.isFinite(bannedUntil) && bannedUntil > Date.now();
    res.json({
      user: {
        id: profile.id,
        email: authUser?.email ?? profile.email,
        displayName: (profile.display_name as string | null) ?? null,
        credits: (profile.credits as number | null) ?? 0,
        plan: (profile.plan as string | null) ?? "free",
        banned,
        createdAt: authUser?.created_at ?? profile.created_at ?? null,
      },
    });
  } catch (err) {
    req.log.error({ err }, "admin: user lookup failed");
    res.status(500).json({ error: "Could not look up the user." });
  }
});

const UserIdParamSchema = z.object({
  id: z.string().uuid(),
});

/** Refuse to ban/unban the requesting admin or any admin account. */
async function banTargetForbidden(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  targetUserId: string,
  requesterUserId: string,
): Promise<string | null> {
  if (targetUserId === requesterUserId) return "You cannot change your own ban state.";
  const { data: authData, error } = await supabase.auth.admin.getUserById(targetUserId);
  if (error || !authData.user) return "User not found.";
  const targetEmail = (authData.user.email ?? "").toLowerCase();
  if (targetEmail && adminEmails().includes(targetEmail)) {
    return "Admin accounts cannot be banned or unbanned here.";
  }
  return null;
}

/**
 * POST /api/admin/users/:id/ban — ban for ~100 years (effectively permanent).
 */
router.post("/admin/users/:id/ban", requireAuth, requireAdmin, async (req, res) => {
  const parsed = UserIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid user id." });
    return;
  }
  try {
    const supabase = getSupabaseAdmin();
    const forbidden = await banTargetForbidden(supabase, parsed.data.id, req.userId!);
    if (forbidden) {
      const status = forbidden === "User not found." ? 404 : 403;
      res.status(status).json({ error: forbidden });
      return;
    }
    const { error } = await supabase.auth.admin.updateUserById(parsed.data.id, {
      ban_duration: "876000h",
    });
    if (error) throw error;
    req.log.info({ admin: req.userEmail, targetUserId: parsed.data.id }, "admin: user banned");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "admin: ban user failed");
    res.status(500).json({ error: "Could not ban the user." });
  }
});

/**
 * POST /api/admin/users/:id/unban — lift a ban.
 */
router.post("/admin/users/:id/unban", requireAuth, requireAdmin, async (req, res) => {
  const parsed = UserIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid user id." });
    return;
  }
  try {
    const supabase = getSupabaseAdmin();
    const forbidden = await banTargetForbidden(supabase, parsed.data.id, req.userId!);
    if (forbidden) {
      const status = forbidden === "User not found." ? 404 : 403;
      res.status(status).json({ error: forbidden });
      return;
    }
    const { error } = await supabase.auth.admin.updateUserById(parsed.data.id, {
      ban_duration: "none",
    });
    if (error) throw error;
    req.log.info({ admin: req.userEmail, targetUserId: parsed.data.id }, "admin: user unbanned");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "admin: unban user failed");
    res.status(500).json({ error: "Could not unban the user." });
  }
});

export default router;
