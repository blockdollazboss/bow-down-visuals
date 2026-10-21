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

/* Release smartlink analytics (migration 0186, competitor gap G2).
   One row per landing event on the release's persistent smartlink /
   presave page, copying the bio_link_clicks field discipline
   (bio-pages.ts): link key + title snapshot, referrer, created_at.
   kind = 'view' for a landing view, 'click' for an outbound link tap.
   channel is the attribution label the fan arrived with (?src= /
   utm_source) — plain text, never a fingerprint. country is a coarse
   ISO code from the CDN geo header when present; IPs are never stored.
   user_id is the release owner, denormalized for owner-scoped reads. */
export const releaseLinkClicksTable = pgTable("release_link_clicks", {
  id: uuid("id").primaryKey().defaultRandom(),
  releaseId: uuid("release_id")
    .notNull()
    .references(() => distributionReleasesTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  kind: text("kind").notNull().default("click"),
  linkKey: text("link_key").notNull().default(""),
  linkTitle: text("link_title").notNull().default(""),
  channel: text("channel"),
  referrer: text("referrer"),
  country: text("country"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReleaseLinkClick = typeof releaseLinkClicksTable.$inferSelect;
