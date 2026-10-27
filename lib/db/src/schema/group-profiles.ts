import { pgTable, uuid, text, boolean, jsonb, timestamp, check, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { teamsTable } from "./teams";
import type { ProductSplit } from "./sale-splits";

/* ── Duo/Group public profiles (Stack-200 UPGRADE N20) ─────────────────
   The PUBLIC half of a team. The internal half already exists: teams +
   team_members (lib/teams.ts — creation, invites, roles, shared credit
   pool) and the money half (lib/sale-splits.ts — a product's splits list
   dividing its net at fulfillment, flat 5% platform fee off the top
   first).

   A group profile is ONE public creator identity bound 1:1 to a team:
   one page under the group name, members credited, and the group's
   WRITTEN split terms on display. The terms are a ProductSplit list
   validated by the same sum-to-100 machine as product splits, with the
   team owner holding a share; every account in the list must be an
   ACTIVE member of the bound team (enforced in lib/group-profiles.ts).

   The shared store: store_products.group_profile_id marks the products
   sold under the group name. Creating one stamps the group's split
   terms onto the product's own `splits` column, so the EXISTING
   sale-splits rail divides those sales — there is no second money path.
   The product's profile_id stays the team owner's creator profile,
   which keeps checkout, orders and delivery exactly as they are. */

export const groupProfilesTable = pgTable("group_profiles", {
  id:          uuid("id").primaryKey().defaultRandom(),
  teamId:      uuid("team_id").notNull().unique().references(() => teamsTable.id, { onDelete: "cascade" }),
  /** Public URL handle: /group/<slug>. Lowercase letters, numbers, dashes. */
  slug:        text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  bio:         text("bio").notNull().default(""),
  avatarUrl:   text("avatar_url"),
  bannerUrl:   text("banner_url"),
  /** Draft until the group says otherwise — an unpublished group has no
   *  public page and no public store listing. */
  isPublished: boolean("is_published").notNull().default(false),
  /** The group's written split terms: [{ userId, sharePct }] summing to
   *  exactly 100, team owner included, active team members only. Null =
   *  no written terms yet (group store products then carry no splits). */
  splitTerms:  jsonb("split_terms").$type<ProductSplit[] | null>(),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("group_profiles_slug_check", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'`),
  uniqueIndex("group_profiles_slug_ux").on(t.slug),
  index("group_profiles_published_idx").on(t.isPublished),
]);

export const insertGroupProfileSchema = createInsertSchema(groupProfilesTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertGroupProfile = z.infer<typeof insertGroupProfileSchema>;
export type GroupProfile = typeof groupProfilesTable.$inferSelect;
