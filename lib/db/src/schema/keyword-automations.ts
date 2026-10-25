import { pgTable, uuid, text, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { emailListsTable } from "./email-lists";

/* ─── Keyword automations (migration 0232, Wave 4 #32) ───────────────────
   The ManyChat pattern on our own rails: a creator defines keyword
   rules — when a fan comments the keyword on the creator's post,
   media (shorts / tracks), profile wall, or live chat, the fan
   instantly gets an in-app DM from the creator through the site's own
   messages rail (conversations / messages), and if the rule asks, the
   fan can reply in that DM with an email address that is captured
   into the creator's EXISTING email list (email_subscribers — never a
   new silo).

   Laws:
   - enabled defaults FALSE — nothing ever sends for a creator who
     hasn't switched a rule on (the email_automations law, 0198).
   - A rule never fires on the creator's own comments, and triggers
     only ever come from comment surfaces — never from DMs — so an
     automation can never trigger itself.
   - keyword_automation_events is the audit log the creator reads
     (rule fired, to whom, when, what happened) AND the dedupe
     ledger: its partial unique index makes one fired DM per
     (rule, fan, surface, surface ref) a database fact.
   - keyword_automation_captures holds at most one PENDING email
     capture per (rule, fan) — also a partial unique index. */

export const KEYWORD_AUTOMATION_SURFACES = ["post", "media", "wall", "live"] as const;
export type KeywordAutomationSurface = (typeof KEYWORD_AUTOMATION_SURFACES)[number];

export const KEYWORD_AUTOMATION_EVENT_OUTCOMES = [
  "sent",
  "captured",
  "already_on_list",
  "rate_limited",
  "blocked",
  "failed",
] as const;
export type KeywordAutomationEventOutcome = (typeof KEYWORD_AUTOMATION_EVENT_OUTCOMES)[number];

export const keywordAutomationRulesTable = pgTable("keyword_automation_rules", {
  id:            uuid("id").primaryKey().defaultRandom(),
  creatorUserId: uuid("creator_user_id").notNull(),
  /* The creator's email list an email capture lands in. Required by
     the route whenever capture_email is on; a DM-only rule may leave
     it null. SET NULL if the list is deleted — the rule survives as
     a DM-only rule and captures stop (no list to write to). */
  listId:        uuid("list_id").references(() => emailListsTable.id, { onDelete: "set null" }),
  /* Stored normalized: trimmed, lowercased, a single token. Matching
     is whole-word and case-insensitive (lib/keyword-automations). */
  keyword:       text("keyword").notNull(),
  surfaces:      jsonb("surfaces").$type<KeywordAutomationSurface[]>().notNull().default(["post"]),
  dmBody:        text("dm_body").notNull(),
  captureEmail:  boolean("capture_email").notNull().default(false),
  enabled:       boolean("enabled").notNull().default(false),
  /* When the creator last switched this rule ON. A trigger older than
     this never fires (parity with email_automations). */
  enabledAt:     timestamp("enabled_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:     timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("keyword_automation_rules_creator_idx").on(t.creatorUserId),
]);

export type KeywordAutomationRule = typeof keywordAutomationRulesTable.$inferSelect;

export const keywordAutomationEventsTable = pgTable("keyword_automation_events", {
  id:            uuid("id").primaryKey().defaultRandom(),
  ruleId:        uuid("rule_id").notNull().references(() => keywordAutomationRulesTable.id, { onDelete: "cascade" }),
  creatorUserId: uuid("creator_user_id").notNull(),
  fanUserId:     uuid("fan_user_id").notNull(),
  surface:       text("surface").notNull().$type<KeywordAutomationSurface>(),
  /* The thing commented on: post id, media id, profile id, or stream
     id, as text (the surfaces do not share an id space contract). */
  surfaceRef:    text("surface_ref").notNull(),
  outcome:       text("outcome").notNull().$type<KeywordAutomationEventOutcome>(),
  dmMessageId:   uuid("dm_message_id"),
  capturedEmail: text("captured_email"),
  detail:        text("detail"),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("keyword_automation_events_creator_idx").on(t.creatorUserId, t.createdAt),
  index("keyword_automation_events_rule_idx").on(t.ruleId, t.createdAt),
  uniqueIndex("keyword_automation_events_dedupe_ux")
    .on(t.ruleId, t.fanUserId, t.surface, t.surfaceRef)
    .where(sql`${t.outcome} = 'sent'`),
]);

export type KeywordAutomationEvent = typeof keywordAutomationEventsTable.$inferSelect;

export const KEYWORD_AUTOMATION_CAPTURE_STATUSES = ["pending", "captured", "expired"] as const;
export type KeywordAutomationCaptureStatus = (typeof KEYWORD_AUTOMATION_CAPTURE_STATUSES)[number];

export const keywordAutomationCapturesTable = pgTable("keyword_automation_captures", {
  id:             uuid("id").primaryKey().defaultRandom(),
  ruleId:         uuid("rule_id").notNull().references(() => keywordAutomationRulesTable.id, { onDelete: "cascade" }),
  creatorUserId:  uuid("creator_user_id").notNull(),
  fanUserId:      uuid("fan_user_id").notNull(),
  conversationId: uuid("conversation_id").notNull(),
  status:         text("status").notNull().default("pending").$type<KeywordAutomationCaptureStatus>(),
  capturedEmail:  text("captured_email"),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  capturedAt:     timestamp("captured_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("keyword_automation_captures_pending_ux")
    .on(t.ruleId, t.fanUserId)
    .where(sql`${t.status} = 'pending'`),
  index("keyword_automation_captures_fan_idx").on(t.fanUserId, t.status),
]);

export type KeywordAutomationCapture = typeof keywordAutomationCapturesTable.$inferSelect;
