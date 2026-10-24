import { pgTable, uuid, text, timestamp, integer, boolean, numeric, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Collab Finder (v1).
   Creators publish a public collab profile (niche, platforms, audience size,
   collab interests) so other creators can discover them. Browsing is free;
   the AI match report (compatibility scoring) costs 1 credit. Sending and
   answering collab requests is free — it's the growth loop, and it's pure
   interface (DB write + read), no compute.

   Outreach message templates are static copy shipped in the frontend (zero
   runtime compute), so proposals stay genuinely free per the pricing rule:
   if it burns compute it charges; if it's just interface it's free. */

export const COLLAB_NICHES = [
  "music",
  "gaming",
  "vlogging",
  "comedy",
  "education",
  "fitness",
  "beauty",
  "tech",
  "cooking",
  "travel",
  "fashion",
  "podcasting",
  "other",
] as const;
export type CollabNiche = (typeof COLLAB_NICHES)[number];

export function isCollabNicheKey(v: unknown): v is CollabNiche {
  return typeof v === "string" && (COLLAB_NICHES as readonly string[]).includes(v);
}

export const COLLAB_PLATFORMS = [
  "tiktok",
  "instagram",
  "youtube",
  "twitch",
  "x",
  "discord",
] as const;
export type CollabPlatform = (typeof COLLAB_PLATFORMS)[number];

export function isCollabPlatformKey(v: unknown): v is CollabPlatform {
  return typeof v === "string" && (COLLAB_PLATFORMS as readonly string[]).includes(v);
}

export const COLLAB_REQUEST_STATUSES = ["pending", "accepted", "declined"] as const;
export type CollabRequestStatus = (typeof COLLAB_REQUEST_STATUSES)[number];

/* One public collab profile per user. */
export const collabProfilesTable = pgTable(
  "collab_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull().unique(),
    display_name: text("display_name").notNull(),
    niche: text("niche").notNull(),
    /* [{ platform: "tiktok", followers: 12000 }] */
    platforms: jsonb("platforms").$type<{ platform: string; followers: number }[]>().notNull().default([]),
    collab_interests: text("collab_interests").notNull().default(""),
    bio: text("bio").notNull().default(""),
    is_public: boolean("is_public").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("collab_profiles_user_id_idx").on(t.user_id),
    index("collab_profiles_niche_idx").on(t.niche),
  ],
);

export const insertCollabProfileSchema = createInsertSchema(collabProfilesTable).omit({
  id: true,
  user_id: true,
  created_at: true,
  updated_at: true,
});
export type InsertCollabProfile = z.infer<typeof insertCollabProfileSchema>;
export type CollabProfile = typeof collabProfilesTable.$inferSelect;

/* Collab requests between creators. Free to send/answer. */
export const collabRequestsTable = pgTable(
  "collab_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    from_user_id: uuid("from_user_id").notNull(),
    to_user_id: uuid("to_user_id").notNull(),
    message: text("message").notNull(),
    status: text("status").notNull().default("pending"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("collab_requests_to_user_id_idx").on(t.to_user_id),
    index("collab_requests_from_user_id_idx").on(t.from_user_id),
  ],
);

export const insertCollabRequestSchema = createInsertSchema(collabRequestsTable).omit({
  id: true,
  from_user_id: true,
  created_at: true,
  updated_at: true,
});
export type InsertCollabRequest = z.infer<typeof insertCollabRequestSchema>;
export type CollabRequest = typeof collabRequestsTable.$inferSelect;

/* ── Co-post author sides (Stack-100 #3, #24) ──────────────────────────────
   ONE Feed post (`posts`, single author column = the initiator) with TWO
   author sides. This table is the second side's record AND the consent
   ledger for both: a row per creator per co-post, with the side's status
   and the moment it accepted. The post itself stays a single row, so its
   likes / replies / reactions exist exactly once — engagement can never
   double-count across the two profiles it appears on.

   *** MIGRATION HELD *** The table is created by migration 0205, written
   out in full in .lane/MIGRATION-NEEDED.md and NOT applied by this lane.
   Until it lands, every co-post write answers an honest 503
   (CO_POST_NOT_READY) and every read path treats a missing table as
   "no co-posts exist yet" — behaviour is byte-identical to today.

   Status machine (pure logic + tests: api-server lib/co-posts.ts):
   author side starts `accepted` (they wrote it), co-author side starts
   `pending`; published ⇔ every side has accepted_at set; `declined`
   (pre-live only) ends it; `withdrawn` removes ONLY that side — the
   other creator keeps the post on their profile. */
export const CO_POST_SIDE_STATUSES = ["pending", "accepted", "declined", "withdrawn"] as const;
export type CoPostSideStatus = (typeof CO_POST_SIDE_STATUSES)[number];

