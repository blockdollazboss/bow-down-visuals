import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * World show invites (migration 0313, stack1300 Ring 3.8 — the
 * invite-to-a-show remainder of "Invites + announcements").
 *
 * The room invites (world_room_invites, migration 0300) proved the
 * shape: a named inviter invites a named member, and the member
 * answers. This table is the same shape aimed at a SHOW: one row
 * of world_events (a stage show, a listening party, office hours —
 * any booked happening with a room and an hour).
 *
 * Until this table, a show spread only by the palace-wide
 * announcement and the calendar: nobody could invite a specific
 * friend to a specific event. This row IS that invite: the show's
 * host (inviter_user_id — the event's host_user_id) invites a
 * member (invitee_user_id — a user id picked from the member
 * directory, never an email string) to one event.
 *
 * The show's identity is denormalized onto the row (title, kind,
 * room, window) so the invitee's list and the bell copy name the
 * show without re-deriving it — and so the invite still reads
 * honestly if the event row is later cancelled (the answer path
 * re-reads the event: a cancelled or finished show closes the
 * invite instead of promising a walk to nothing).
 *
 *   status  "pending"   — sent, waiting on the invitee
 *           "accepted"  — the invitee said yes; the row is their
 *                         standing invitation, and they walk in
 *                         through the palace's existing doorway
 *                         (the calendar's room walk — no second
 *                         door is built on top of this table)
 *           "declined"  — the invitee said no; the row stays as
 *                         history and the host may invite again
 *                         (a fresh row — history is never rewritten)
 *
 * Exactly-once lives here, not in counters: the partial unique
 * index allows ONE pending row per (event, invitee), so a replayed
 * or raced create can never double the invite — and the create
 * route's bell fires only behind a landed insert, so it can never
 * double the telling either.
 */
export const worldShowInvitesTable = pgTable("world_show_invites", {
  id:            uuid("id").primaryKey().defaultRandom(),
  /** The world_events row this invite names. */
  eventId:       uuid("event_id").notNull(),
  /** The show's title, denormalized from the event row at send
   *  time so invite reads and bell copy name the show itself. */
  eventTitle:    text("event_title").notNull(),
  /** The event's kind (stage_show / listening_party / …), carried
   *  so the invitee's walk resolves exactly as a calendar row's
   *  does (room kinds walk to the room; a contest walks to its
   *  station). */
  eventKind:     text("event_kind").notNull(),
  /** The palace room the show stands in (the event's room_id). */
  roomId:        text("room_id").notNull(),
  /** The show's window, denormalized for the invite list's
   *  when-line and its already-over honesty. */
  startsAt:      timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt:        timestamp("ends_at", { withTimezone: true }).notNull(),
  /** The host who sent it (the event's host_user_id). */
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
  index("world_show_invites_invitee_idx").on(t.inviteeUserId, t.status),
  index("world_show_invites_event_idx").on(t.eventId, t.status),
  uniqueIndex("world_show_invites_one_pending_ux")
    .on(t.eventId, t.inviteeUserId)
    .where(sql`${t.status} = 'pending'`),
]);

const insertWorldShowInviteSchema = createInsertSchema(worldShowInvitesTable).omit({
  id: true,
  createdAt: true,
});
export type WorldShowInvite = typeof worldShowInvitesTable.$inferSelect;
