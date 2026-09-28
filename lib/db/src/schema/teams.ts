import { pgTable, uuid, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
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
});

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
