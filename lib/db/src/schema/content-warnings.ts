import { pgTable, uuid, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Content warnings & sensitive-content labels (Wave 4 #40, migration 0238).
 *
 * The label set is FIXED and small — a creator picks any subset of these
 * for their own post at publish time (or later, author-only). It is the
 * creator's honesty tool, never a moderation weapon: platform moderation
 * (flags / removal) is a separate system, and no other account — fan,
 * admin, or the platform — can add or remove a creator's label.
 *
 *   sensitive        — the generic "sensitive content" label
 *   flashing_lights  — strobing / flicker content (photosensitivity)
 *   mature_themes    — heavy or adult themes
 *   strong_language  — explicit language
 *
 * The label rides posts.content_warnings (jsonb array, creator-stories-
 * posts.ts) and is enforced at READ time in the post DTO (routes/social
 * enrichPosts, the members-gate pattern): a labelled post's media never
 * leaves the server until the viewer taps to reveal that one item.
 */
export const CONTENT_WARNING_LABELS = [
  "sensitive",
  "flashing_lights",
  "mature_themes",
  "strong_language",
] as const;
export type ContentWarningLabel = (typeof CONTENT_WARNING_LABELS)[number];

export function isContentWarningLabel(v: unknown): v is ContentWarningLabel {
  return typeof v === "string" && (CONTENT_WARNING_LABELS as readonly string[]).includes(v);
}

/** Keep only known labels, deduped, in canonical set order. */
export function normalizeContentWarnings(v: unknown): ContentWarningLabel[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set(v.filter(isContentWarningLabel));
  return CONTENT_WARNING_LABELS.filter((l) => seen.has(l));
}

/**
 * A viewer's own content-warning preference (migration 0238): the labels
 * THEY have chosen to always hide entirely from their own feeds, instead
 * of the standard cover-and-tap-to-reveal. One row per member, keyed by
 * user — the routes only ever read and write the caller's own row.
 *
 * STRICTER ONLY, by construction: the default (no row / empty list) is
 * the creator's label at full strength — covered until tapped. The only
 * direction this preference moves is MORE protective for the viewer
 * themselves (hide instead of cover). There is deliberately no setting
 * that loosens another creator's label.
 */
export const contentWarningPreferencesTable = pgTable("content_warning_preferences", {
  userId:       uuid("user_id").primaryKey(),
  hiddenLabels: jsonb("hidden_labels").$type<ContentWarningLabel[]>().notNull().default([]),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ContentWarningPreferences = typeof contentWarningPreferencesTable.$inferSelect;
