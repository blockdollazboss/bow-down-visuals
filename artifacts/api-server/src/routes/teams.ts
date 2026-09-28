import { Router } from "express";
import { eq, and, sql, inArray } from "drizzle-orm";
import { db, teamsTable, teamMembersTable, creditUsageTable, teamFundingOpsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { deductCredits, OutOfCreditsError } from "../lib/credits";
import { addCreditsToProfile } from "../lib/supabase-admin";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { getUserActiveTeam } from "../lib/teams";

const router = Router();

/** How long a funding op may sit in a non-terminal state before it's considered crashed. */
const FUNDING_OP_LEASE_MS = 5 * 60 * 1000;

type FundingOpStatus =
  | "started"
  | "personal_deducted"
  | "reconciling"
  | "completed"
  | "refunded"
  | "refund_failed"
  | "abandoned"
  | "failed";

async function markFundingOp(opId: string, status: FundingOpStatus) {
  await db
    .update(teamFundingOpsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(teamFundingOpsTable.id, opId));
}

/**
 * Lazy reconciler for the cross-database funding saga. Personal Visual Bucs
 * live in Supabase; the team pool + ledger live in Render Postgres, so no
 * single transaction can cover both. This sweeper claims the caller's stale
 * (lease-expired) ops and resolves them:
 *
 * - `personal_deducted` / `reconciling`: the deduct definitely happened
 *   (we only mark after deductCredits returns). If the ledger already has
 *   the pool credit, mark `completed`; otherwise refund the personal
 *   balance and mark `refunded` (or `refund_failed` + CRITICAL log if the
 *   refund itself fails — needs human eyes).
 * - `started`: ambiguous — the process may have crashed before OR after the
 *   personal deduct. Fail SAFE: mark `abandoned` for manual review, never
 *   auto-retry (auto-retry could double-charge the personal balance).
 *
 * Best-effort: never throws. Runs inline on every fund attempt, so no
 * separate cron infrastructure is needed — the next fund attempt heals the
 * previous crash.
 */
async function reconcileStuckFundingOps(
  userId: string,
  log: { error: (obj: unknown, msg: string) => void },
): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - FUNDING_OP_LEASE_MS);
    const stuck = await db
      .select()
      .from(teamFundingOpsTable)
      .where(
        and(
          eq(teamFundingOpsTable.userId, userId),
          inArray(teamFundingOpsTable.status, ["started", "personal_deducted", "reconciling"]),
          sql`${teamFundingOpsTable.updatedAt} < ${cutoff}`,
        ),
      );
    for (const op of stuck) {
      if (op.status === "started") {
        // Ambiguous: fail safe, manual review, never auto-retry.
        const [abandoned] = await db
          .update(teamFundingOpsTable)
          .set({ status: "abandoned", updatedAt: new Date() })
          .where(
            and(
              eq(teamFundingOpsTable.id, op.id),
              eq(teamFundingOpsTable.status, "started"),
            ),
          )
          .returning();
        if (abandoned) {
          log.error(
            { opId: op.id, teamId: op.teamId, amount: op.amount },
            "teams: funding op abandoned after going stale in `started` — manual review needed",
          );
        }
        continue;
      }
      // Atomic claim: exactly one reconciler owns this op. The claim also
      // extends the lease (updatedAt), so a crashed reconciler's op becomes
      // claimable again after the lease expires.
      const [claimed] = await db
        .update(teamFundingOpsTable)
        .set({ status: "reconciling", updatedAt: new Date() })
        .where(
          and(
            eq(teamFundingOpsTable.id, op.id),
            inArray(teamFundingOpsTable.status, ["personal_deducted", "reconciling"]),
            sql`${teamFundingOpsTable.updatedAt} < ${cutoff}`,
          ),
        )
        .returning();
      if (!claimed) continue; // another reconciler (or retry) claimed it
      // Did the pool credit land? The ledger row is the source of truth.
      const [ledger] = await db
        .select({ id: creditUsageTable.id })
        .from(creditUsageTable)
        .where(
          and(
            eq(creditUsageTable.teamId, claimed.teamId),
            eq(creditUsageTable.idempotencyKey, claimed.idempotencyKey),
          ),
        )
        .limit(1);
      if (ledger) {
        await markFundingOp(claimed.id, "completed");
        continue;
      }
      try {
        await addCreditsToProfile(claimed.userId, claimed.amount);
        await markFundingOp(claimed.id, "refunded");
      } catch (refundErr) {
        await markFundingOp(claimed.id, "refund_failed");
        log.error(
          { err: refundErr, opId: claimed.id, teamId: claimed.teamId, amount: claimed.amount },
          "teams: CRITICAL — stuck funding op refund failed, manual reconciliation needed",
        );
      }
    }
  } catch (err) {
    log.error({ err, userId }, "teams: funding reconciler failed (best-effort, continuing)");
  }
}

