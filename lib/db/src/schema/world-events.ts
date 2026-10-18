import { pgTable, uuid, text, integer, timestamp, jsonb, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * The palace calendar (migration 0145) — World Events: scheduled
 * things that HAPPEN in the World, booked ahead and driven by the
 * room authority's scheduler tick (lib/world-events on the API side).
 *
 * Kinds:
 *  - stage_show       — a booked Throne Hall slot: at the hour the
 *                       hall's screen takes the show (a catalog video
 *                       via payload.contentRef, or "live" — the stage
 *                       opens for the host's own live stream).
 *  - listening_party  — a booked Music Hall session: the jukebox
 *                       takes the party's queue (payload.trackIds, in
 *                       order) under the host's name for the slot.
 *  - drop             — a drop spectacle: at the hour a claimable
 *                       Visual Bucs drop lands IN room_id, first-come
 *                       for the members standing in that room
 *                       (payload.amountVb per claim, payload.claimCap
 *                       claims in total).
 *  - contest          — a standing competition (2.24, migration
 *                       0158): the window is the ENTRY window
 *                       (payload.theme); entries and winners live
 *                       in world_contest_entries /
 *                       world_contest_winners. A contest holds no
 *                       stage — the scheduler only flips its status
 *                       with the window (see lib/world-events).
 *
 * room_id is a palace room id ("world:kings-hall", "world:music-hall",
 * …) — plain text, because rooms are socket state, not rows; the
 * palace registry is the authority on which ids exist. host_user_id
 * is the booking member (FK-free like scheduled_posts.user_id: an
 * event outlives nothing — it is cancelled, never orphaned, and a
 * deleted account must not block the calendar).
 *
 * Status is the scheduler's state machine:
 *   scheduled → live → done, with cancelled reachable from scheduled
 *   or live (host or admin). The tick is the only writer of live/done.
 */
export const WORLD_EVENT_KINDS = ["stage_show", "listening_party", "drop", "contest"] as const;
export type WorldEventKind = (typeof WORLD_EVENT_KINDS)[number];

export const WORLD_EVENT_STATUSES = ["scheduled", "live", "done", "cancelled"] as const;
export type WorldEventStatus = (typeof WORLD_EVENT_STATUSES)[number];

/** Per-kind booking payload (validated + sanitized at the route). */
export type WorldEventPayload =
  | { contentRef: string } // stage_show: "live" | "video:<uuid>" | "replay:<uuid>"
  | { trackIds: string[]; playlistId?: string | null } // listening_party
  | { amountVb: number; claimCap: number } // drop
  | { theme: string }; // contest: the theme works are entered under

export const worldEventsTable = pgTable(
  "world_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    roomId: text("room_id").notNull(),
    hostUserId: uuid("host_user_id").notNull(),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: text("status").notNull().default("scheduled"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("world_events_room_starts_idx").on(t.roomId, t.startsAt),
    index("world_events_status_starts_idx").on(t.status, t.startsAt),
    index("world_events_host_idx").on(t.hostUserId),
    /* Migration 0145: kinds and statuses are closed sets.
     * Migration 0158 admits 'contest' (World Contests, 2.24). */
    check(
      "world_events_kind_check",
      sql`${t.kind} IN ('stage_show', 'listening_party', 'drop', 'contest')`,
    ),
    check(
      "world_events_status_check",
      sql`${t.status} IN ('scheduled', 'live', 'done', 'cancelled')`,
    ),
    check("world_events_window_check", sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export type WorldEvent = typeof worldEventsTable.$inferSelect;
export type NewWorldEvent = typeof worldEventsTable.$inferInsert;
