import { pgTable, uuid, text, integer, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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

/* Release-day fan notifications (wave 3 #15, migration 0185).
   presave_release_deliveries: the delivery ledger for the "one email
   when the music drops" promise the presave page makes. One row per
   (release, fan email), claimed insert-first (ON CONFLICT DO NOTHING
   on the unique (release_id, email) index) before any send — the
   live_go_live_deliveries discipline (migration 0133): only a claim
   that lands may send, so a retried sweep, a second sweeper, or a
   restart can never email a fan twice.
     pending → a claim landed; the send has not resolved yet.
     sent    → the provider accepted the email (provider_id recorded).
     failed  → the send attempt failed (last_error recorded); a later
               sweep may retry while attempts < the cap.
     dead    → attempts exhausted; terminal, never retried. */
export const PRESAVE_DELIVERY_STATUSES = ["pending", "sent", "failed", "dead"] as const;
export type PresaveDeliveryStatus = (typeof PRESAVE_DELIVERY_STATUSES)[number];

export const presaveReleaseDeliveriesTable = pgTable("presave_release_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  releaseId: uuid("release_id")
    .notNull()
    .references(() => distributionReleasesTable.id, { onDelete: "cascade" }),
  /* The presave_follows row this delivery answers. Set-null on delete:
     the ledger row (and its email) is the durable record of the one
     allowed send even if the follow row later disappears. */
  followId: uuid("follow_id").references(() => presaveFollowsTable.id, { onDelete: "set null" }),
  email: text("email").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  providerId: text("provider_id"),
  lastError: text("last_error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check(
    "presave_release_deliveries_status_check",
    sql`${t.status} IN ('pending', 'sent', 'failed', 'dead')`,
  ),
  uniqueIndex("presave_release_deliveries_release_email_idx").on(t.releaseId, t.email),
  index("presave_release_deliveries_release_idx").on(t.releaseId),
]);

export type PresaveReleaseDelivery = typeof presaveReleaseDeliveriesTable.$inferSelect;
