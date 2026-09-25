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
  /* Welcome-email automation: sent to every new subscriber (v1: simple
     server-side queue — see the route's honesty notes on deliverability). */
  welcomeSubject: text("welcome_subject"),
  welcomeBody:    text("welcome_body"),
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
  /* v1 tracks opens via a best-effort pixel; honest about its limits. */
  opens:     integer("opens").notNull().default(0),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  subscribedAt: timestamp("subscribed_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertEmailSubscriberSchema = createInsertSchema(emailSubscribersTable)
  .omit({ id: true, subscribedAt: true, opens: true, unsubscribedAt: true })
  .extend({
    email: z.string().email("Enter a valid email address.").max(254),
    name: z.string().max(120).optional(),
  });
export type InsertEmailSubscriber = z.infer<typeof insertEmailSubscriberSchema>;
export type EmailSubscriber = typeof emailSubscribersTable.$inferSelect;

/* ─── Campaigns (newsletters) ──────────────────────────────────────────────
   status: "draft" → "queued" → "sent". v1 sends through a simple
   server-side queue — NOT a dedicated ESP. Deliverability and scale
   limits are disclosed in the UI. */

export const emailCampaignsTable = pgTable("email_campaigns", {
  id:        uuid("id").primaryKey().defaultRandom(),
  listId:    uuid("list_id").notNull().references(() => emailListsTable.id, { onDelete: "cascade" }),
  subject:   text("subject").notNull(),
  body:      text("body").notNull(),
  status:    text("status").notNull().default("draft"),
  sentAt:    timestamp("sent_at", { withTimezone: true }),
  recipientCount: integer("recipient_count").notNull().default(0),
  openCount: integer("open_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertEmailCampaignSchema = createInsertSchema(emailCampaignsTable)
  .omit({ id: true, createdAt: true, sentAt: true, recipientCount: true, openCount: true })
  .extend({
    subject: z.string().min(1, "Subject is required.").max(200),
    body: z.string().min(1, "Body is required.").max(50000),
    status: z.enum(["draft", "queued", "sent"]).default("draft"),
  });
export type InsertEmailCampaign = z.infer<typeof insertEmailCampaignSchema>;
export type EmailCampaign = typeof emailCampaignsTable.$inferSelect;

/* ─── Shared constants ───────────────────────────────────────────────────── */

export const EMAIL_FREE_SUBSCRIBER_LIMIT = 1000;

export const RESERVED_HANDLES = new Set([
  "admin", "api", "app", "dashboard", "join", "login", "signup",
  "settings", "pricing", "support", "help", "blog", "news",
]);

export function isHandleAvailable(handle: string): boolean {
  return !RESERVED_HANDLES.has(handle.toLowerCase());
}
