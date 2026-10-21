import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Team Seats — DistroKid-style roles for collaborators & managers on an
 * account (separate from the Shot Caller `teams` shared-credit-pool feature).
 *
 * The account holder is the implicit `owner`. They invite seats by email with
 * a role; the seat activates when the invited email's signed-in account
 * accepts the invite link (matched on Supabase auth email). No email provider
 * is configured, so invites are link-based: the owner copies the link and
 * shares it manually.
 *
 * Permission matrix (see TEAM_SEAT_PERMISSIONS below):
 * - owner:        everything — team management, credits, publishing, money, profile
 * - manager:     generate/spend credits, publish releases, view money, edit profile
 * - collaborator: generate/spend credits
 * - viewer:      read-only
 */
export const teamSeatsTable = pgTable("team_seats", {
  id:         uuid("id").primaryKey().defaultRandom(),
  /** Supabase user id of the account holder — the seat owner. */
  ownerId:    uuid("owner_id").notNull(),
  /** Invite target / member email. Unique per owner. */
  email:      text("email").notNull(),
  /** Display name shown in the team list / splits ledger collaborator picker. */
  displayName: text("display_name"),
  role:       text("role").notNull().default("collaborator"),
  status:     text("status").notNull().default("invited"),
  /** Secret token in the invite link; null after the invite is accepted. */
  inviteToken: text("invite_token").unique(),
  invitedAt:  timestamp("invited_at", { withTimezone: true }).defaultNow().notNull(),
  joinedAt:   timestamp("joined_at", { withTimezone: true }),
  revokedAt:  timestamp("revoked_at", { withTimezone: true }),
});

export const insertTeamSeatSchema = createInsertSchema(teamSeatsTable).omit({
  id: true,
  invitedAt: true,
});
export type InsertTeamSeat = z.infer<typeof insertTeamSeatSchema>;
export type TeamSeat = typeof teamSeatsTable.$inferSelect;

export const TEAM_SEAT_ROLES = ["owner", "manager", "collaborator", "viewer"] as const;
export type TeamSeatRole = (typeof TEAM_SEAT_ROLES)[number];

export const TEAM_SEAT_STATUSES = ["invited", "active", "revoked"] as const;
export type TeamSeatStatus = (typeof TEAM_SEAT_STATUSES)[number];

/** Capability flags used across the app (splits ledger, money tracker, releases). */
export interface TeamSeatPermissions {
  /** Generate AI + spend the account's credits */
  canGenerate: boolean;
  /** Publish releases */
  canPublish: boolean;
  /** View Money Tracker */
  canViewMoney: boolean;
  /** Edit the artist profile */
  canEditProfile: boolean;
  /** Invite / change / revoke team seats */
  canManageTeam: boolean;
}

export const TEAM_SEAT_PERMISSIONS: Record<TeamSeatRole, TeamSeatPermissions> = {
  owner: {
    canGenerate: true,
    canPublish: true,
    canViewMoney: true,
    canEditProfile: true,
    canManageTeam: true,
  },
  manager: {
    canGenerate: true,
    canPublish: true,
    canViewMoney: true,
    canEditProfile: true,
    canManageTeam: false,
  },
  collaborator: {
    canGenerate: true,
    canPublish: false,
    canViewMoney: false,
    canEditProfile: false,
    canManageTeam: false,
  },
  viewer: {
    canGenerate: false,
    canPublish: false,
    canViewMoney: false,
    canEditProfile: false,
    canManageTeam: false,
  },
};

export function permissionsForRole(role: string): TeamSeatPermissions {
  const r = role as TeamSeatRole;
  return TEAM_SEAT_PERMISSIONS[r] ?? TEAM_SEAT_PERMISSIONS.viewer;
}
