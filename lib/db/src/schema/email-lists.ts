import { pgTable, uuid, text, timestamp, integer, boolean, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
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
    /* 2,000 chars: the description IS the join page's offer copy ("What
       do subscribers get?") — a real offer (headline + pitch + the
       4-bullet pack/founding/drop block, with emoji) runs 650–1,500
       chars. The old 500 cap rejected exactly that copy with a bare
       "Invalid list." — proven against the schema with the house
       list's real offer text. 2,000 still stops paste-bomb abuse.
       Name/handle stay tight: punctuation and emoji are legitimate in
       a display name (em dashes, apostrophes) and always were allowed
       — length is the only name rule. */
    description: z.string().max(2000).optional(),
    welcomeSubject: z.string().max(200).optional(),
    /* 20,000: a full welcome email (subject + story + link block) can
       run past the old 5,000 once steps carry the complete final copy;
       campaign bodies already allow 50,000. */
    welcomeBody: z.string().max(20000).optional(),
    welcome2Subject: z.string().max(200).optional(),
    welcome2Body: z.string().max(20000).optional(),
    welcome3Subject: z.string().max(200).optional(),
    welcome3Body: z.string().max(20000).optional(),
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
  /* Open count, written ONLY by real engagement signals (migration
     0189): the house tracking pixel, the click redirect, and the
     signature-verified Resend webhook all record into
     email_engagement_events first; the first open per delivered email
     increments this counter. Never written by anything else — a 0 here
     is a measured 0, not a placeholder. */
  opens:     integer("opens").notNull().default(0),
  /* Click count, same discipline as opens (first click per link per
     delivered email increments). */
  clicks:    integer("clicks").notNull().default(0),
  /* Server-generated token powering the one-click unsubscribe link in
     every send (GET/POST /email-list/unsubscribe/:token). Never set by
     the client; legacy rows were backfilled by migration 0181. */
  unsubscribeToken: text("unsubscribe_token"),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  subscribedAt: timestamp("subscribed_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertEmailSubscriberSchema = createInsertSchema(emailSubscribersTable)
  .omit({ id: true, subscribedAt: true, opens: true, clicks: true, unsubscribedAt: true, unsubscribeToken: true })
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
   Dispatch also records one delivery row per recipient (migration
   0189) carrying the tracking pixel + wrapped links. Deliverability
   and scale limits are disclosed in the UI. */

export const emailCampaignsTable = pgTable("email_campaigns", {
  id:        uuid("id").primaryKey().defaultRandom(),
  listId:    uuid("list_id").notNull().references(() => emailListsTable.id, { onDelete: "cascade" }),
  subject:   text("subject").notNull(),
  body:      text("body").notNull(),
  /* "campaign" = a newsletter blast to the list's active subscribers. */
  kind:      text("kind").notNull().default("campaign"),
  status:    text("status").notNull().default("draft"),
  /* Audience: null = the whole list; otherwise the segment (same list)
     the audience was resolved from at dispatch time. */
  segmentId: uuid("segment_id").references(() => emailSegmentsTable.id, { onDelete: "set null" }),
  /* Automation carrier (migration 0198): a campaign row owned by an
     email_automations row — the series' deliveries hang off it so the
     tracking pixel / click redirect / unsubscribe / Resend webhook all
     resolve exactly like a newsletter send. Carrier campaigns are NOT
     newsletters: the campaign history filters them out and manual
     dispatch refuses them. Plain uuid (no FK) — the FK lives on
     email_automations.campaign_id, one direction only, no cycle. */
  automationId: uuid("automation_id"),
  sentAt:    timestamp("sent_at", { withTimezone: true }),
  recipientCount: integer("recipient_count").notNull().default(0),
  /* Measured counters (migration 0189): delivered = provider accepted;
     openCount / clickCount = unique subscribers who opened / clicked,
     maintained from email_engagement_events. Real signals only. */
  deliveredCount: integer("delivered_count").notNull().default(0),
  openCount: integer("open_count").notNull().default(0),
  clickCount: integer("click_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertEmailCampaignSchema = createInsertSchema(emailCampaignsTable)
  .omit({ id: true, createdAt: true, sentAt: true, recipientCount: true, deliveredCount: true, openCount: true, clickCount: true })
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

/* ─── Tags (migration 0189) ───────────────────────────────────────────────
   Manual labels a creator puts on subscribers of ONE list. Automatic
   tags (presave / member / buyer / opened / clicked / engaged) are NOT
   stored here — they are derived at read time from data the house
   already keeps (subscriber source, fan_members, shop_events,
   engagement events) so they can never drift from the truth. */

export const emailTagsTable = pgTable("email_tags", {
  id:        uuid("id").primaryKey().defaultRandom(),
  listId:    uuid("list_id").notNull().references(() => emailListsTable.id, { onDelete: "cascade" }),
  name:      text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("email_tags_list_name_ux").on(t.listId, t.name),
]);

export type EmailTag = typeof emailTagsTable.$inferSelect;

export const emailSubscriberTagsTable = pgTable("email_subscriber_tags", {
  subscriberId: uuid("subscriber_id").notNull().references(() => emailSubscribersTable.id, { onDelete: "cascade" }),
  tagId:        uuid("tag_id").notNull().references(() => emailTagsTable.id, { onDelete: "cascade" }),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.subscriberId, t.tagId] }),
]);

export type EmailSubscriberTag = typeof emailSubscriberTagsTable.$inferSelect;

/* ─── Segments (migration 0189) ───────────────────────────────────────────
   A saved audience definition over one list. criteria shape (validated
   in the route + lib/email-segments):
   {
     tags: string[]        — manual tag names; subscriber must carry ALL
     autoTags: string[]    — derived tags; subscriber must carry ALL
     sources: string[]     — subscriber.source must be one of these
     engagement: "any" | "opened" | "clicked" | "engaged" | "none"
   }
   Unsubscribed subscribers are NEVER part of any segment, whatever the
   criteria say — suppression is absolute and evaluated first. */

export const emailSegmentsTable = pgTable("email_segments", {
  id:        uuid("id").primaryKey().defaultRandom(),
  listId:    uuid("list_id").notNull().references(() => emailListsTable.id, { onDelete: "cascade" }),
  name:      text("name").notNull(),
  criteria:  text("criteria").notNull().default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type EmailSegment = typeof emailSegmentsTable.$inferSelect;

/* ─── Campaign deliveries (migration 0189) ────────────────────────────────
   One row per (campaign, subscriber) created at dispatch time. The
   random token is the unguessable handle the tracking pixel, click
   redirect, and one-click unsubscribe all key off — it is never a
   subscriber or campaign id, so tracking URLs leak no identity. */

export const emailCampaignDeliveriesTable = pgTable("email_campaign_deliveries", {
  id:        uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").notNull().references(() => emailCampaignsTable.id, { onDelete: "cascade" }),
  subscriberId: uuid("subscriber_id").notNull().references(() => emailSubscribersTable.id, { onDelete: "cascade" }),
  email:     text("email").notNull(),
  /* queued → sent | failed | no_provider; bounced / complained land
     from the Resend webhook after a send. */
  status:    text("status").notNull().default("queued"),
  providerMessageId: text("provider_message_id"),
  token:     text("token").notNull().unique(),
  sentAt:    timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type EmailCampaignDelivery = typeof emailCampaignDeliveriesTable.$inferSelect;

/* One wrapped link per (delivery, distinct target URL in the body).
   The redirect endpoint resolves the target FROM THIS ROW by token —
   the request never carries a destination, so the endpoint can never
   be abused as an open redirect. */
export const emailCampaignLinksTable = pgTable("email_campaign_links", {
  id:         uuid("id").primaryKey().defaultRandom(),
  deliveryId: uuid("delivery_id").notNull().references(() => emailCampaignDeliveriesTable.id, { onDelete: "cascade" }),
  targetUrl:  text("target_url").notNull(),
  token:      text("token").notNull().unique(),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type EmailCampaignLink = typeof emailCampaignLinksTable.$inferSelect;

/* ─── Engagement events (migration 0189) ──────────────────────────────────
   Append-only record of real engagement signals. First-signal-wins:
   the unique indexes make a second open (or a second click on the same
   link) for the same delivery a no-op insert, whichever source reports
   it (house pixel/redirect or the Resend webhook) — an open is counted
   exactly once per delivered email. The recorder maintains the
   counters on email_subscribers / email_campaigns from these rows. */

export const emailEngagementEventsTable = pgTable("email_engagement_events", {
  id:           uuid("id").primaryKey().defaultRandom(),
  deliveryId:   uuid("delivery_id").notNull().references(() => emailCampaignDeliveriesTable.id, { onDelete: "cascade" }),
  campaignId:   uuid("campaign_id").notNull(),
  subscriberId: uuid("subscriber_id").notNull(),
  listId:       uuid("list_id").notNull(),
  /* open | click | bounce | complaint */
  kind:         text("kind").notNull(),
  linkId:       uuid("link_id"),
  /* pixel | redirect | resend_webhook */
  source:       text("source").notNull(),
  providerEventId: text("provider_event_id"),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type EmailEngagementEvent = typeof emailEngagementEventsTable.$inferSelect;

/* ─── Automations (migration 0198) ───────────────────────────────────────
   One row per (list, kind) — the three starter automations. A row is
   materialized lazily the first time the creator opens the Automations
   card (defaults in, enabled FALSE: nothing ever sends for a creator
   who hasn't switched an automation on). The creator edits subject /
   body / delay and toggles enabled; a background sweeper evaluates
   triggers and sends through the same tracked delivery rail as
   campaigns (the automation's carrier campaign holds the deliveries).

   Trigger sources are rows the house already keeps — never invented:
     post_purchase       — shop_events 'sale' rows (paid truth, buyer
                           email on the row) + digital_sales completed
                           rows (buyer email resolved through the auth
                           rail, the same lookup Stripe Connect uses)
     abandoned_checkout  — shop_events 'pending_sale' rows that never
                           flip to 'sale' (the shop card checkout records
                           a pending row at start) + abandoned_checkouts
                           rows (migration 0204): the store + storefront
                           card checkouts record nothing at start, so the
                           central webhook files their
                           checkout.session.expired events there instead;
                           buyer email resolved through the auth rail.
     membership_winback  — fan_members rows in canceled / expired. */

export const EMAIL_AUTOMATION_KINDS = ["post_purchase", "abandoned_checkout", "membership_winback"] as const;
export type EmailAutomationKind = (typeof EMAIL_AUTOMATION_KINDS)[number];

export const emailAutomationsTable = pgTable("email_automations", {
  id:        uuid("id").primaryKey().defaultRandom(),
  listId:    uuid("list_id").notNull().references(() => emailListsTable.id, { onDelete: "cascade" }),
  kind:      text("kind").notNull().$type<EmailAutomationKind>(),
  enabled:   boolean("enabled").notNull().default(false),
  subject:   text("subject").notNull(),
  body:      text("body").notNull(),
  /* Hours between the trigger event and the send. 0 = next sweep. */
  delayHours: integer("delay_hours").notNull().default(24),
  /* The most recent carrier campaign this series sent through.
     Carriers are minted PER SEND (deliveries are unique per
     campaign+subscriber, and every physical email needs its own
     delivery row/token), each snapshotting the automation's current
     subject/body — so edits never need syncing, and this column is
     a latest pointer, not the series' single home. */
  campaignId: uuid("campaign_id").references(() => emailCampaignsTable.id, { onDelete: "set null" }),
  /* When the creator last switched this automation ON. Triggers older
     than this never fire — enabling an automation doesn't spam fans
     about things that happened before it existed. */
  enabledAt: timestamp("enabled_at", { withTimezone: true }),
  /* When the sweeper last evaluated this automation (set every run,
     sends or not — the honest "last checked" the UI shows). */
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("email_automations_list_kind_ux").on(t.listId, t.kind),
]);

export type EmailAutomation = typeof emailAutomationsTable.$inferSelect;

/* One row per (automation, trigger event) the runner has claimed. The
   unique index IS the dedupe law: a fan can never receive the same
   automation for the same purchase / checkout / lapse twice, however
   many times the sweeper runs. Rows are written for subscribers only —
   including the honest 'skipped_unsubscribed' outcome; trigger events
   whose address isn't on the list are not actionable and get no row. */
export const emailAutomationSendsTable = pgTable("email_automation_sends", {
  id:           uuid("id").primaryKey().defaultRandom(),
  automationId: uuid("automation_id").notNull().references(() => emailAutomationsTable.id, { onDelete: "cascade" }),
  subscriberId: uuid("subscriber_id").notNull().references(() => emailSubscribersTable.id, { onDelete: "cascade" }),
  deliveryId:   uuid("delivery_id").references(() => emailCampaignDeliveriesTable.id, { onDelete: "set null" }),
  triggerKind:  text("trigger_kind").notNull().$type<EmailAutomationKind>(),
  /* The dedupe key: shop_sale:<event id> | digital_sale:<sale id> |
     checkout:<checkout group> | stripe_checkout:<session id> |
     member:<fan member id>. */
  triggerRef:   text("trigger_ref").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  /* queued → sent | failed | no_provider | skipped_unsubscribed */
  status:       text("status").notNull().default("queued"),
  sentAt:       timestamp("sent_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("email_automation_sends_dedupe_ux").on(t.automationId, t.triggerRef),
]);

export type EmailAutomationSend = typeof emailAutomationSendsTable.$inferSelect;

/* ─── Abandoned checkouts (migration 0204) ───────────────────────────────
   One row per store / storefront Stripe checkout that expired unpaid,
   filed by the central webhook's checkout.session.expired branch. The
   shop card checkout needs no row here — its pending_sale shop_events
   are its record. The unique stripe_session_id is the replay law: a
   redelivered webhook records nothing twice. The abandoned_checkout
   automation reads these rows per creator profile; the buyer's email
   is NOT stored — it is resolved through the auth rail when the
   sweeper evaluates, exactly like digital_sales triggers. */

export const ABANDONED_CHECKOUT_RAILS = ["storefront", "store"] as const;
export type AbandonedCheckoutRail = (typeof ABANDONED_CHECKOUT_RAILS)[number];

export const abandonedCheckoutsTable = pgTable("abandoned_checkouts", {
  id:              uuid("id").primaryKey().defaultRandom(),
  stripeSessionId: text("stripe_session_id").notNull().unique(),
  /* Which creator-goods rail the session belonged to. */
  rail:            text("rail").notNull().$type<AbandonedCheckoutRail>(),
  /* The creator whose goods were being bought (creator_profiles.id),
     and the signed-in buyer (auth user id — both checkout routes are
     requireAuth, and the session metadata carries both). Plain uuids
     like digital_sales: a deleted profile must never break the
     webhook's insert. */
  profileId:       uuid("profile_id").notNull(),
  buyerUserId:     uuid("buyer_user_id").notNull(),
  /* What was in the cart, for the record: the storefront product id,
     or "<item_kind>:<item_id>" for a digital-store checkout. */
  itemRef:         text("item_ref"),
  amountCents:     integer("amount_cents"),
  /* When the expiry was recorded — the abandonment moment the
     automation's enabled-at and delay gates measure from. */
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AbandonedCheckout = typeof abandonedCheckoutsTable.$inferSelect;

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

export const EMAIL_FREE_SUBSCRIBER_LIMIT = 1000;

export const RESERVED_HANDLES = new Set([
  "admin", "api", "app", "dashboard", "join", "login", "signup",
  "settings", "pricing", "support", "help", "blog", "news",
]);

export function isHandleAvailable(handle: string): boolean {
  return !RESERVED_HANDLES.has(handle.toLowerCase());
}
