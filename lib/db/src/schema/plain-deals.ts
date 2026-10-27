import { pgTable, uuid, text, timestamp, numeric, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";

/* ─── Plain-Words Deals (Stack-200 upgrade #164) ──────────────────────────
   A collab agreement two creators WRITE in plain words (what each side
   does / gets), sign in-app, and — at full signature — have its split
   wired into the EXISTING rails by routes/plain-deals.ts: a co-release
   for a release/product, the product's sale-splits list for a store or
   shop product. These tables hold the deal itself; they are NOT a
   second splits machine. The pure machine is
   artifacts/api-server/src/lib/plain-deals.ts.

   plain_deals is the head: the frozen facts live here — agreed_shares
   + signed_text + signed_at are written exactly once, in the request
   that completes the second signature, and never mutate after
   (a different deal is a new deal). split_attach records which rail
   the frozen split was wired into ({ rail, refId, at }) or null when
   the deal names no attachable item (general) or wiring hasn't run.

   plain_deal_sides is one row per creator (exactly two): their plain
   words, their PROPOSED share while unsigned, and their signature
   state. Statuses mirror PLAIN_DEAL_SIDE_STATUSES in the lib machine.

   Tables land via the PROVISIONAL migration
   lib/db/migrations/9999-plain-deals.sql; until it is applied, write
   routes answer 503 plain_deal_not_ready and reads degrade to empty
   (the lib's isMissingPlainDealTable guard). */

export interface PlainDealAgreedShare {
  profileId: string;
  userId: string;
  sharePct: number;
}

export interface PlainDealSplitAttachRecord {
  rail: "co_release" | "sale_splits";
  refId: string;
  at: string;
}

export const plainDealsTable = pgTable(
  "plain_deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /* What the collab is, in plain words ("Our song 'Midnight Run'"). */
    title: text("title").notNull().default(""),
    /* 'release' | 'product' | 'store_product' | 'shop_product' | 'general'
       (PLAIN_DEAL_ITEM_KINDS in the lib machine). */
    item_kind: text("item_kind").notNull().default("general"),
    /* Polymorphic item pointer — validated at the route against the
       author's own rows (no FK: several possible target tables).
       Null for a general deal that names no item yet. */
    item_id: uuid("item_id"),
    /* Title snapshot at draft time so lists render even if the
       underlying item is later renamed/deleted. */
    item_title: text("item_title").notNull().default(""),
    /* FROZEN at full signature: the agreed split snapshot. Null until
       both sides sign; never changes after. */
    agreed_shares: jsonb("agreed_shares").$type<PlainDealAgreedShare[] | null>(),
    /* FROZEN at full signature: the exact agreement text both sides
       signed (renderPlainDealText). Null until signed. */
    signed_text: text("signed_text"),
    /* Set exactly once, at the second side's signature. */
    signed_at: timestamp("signed_at", { withTimezone: true }),
    /* Which existing rail the frozen split was wired into at signing
       ({ rail: 'co_release' | 'sale_splits', refId, at }) — null when
       the deal is record-only (general, or attach pending/failed). */
    split_attach: jsonb("split_attach").$type<PlainDealSplitAttachRecord | null>(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("plain_deals_item_idx").on(t.item_kind, t.item_id),
    index("plain_deals_signed_idx").on(t.signed_at),
    index("plain_deals_created_idx").on(t.created_at),
  ],
);

export const plainDealSidesTable = pgTable(
  "plain_deal_sides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    plain_deal_id: uuid("plain_deal_id").notNull(),
    profile_id: uuid("profile_id").notNull(),
    user_id: uuid("user_id").notNull(),
    role: text("role").notNull().default("partner"), // 'author' | 'partner'
    status: text("status").notNull().default("pending"), // PLAIN_DEAL_SIDE_STATUSES
    /* This side's plain words — written by the author, signed by both. */
    does_text: text("does_text").notNull().default(""),
    gets_text: text("gets_text").notNull().default(""),
    /* Creator-entered share %, numeric(5,2) semantics stored as a
       numeric string by drizzle — validated by the co-releases
       machine's validateSplit (sums to 100 across both sides). */
    share_pct: numeric("share_pct", { precision: 5, scale: 2 }).notNull(),
    /* The typed in-app signature and when it was given. Null while
       this side is unsigned (and reset to null when an author amend
       un-signs the partner). */
    signed_name: text("signed_name"),
    signed_at: timestamp("signed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("plain_deal_sides_deal_profile_uidx").on(t.plain_deal_id, t.profile_id),
    index("plain_deal_sides_deal_idx").on(t.plain_deal_id),
    index("plain_deal_sides_profile_status_idx").on(t.profile_id, t.status),
    index("plain_deal_sides_user_status_idx").on(t.user_id, t.status),
  ],
);

export type PlainDealRow = typeof plainDealsTable.$inferSelect;
export type PlainDealSideRow = typeof plainDealSidesTable.$inferSelect;