export const postCoAuthorsTable = pgTable(
  "post_co_authors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /* The single shared post. Cascade: deleting the post ends the co-post. */
    post_id: uuid("post_id").notNull(),
    /* Creator profile this side belongs to (FK added in migration 0205
       with ON DELETE CASCADE — kept as a plain column here to avoid an
       import cycle with creator-stories-posts / creator-platform). */
    profile_id: uuid("profile_id").notNull(),
    /* The account behind the profile — routes authorize by user_id. */
    user_id: uuid("user_id").notNull(),
    role: text("role").notNull().default("co_author"), // 'author' | 'co_author'
    status: text("status").notNull().default("pending"), // CO_POST_SIDE_STATUSES
    /* Set the moment this side accepted; KEPT after a later withdrawal —
       "every side has accepted_at" is the publish test. */
    accepted_at: timestamp("accepted_at", { withTimezone: true }),
    responded_at: timestamp("responded_at", { withTimezone: true }),
    withdrawn_at: timestamp("withdrawn_at", { withTimezone: true }),
    /* Provenance: the accepted collab request this co-post grew out of,
       when it was created from one (null for a direct invite). */
    collab_request_id: uuid("collab_request_id"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("post_co_authors_post_profile_uidx").on(t.post_id, t.profile_id),
    index("post_co_authors_post_idx").on(t.post_id),
    index("post_co_authors_profile_status_idx").on(t.profile_id, t.status),
    index("post_co_authors_user_status_idx").on(t.user_id, t.status),
  ],
);

export type PostCoAuthor = typeof postCoAuthorsTable.$inferSelect;

/* ── Co-release sides + agreed splits (Stack-100 #3 Wave 3, co-posts phase 2) ──
   ONE existing item — a distribution release (`item_kind='release'`,
   item_id = distribution_releases.id) or a store product
   (`item_kind='product'`, item_id = store_products.id) — published to
   BOTH creators' profiles, with a royalty split BOTH creators consent
   to before anything publishes. The consent machine is the single
   source: api-server lib/co-releases.ts.

   *** MIGRATION HELD *** Both tables are created by the held migration
   written out in full in .lane/MIGRATION-NEEDED.md (claims 0206, after
   phase 1's held 0205) and NOT applied by this lane. Until it lands,
   every co-release WRITE answers an honest 503 (CO_RELEASE_NOT_READY,
   probe-first — nothing created, nobody notified) and every READ path
   treats a missing table as "no co-releases yet".

   Immutability, enforced in the migration itself: once a co-release
   publishes, agreed_share_pct / agreed_at on the sides and
   published_at on the parent can never be updated (BEFORE UPDATE
   trigger raises). The proposed share_pct stays the pre-publish
   proposal record; attribution reads ONLY the agreed columns. */
export const CO_RELEASE_ITEM_KINDS = ["release", "product"] as const;
export type CoReleaseItemKind = (typeof CO_RELEASE_ITEM_KINDS)[number];
export const CO_RELEASE_SIDE_STATUSES = ["pending", "accepted", "declined", "withdrawn"] as const;
export type CoReleaseSideStatusDb = (typeof CO_RELEASE_SIDE_STATUSES)[number];

export const coReleasesTable = pgTable(
  "co_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /* Polymorphic item pointer — validated at the route against the
       owner's own rows (no FK: two possible target tables). */
    item_kind: text("item_kind").notNull().default("release"), // 'release' | 'product'
    item_id: uuid("item_id").notNull(),
    /* Title snapshot at draft time so profile lists render even if the
       underlying item is later renamed/deleted. */
    item_title: text("item_title").notNull().default(""),
    /* Set exactly once, at the second side's accept — the publish
       moment. Trigger-protected in the held migration. */
    published_at: timestamp("published_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("co_releases_item_idx").on(t.item_kind, t.item_id),
    index("co_releases_published_idx").on(t.published_at),
  ],
);

export const coReleaseSidesTable = pgTable(
  "co_release_sides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    co_release_id: uuid("co_release_id").notNull(),
    profile_id: uuid("profile_id").notNull(),
    user_id: uuid("user_id").notNull(),
    role: text("role").notNull().default("co_author"), // 'author' | 'co_author'
    status: text("status").notNull().default("pending"), // CO_RELEASE_SIDE_STATUSES
    /* Proposed share (creator-entered %, numeric(5,2) semantics stored
       as numeric string by drizzle) — the proposal BOTH sides see. */
    share_pct: numeric("share_pct", { precision: 5, scale: 2 }).notNull(),
    /* FROZEN agreed share — written once at publish, trigger-protected
       afterwards. Null until published. Attribution reads only this. */
    agreed_share_pct: numeric("agreed_share_pct", { precision: 5, scale: 2 }),
    accepted_at: timestamp("accepted_at", { withTimezone: true }),
    responded_at: timestamp("responded_at", { withTimezone: true }),
    withdrawn_at: timestamp("withdrawn_at", { withTimezone: true }),
    agreed_at: timestamp("agreed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("co_release_sides_release_profile_uidx").on(t.co_release_id, t.profile_id),
    index("co_release_sides_release_idx").on(t.co_release_id),
    index("co_release_sides_profile_status_idx").on(t.profile_id, t.status),
    index("co_release_sides_user_status_idx").on(t.user_id, t.status),
  ],
);

export type CoReleaseRow = typeof coReleasesTable.$inferSelect;
export type CoReleaseSideRow = typeof coReleaseSidesTable.$inferSelect;
