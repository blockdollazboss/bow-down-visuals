import { eq, and, sql } from "drizzle-orm";
import { db, teamsTable, teamMembersTable } from "@workspace/db";
import { logger } from "./logger";
import { getCreatorRank } from "./creator-rank";

/**
 * Creator Rank ladder: ★1 Street Punk, ★2 Hustler, ★3 Gangster,
 * ★4 Shot Caller, ★5 Crime Boss, ★6 Kingpin — names and thresholds live
 * in lib/creator-rank.ts, the single source of truth. Teams require
 * Shot Caller (★4) or higher.
 */
const SHOT_CALLER_TIER = 4;

/**
 * Returns true if the user has EARNED Shot Caller rank (★4) or higher.
 *
 * The rank is the server computation in lib/creator-rank.ts — earned from
 * recorded work, never purchasable, and (per that module's hard rules) no
 * plan tier moves it. This gate used to read profiles.plan_tier instead:
 * a legacy column whose only writer is the manual admin endpoint
 * (/api/admin/plan/set, migration 0039 — "assigned manually … until real
 * checkout exists"). Nothing a user does ever raises it, so the gate was
 * closed to every self-serve creator, including ones who had earned ★4+.
 *
 * Fail-closed: a rank read that fails = no access, same posture as before.
 */
export async function isShotCallerOrHigher(userId: string): Promise<boolean> {
  try {
    const rank = await getCreatorRank(userId);
    return rank.stars >= SHOT_CALLER_TIER;
  } catch {
    return false;
  }
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