/** Express 5 types params as string | string[]; our routes use single values. */
function paramId(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

async function requireMembership(userId: string, teamId: string, minRole: "member" | "admin" | "owner") {
  const rows = await db
    .select()
    .from(teamMembersTable)
    .where(
      and(
        eq(teamMembersTable.teamId, teamId),
        eq(teamMembersTable.userId, userId),
        eq(teamMembersTable.status, "active"),
      ),
    )
    .limit(1);
  const membership = rows[0];
  if (!membership) return null;
  const rank: Record<string, number> = { member: 0, admin: 1, owner: 2 };
  if ((rank[membership.role] ?? 0) < (rank[minRole] ?? 0)) return null;
  return membership;
}

/* ── Create a team ─────────────────────────────────────────── */
router.post("/teams", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const name = String(req.body?.name ?? "").trim();
    if (!name || name.length > 80) {
      res.status(400).json({ error: "Team name is required (max 80 characters)." });
      return;
    }
    // ENTITLEMENT: Teams require Shot Caller tier (4) or higher.
    // Fail-closed: unknown tier = no access.
    const { isShotCallerOrHigher } = await import("../lib/teams");
    if (!(await isShotCallerOrHigher(userId))) {
      res.status(403).json({ error: "Team Workspace requires Shot Caller tier or higher." });
      return;
    }
    // V1: one active team per user.
    const existing = await getUserActiveTeam(userId);
    if (existing) {
      res.status(400).json({ error: "You're already on a team. Leave it before creating a new one." });
      return;
    }
    const email = await getUserEmail(userId);

    const [team] = await db.insert(teamsTable).values({ name, ownerId: userId, credits: 0 }).returning();
    await db.insert(teamMembersTable).values({
      teamId: team!.id,
      userId,
      email: email ?? "",
      role: "owner",
      status: "active",
      joinedAt: new Date(),
    });
    res.json({ team });
  } catch (err: unknown) {
    req.log.error({ err }, "teams: create failed");
    res.status(500).json({ error: "Failed to create team." });
  }
});

/* ── My teams + pending invites ─────────────────────────────── */
router.get("/teams", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    // Entitlement gates team CREATION, not membership: anyone can be invited
    // onto a team, but only Shot Caller tier or higher can create one.
    // (Fail-closed: unknown tier = no creation rights.)
    const { isShotCallerOrHigher } = await import("../lib/teams");
    const canCreate = await isShotCallerOrHigher(userId);
    const email = await getUserEmail(userId);

    const memberships = await db
      .select()
      .from(teamMembersTable)
      .where(eq(teamMembersTable.userId, userId));
    const teamIds = [...new Set(memberships.map((m) => m.teamId))];
    const teams =
      teamIds.length > 0
        ? await db.select().from(teamsTable).where(inArray(teamsTable.id, teamIds))
        : [];

    // Pending invites addressed to this user's email (not yet accepted).
    const invites =
      email != null
        ? await db
            .select()
            .from(teamMembersTable)
            .where(and(eq(teamMembersTable.email, email.toLowerCase()), eq(teamMembersTable.status, "invited")))
        : [];
    const inviteTeams =
      invites.length > 0
        ? await db
            .select()
            .from(teamsTable)
            .where(inArray(teamsTable.id, [...new Set(invites.map((i) => i.teamId))]))
        : [];
    const inviteTeamById = new Map(inviteTeams.map((t) => [t.id, t]));

    res.json({
      canCreate,
      teams: teams.map((t) => ({
        ...t,
        myRole: memberships.find((m) => m.teamId === t.id)?.role ?? null,
        myStatus: memberships.find((m) => m.teamId === t.id)?.status ?? null,
      })),
      invites: invites.map((i) => ({ ...i, team: inviteTeamById.get(i.teamId) ?? null })),
    });
  } catch (err: unknown) {
    req.log.error({ err }, "teams: list failed");
    res.status(500).json({ error: "Failed to load teams." });
  }
});

