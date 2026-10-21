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
 *  GET  /api/admin/dmca-reports    the moderation bench's takedown queue.
 *  GET  /api/admin/content/:id     one post/comment's moderation state.
 *  PATCH /api/admin/content/:id    { removed, reason?, note? } — the
 *                                  content-removal rail: take a post or
 *                                  thread reply down (reversibly, with
 *                                  the reason recorded) or restore it.
 *  GET  /api/admin/operator-actions  the Cloud Operator's action
 *                                  trail (Phase 2): what the executor
 *                                  ran or refused, newest first.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { recordCreditUsageStrict } from "../lib/payment-record";
import { db, artistVaultsTable, spotlightInquiriesTable, contactMessagesTable, dmcaReportsTable, contentReportsTable, CONTENT_REPORT_STATUSES, postsTable, creatorProfilesTable, POST_REMOVAL_REASONS } from "@workspace/db";
import { eq, isNull, isNotNull, inArray, and, sql, desc } from "drizzle-orm";
import { refreshSupabaseStorageUrlsDeep } from "../lib/objectStorage";
import { listOperatorActions, OPERATOR_DAILY_CHARGED_CAP, operatorHandsEnabled } from "../lib/operator-executor";
import { listPaymentReversals } from "../lib/payment-reversals";

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
    /* Stored video values may be storage refs (mirrored at submit) —
       re-sign fresh on every read. */
    res.json({ inquiries: await refreshSupabaseStorageUrlsDeep(inquiries) });
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

/* ─── Moderation bench: DMCA takedown report queue ────────────────────
   Reports filed through POST /api/dmca/report (routes/creator-platform)
   land in dmca_reports with status "new". Until this bench existed,
   NOTHING read that table — the intake's own operator alert email
   already told admins to "Review it in the admin panel under DMCA
   reports", a panel that was never built. This is that panel's rail:
   the queue (newest first, optional ?status= filter) and the one
   action the stored data supports — moving a report through its
   workflow. Acting on the reported content itself rides the
   content-removal rail further down this file (posts + thread
   replies, reversible, files never touched). */

const DMCA_REPORT_STATUSES = ["new", "reviewing", "actioned", "dismissed"] as const;

const DmcaStatusQuerySchema = z.object({
  status: z.enum(DMCA_REPORT_STATUSES).optional(),
});

const dmcaReportDto = {
  id: dmcaReportsTable.id,
  reporterName: dmcaReportsTable.reporterName,
  reporterEmail: dmcaReportsTable.reporterEmail,
  reporterOrg: dmcaReportsTable.reporterOrg,
  infringingUrls: dmcaReportsTable.infringingUrls,
  originalUrls: dmcaReportsTable.originalUrls,
  description: dmcaReportsTable.description,
  status: dmcaReportsTable.status,
  createdAt: dmcaReportsTable.createdAt,
};

/**
 * GET /api/admin/dmca-reports?status=
 * The takedown queue — newest first. ?status= narrows to one
 * workflow state; an unknown state is a 400, never a silent
 * empty queue.
 */
router.get("/admin/dmca-reports", requireAuth, requireAdmin, async (req, res) => {
  const parsed = DmcaStatusQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: `Invalid status filter. Must be one of: ${DMCA_REPORT_STATUSES.join(", ")}.` });
    return;
  }
  try {
    const base = db.select(dmcaReportDto).from(dmcaReportsTable);
    const reports = parsed.data.status
      ? await base.where(eq(dmcaReportsTable.status, parsed.data.status)).orderBy(desc(dmcaReportsTable.createdAt)).limit(200)
      : await base.orderBy(desc(dmcaReportsTable.createdAt)).limit(200);
    res.json({ reports });
  } catch (err) {
    req.log.error({ err }, "admin: list dmca reports failed");
    res.status(500).json({ error: "Could not load DMCA reports." });
  }
});

const DmcaStatusSchema = z.object({
  status: z.enum(DMCA_REPORT_STATUSES),
});

/**
 * PATCH /api/admin/dmca-reports/:id
 * Move a report through its workflow:
 * new → reviewing → actioned / dismissed.
 */
