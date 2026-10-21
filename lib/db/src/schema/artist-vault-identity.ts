import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Identity Set photos for an artist vault character (migration 0196,
   Higgsfield G4 — the honest near-term form of a trained identity).
   A vault character used to hold exactly ONE reference_image_url; an
   identity set lets the character hold several photos of the SAME
   character, each labeled by angle / expression / wardrobe, so the
   generation rail can pick the best-matching reference per shot instead
   of forcing every shot through the one photo.

   Discipline (character lock):
   - Photos are the creator's OWN uploads (source 'upload'). An
     AI-generated portrait may be added only when it is explicitly
     labeled source 'generated' — generated faces never enter a set
     silently, and the UI badges them.
   - NO model is trained on these photos and nothing here pretends
     otherwise; the set is disciplined reference selection only.
   - user_id is denormalized from the vault so every query can stay
     owner-scoped without a join (the forum-channels pattern).
   - Soft delete only (deleted_at), like the vault itself: user data
     is never hard-deleted. The image object in storage is never
     touched by a delete. */
export const artistVaultIdentityPhotosTable = pgTable("artist_vault_identity_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  vault_id: uuid("vault_id").notNull(),
  user_id: uuid("user_id").notNull(),
  image_url: text("image_url").notNull(),
  image_path: text("image_path"),
  /* Shot labels — the vocabularies live in the API server's
     lib/identity-set.ts (IDENTITY_ANGLES / IDENTITY_EXPRESSIONS) and
     are enforced by zod at the route; stored as plain text so new
     labels never need a migration. */
  angle: text("angle").notNull().default("front"),
  expression: text("expression").notNull().default("neutral"),
  /* Free-text wardrobe label (e.g. "stage outfit") so a shot wearing
     an outfit can prefer the photo shot in it. */
  wardrobe: text("wardrobe"),
  /* 'upload' = the creator's own photo. 'generated' = an AI-generated
     portrait, admitted only with the label on. */
  source: text("source").notNull().default("upload"),
  sort_order: integer("sort_order").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});

export const insertArtistVaultIdentityPhotoSchema = createInsertSchema(artistVaultIdentityPhotosTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
  deleted_at: true,
});

export const selectArtistVaultIdentityPhotoSchema = createSelectSchema(artistVaultIdentityPhotosTable);

export type ArtistVaultIdentityPhotoRow = typeof artistVaultIdentityPhotosTable.$inferSelect;
export type InsertArtistVaultIdentityPhoto = z.infer<typeof insertArtistVaultIdentityPhotoSchema>;
