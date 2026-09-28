import { eq, and, sql } from "drizzle-orm";
import { db, teamsTable, teamMembersTable } from "@workspace/db";
import { logger } from "./logger";

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
