import { eq, and, sql } from "drizzle-orm";
import { db, teamsTable, teamMembersTable } from "@workspace/db";
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