/* ── Team detail + members ───────────────────────────────────── */
router.get("/teams/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const teamId = paramId(req.params.id);
    const membership = await requireMembership(userId, teamId, "member");
    if (!membership) {
      res.status(403).json({ error: "Not a member of this team." });
      return;
    }
    const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId)).limit(1);
    if (!team) {
      res.status(404).json({ error: "Team not found." });
      return;
    }
    const members = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));
    res.json({ team, members, myRole: membership.role });
  } catch (err: unknown) {
    req.log.error({ err }, "teams: detail failed");
    res.status(500).json({ error: "Failed to load team." });
  }
});

/* ── Update team settings (owner/admin) ─────────────────────────── */
router.patch("/teams/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const teamId = paramId(req.params.id);
    const caller = await requireMembership(userId, teamId, "admin");
    if (!caller) {
      res.status(403).json({ error: "Only team admins can change team settings." });
      return;
    }
    const updates: { name?: string; allowPersonalFallback?: boolean } = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name || name.length > 80) {
        res.status(400).json({ error: "Team name is required (max 80 characters)." });
        return;
      }
      updates.name = name;
    }
    if (req.body?.allowPersonalFallback !== undefined) {
      updates.allowPersonalFallback = Boolean(req.body.allowPersonalFallback);
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Nothing to update." });
      return;
    }
    const [team] = await db
      .update(teamsTable)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(teamsTable.id, teamId))
      .returning();
    res.json({ team });
  } catch (err: unknown) {
    req.log.error({ err }, "teams: update failed");
    res.status(500).json({ error: "Failed to update team." });
  }
});

/* ── Invite a member ─────────────────────────────────────────── */
router.post("/teams/:id/invite", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const teamId = paramId(req.params.id);
    const caller = await requireMembership(userId, teamId, "admin");
    if (!caller) {
      res.status(403).json({ error: "Only team admins can invite members." });
      return;
    }
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const role = String(req.body?.role ?? "member");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "Enter a valid email address." });
      return;
    }
    if (!["admin", "member"].includes(role)) {
      res.status(400).json({ error: "Role must be admin or member." });
      return;
    }
    const [existing] = await db
      .select()
      .from(teamMembersTable)
      .where(and(eq(teamMembersTable.teamId, teamId), eq(teamMembersTable.email, email)))
      .limit(1);
    if (existing) {
      res.status(400).json({ error: "That email is already on the team." });
      return;
    }
    // If the invitee already has an account, link it immediately (still invited status).
    const inviteeId = await getUserIdByEmail(email);
    const [member] = await db
      .insert(teamMembersTable)
      .values({ teamId, userId: inviteeId, email, role, status: "invited" })
      .returning();
    res.json({ member });
  } catch (err: unknown) {
    req.log.error({ err }, "teams: invite failed");
    res.status(500).json({ error: "Failed to send invite." });
  }
});

/* ── Accept an invite ────────────────────────────────────────── */
router.post("/teams/:id/accept", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const teamId = paramId(req.params.id);
    const email = await getUserEmail(userId);
    if (!email) {
      res.status(400).json({ error: "Could not determine your account email." });
      return;
    }
    const [invite] = await db
      .select()
      .from(teamMembersTable)
      .where(
        and(
          eq(teamMembersTable.teamId, teamId),
          eq(teamMembersTable.email, email.toLowerCase()),
          eq(teamMembersTable.status, "invited"),
        ),
      )
      .limit(1);
    if (!invite) {
      res.status(404).json({ error: "No pending invite for this team." });
      return;
    }
    const existing = await getUserActiveTeam(userId);
    if (existing) {
      res.status(400).json({ error: "You're already on a team. Leave it before joining another." });
      return;
    }
    await db
      .update(teamMembersTable)
      .set({ status: "active", userId, joinedAt: new Date() })
      .where(eq(teamMembersTable.id, invite.id));
    res.json({ ok: true });
  } catch (err: unknown) {
    req.log.error({ err }, "teams: accept failed");
    res.status(500).json({ error: "Failed to accept invite." });
  }
});

