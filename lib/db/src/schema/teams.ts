import { pgTable, uuid, text, integer, timestamp, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Team workspaces (Shot Caller tier feature).
 *
 * A team has one shared credit pool (teams.credits). When an active member
 * spends via chargeCredits(), the deduction comes from the team pool instead
 * of their personal Supabase profile balance. The ledger (credit_usage)
 * records both the team and the member who triggered the spend.
 *
 * V1 constraints:
 * - One active team per user (cannot accept a second invite while active).
 * - Roles: owner (full control) > admin (manage members) > member.
 * - Owner funds the pool by transferring personal credits (POST /api/teams/:id/fund).
 */
export const teamsTable = pgTable("teams", {
  id:        uuid("id").primaryKey().defaultRandom(),
  name:      text("name").notNull(),
  logoUrl:   text("logo_url"),
  ownerId:   uuid("owner_id").notNull(),
  /** Shared credit pool. Members spend from this via chargeCredits(). */
  credits:   integer("credits").notNull().default(0),
  /**
   * When true (default), member spending falls back to personal credits if
   * the shared pool is insufficient. When false, spending fails with
   * OutOfCreditsError instead of touching personal balances.
   * Owner/admin configurable via PATCH /api/teams/:id.
   */
  allowPersonalFallback: boolean("allow_personal_fallback").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const teamMembersTable = pgTable("team_members", {
  id:       uuid("id").primaryKey().defaultRandom(),
  teamId:   uuid("team_id").notNull().references(() => teamsTable.id, { onDelete: "cascade" }),
  /** Supabase user id once accepted; null while the invite is pending. */
  userId:   uuid("user_id"),
  /** Invite target / member email. Unique per team. */
  email:    text("email").notNull(),
  role:     text("role").notNull().default("member"),
  status:   text("status").notNull().default("invited"),
  invitedAt: timestamp("invited_at", { withTimezone: true }).defaultNow().notNull(),
  joinedAt:  timestamp("joined_at", { withTimezone: true }),
}, (t) => [
  /**
   * V1: one active team per user, enforced at the database level so
   * concurrent invite acceptances cannot create two active memberships.
   * Partial index: only rows with status='active' and a known user_id
   * participate. Pending invites (user_id IS NULL) are unaffected —
   * Postgres treats NULLs as distinct in unique indexes.
   */
  uniqueIndex("team_members_one_active_per_user_uidx")
    .on(t.userId)
    .where(sql`${t.status} = 'active'`),
]);

export const insertTeamSchema = createInsertSchema(teamsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTeam = z.infer<typeof insertTeamSchema>;
export type Team = typeof teamsTable.$inferSelect;

export const insertTeamMemberSchema = createInsertSchema(teamMembersTable).omit({ id: true, invitedAt: true });
export type InsertTeamMember = z.infer<typeof insertTeamMemberSchema>;
export type TeamMember = typeof teamMembersTable.$inferSelect;

export const TEAM_ROLES = ["owner", "admin", "member"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const TEAM_STATUSES = ["invited", "active"] as const;
export type TeamStatus = (typeof TEAM_STATUSES)[number];

/**
 * Durable state machine for the cross-database team funding saga.
 *
 * Personal Visual Bucs live in Supabase; the team pool and credit_usage
 * ledger live in Render Postgres — they cannot share a transaction. This
 * table makes every funding attempt auditable and recoverable:
 *
 *   started           — op claimed (idempotency mutex acquired); no money moved yet
 *   personal_deducted — personal balance deducted; pool credit not yet confirmed
 *   reconciling       — a reconciler has claimed this stuck op (transient)
 *   completed         — pool credited + ledger written (terminal, success)
 *   failed            — no money moved (e.g. insufficient personal balance; terminal)
 *   refunded          — pool credit failed; personal balance refunded (terminal)
 *   refund_failed     — pool credit failed AND the refund failed (terminal, CRITICAL:
 *                       needs manual reconciliation — money left the personal balance)
 *   abandoned         — op never got past `started` and went stale; ambiguous whether
 *                       the personal deduct happened (terminal, needs manual review)
 *
 * The (team_id, idempotency_key) unique index is the distributed mutex:
 * concurrent retries with the same key serialize here instead of
 * double-deducting the personal balance (the old check-then-act had a race).
 * A lazy reconciler (reconcileStuckFundingOps, in routes/teams.ts) claims
 * stale personal_deducted ops on subsequent fund attempts and either
 * completes or refunds them — no silent money loss on process crashes.
 */
export const teamFundingOpsTable = pgTable("team_funding_ops", {
  id:             uuid("id").primaryKey().defaultRandom(),
  teamId:         uuid("team_id").notNull().references(() => teamsTable.id, { onDelete: "cascade" }),
  userId:         uuid("user_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  amount:         integer("amount").notNull(),
  status:         text("status").notNull().default("started"),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("team_funding_ops_team_key_uidx").on(t.teamId, t.idempotencyKey),
  index("team_funding_ops_stuck_idx").on(t.status, t.updatedAt),
]);

export type TeamFundingOp = typeof teamFundingOpsTable.$inferSelect;

export const FUNDING_OP_STATUSES = [
  "started",
  "personal_deducted",
  "reconciling",
  "completed",
  "failed",
  "refunded",
  "refund_failed",
  "abandoned",
] as const;
export type FundingOpStatus = (typeof FUNDING_OP_STATUSES)[number];