router.patch("/admin/dmca-reports/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = DmcaStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: `Invalid status. Must be one of: ${DMCA_REPORT_STATUSES.join(", ")}.` });
    return;
  }
  const parsedParams = IdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid report id." });
    return;
  }
  try {
    const [report] = await db
      .update(dmcaReportsTable)
      .set({ status: parsed.data.status })
      .where(eq(dmcaReportsTable.id, parsedParams.data.id))
      .returning(dmcaReportDto);
    if (!report) {
      res.status(404).json({ error: "Report not found." });
      return;
    }
    req.log.info(
      { admin: req.userEmail, reportId: report.id, status: report.status },
      "admin: dmca report status updated",
    );
    res.json({ report });
  } catch (err) {
    req.log.error({ err }, "admin: update dmca report failed");
    res.status(500).json({ error: "Could not update the report." });
  }
});

/* ─── Moderation bench: member content report queue ───────────────────
   Reports filed through POST /api/reports (routes/reports.ts) land in
   content_reports with status "new". This is the queue that reads
   them back — the member-reported sibling of the DMCA bench above,
   same gate, same workflow vocabulary, same discipline. Working a
   report = moving it through its workflow. Acting on the reported
   content itself (removing a post or media) has no admin rail
   anywhere in the codebase — post/media deletion is author-only —
   so the bench deliberately has no "remove" button to fake. */

const ContentReportStatusQuerySchema = z.object({
  status: z.enum(CONTENT_REPORT_STATUSES).optional(),
});

const contentReportDto = {
  id: contentReportsTable.id,
  reporterUserId: contentReportsTable.reporterUserId,
  targetType: contentReportsTable.targetType,
  targetId: contentReportsTable.targetId,
  targetOwnerUserId: contentReportsTable.targetOwnerUserId,
  targetSummary: contentReportsTable.targetSummary,
  reason: contentReportsTable.reason,
  note: contentReportsTable.note,
  status: contentReportsTable.status,
  createdAt: contentReportsTable.createdAt,
};

/**
 * GET /api/admin/reports?status=
 * The member-report queue — newest first. ?status= narrows to one
 * workflow state; an unknown state is a 400, never a silent
 * empty queue.
 */
router.get("/admin/reports", requireAuth, requireAdmin, async (req, res) => {
  const parsed = ContentReportStatusQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: `Invalid status filter. Must be one of: ${CONTENT_REPORT_STATUSES.join(", ")}.` });
    return;
  }
  try {
    const base = db.select(contentReportDto).from(contentReportsTable);
    const reports = parsed.data.status
      ? await base.where(eq(contentReportsTable.status, parsed.data.status)).orderBy(desc(contentReportsTable.createdAt)).limit(200)
      : await base.orderBy(desc(contentReportsTable.createdAt)).limit(200);
    res.json({ reports });
  } catch (err) {
    req.log.error({ err }, "admin: list content reports failed");
    res.status(500).json({ error: "Could not load content reports." });
  }
});

const ContentReportStatusSchema = z.object({
  status: z.enum(CONTENT_REPORT_STATUSES),
});

/**
 * PATCH /api/admin/reports/:id
 * Move a report through its workflow:
 * new → reviewing → actioned / dismissed.
 */
router.patch("/admin/reports/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsed = ContentReportStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: `Invalid status. Must be one of: ${CONTENT_REPORT_STATUSES.join(", ")}.` });
    return;
  }
  const parsedParams = IdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid report id." });
    return;
  }
  try {
    const [report] = await db
      .update(contentReportsTable)
      .set({ status: parsed.data.status })
      .where(eq(contentReportsTable.id, parsedParams.data.id))
      .returning(contentReportDto);
    if (!report) {
      res.status(404).json({ error: "Report not found." });
      return;
    }
    req.log.info(
      { admin: req.userEmail, reportId: report.id, status: report.status },
      "admin: content report status updated",
    );
    res.json({ report });
  } catch (err) {
    req.log.error({ err }, "admin: update content report failed");
    res.status(500).json({ error: "Could not update the report." });
  }
});

/* ─── Moderation bench: content removal rail ──────────────────────────
   The takedown hand for posts and comments (thread replies — both
   are rows of the posts table, told apart by kind). Until this rail
   existed, post/comment deletion was author-only: an admin who
   needed a post gone could only ban its author.

   Removal is a STATE, never a delete (migration 0175): the row, its
   body and its media references stay put and the removal records
   who acted (the admin's allowlist email), when, the reason
   CATEGORY (POST_REMOVAL_REASONS — the part the author is shown)
   and an optional note that never leaves this DTO. Restoring
   clears the state. Every public read path honors the state at the
   read layer (routes/social.ts): a removed item is served only to
   its own author, with its moderation state attached.

   The "comment" label below is the posts table's thread_reply kind
   — the replies members leave on posts, which share the posts
   author-delete rail this mirrors. */

