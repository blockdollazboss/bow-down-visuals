import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

/** Per-creator stream-overlay token (stack900 lane C2, migration 0300).
 *  One row per creator. The token is the ONLY credential an overlay
 *  page (an OBS / Streamlabs browser source) ever holds: it is
 *  unguessable (256 bits of randomness), names no user id, and
 *  resetting it kills every overlay URL the creator ever shared —
 *  the old token stops resolving the moment the row is rewritten.
 *
 *  The token gates a READ-ONLY public surface: overlay state (latest
 *  follower, recent tips, tip-goal progress — all data the creator's
 *  own stream already shows publicly) and the live alert socket.
 *  It can move no money and change nothing. The reader/writer lives
 *  in the API's lib/overlay-events.ts. */
export const creatorOverlayTokensTable = pgTable("creator_overlay_tokens", {
  userId:    uuid("user_id").primaryKey(),
  token:     text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type CreatorOverlayToken = typeof creatorOverlayTokensTable.$inferSelect;