/* ── Decline an invite ───────────────────────────────────────── */
router.post("/teams/:id/decline", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const teamId = paramId(req.params.id);
    const email = await getUserEmail(userId);
    if (!email) {
      res.status(400).json({ error: "Could not determine your account email." });
      return;
    }
    await db
      .delete(teamMembersTable)
      .where(
        and(
          eq(teamMembersTable.teamId, teamId),
          eq(teamMembersTable.email, email.toLowerCase()),
          eq(teamMembersTable.status, "invited"),
        ),
      );
    res.json({ ok: true });
  } catch (err: unknown) {
    req.log.error({ err }, "teams: decline failed");
    res.status(500).json({ error: "Failed to decline invite." });
  }
});

/* ── Change a member's role ──────────────────────────────────── */
router.patch("/teams/:id/members/:memberId", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const teamId = paramId(req.params.id);
    const caller = await requireMembership(userId, teamId, "owner");
    if (!caller) {
      res.status(403).json({ error: "Only the team owner can change roles." });
      return;
    }
    const role = String(req.body?.role ?? "");
    if (!["admin", "member"].includes(role)) {
      res.status(400).json({ error: "Role must be admin or member." });
      return;
    }
    const [target] = await db
      .select()
      .from(teamMembersTable)
      .where(and(eq(teamMembersTable.id, paramId(req.params.memberId)), eq(teamMembersTable.teamId, teamId)))
      .limit(1);
    if (!target || target.role === "owner") {
      res.status(400).json({ error: "Cannot change the owner's role." });
      return;
    }
    await db.update(teamMembersTable).set({ role }).where(eq(teamMembersTable.id, target.id));
    res.json({ ok: true });
  } catch (err: unknown) {
    req.log.error({ err }, "teams: role change failed");
    res.status(500).json({ error: "Failed to change role." });
  }
});

/* ── Remove a member ─────────────────────────────────────────── */
router.delete("/teams/:id/members/:memberId", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const teamId = paramId(req.params.id);
    const caller = await requireMembership(userId, teamId, "admin");
    if (!caller) {
      res.status(403).json({ error: "Only team admins can remove members." });
      return;
    }
    const [target] = await db
      .select()
      .from(teamMembersTable)
      .where(and(eq(teamMembersTable.id, paramId(req.params.memberId)), eq(teamMembersTable.teamId, teamId)))
      .limit(1);
    if (!target || target.role === "owner") {
      res.status(400).json({ error: "Cannot remove the team owner." });
      return;
    }
    if (caller.role !== "owner" && target.role === "admin") {
      res.status(403).json({ error: "Only the owner can remove an admin." });
      return;
    }
    await db.delete(teamMembersTable).where(eq(teamMembersTable.id, target.id));
    res.json({ ok: true });
  } catch (err: unknown) {
    req.log.error({ err }, "teams: remove failed");
    res.status(500).json({ error: "Failed to remove member." });
  }
});

/* ── Leave a team ────────────────────────────────────────────── */
router.post("/teams/:id/leave", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const teamId = paramId(req.params.id);
    const membership = await requireMembership(userId, teamId, "member");
    if (!membership) {
      res.status(403).json({ error: "Not a member of this team." });
      return;
    }
    if (membership.role === "owner") {
      res.status(400).json({ error: "The owner can't leave. Delete the team or transfer ownership first." });
      return;
    }
    await db.delete(teamMembersTable).where(eq(teamMembersTable.id, membership.id));
    res.json({ ok: true });
  } catch (err: unknown) {
    req.log.error({ err }, "teams: leave failed");
    res.status(500).json({ error: "Failed to leave team." });
  }
});

/* ── Fund the team pool from personal credits ───────────────────
 *
 * Cross-database saga (Supabase personal balance -> Render Postgres pool),
 * made safe via the team_funding_ops state machine:
 *
 * 1. The (team_id, idempotency_key) unique index is the mutex: concurrent
 *    retries with the same key serialize here. Exactly one attempt wins;
 *    the losers get the completed result (duplicate) or a 409 while the
 *    winner is still in flight — never a double personal deduction.
 * 2. Personal deduct happens first; the op is marked `personal_deducted`
 *    immediately after, so a crash past this point is recoverable.
 * 3. Pool credit + ledger + op completion happen in ONE Render transaction.
 * 4. Any stale ops from crashed attempts are reconciled first
 *    (reconcileStuckFundingOps) — complete-or-refund, never silent loss.
 */
