import { pgTable, uuid, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { creatorProfilesTable } from "./creator-platform";

/**
 * Fan Art Wall (Stack-200, owner idea batch 4 #157 — TRULY NEW).
 *
 * Fans submit art FOR a creator; the pieces live in that creator's
 * profile GALLERY block (block type "gallery"). This is NOT Showcase
 * (a creator's own work) — every row here is fan-made, and the artist
 * is a different person from the profile owner.
 *
 * APPROVAL GATE (the whole point): a piece is born status='pending'
 * and NOTHING displays publicly until the creator approves THAT piece
 * (per-piece approval). The public read filters status='approved' in
 * the store layer — there is no code path that lists a pending,
 * rejected, or revoked piece publicly.
 *
 * REVOCATION: approve → revoke flips an approved piece to 'revoked'
 * and it disappears from the public wall immediately (same filter).
 * The creator may approve a revoked piece again (undo) — still a
 * per-piece, creator-only act.
 *
 * ARTIST CREDIT IS NEVER STRIPPED: artist_user_id + an artist_name
 * snapshot (taken at submit time) ride every row and every DTO, in
 * every state — pending, approved, rejected, revoked. A rename or a
 * deleted profile never erases who made the piece.
 *
 * NO PRICES: submitting, approving, and displaying fan art is free —
 * no charge rail, no Visual Bucs, no real money anywhere in this lane.
 *
 * Migration: lib/db/migrations/9999-fan-art-wall.sql (PROVISIONAL
 * number — renumber at join time).
 */
export const FAN_ART_STATUSES = ["pending", "approved", "rejected", "revoked"] as const;
export type FanArtStatus = (typeof FAN_ART_STATUSES)[number];

export const fanArtPiecesTable = pgTable(
  "fan_art_pieces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The creator whose Gallery wall this piece is submitted to. */
    creatorProfileId: uuid("creator_profile_id")
      .notNull()
      .references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    /** The fan who made it. Never the profile owner (enforced in the
     *  service layer: fan art is by definition someone else's work). */
    artistUserId: uuid("artist_user_id").notNull(),
    /** Artist credit snapshot at submit time — kept on every DTO in
     *  every state, even if the artist later renames or deletes
     *  their profile. Credit is never stripped. */
    artistName: text("artist_name").notNull().default("A fan"),
    title: text("title").notNull(),
    /** The submitted artwork itself (the fan's hosted image URL). */
    imageUrl: text("image_url").notNull(),
    /** Optional note from the artist to the creator. */
    note: text("note").notNull().default(""),
    status: text("status").notNull().default("pending").$type<FanArtStatus>(),
    /** The creator's per-piece decision stamp (approve/reject/revoke). */
    reviewedByUserId: uuid("reviewed_by_user_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fan_art_pieces_wall_idx").on(t.creatorProfileId, t.status, t.createdAt),
    index("fan_art_pieces_artist_idx").on(t.artistUserId, t.createdAt),
    check(
      "fan_art_pieces_status_check",
      sql`${t.status} IN ('pending', 'approved', 'rejected', 'revoked')`,
    ),
  ],
);

export type FanArtPieceRow = typeof fanArtPiecesTable.$inferSelect;
export type InsertFanArtPiece = typeof fanArtPiecesTable.$inferInsert;
