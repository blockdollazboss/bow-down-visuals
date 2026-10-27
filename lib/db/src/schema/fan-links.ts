import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Fan Links That Prove It (N17, dedupe-audit UPGRADE of Shares + Referrals).
   A fan (any signed-in member) mints THEIR OWN share link for a creator's
   content: one row per (fan, content). The link's code rides the URL; the
   public redirect records a real click, a play made while carrying the
   code records a real arrival, and the post-signup attribution call
   records a real signup. The creator-side view aggregates ONLY these
   recorded events — an attribution the data can't prove is never shown.

   content_id is text (share_events uses the same shape: content ids are
   uuids for tracks/videos but the share vocabulary is wider). */
export const FAN_LINK_EVENT_KINDS = ["click", "arrival", "signup"] as const;
export type FanLinkEventKind = (typeof FAN_LINK_EVENT_KINDS)[number];

export const fanLinksTable = pgTable(
  "fan_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /* Public code in the URL — short, unambiguous alphabet (lib/fan-links.ts). */
    code: text("code").notNull().unique(),
    fan_user_id: uuid("fan_user_id").notNull(),
    /* The creator whose content the link points at (attribution owner). */
    creator_user_id: uuid("creator_user_id").notNull(),
    content_type: text("content_type").notNull(), // shares vocabulary
    content_id: text("content_id"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fan_links_fan_content_uidx").on(t.fan_user_id, t.content_type, t.content_id),
    index("fan_links_creator_idx").on(t.creator_user_id),
    index("fan_links_code_idx").on(t.code),
  ],
);

export const insertFanLinkSchema = createInsertSchema(fanLinksTable).omit({
  id: true,
  created_at: true,
});
export type InsertFanLink = z.infer<typeof insertFanLinkSchema>;
export type FanLink = typeof fanLinksTable.$inferSelect;

/* One row per PROVEN touch: a click on the redirect, an arrival (a play
   of the linked content carrying the code), or a signup attributed to it.
   visitor_user_id is set when the toucher is signed in; signups are
   exactly-once per new account (enforced in the route + unique index
   on (kind, visitor_user_id) for kind='signup' via partial index in
   the migration). */
export const fanLinkEventsTable = pgTable(
  "fan_link_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fan_link_id: uuid("fan_link_id")
      .notNull()
      .references(() => fanLinksTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // FAN_LINK_EVENT_KINDS
    visitor_user_id: uuid("visitor_user_id"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fan_link_events_link_idx").on(t.fan_link_id, t.kind),
    index("fan_link_events_visitor_idx").on(t.visitor_user_id),
  ],
);

export type FanLinkEvent = typeof fanLinkEventsTable.$inferSelect;
