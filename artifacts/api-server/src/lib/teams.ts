import { eq, and, sql, isNull } from "drizzle-orm";
import { db, teamsTable, teamMembersTable, artistVaultsTable } from "@workspace/db";
import { logger } from "./logger";
import { getSupabaseAdmin } from "./supabase-admin";

/**
 * Plan tiers: 1=Street Punk, 2=Hustler, 3=Gangster, 4=Shot Caller, 5=Crime Boss, 6=Kingpin.
 * Teams require Shot Caller (4) or higher.
 */
export const SHOT_CALLER_TIER = 4;

/**
 * Returns the user's plan tier (1-6), or null if not set.
 * Reads from Supabase profiles.plan_tier.
 */
export async function getUserPlanTier(userId: string): Promise<number | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("profiles")
      .select("plan_tier")
      .eq("id", userId)
      .maybeSingle();
    if (error || !data) return null;
    const tier = (data as { plan_tier?: number }).plan_tier;
    return typeof tier === "number" && tier >= 1 && tier <= 6 ? tier : null;
  } catch {
    return null;
  }
}

/**
 * Returns true if the user is Shot Caller tier or higher.
 * Fail-closed: unknown tier = no access.
 */
export async function isShotCallerOrHigher(userId: string): Promise<boolean> {
  const tier = await getUserPlanTier(userId);
  return tier !== null && tier >= SHOT_CALLER_TIER;
}

/**
 * Returns the caller's active team membership (if any), with the team row.
 * V1: one active team per user.
 */
export async function getUserActiveTeam(userId: string) {
  const memberships = await db
    .select()
    .from(teamMembersTable)
    .where(and(eq(teamMembersTable.userId, userId), eq(teamMembersTable.status, "active")))
    .limit(1);
  if (memberships.length === 0) return null;
  const membership = memberships[0]!;
  const teams = await db.select().from(teamsTable).where(eq(teamsTable.id, membership.teamId)).limit(1);
  if (teams.length === 0) return null;
  return { team: teams[0]!, membership };
}

/**
 * Returns a vault if the user can USE it: they own it, or it's shared with
 * their active team. Use for generation/read operations.
 * For MANAGE operations (edit, delete, share, outfits, voice lock), require
 * strict ownership via eq(artistVaultsTable.user_id, userId) instead.
 */
export async function getAccessibleVault(userId: string, vaultId: string) {
  const [vault] = await db
    .select()
    .from(artistVaultsTable)
    .where(and(eq(artistVaultsTable.id, vaultId), isNull(artistVaultsTable.deleted_at)))
    .limit(1);
  if (!vault) return null;
  // Owner always has access.
  if (vault.user_id === userId) return vault;
  // Team members can use vaults shared with their active team.
  if (vault.team_id) {
    const activeTeam = await getUserActiveTeam(userId);
    if (activeTeam && activeTeam.team.id === vault.team_id) return vault;
  }
  return null;
}

/**
 * Returns true if the team's pool may be spent from. The pool is a Shot
 * Caller feature: it stays active only while the team's OWNER holds Shot
 * Caller tier or higher. If the owner is downgraded (or their tier is
 * unknown), the pool is frozen — members fall back to personal credits.
 * Fail-closed: unknown tier = suspended.
 *
 * Recovery path: the (downgraded) owner can still transfer ownership to an
 * entitled member via POST /api/teams/:id/transfer, which unsuspends the pool.
 */
export async function isTeamPoolActive(team: { ownerId: string }): Promise<boolean> {
  return isShotCallerOrHigher(team.ownerId);
}

/**
 * Deducts `cost` from a team's shared pool. Returns the new pool balance.
 * Throws OutOfCreditsError-style { status: 402 } on insufficient pool.
 */
export async function deductTeamCredits(teamId: string, cost: number): Promise<number> {
  if (!Number.isFinite(cost) || cost <= 0) {
    throw new Error(`deductTeamCredits: invalid cost ${cost}`);
  }
  // Atomic: single conditional UPDATE — no read-then-write race. Only deducts
  // when the pool holds enough; zero rows updated means insufficient credits.
  const [updated] = await db
    .update(teamsTable)
    .set({ credits: sql`${teamsTable.credits} - ${cost}`, updatedAt: new Date() })
    .where(and(eq(teamsTable.id, teamId), sql`${teamsTable.credits} >= ${cost}`))
    .returning();
  if (!updated) {
    const err = new Error("out_of_credits") as Error & { status?: number };
    err.name = "OutOfCreditsError";
    err.status = 402;
    throw err;
  }
  logger.info({ teamId, cost, creditsAfter: updated.credits }, "[teams] deducted from team pool");
  return updated.credits;
}