type ContentRow = typeof postsTable.$inferSelect;

function toContentRemovalDto(row: ContentRow, author: typeof creatorProfilesTable.$inferSelect | null) {
  return {
    id: row.id,
    /* "post" for a top-level item, "comment" for a thread reply. */
    kind: row.kind === "thread_reply" ? "comment" : "post",
    postKind: row.kind,
    body: row.body,
    mediaUrls: row.mediaUrls ?? [],
    author: author
      ? { profileId: author.id, userId: author.userId, slug: author.slug, displayName: author.displayName }
      : null,
    replyTo: row.replyTo,
    createdAt: row.createdAt,
    removed: !!row.removedAt,
    removedAt: row.removedAt,
    removedByEmail: row.removedByEmail,
    removalReason: row.removalReason,
    removalNote: row.removalNote,
  };
}

async function loadContentWithAuthor(id: string) {
  const [row] = await db.select().from(postsTable).where(eq(postsTable.id, id)).limit(1);
  if (!row) return null;
  const [author] = await db.select().from(creatorProfilesTable).where(eq(creatorProfilesTable.id, row.profileId)).limit(1);
  return toContentRemovalDto(row, author ?? null);
}

/**
 * GET /api/admin/content/removed
 * The removal record — everything currently removed, newest
 * removal first, so a restore is one lookup away.
 */
router.get("/admin/content/removed", requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await db.select().from(postsTable)
      .where(isNotNull(postsTable.removedAt))
      .orderBy(desc(postsTable.removedAt))
      .limit(200);
    const authorIds = [...new Set(rows.map((r) => r.profileId))];
    const authors = authorIds.length
      ? await db.select().from(creatorProfilesTable).where(inArray(creatorProfilesTable.id, authorIds))
      : [];
    const byId = new Map(authors.map((a) => [a.id, a]));
    res.json({ content: rows.map((r) => toContentRemovalDto(r, byId.get(r.profileId) ?? null)) });
  } catch (err) {
    req.log.error({ err }, "admin: list removed content failed");
    res.status(500).json({ error: "Could not load removed content." });
  }
});

/**
 * GET /api/admin/content/:id
 * Current state of one post or comment, with the full context an
 * admin needs before acting: body, author, and — if it is already
 * removed — the standing removal record.
 */
router.get("/admin/content/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsedParams = IdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid content id." });
    return;
  }
  try {
    const content = await loadContentWithAuthor(parsedParams.data.id);
    if (!content) {
      res.status(404).json({ error: "Content not found." });
      return;
    }
    res.json({ content });
  } catch (err) {
    req.log.error({ err }, "admin: load content state failed");
    res.status(500).json({ error: "Could not load that content." });
  }
});

