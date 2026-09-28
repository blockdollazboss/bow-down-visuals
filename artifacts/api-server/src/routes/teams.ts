import { Router } from "express";
import { eq, and, sql, inArray } from "drizzle-orm";
import { db, teamsTable, teamMembersTable, creditUsageTable } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { deductCredits, OutOfCreditsError } from "../lib/credits";
import { addCreditsToProfile } from "../lib/supabase-admin";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { getUserActiveTeam } from "../lib/teams";

const router = Router();

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
    // ENTITLEMENT: Teams are positioned for Shot Caller tier and above.
    // No reliable subscription-tier data exists yet (Stripe webhook records
    // purchases but no tier/plan), so this is intentionally fail-open for the
    // beta. When tiers launch, enforce here: look up the user's plan and
    // return 403 unless Shot Caller or higher.
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

/* ── Fund the team pool from personal credits ─────────────────── */
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
    // Deduct from personal Supabase balance first (throws 402 if short).
    try {
      await deductCredits(userId, amount);
    } catch (e) {
      if (e instanceof OutOfCreditsError) {
        res.status(402).json({ error: "out_of_credits" });
        return;
      }
      throw e;
    }
    // Credit the team pool. If this fails, automatically refund the personal
    // deduction so credits are never silently lost — no manual reconciliation.
    try {
      const [team] = await db
        .update(teamsTable)
        .set({ credits: sql`${teamsTable.credits} + ${amount}`, updatedAt: new Date() })
        .where(eq(teamsTable.id, teamId))
        .returning();
      await db.insert(creditUsageTable).values({
        userId,
        action: "team_fund",
        creditsUsed: -amount,
        teamId,
      });
      res.json({ team });
    } catch (poolErr) {
      req.log.error({ err: poolErr, userId, teamId, amount }, "teams: pool credit failed, refunding personal deduction");
      try {
        await addCreditsToProfile(userId, amount);
      } catch (refundErr) {
        // Both legs failed — this needs human eyes. Log loudly.
        req.log.error({ err: refundErr, userId, teamId, amount }, "teams: CRITICAL — personal refund failed after pool credit failure");
      }
      res.status(500).json({ error: "Failed to fund the team pool. Your credits were refunded." });
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
    const { data, error } = await admin.auth.admin.listUsers();
    if (error) return null;
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    return found?.id ?? null;
  } catch {
    return null;
  }
}

export default router;
