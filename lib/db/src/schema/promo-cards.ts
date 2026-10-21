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

/* The creator's brand kit as read at generation time (Stack-4 wave-2
   #4, migration 0181) — the promo-card sibling of UGC's brand
   snapshot (migration 0164). The four core fields mirror
   UgcBrandSnapshot exactly (brandName / logoUrl / primaryColor /
   vibe, same derivation in the route); colors and fonts ride in
   full because the card composer burns text and frames with them —
   the palette styles the background prompt + headline/frame accent
   and the lead font pairing resolves to a bundled face where one
   exists. It is a SNAPSHOT: values are copied at generation time, so
   editing the kit afterwards never mutates already-generated cards.
   Null when the creator had no kit (generation then behaves exactly
   as it did before the kit was wired in). */
export interface PromoCardBrandSnapshot {
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  vibe: string | null;
  colors: Array<{ hex: string; name: string; role: string }>;
  fonts: Array<{ heading: string; body: string; usage: string }>;
}

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
  /** The caller's brand kit as read at generation time (0181). */
  brandSnapshot: jsonb("brand_snapshot").$type<PromoCardBrandSnapshot>(),
  width:        integer("width").notNull(),
  height:       integer("height").notNull(),
  platforms:    jsonb("platforms").$type<string[]>().notNull().default([]),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("promo_cards_user_created_idx").on(t.userId, t.createdAt),
  index("promo_cards_job_idx").on(t.jobId),
]);

export type PromoCard = typeof promoCardsTable.$inferSelect;