const ContentRemovalPatchSchema = z.object({
  removed: z.boolean(),
  /* Required when removing (enforced below, where the 400 can say
     why); refused vocabulary fails the enum here. */
  reason: z.enum(POST_REMOVAL_REASONS).optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * PATCH /api/admin/content/:id
 * { removed: true, reason, note? } takes an item down;
 * { removed: false } restores it. Illegal transitions are 409s —
 * removing what's already removed, restoring what's live — never
 * silent no-ops that pretend the state changed.
 */
router.patch("/admin/content/:id", requireAuth, requireAdmin, async (req, res) => {
  const parsedParams = IdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: "Invalid content id." });
    return;
  }
  const parsed = ContentRemovalPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: `Invalid request. When removing, reason must be one of: ${POST_REMOVAL_REASONS.join(", ")}.` });
    return;
  }
  if (parsed.data.removed && !parsed.data.reason) {
    res.status(400).json({ error: "A reason category is required to remove content — the author is shown it." });
    return;
  }
  try {
    const [row] = await db.select().from(postsTable).where(eq(postsTable.id, parsedParams.data.id)).limit(1);
    if (!row) {
      res.status(404).json({ error: "Content not found." });
      return;
    }
    const isRemoved = !!row.removedAt;
    if (parsed.data.removed && isRemoved) {
      res.status(409).json({ error: "That content is already removed." });
      return;
    }
    if (!parsed.data.removed && !isRemoved) {
      res.status(409).json({ error: "That content is live — there is no removal to restore." });
      return;
    }
    const [updated] = await db
      .update(postsTable)
      .set(parsed.data.removed
        ? {
            removedAt: new Date(),
            removedByEmail: req.userEmail ?? null,
            removalReason: parsed.data.reason!,
            removalNote: parsed.data.note ?? null,
          }
        : { removedAt: null, removedByEmail: null, removalReason: null, removalNote: null })
      .where(eq(postsTable.id, parsedParams.data.id))
      .returning();
    const [author] = await db.select().from(creatorProfilesTable).where(eq(creatorProfilesTable.id, row.profileId)).limit(1);
    req.log.info(
      {
        admin: req.userEmail,
        contentId: parsedParams.data.id,
        kind: row.kind,
        action: parsed.data.removed ? "removed" : "restored",
        reason: parsed.data.removed ? parsed.data.reason : undefined,
      },
      "admin: content removal state changed",
    );
    res.json({ content: toContentRemovalDto(updated, author ?? null) });
  } catch (err) {
    req.log.error({ err }, "admin: update content removal failed");
    res.status(500).json({ error: "Could not update that content." });
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

/**
 * GET /api/admin/operator-actions?limit=
 * The Cloud Operator's action trail (Phase 2): every action the
 * executor ran or refused, newest first — who it ran as, the tool,
 * the channel, the quoted/charged price, and the outcome with its
 * reason. Read-only: the rows are written by the executor from rail
 * results; this bench never edits them. The member's own scoped
 * readback is GET /api/operator/actions.
 */
router.get("/admin/operator-actions", requireAuth, requireAdmin, async (req, res) => {
  try {
    const limitRaw = Number(req.query["limit"]);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 50;
    const actions = await listOperatorActions(limit);
    res.json({
      /* The daily charged cap rides along so the bench shows the
         runaway guard's setting beside the trail it guards. */
      dailyChargedCap: OPERATOR_DAILY_CHARGED_CAP,
      handsEnabled: operatorHandsEnabled(),
      actions: actions.map((r) => ({
        id: r.id,
        userId: r.userId,
        adminEmail: r.adminEmail,
        tier: r.tier,
        toolId: r.toolId,
        summary: r.summary,
        target: r.target,
        channel: r.channel,
        priceQuoted: r.priceQuoted,
        priceCharged: r.priceCharged,
        idempotencyKey: r.idempotencyKey,
        result: r.result,
        resultReason: r.resultReason,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "admin: list operator actions failed");
    res.status(500).json({ error: "Could not load operator actions." });
  }
});

/**
 * GET /api/admin/payment-reversals?limit=
 * The refund / chargeback clawback trail (0182, defect D1): one row
 * per reversed charge — the rail, what was granted, what was clawed
 * back, any shortfall the balance couldn't cover, and the rows parked
 * at 'needs_manual_review' (identified charges a human must reverse,
 * and charges no grant record identifies). Read-only: the rows are
 * written by the webhook's reversal engine from rail results.
 */
router.get("/admin/payment-reversals", requireAuth, requireAdmin, async (req, res) => {
  try {
    const limitRaw = Number(req.query["limit"]);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 50;
    const reversals = await listPaymentReversals(limit);
    res.json({
      reversals: reversals.map((r) => ({
        id: r["id"],
        stripeEventId: r["stripe_event_id"],
        stripeChargeId: r["stripe_charge_id"],
        stripePaymentIntentId: r["stripe_payment_intent_id"],
        trigger: r["trigger"],
        rail: r["rail"],
        userId: r["user_id"],
        sessionId: r["session_id"],
        grantedCredits: r["granted_credits"],
        creditsClawed: r["credits_clawed"],
        referralCreditsClawed: r["referral_credits_clawed"],
        refundedCentsSeen: r["refunded_cents_seen"],
        chargeAmountCents: r["charge_amount_cents"],
        disputeLost: r["dispute_lost"],
        entitlementRevoked: r["entitlement_revoked"],
        sellerReversed: r["seller_reversed"],
        shortfallCredits: r["shortfall_credits"],
        status: r["status"],
        details: r["details"],
        createdAt: r["created_at"],
        updatedAt: r["updated_at"],
      })),
    });
  } catch (err) {
    req.log.error({ err }, "admin: list payment reversals failed");
    res.status(500).json({ error: "Could not load payment reversals." });
  }
});

export default router;
