import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * World room invites (migration 0300, stack900 Lane B4 — owner
 * ruling Oct 29, 2026: "Build real room invites — pick a person,
 * they accept or decline").
 *
 * Until this table, a Creator Room spread only by an anonymous
 * copied link/code: no invitee was ever recorded, so nobody could
 * be told they'd been invited. This row IS the invite: a named
 * inviter (the room's host — the creator profile's user id) invites
 * a named member (a user id picked from the member directory, never
 * an email string) to one room (`creator:<slug>`), and the member
 * answers it.
 *
 *   status  "pending"   — sent, waiting on the invitee
 *           "accepted"  — the invitee said yes; the row is their
 *                         standing invitation, and they walk in
 *                         through the palace's existing doorway
 *                         (the room read + transfer — no second
 *                         door is built on top of this table)
 *           "declined"  — the invitee said no; the row stays as
 *                         history and the host may invite again
 *                         (a fresh row — history is never rewritten)
 *
 * Exactly-once lives here, not in counters: the partial unique
 * index allows ONE pending row per (room, invitee), so a replayed
 * or raced create can never double the invite — and the create
 * route's bell fires only behind a landed insert, so it can never
 * double the telling either.
 */
export const worldRoomInvitesTable = pgTable("world_room_invites", {
  id:            uuid("id").primaryKey().defaultRandom(),
  /** The palace room id: `creator:<slug>`. */
  roomId:        text("room_id").notNull(),
  /** The room's slug, denormalized so invite reads and bell copy
   *  name the room without re-deriving it from the id. */
  roomSlug:      text("room_slug").notNull(),
  /** The host who sent it (the room-owning creator's user id). */
  inviterUserId: uuid("inviter_user_id").notNull(),
  /** The member who was invited (a user id — always a real,
   *  picked person, never an email or a typed string). */
  inviteeUserId: uuid("invitee_user_id").notNull(),
  status:        text("status").notNull().default("pending"),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  /** When the invitee answered (accept or decline); null while
   *  the invite still waits on them. */
  respondedAt:   timestamp("responded_at", { withTimezone: true }),
}, (t) => [
  index("world_room_invites_invitee_idx").on(t.inviteeUserId, t.status),
  index("world_room_invites_room_idx").on(t.roomId, t.status),
  uniqueIndex("world_room_invites_one_pending_ux")
    .on(t.roomId, t.inviteeUserId)
    .where(sql`${t.status} = 'pending'`),
]);

export const insertWorldRoomInviteSchema = createInsertSchema(worldRoomInvitesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertWorldRoomInvite = z.infer<typeof insertWorldRoomInviteSchema>;
export type WorldRoomInvite = typeof worldRoomInvitesTable.$inferSelect;
