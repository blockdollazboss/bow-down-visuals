import { pgTable, uuid, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ─── Email lists ──────────────────────────────────────────────────────────
   One list per creator (or per project). The `handle` powers the hosted
   landing page at /join/:handle and must be unique across the site. */

export const emailListsTable = pgTable("email_lists", {
  id:          uuid("id").primaryKey().defaultRandom(),
  userId:      uuid("user_id").notNull(),
  name:        text("name").notNull(),
  handle:      text("handle").notNull().unique(),
  description: text("description"),
  /* Welcome-sequence automation: sent to every new subscriber by the
     Resend-backed sender (lib/email-campaign-sender.ts). Step 1 fires
     on signup, step 2 at +24h, step 3 at +72h after step 2. Steps 2/3
     are optional — a list that only fills step 1 sends only step 1. */
  welcomeSubject: text("welcome_subject"),
  welcomeBody:    text("welcome_body"),
  welcome2Subject: text("welcome2_subject"),
  welcome2Body:    text("welcome2_body"),
  welcome3Subject: text("welcome3_subject"),
  welcome3Body:    text("welcome3_body"),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertEmailListSchema = createInsertSchema(emailListsTable)
  .omit({ id: true, createdAt: true })
  .extend({
    name: z.string().min(1, "List name is required.").max(120),
    handle: z.string()
      .min(3, "Handle must be at least 3 characters.")
      .max(40, "Handle must be 40 characters or fewer.")
      .regex(/^[a-z0-9-]+$/, "Handle may only contain lowercase letters, numbers, and hyphens."),
    description: z.string().max(500).optional(),
    welcomeSubject: z.string().max(200).optional(),
    welcomeBody: z.string().max(5000).optional(),
    welcome2Subject: z.string().max(200).optional(),
    welcome2Body: z.string().max(5000).optional(),
    welcome3Subject: z.string().max(200).optional(),
    welcome3Body: z.string().max(5000).optional(),
  });
export type InsertEmailList = z.infer<typeof insertEmailListSchema>;
export type EmailList = typeof emailListsTable.$inferSelect;

/* ─── Subscribers ──────────────────────────────────────────────────────────
   Free tier: up to 1,000 subscribers per list (enforced in the route). */

export const emailSubscribersTable = pgTable("email_subscribers", {
  id:        uuid("id").primaryKey().defaultRandom(),
  listId:    uuid("list_id").notNull().references(() => emailListsTable.id, { onDelete: "cascade" }),
  email:     text("email").notNull(),
  name:      text("name"),
  /* Where the signup came from: "embed" | "landing" | "import" */
  source:    text("source").notNull().default("landing"),
  confirmed: boolean("confirmed").notNull().default(true),
  /* Reserved for open tracking — nothing writes this column yet: v1 has
     no tracking pixel and no provider webhook, so it stays 0 and the
     dashboard reports opens as NOT TRACKED instead of presenting this
     permanent 0 as a measured stat. When a real open signal lands, it
     lands here. */
  opens:     integer("opens").notNull().default(0),
  /* Server-generated token powering the one-click unsubscribe link in
     every send (GET/POST /email-list/unsubscribe/:token). Never set by
     the client; legacy rows were backfilled by migration 0181. */
  unsubscribeToken: text("unsubscribe_token"),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  subscribedAt: timestamp("subscribed_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertEmailSubscriberSchema = createInsertSchema(emailSubscribersTable)
  .omit({ id: true, subscribedAt: true, opens: true, unsubscribedAt: true, unsubscribeToken: true })
  .extend({
    email: z.string().email("Enter a valid email address.").max(254),
    name: z.string().max(120).optional(),
  });
export type InsertEmailSubscriber = z.infer<typeof insertEmailSubscriberSchema>;
export type EmailSubscriber = typeof emailSubscribersTable.$inferSelect;

/* ─── Campaigns (newsletters) ──────────────────────────────────────────────
   status is SERVER-OWNED: "draft" → "queued" → "sending" → "sent" |
   "failed". Clients may only create drafts or request the queue —
   "sending"/"sent"/"failed" are stamped exclusively by the sender
   (lib/email-campaign-sender.ts) after Resend actually accepts mail.
   Sends deliver via Resend; deliverability and scale limits are
   disclosed in the UI. */

export const emailCampaignsTable = pgTable("email_campaigns", {
  id:        uuid("id").primaryKey().defaultRandom(),
  listId:    uuid("list_id").notNull().references(() => emailListsTable.id, { onDelete: "cascade" }),
  subject:   text("subject").notNull(),
  body:      text("body").notNull(),
  /* "campaign" = a newsletter blast to the list's active subscribers. */
  kind:      text("kind").notNull().default("campaign"),
  status:    text("status").notNull().default("draft"),
  sentAt:    timestamp("sent_at", { withTimezone: true }),
  recipientCount: integer("recipient_count").notNull().default(0),
  /* Reserved like email_subscribers.opens — no open signal writes this
     in v1; never surface it as a measured count. */
  openCount: integer("open_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertEmailCampaignSchema = createInsertSchema(emailCampaignsTable)
  .omit({ id: true, createdAt: true, sentAt: true, recipientCount: true, openCount: true })
  .extend({
    subject: z.string().min(1, "Subject is required.").max(200),
    body: z.string().min(1, "Body is required.").max(50000),
    /* Full server-side vocabulary. The API route narrows what a client
       may request to "draft" | "queued" — the rest are sender-stamped. */
    status: z.enum(["draft", "queued", "sending", "sent", "failed"]).default("draft"),
    kind: z.enum(["campaign"]).default("campaign"),
  });
export type InsertEmailCampaign = z.infer<typeof insertEmailCampaignSchema>;
export type EmailCampaign = typeof emailCampaignsTable.$inferSelect;

/* ─── Welcome-sequence deliveries ─────────────────────────────────────────
   One row per subscriber per sequence step, queued at signup by the
   subscribe route (queueWelcomeSequence in the sender module) and
   drained by the sender when scheduledFor comes due. Step timing:
   1 = on signup, 2 = +24h, 3 = +72h after step 2. The (subscriber, step)
   pair is unique in the DB (migration 0181) so re-queueing is a no-op.
   status: "queued" → "sending" → "sent" | "failed" | "skipped"
   (skipped = the list has no stored template for that step, or the
   subscriber unsubscribed before the step came due). */

export const emailSequenceDeliveriesTable = pgTable("email_sequence_deliveries", {
  id:           uuid("id").primaryKey().defaultRandom(),
  listId:       uuid("list_id").notNull().references(() => emailListsTable.id, { onDelete: "cascade" }),
  subscriberId: uuid("subscriber_id").notNull().references(() => emailSubscribersTable.id, { onDelete: "cascade" }),
  step:         integer("step").notNull(),
  status:       text("status").notNull().default("queued"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  sentAt:       timestamp("sent_at", { withTimezone: true }),
  error:        text("error"),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertEmailSequenceDeliverySchema = createInsertSchema(emailSequenceDeliveriesTable)
  .omit({ id: true, createdAt: true, sentAt: true })
  .extend({
    step: z.number().int().min(1).max(3),
    status: z.enum(["queued", "sending", "sent", "failed", "skipped"]).default("queued"),
  });
export type InsertEmailSequenceDelivery = z.infer<typeof insertEmailSequenceDeliverySchema>;
export type EmailSequenceDelivery = typeof emailSequenceDeliveriesTable.$inferSelect;

/* ─── Per-recipient send log ───────────────────────────────────────────────
   Every individual send the sender attempts — campaign blasts and
   sequence deliveries alike — lands here with its outcome. A failed
   address is a failed ROW, never a failed batch. */

export const emailCampaignSendsTable = pgTable("email_campaign_sends", {
  id:           uuid("id").primaryKey().defaultRandom(),
  campaignId:   uuid("campaign_id").references(() => emailCampaignsTable.id, { onDelete: "cascade" }),
  deliveryId:   uuid("delivery_id").references(() => emailSequenceDeliveriesTable.id, { onDelete: "cascade" }),
  subscriberId: uuid("subscriber_id").references(() => emailSubscribersTable.id, { onDelete: "set null" }),
  email:        text("email").notNull(),
  status:       text("status").notNull().default("pending"),
  providerId:   text("provider_id"),
  error:        text("error"),
  sentAt:       timestamp("sent_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertEmailCampaignSendSchema = createInsertSchema(emailCampaignSendsTable)
  .omit({ id: true, createdAt: true })
  .extend({
    email: z.string().email("Enter a valid email address.").max(254),
    status: z.enum(["pending", "sent", "failed"]).default("pending"),
  });
export type InsertEmailCampaignSend = z.infer<typeof insertEmailCampaignSendSchema>;
export type EmailCampaignSend = typeof emailCampaignSendsTable.$inferSelect;

/* ─── Shared constants ───────────────────────────────────────────────────── */

/** Welcome-sequence step timing (hours after the previous step). */
export const WELCOME_STEP_DELAYS_HOURS: Record<number, number> = {
  1: 0, // on signup
  2: 24, // +24h after step 1
  3: 72, // +72h after step 2
};

export const EMAIL_FREE_SUBSCRIBER_LIMIT = 1000;

export const RESERVED_HANDLES = new Set([
  "admin", "api", "app", "dashboard", "join", "login", "signup",
  "settings", "pricing", "support", "help", "blog", "news",
]);

export function isHandleAvailable(handle: string): boolean {
  return !RESERVED_HANDLES.has(handle.toLowerCase());
}
