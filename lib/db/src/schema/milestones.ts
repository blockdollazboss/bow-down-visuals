import { pgTable, uuid, text, bigint, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ─── Milestone Tracker + Catalog Vault ───────────────────────────────────
   DistroKid RIAA-monitoring / Leave-a-Legacy parity.

   milestones: user-logged or CSV-imported stream/download counts per track
   and platform. HONESTY: there is no live Spotify sync (no distribution
   partner yet), so every row carries a source ('manual' | 'csv') and the UI
   labels it "Log your stream counts from Spotify for Artists — live sync
   needs a distribution partner." Keep in sync with
   lib/db/migrations/0084_milestones.sql.

   catalog_vaults: per-release one-time purchase (200 Visual Bucs) that
   guarantees the release's presave page, showcase entry and assets stay
   live permanently on Bow Down Visuals — our own hosting, a guarantee we
   CAN make. One row per user+release (unique index). */

export const MILESTONE_AWARD_TIERS = [
  "none",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
] as const;
export type MilestoneAwardTier = (typeof MILESTONE_AWARD_TIERS)[number];

export const MILESTONE_SOURCES = ["manual", "csv"] as const;
export type MilestoneSource = (typeof MILESTONE_SOURCES)[number];

export const milestonesTable = pgTable("milestones", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  trackTitle: text("track_title").notNull(),
  artistName: text("artist_name"),
  platform: text("platform").notNull().default("spotify"),
  streamCount: bigint("stream_count", { mode: "number" }).notNull().default(0),
  awardTier: text("award_tier").notNull().default("none"),
  source: text("source").notNull().default("manual"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertMilestoneSchema = createInsertSchema(milestonesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertMilestone = z.infer<typeof insertMilestoneSchema>;
export type Milestone = typeof milestonesTable.$inferSelect;

export const catalogVaultsTable = pgTable("catalog_vaults", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  releaseId: text("release_id").notNull(),
  creditsCharged: integer("credits_charged").notNull().default(0),
  status: text("status").notNull().default("vaulted"),
  vaultedAt: timestamp("vaulted_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertCatalogVaultSchema = createInsertSchema(catalogVaultsTable).omit({
  id: true,
  createdAt: true,
  vaultedAt: true,
});
export type InsertCatalogVault = z.infer<typeof insertCatalogVaultSchema>;
export type CatalogVault = typeof catalogVaultsTable.$inferSelect;
