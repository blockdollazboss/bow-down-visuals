import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ─── Public Creator API webhooks (Stack-100 #3, wave 3, lane 20) ────────
   PENDING MIGRATION: these tables are drafted ahead of their migration.
   The exact SQL lives in the lane's .lane/MIGRATION-NEEDED.md; the
   migration number is assigned at join (kept SEPARATE from the public-api
   lane's api_keys hold). Until the migration lands, every query against
   these tables fails and the webhook module FAILS CLOSED: registration
   errors out honestly and event emission swallows the failure — no event
   fires, nothing pretends to fire, and the underlying sale / follow /
   membership is never affected.

   Security shape (mirrors api_keys exactly):
   - Only a SHA-256 hash of the signing secret is stored (secret_hash).
     The plaintext secret (`whsec_…`) is shown to the creator exactly once
     at creation and is never stored, never logged, never returned again.
   - secret_prefix is the non-secret display fragment so the owner can
     recognise an endpoint in the Developer door.
   - events is a comma-joined list from the closed v1 event set enforced
     in artifacts/api-server/src/lib/api-webhooks.ts (WEBHOOK_EVENT_TYPES):
     new-sale | new-follower | new-member — each verified against a real
     event source in the codebase (see the lane report).
   - status: "active" | "paused" | "disabled". Paused is creator-chosen;
     disabled is set automatically after sustained delivery failure
     (WEBHOOK_DISABLE_AFTER_CONSECUTIVE_FAILURES in the lib). Anything
     that is not "active" receives NOTHING (fail-closed).
   - consecutive_failures counts consecutive exhausted deliveries (all
     retries spent); any successful delivery resets it to 0. */
export const apiWebhooksTable = pgTable(
  "api_webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    url: text("url").notNull(),
    events: text("events").notNull(),
    secretPrefix: text("secret_prefix").notNull(),
    secretHash: text("secret_hash").notNull(),
    status: text("status").notNull().default("active"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (t) => [
    index("api_webhooks_user_idx").on(t.userId),
    index("api_webhooks_user_status_idx").on(t.userId, t.status),
  ],
);

export const insertApiWebhookSchema = createInsertSchema(apiWebhooksTable).omit({
  id: true,
  createdAt: true,
  disabledAt: true,
  consecutiveFailures: true,
});
export type InsertApiWebhook = z.infer<typeof insertApiWebhookSchema>;
export type ApiWebhook = typeof apiWebhooksTable.$inferSelect;

/* One row per delivery ATTEMPT (not per event): the delivery-history view
   and the retry discipline both read this log. payload is the exact JSON
   body that was (or was attempted to be) sent, so a creator can see
   precisely what their endpoint received; it contains only the event's
   own data — never the signing secret (the signature travels in a header
   and is deliberately NOT stored). */
export const apiWebhookDeliveriesTable = pgTable(
  "api_webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => apiWebhooksTable.id, { onDelete: "cascade" }),
    /* Stable per-event id, also sent as the payload's `id` and the
       X-BDV-Event-Id header — receivers dedupe on it across retries. */
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    attempt: integer("attempt").notNull(),
    status: text("status").notNull(), // "delivered" | "failed"
    responseStatus: integer("response_status"),
    error: text("error"),
    payload: text("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("api_webhook_deliveries_webhook_idx").on(t.webhookId, t.createdAt),
    index("api_webhook_deliveries_event_idx").on(t.eventId),
  ],
);

export const insertApiWebhookDeliverySchema = createInsertSchema(apiWebhookDeliveriesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertApiWebhookDelivery = z.infer<typeof insertApiWebhookDeliverySchema>;
export type ApiWebhookDelivery = typeof apiWebhookDeliveriesTable.$inferSelect;
