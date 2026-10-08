import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { distributionReleasesTable } from "./distribution-releases";

/* Pre-save page engagement (HyperFollow parity, migration 0082).
   presave_follows: fans who pre-saved / joined the notify list on a
   public /presave/:slug page. One row per (release, email); the email is
   also subscribed to the artist's email list server-side.
   presave_shares: one row per share action — powers the share counter and
   the "share to unlock" bonus-content gate. */
export const presaveFollowsTable = pgTable("presave_follows", {
  id: uuid("id").primaryKey().defaultRandom(),
  releaseId: uuid("release_id")
    .notNull()
    .references(() => distributionReleasesTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name"),
  platform: text("platform"),
  source: text("source").notNull().default("presave"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const presaveSharesTable = pgTable("presave_shares", {
  id: uuid("id").primaryKey().defaultRandom(),
  releaseId: uuid("release_id")
    .notNull()
    .references(() => distributionReleasesTable.id, { onDelete: "cascade" }),
  channel: text("channel"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PresaveFollow = typeof presaveFollowsTable.$inferSelect;
export type PresaveShare = typeof presaveSharesTable.$inferSelect;
