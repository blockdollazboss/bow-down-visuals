import { pgTable, uuid, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/* Release promo cards (STACK-20 R2 #17, migration 0161): ONE row per
   generated card. Until this table existed, a generated pack lived
   only in the POST /api/promo-cards response and as a storage object
   — the creator could never see a past card again, because nothing on
   the server kept the record. The generation route now writes one row
   per card in the same request that mints it; the history list and
   the per-card delete read/write ONLY the caller's rows.
   The image itself stays in permanent storage — storage_ref is the
   stable ref (r2:// or supabase://), and read paths mint a fresh
   playable URL from it on every read, never the stored URL. Deleting
   a card deletes the ROW only; the storage object is never purged
   from here (files law: media is removed deliberately, not as a
   side effect of tidying a list). */
export const promoCardsTable = pgTable("promo_cards", {
  id:           uuid("id").primaryKey().defaultRandom(),
  userId:       uuid("user_id").notNull(),
  /** One generation request mints one pack; jobId groups its cards. */
  jobId:        text("job_id").notNull(),
  style:        text("style").notNull(),
  size:         text("size").notNull(),
  storageRef:   text("storage_ref").notNull(),
  releaseTitle: text("release_title").notNull(),
  artistName:   text("artist_name").notNull(),
  /** The caption suggested for the pack at generation time. */
  caption:      text("caption"),
  width:        integer("width").notNull(),
  height:       integer("height").notNull(),
  platforms:    jsonb("platforms").$type<string[]>().notNull().default([]),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("promo_cards_user_created_idx").on(t.userId, t.createdAt),
  index("promo_cards_job_idx").on(t.jobId),
]);

export type PromoCard = typeof promoCardsTable.$inferSelect;
