import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Global Drop (#165) — UPGRADE of Translate & Dub.
 *
 * One package per music RELEASE (distribution_releases): the five
 * launch-language versions of the release, assembled in one tap.
 * Each version is a first-class record — { language, sourceTitle,
 * translatedTitle, url, status } — that the creator REVIEWS one by
 * one (draft → approved) before anything publishes. Publishing
 * writes the approved versions' URLs into the release's existing
 * smartlink language routing (smartlink_language_destinations), so
 * an approved version is a real destination on the release's own
 * distribution surface, not a note in a drawer.
 *
 * Honesty rules: the package invents no translations — a version's
 * translatedTitle is the creator's own (entered at review, from
 * their dub/caption work on the existing Translate & Dub rails);
 * its url is the creator's, validated http(s) only. A version with
 * no URL can be approved as a title-only version; publish routes
 * only versions that carry both approval and a URL, and says so.
 *
 * Package status: draft (assembled/reviewing) → active (published
 * at least once). Per-version status lives inside `versions`.
 *
 * Migration: provisional 0285_global_drop.sql (renumbered at join).
 */
export const globalDropPackagesTable = pgTable(
  "global_drop_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    /** 'draft' | 'active' */
    status: text("status").notNull().default("draft"),
    /** The five language versions, keyed by language code:
     *  { es: { language, label, sourceTitle, translatedTitle, url,
     *  status }, ... } — built by lib/global-drop. */
    versions: jsonb("versions").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("global_drop_packages_status_check", sql`${t.status} IN ('draft','active')`),
    uniqueIndex("global_drop_packages_release_idx").on(t.releaseId),
  ],
);

export type GlobalDropPackage = typeof globalDropPackagesTable.$inferSelect;
