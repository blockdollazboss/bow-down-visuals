import { pgTable, uuid, text, integer, timestamp, index, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { liveStreamsTable } from "./live-streams";
import { liveChatMessagesTable } from "./live-chat";
import { creatorProfilesTable } from "./creator-platform";

/* Stack 2 — "The stream comes alive" (migration 0133).
   - live_go_live_deliveries: the dedupe ledger for go-live alerts.
     One row per (stream, follower); inserted ON CONFLICT DO NOTHING,
     and only rows that actually land produce a notification, so a
     stream start notifies each follower exactly once.
   - push_subscriptions: browser Push API subscriptions for web-push
     delivery of those alerts.
   - live_stream_tips: fan -> creator Visual Bucs transfers on a live
     stream; the tip's chat row lives in live_chat_messages
     (kind='tip'), and pinned_until marks the active paid pin.
   - live_channel_moderators: moderators appointed per creator
     profile — their powers ride every stream that creator runs.
   - live_viewer_samples: throttled heartbeat samples so the
     post-stream summary can report a real average viewer count. */

export const liveGoLiveDeliveriesTable = pgTable(
  "live_go_live_deliveries",
  {
    stream_id: uuid("stream_id")
      .notNull()
      .references(() => liveStreamsTable.id, { onDelete: "cascade" }),
    follower_user_id: uuid("follower_user_id").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.stream_id, t.follower_user_id] })],
);

export const pushSubscriptionsTable = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("push_subscriptions_user_id_idx").on(t.user_id)],
);

export const liveStreamTipsTable = pgTable(
  "live_stream_tips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stream_id: uuid("stream_id")
      .notNull()
      .references(() => liveStreamsTable.id, { onDelete: "cascade" }),
    tipper_user_id: uuid("tipper_user_id").notNull(),
    creator_user_id: uuid("creator_user_id").notNull(),
    /* Visual Bucs amount (the site's credit unit — displayed as-is). */
    amount_vb: integer("amount_vb").notNull(),
    message_id: uuid("message_id").references(() => liveChatMessagesTable.id, {
      onDelete: "set null",
    }),
    /* When set and in the future, this tip's message is the stream's
       pinned message. A newer qualifying tip replaces the pin by
       expiring the older rows. */
    pinned_until: timestamp("pinned_until", { withTimezone: true }),
    /* Set once the creator's balance has actually been credited; a
       retried tip resumes at the credit step instead of double-paying. */
    creator_credited_at: timestamp("creator_credited_at", { withTimezone: true }),
    idempotency_key: text("idempotency_key").notNull().unique(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("live_stream_tips_stream_created_idx").on(t.stream_id, t.created_at.desc()),
    index("live_stream_tips_stream_pinned_idx").on(t.stream_id, t.pinned_until.desc()),
  ],
);

/* Ticketed live (Wave 4 #31, migration 0231): one row = one fan's
   paid entry to one ticketed stream. The purchase is a fan -> creator
   Visual Bucs transfer built from the same house parts as tips
   (chargeCredits debit + addCreditsAtomic creator credit + strict
   ledger rows), with the platform's cut taken through
   lib/platform-fees feeSplit (PLATFORM_FEE_BPS, flat 5% — the module
   whose header names tickets as a surface it owns).
   Exactly-once is structural, twice over: the charge idempotency key
   is UNIQUE, and (stream_id, buyer_user_id) is UNIQUE — a fan can
   hold at most one ticket per show, so a retry, a double-tap, or a
   second buy with a fresh key can never charge twice or stack seats.
   status: 'active' grants entry; 'refunded' (via the refund unwind in
   lib/live-tickets.ts) revokes it. creator_credited_at mirrors the
   tips discipline: a retried purchase resumes at the credit step
   instead of paying the creator twice. */
export const liveStreamTicketsTable = pgTable(
  "live_stream_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stream_id: uuid("stream_id")
      .notNull()
      .references(() => liveStreamsTable.id, { onDelete: "cascade" }),
    buyer_user_id: uuid("buyer_user_id").notNull(),
    creator_user_id: uuid("creator_user_id").notNull(),
    /* What the fan paid, in Visual Bucs (the listed ticket price). */
    price_vb: integer("price_vb").notNull(),
    /* The platform's cut of price_vb (feeSplit at PLATFORM_FEE_BPS). */
    platform_fee_vb: integer("platform_fee_vb").notNull().default(0),
    /* What the creator was credited: price_vb - platform_fee_vb. */
    creator_net_vb: integer("creator_net_vb").notNull(),
    idempotency_key: text("idempotency_key").notNull().unique(),
    /* 'active' | 'refunded' */
    status: text("status").notNull().default("active"),
    creator_credited_at: timestamp("creator_credited_at", { withTimezone: true }),
    refunded_at: timestamp("refunded_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("live_stream_tickets_stream_buyer_uniq").on(t.stream_id, t.buyer_user_id),
    index("live_stream_tickets_stream_idx").on(t.stream_id, t.created_at.desc()),
    index("live_stream_tickets_buyer_idx").on(t.buyer_user_id),
  ],
);

export const liveChannelModeratorsTable = pgTable(
  "live_channel_moderators",
  {
    profile_id: uuid("profile_id")
      .notNull()
      .references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    moderator_user_id: uuid("moderator_user_id").notNull(),
    appointed_by_user_id: uuid("appointed_by_user_id").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.profile_id, t.moderator_user_id] }),
    index("live_channel_moderators_user_idx").on(t.moderator_user_id),
  ],
);

export const liveViewerSamplesTable = pgTable(
  "live_viewer_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stream_id: uuid("stream_id")
      .notNull()
      .references(() => liveStreamsTable.id, { onDelete: "cascade" }),
    viewer_count: integer("viewer_count").notNull(),
    sampled_at: timestamp("sampled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("live_viewer_samples_stream_sampled_idx").on(t.stream_id, t.sampled_at)],
);

export type LiveStreamTip = typeof liveStreamTipsTable.$inferSelect;
export type LiveStreamTicket = typeof liveStreamTicketsTable.$inferSelect;
export type LiveChannelModerator = typeof liveChannelModeratorsTable.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptionsTable.$inferSelect;
export type LiveViewerSample = typeof liveViewerSamplesTable.$inferSelect;
