import { pgTable, uuid, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

/* ── Beat Marketplace ──────────────────────────────────────────────────────
   Producers list beats; artists browse, preview, and license them.
   Listing is free. The site takes a 15% commission on sales (BEAT_SALE_COMMISSION_PCT).
   v1 honesty: license "purchase" records intent only — payment processing is
   coming soon, so no money actually moves yet. */

/** License tiers available on every beat. Prices in integer cents. */
export const BEAT_LICENSE_TIERS = ["basic", "premium", "exclusive"] as const;
export type BeatLicenseTier = (typeof BEAT_LICENSE_TIERS)[number];

/** Site commission on beat sales (percent, integer). */
export const BEAT_SALE_COMMISSION_PCT = 15;

export const beatsTable = pgTable("beats", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Producer who listed the beat. */
  user_id: uuid("user_id").notNull(),
  title: text("title").notNull(),
  /** Public URL of the full audio file (MP3/WAV). */
  audio_url: text("audio_url").notNull(),
  /** Supabase storage path for the audio file. */
  audio_path: text("audio_path"),
  /** Public URL of the watermarked preview (shorter / tagged). Falls back to audio_url. */
  preview_url: text("preview_url"),
  genre: text("genre").notNull().default("hip-hop"),
  bpm: integer("bpm"),
  /** Musical key, e.g. "C min", "F# maj". */
  musical_key: text("musical_key"),
  /** Free-form mood tags: ["dark", "aggressive", ...]. */
  mood_tags: text("mood_tags").array().notNull().default([]),
  description: text("description"),
  /** License prices in integer cents. */
  basic_price_cents: integer("basic_price_cents").notNull().default(2999),
  premium_price_cents: integer("premium_price_cents").notNull().default(9999),
  exclusive_price_cents: integer("exclusive_price_cents").notNull().default(49999),
  /** Exclusive licenses can only be sold once. */
  exclusive_sold: boolean("exclusive_sold").notNull().default(false),
  plays: integer("plays").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBeatSchema = createInsertSchema(beatsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
  plays: true,
  exclusive_sold: true,
});

export const selectBeatSchema = createSelectSchema(beatsTable);

export type Beat = typeof beatsTable.$inferSelect;
export type NewBeat = typeof beatsTable.$inferInsert;

/* ── Beat license purchases ────────────────────────────────────────────────
   Records an artist's license acquisition. v1: payment is "coming soon",
   so every row starts as status='pending_payment' — never 'completed'.
   The honesty contract is enforced by tests: no code path may write
   status='completed' until real payment processing ships. */

export const BEAT_LICENSE_STATUSES = ["pending_payment", "completed", "refunded"] as const;
export type BeatLicenseStatus = (typeof BEAT_LICENSE_STATUSES)[number];

export const beatLicensesTable = pgTable("beat_licenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  beat_id: uuid("beat_id").notNull().references(() => beatsTable.id, { onDelete: "cascade" }),
  /** Buyer (artist). */
  buyer_id: uuid("buyer_id").notNull(),
  /** Producer (seller) — denormalized from the beat for dashboard queries. */
  producer_id: uuid("producer_id").notNull(),
  tier: text("tier").notNull(),
  /** Price paid in integer cents (before commission split). */
  price_cents: integer("price_cents").notNull(),
  /** Site commission in integer cents. */
  commission_cents: integer("commission_cents").notNull().default(0),
  status: text("status").notNull().default("pending_payment"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBeatLicenseSchema = createInsertSchema(beatLicensesTable).omit({
  id: true,
  created_at: true,
});

export const selectBeatLicenseSchema = createSelectSchema(beatLicensesTable);

export type BeatLicense = typeof beatLicensesTable.$inferSelect;