router.post("/teams/:id/fund", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const teamId = paramId(req.params.id);
    const caller = await requireMembership(userId, teamId, "admin");
    if (!caller) {
      res.status(403).json({ error: "Only team admins can fund the pool." });
      return;
    }
    const amount = Math.floor(Number(req.body?.credits ?? 0));
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: "Enter a credit amount greater than 0." });
      return;
    }
    const idempotencyKey = String(req.body?.idempotencyKey ?? "").trim();
    if (!idempotencyKey) {
      res.status(400).json({ error: "idempotencyKey is required." });
      return;
    }

    // Best-effort: heal this user's crashed funding attempts before starting
    // a new one, so no money is ever left in limbo.
    await reconcileStuckFundingOps(userId, req.log);

    // Claim the idempotency mutex. ON CONFLICT DO NOTHING: exactly one
    // concurrent attempt with this key inserts; the rest see the existing op.
    const [op] = await db
      .insert(teamFundingOpsTable)
      .values({ teamId, userId, idempotencyKey, amount, status: "started" })
      .onConflictDoNothing()
      .returning();
    if (!op) {
      const [existing] = await db
        .select()
        .from(teamFundingOpsTable)
        .where(
          and(
            eq(teamFundingOpsTable.teamId, teamId),
            eq(teamFundingOpsTable.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing?.status === "completed") {
        const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId)).limit(1);
        res.json({ team, duplicate: true });
        return;
      }
      res.status(409).json({
        error: "A funding operation with this key is already in progress. Wait a moment, then check the pool balance before retrying.",
      });
      return;
    }

    // Deduct from personal Supabase balance first (throws 402 if short —
    // no money moved, op goes to `failed` for the audit trail).
    let personalBalance: number;
    try {
      personalBalance = await deductCredits(userId, amount);
    } catch (e) {
      if (e instanceof OutOfCreditsError) {
        await markFundingOp(op.id, "failed");
        res.status(402).json({ error: "out_of_credits" });
        return;
      }
      throw e;
    }
    // Record the deduct immediately. A crash after this point leaves
    // `personal_deducted`, which the reconciler can complete-or-refund.
    // A crash before it leaves `started`, which the reconciler treats as
    // ambiguous -> manual review (fail-safe: never auto double-charges).
    try {
      await markFundingOp(op.id, "personal_deducted");
    } catch (markErr) {
      req.log.error(
        { err: markErr, opId: op.id, userId, teamId, amount },
        "teams: CRITICAL — personal deducted but op mark failed; manual reconciliation needed",
      );
      res.status(500).json({
        error: "Your credits were deducted but the pool credit could not be confirmed. Support has been notified.",
      });
      return;
    }

    // Credit the pool + write the ledger + complete the op atomically.
    // Either all three happen or none do.
    try {
      const team = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(teamsTable)
          .set({ credits: sql`${teamsTable.credits} + ${amount}`, updatedAt: new Date() })
          .where(eq(teamsTable.id, teamId))
          .returning();
        if (!updated) throw new Error("Team not found during fund");
        await tx.insert(creditUsageTable).values({
          userId,
          action: "team_fund",
          creditsUsed: -amount,
          teamId,
          idempotencyKey,
        });
        await tx
          .update(teamFundingOpsTable)
          .set({ status: "completed", updatedAt: new Date() })
          .where(eq(teamFundingOpsTable.id, op.id));
        return updated;
      });
      res.json({ team, personalBalance, idempotencyKey });
    } catch (poolErr) {
      req.log.error({ err: poolErr, opId: op.id, userId, teamId, amount }, "teams: pool credit failed, refunding personal deduction");
      try {
        await addCreditsToProfile(userId, amount);
        await markFundingOp(op.id, "refunded");
        res.status(500).json({ error: "Failed to fund the team pool. Your credits were refunded." });
      } catch (refundErr) {
        await markFundingOp(op.id, "refund_failed");
        req.log.error(
          { err: refundErr, opId: op.id, userId, teamId, amount },
          "teams: CRITICAL — personal refund failed after pool credit failure",
        );
        res.status(500).json({
          error: "Failed to fund the team pool and the automatic refund failed. Support has been notified.",
        });
      }
    }
  } catch (err: unknown) {
    req.log.error({ err }, "teams: fund failed");
    res.status(500).json({ error: "Failed to fund the team pool." });
  }
});

