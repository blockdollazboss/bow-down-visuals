import { pgTable, uuid, integer, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { creatorProfilesTable } from "./creator-platform";

/**
 * The Royal Court (migration 0131) — a creator crowns up to 8 other
 * creators into their Court, in rank order. Positions are 1–8 and the
 * order IS the ranking: position 1 sits at the head of the Court.
 *
 * Rows reference creator_profiles on BOTH sides with CASCADE deletes, so
 * a deleted profile can never leave a dangling Court row. A member who
 * goes private is filtered at read time (the row survives; the Court
 * restores itself if they come back).
 */
export const ROYAL_COURT_MAX_MEMBERS = 8;

export const royalCourtTable = pgTable(
  "royal_court",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The creator doing the crowning — the Court lives on their page. */
    ownerProfileId: uuid("owner_profile_id")
      .notNull()
      .references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    /** The crowned creator's profile. */
    memberProfileId: uuid("member_profile_id")
      .notNull()
      .references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    /** Rank within the Court: 1 (head of the Court) through 8. */
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    /* One member per seat. */
    uniqueIndex("royal_court_owner_position_ux").on(t.ownerProfileId, t.position),
    /* One seat per member — nobody holds two chairs at the same court. */
    uniqueIndex("royal_court_owner_member_ux").on(t.ownerProfileId, t.memberProfileId),
    index("royal_court_owner_idx").on(t.ownerProfileId),
    /* Migration 0131: seats are ranks 1-8, enforced by the database. */
    check("royal_court_position_check", sql`${t.position} >= 1 AND ${t.position} <= 8`),
  ],
);

export type RoyalCourtEntry = typeof royalCourtTable.$inferSelect;
export type NewRoyalCourtEntry = typeof royalCourtTable.$inferInsert;
