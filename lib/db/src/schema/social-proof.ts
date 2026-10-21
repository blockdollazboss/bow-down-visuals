import { pgTable, uuid, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creatorProfilesTable } from "./creator-platform";

/* Live social-proof cache + visibility prefs (migration 0202, competitor
   C5). One row per creator profile. `figures` is a cache of numbers a
   connected social rail ACTUALLY returned (via the analytics fetchers —
   honest nulls upstream mean absent figures here, never estimates),
   each stamped with its own fetchedAt so the public profile can label
   "Updated <when>" and retire figures that go stale. `hiddenKeys` is
   the creator's per-figure off switch; a live figure shows by default,
   a hidden one shows nowhere. Mirrors migrations/0202_social_proof.sql. */

export interface SocialProofFigure {
  /** Stable figure id, e.g. "instagram.followers" — the visibility key. */
  key: string;
  platform: "instagram" | "tiktok" | "facebook";
  /** social_accounts.id the number came from; disconnect retires it. */
  accountId: string;
  /** Human account label (username or Page name) shown beside the figure. */
  accountLabel: string;
  /** Plain-language figure name, e.g. "Instagram followers". */
  label: string;
  /** The exact number the rail returned — never rounded up, never derived. */
  value: number;
  /** ISO timestamp of the fetch that produced this value. */
  fetchedAt: string;
}

export const creatorSocialProofTable = pgTable(
  "creator_social_proof",
  {
    profileId: uuid("profile_id")
      .primaryKey()
      .references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    figures: jsonb("figures").$type<SocialProofFigure[]>().notNull().default([]),
    hiddenKeys: jsonb("hidden_keys").$type<string[]>().notNull().default([]),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("creator_social_proof_user_idx").on(t.userId)],
);

export const insertCreatorSocialProofSchema = createInsertSchema(creatorSocialProofTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertCreatorSocialProof = z.infer<typeof insertCreatorSocialProofSchema>;
export type CreatorSocialProof = typeof creatorSocialProofTable.$inferSelect;
