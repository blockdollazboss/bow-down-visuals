import { pgTable, uuid, text, integer, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
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
export type LiveChannelModerator = typeof liveChannelModeratorsTable.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptionsTable.$inferSelect;
export type LiveViewerSample = typeof liveViewerSamplesTable.$inferSelect;
