import { pgTable, uuid, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

/**
 * Producer tags — the creator's ONE signature tag (#159 Your Own Tag).
 *
 * Lifecycle: a generated tag starts as a `draft` (free to audition — the
 * approve-by-ear gate). Approving a draft charges the tag price (100 VB)
 * unless it is the creator's FIRST approved tag, which is the house gift
 * (price_charged = 0). The approved draft becomes `active`; the previous
 * active tag is demoted to `replaced`. One active tag per creator.
 *
 * `kind`: "spoken" (the original TTS tag) or "sonic" (the musical
 * two-second sonic-logo form).
 *
 * `stampEnabled` is the per-creator export-stamping preference, carried
 * on the tag rows: approving a new tag inherits the previous active
 * tag's setting, and the settings endpoint updates the active row.
 */
export const producerTagsTable = pgTable("producer_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  kind: text("kind").notNull().default("spoken"),
  text: text("text"),
  voice: text("voice"),
  preset: text("preset"),
  format: text("format").notNull().default("mp3"),
  audioUrl: text("audio_url"),
  storageRef: text("storage_ref"),
  status: text("status").notNull().default("draft"),
  stampEnabled: boolean("stamp_enabled").notNull().default(true),
  priceCharged: integer("price_charged").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
});
