import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

/* ── Beat Marketplace ──────────────────────────────────────────────────────
   Producers list beats; artists browse, preview, and license them.
   Listing is free. The site takes a 15% commission on sales (BEAT_SALE_COMMISSION_PCT).
   Payment processing (migration 0132): licenses are bought through a
   Stripe TEST-mode checkout; a license is 'completed' only after the
   checkout session verifies as paid — until then it stays
   'pending_payment' and grants no entitlement. */

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

/* ── Producer-custom license templates (migration 0188) ───────────────────
   BeatStars parity: a producer may define their OWN license templates —
   name, price, and the commercial terms — instead of only the three fixed
   tiers above. The fixed tiers remain the defaults for producers who never
   customize. At purchase, the template's terms are SNAPSHOTTED onto the
   license row (terms_snapshot), exactly like the UGC/promo-card brand-kit
   snapshot discipline: later template edits or deletion never rewrite a
   license that was already sold. */

/** Delivery formats a license can grant (mirrors the tier blurbs:
    basic = MP3, premium = WAV + MP3, exclusive = ownership + stems). */
export const BEAT_LICENSE_FORMATS = ["mp3", "wav_mp3", "wav_mp3_stems", "ownership_stems"] as const;
export type BeatLicenseFormat = (typeof BEAT_LICENSE_FORMATS)[number];

/** The commercial terms of one license offer, as structured fields.
    A null cap means the license does not cap that use (unlimited);
    a null term_years means no fixed term (perpetual). This exact shape
    is what gets snapshotted onto beat_licenses at purchase time. */
export interface BeatLicenseTerms {
  /** Display name of the offer as sold ("Basic", or the template's name). */
  name: string;
  format: BeatLicenseFormat;
  streamsCap: number | null;
  salesCap: number | null;
  musicVideosCap: number | null;
  radioTvAllowed: boolean;
  livePerformancesCap: number | null;
  termYears: number | null;
  territory: string;
  creditLine: string | null;
  /** Free-text extra terms, rendered with the license (the blurb slot). */
  termsNote: string | null;
  isExclusive: boolean;
}

export const beatLicenseTemplatesTable = pgTable("beat_license_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Producer who defined the template. Templates are producer-scoped:
      a template can only be sold on that producer's own beats. */
  producer_id: uuid("producer_id").notNull(),
  name: text("name").notNull(),
  /** Producer's own price for this license, integer cents. The platform
      fee math (15%) applies to it exactly as it does to tier prices. */
  price_cents: integer("price_cents").notNull(),
  /** Exclusive templates sell once per beat, under the same atomic
      claim machinery as the fixed exclusive tier. */
  is_exclusive: boolean("is_exclusive").notNull().default(false),
  format: text("format").notNull().default("mp3"),
  streams_cap: integer("streams_cap"),
  sales_cap: integer("sales_cap"),
  music_videos_cap: integer("music_videos_cap"),
  radio_tv_allowed: boolean("radio_tv_allowed").notNull().default(false),
  live_performances_cap: integer("live_performances_cap"),
  term_years: integer("term_years"),
  territory: text("territory").notNull().default("Worldwide"),
  credit_line: text("credit_line"),
  terms_note: text("terms_note"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("beat_license_templates_producer_idx").on(t.producer_id),
]);

export const insertBeatLicenseTemplateSchema = createInsertSchema(beatLicenseTemplatesTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export const selectBeatLicenseTemplateSchema = createSelectSchema(beatLicenseTemplatesTable);

export type BeatLicenseTemplate = typeof beatLicenseTemplatesTable.$inferSelect;
export type NewBeatLicenseTemplate = typeof beatLicenseTemplatesTable.$inferInsert;

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
   Records an artist's license acquisition. Every row starts as
   status='pending_payment'; the ONLY path to 'completed' is a verified
   paid checkout session (POST /api/beats/license/verify). The honesty
   contract is enforced by tests. */

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
  /** Custom template this license was bought under (migration 0188), or
      NULL for the three fixed tiers. Informational only — the binding
      record of what was sold is terms_snapshot; the FK nulls on template
      deletion so a sold license is never cascade-erased. */
  template_id: uuid("template_id").references(() => beatLicenseTemplatesTable.id, { onDelete: "set null" }),
  /** The license terms EXACTLY as sold (BeatLicenseTerms), snapshotted
      at purchase. Template edits/deletes and later tier changes never
      mutate this column on an existing row. */
  terms_snapshot: jsonb("terms_snapshot").$type<BeatLicenseTerms>(),
  /** Price paid in integer cents (before commission split). */
  price_cents: integer("price_cents").notNull(),
  /** Site commission in integer cents. */
  commission_cents: integer("commission_cents").notNull().default(0),
  status: text("status").notNull().default("pending_payment"),
  /* Checkout session that pays for this license — the idempotency key:
     one session can complete at most one license row. */
  stripe_session_id: text("stripe_session_id"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("beat_licenses_stripe_session_ux").on(t.stripe_session_id),
]);

export const insertBeatLicenseSchema = createInsertSchema(beatLicensesTable).omit({
  id: true,
  created_at: true,
});

export const selectBeatLicenseSchema = createSelectSchema(beatLicensesTable);

export type BeatLicense = typeof beatLicensesTable.$inferSelect;
