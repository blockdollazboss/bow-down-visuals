import { pgTable, uuid, text, timestamp, integer, boolean, index, jsonb } from "drizzle-orm/pg-core";
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