/* ── Per-member spending (owner/admin) ───────────────────────── */
router.get("/teams/:id/spending", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const teamId = paramId(req.params.id);
    const caller = await requireMembership(userId, teamId, "admin");
    if (!caller) {
      res.status(403).json({ error: "Only team admins can view spending." });
      return;
    }
    const rows = await db
      .select({
        userId: creditUsageTable.userId,
        action: creditUsageTable.action,
        total: sql<number>`SUM(${creditUsageTable.creditsUsed})`,
      })
      .from(creditUsageTable)
      .where(and(eq(creditUsageTable.teamId, teamId), sql`${creditUsageTable.creditsUsed} > 0`))
      .groupBy(creditUsageTable.userId, creditUsageTable.action);
    const members = await db.select().from(teamMembersTable).where(eq(teamMembersTable.teamId, teamId));
    const emailByUserId = new Map(members.map((m) => [m.userId, m.email]));
    res.json({
      spending: rows.map((r) => ({
        userId: r.userId,
        email: emailByUserId.get(r.userId) ?? null,
        action: r.action,
        total: Number(r.total),
      })),
    });
  } catch (err: unknown) {
    req.log.error({ err }, "teams: spending failed");
    res.status(500).json({ error: "Failed to load spending." });
  }
});

/* ── Transfer ownership (owner only) ─────────────────────────── */
router.post("/teams/:id/transfer", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const teamId = paramId(req.params.id);
    const caller = await requireMembership(userId, teamId, "owner");
    if (!caller) {
      res.status(403).json({ error: "Only the team owner can transfer ownership." });
      return;
    }
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "Enter a valid email address." });
      return;
    }
    const [target] = await db
      .select()
      .from(teamMembersTable)
      .where(
        and(
          eq(teamMembersTable.teamId, teamId),
          eq(teamMembersTable.email, email),
          eq(teamMembersTable.status, "active"),
        ),
      )
      .limit(1);
    if (!target || !target.userId) {
      res.status(400).json({ error: "That person isn't an active member of this team." });
      return;
    }
    if (target.userId === userId) {
      res.status(400).json({ error: "You're already the owner." });
      return;
    }
    const newOwnerId: string = target.userId;
    // Atomic role swap + owner_id update: no window where the team has
    // zero owners or two owners.
    const [team] = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(teamsTable)
        .set({ ownerId: newOwnerId, updatedAt: new Date() })
        .where(eq(teamsTable.id, teamId))
        .returning();
      if (!updated) throw new Error("Team not found during transfer");
      await tx
        .update(teamMembersTable)
        .set({ role: "owner" })
        .where(eq(teamMembersTable.id, target.id));
      await tx
        .update(teamMembersTable)
        .set({ role: "admin" })
        .where(eq(teamMembersTable.id, caller.id));
      return [updated];
    });
    res.json({ team });
  } catch (err: unknown) {
    req.log.error({ err }, "teams: transfer failed");
    res.status(500).json({ error: "Failed to transfer ownership." });
  }
});

/* ── Delete a team (owner only) ───────────────────────────────── */
router.delete("/teams/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.userId!;
    const teamId = paramId(req.params.id);
    const caller = await requireMembership(userId, teamId, "owner");
    if (!caller) {
      res.status(403).json({ error: "Only the team owner can delete the team." });
      return;
    }
    await db.delete(teamsTable).where(eq(teamsTable.id, teamId));
    res.json({ ok: true });
  } catch (err: unknown) {
    req.log.error({ err }, "teams: delete failed");
    res.status(500).json({ error: "Failed to delete team." });
  }
});

/* ── helpers ─────────────────────────────────────────────────── */
async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error) return null;
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}

async function getUserIdByEmail(email: string): Promise<string | null> {
  try {
    const admin = getSupabaseAdmin();
    // listUsers paginates (default 50/page): use a large page so existing
    // users aren't missed on bigger sites. A miss is still harmless — the
    // accept flow matches invites by email — but linking eagerly is better.
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) return null;
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    return found?.id ?? null;
  } catch {
    return null;
  }
}

export default router;
