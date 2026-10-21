import { pgTable, uuid, text, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

/* ── Back-catalog migration assistant (migration 0199) ───────────────────
   One row per piece of a creator's existing body of work that is on its
   way home: either LISTED from one of their already-connected social
   accounts (sourceKind 'connected' — Instagram/Facebook today; TikTok's
   granted scopes cannot read a catalog and park honestly, so no TikTok
   rows are ever created) or REGISTERED from a bulk upload of their own
   files (sourceKind 'upload').

   The row is the unit of progress the creator watches: listed → fetching
   → here (the file is on Bow Down storage and a draft library row exists)
   → ready (an AI rebuild draft is waiting for review) → approved (the
   draft was applied; videos publish). 'blocked' means the platform would
   not hand over the file — statusNote says so in plain words, and nothing
   is ever scraped around it. 'failed' is a fetch that can be retried.
   'dismissed' keeps a listed item from resurrecting on the next scan.

   Only the creator's OWN content ever lands here: connected rows are
   created exclusively from the caller's own social_accounts rows, upload
   rows exclusively from R2 keys under the caller's own prefix. Nothing
   in this table represents an audience — followers do not transfer, and
   no column pretends otherwise. */

export type CatalogImportSourceKind = "connected" | "upload";
export type CatalogImportPlatform = "instagram" | "facebook" | "tiktok";
export type CatalogImportKind = "video" | "audio";
export type CatalogImportStatus =
  | "listed"
  | "fetching"
  | "here"
  | "ready"
  | "approved"
  | "blocked"
  | "failed"
  | "dismissed";

export interface CatalogImportDraftNote {
  /** Which part of the rebuild this note is about. */
  part: "title" | "description" | "captions" | "chapters" | "thumbnail" | "series";
  state: "done" | "skipped";
  /** Plain-language reason when skipped — the creator sees this. */
  reason?: string;
}

export interface CatalogImportChapter {
  atSec: number;
  label: string;
}

/** The AI rebuild draft: what re-uploading used to lose, proposed for the
    creator's approval. NOTHING in a draft is live until approve applies
    it. `source` is honest about provenance: 'ai' when the AI rail wrote
    the words, 'assembled' when it was off and the draft is a cleaned-up
    pass over the creator's own original title/caption. */
export interface CatalogImportDraft {
  title: string;
  description: string;
  tags: string[];
  /** Transcript/caption text from the Scribe rail, when it ran. */
  captions: string | null;
  chapters: CatalogImportChapter[];
  /** Series grouping suggestion (deterministic, from the title). */
  series: { name: string; season: number; episode: number } | null;
  notes: CatalogImportDraftNote[];
  source: "ai" | "assembled";
}

export const catalogImportItemsTable = pgTable(
  "catalog_import_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    sourceKind: text("source_kind").notNull().$type<CatalogImportSourceKind>(),
    /** NULL for uploads (the creator's own files name no platform). */
    platform: text("platform").$type<CatalogImportPlatform | null>(),
    /** The caller's own social_accounts row this item was listed from. */
    socialAccountId: uuid("social_account_id"),
    /** The platform's own media id — the dedupe key with (user, platform):
        a re-scan refreshes the row instead of duplicating it, and an
        item already home is never listed as new again. */
    externalId: text("external_id"),
    kind: text("kind").notNull().$type<CatalogImportKind>(),
    /** The original title/caption first line, or the upload's filename. */
    title: text("title").notNull(),
    /** The full original caption/description from the platform — the
        seed the rebuild draft's description is rebuilt from. NULL for
        uploads (a file brings no caption with it). */
    originalCaption: text("original_caption"),
    /** Permalink on the platform — provenance, shown as "view original". */
    originalUrl: text("original_url"),
    /** The platform's file URL captured at scan time. These expire; a
        re-scan refreshes them. Never shown to the creator. */
    remoteFileUrl: text("remote_file_url"),
    remoteThumbnailUrl: text("remote_thumbnail_url"),
    /** Bow Down (R2) public URL once the file is here. */
    mediaUrl: text("media_url"),
    /** R2 key of our copy of the file. */
    storageKey: text("storage_key"),
    /** R2 key of our copy of the platform thumbnail, when one came over. */
    thumbnailUrl: text("thumbnail_url"),
    durationSec: integer("duration_sec"),
    status: text("status").notNull().default("listed").$type<CatalogImportStatus>(),
    /** Plain-language reason for blocked/failed states. */
    statusNote: text("status_note"),
    draft: jsonb("draft").$type<CatalogImportDraft | null>(),
    /** The library row this item feeds once the file is here. */
    targetKind: text("target_kind").$type<"profile_video" | "song" | null>(),
    targetId: uuid("target_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("catalog_import_items_user_idx").on(t.userId, t.status),
    index("catalog_import_items_account_idx").on(t.socialAccountId),
    uniqueIndex("catalog_import_items_dedupe_ux").on(t.userId, t.platform, t.externalId),
  ],
);

export const insertCatalogImportItemSchema = createInsertSchema(catalogImportItemsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CatalogImportItem = typeof catalogImportItemsTable.$inferSelect;
export type NewCatalogImportItem = typeof catalogImportItemsTable.$inferInsert;
