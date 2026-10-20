import { pgTable, uuid, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ── Press kits (EPKs) ───────────────────────────────────────────────────
   Electronic press kits artists generate and share: bio, photos, top
   tracks, achievements, press quotes, and booking contact — published at
   a public shareable URL (/press/:handle). The AI bio is the only
   compute-burning step (3 credits); all editing is free. */

export interface PressKitTrack {
  title: string;
  url: string;
}

export interface PressKitQuote {
  quote: string;
  source: string;
}

export interface PressKitRelease {
  id: string;
  headline: string;
  /** Full formatted release text (headline, dateline, lede, body, boilerplate, contact). */
  body: string;
  announcementType: string;
  /** 280-char social version. */
  social: string;
  createdAt: string;
}

export const pressKitReleaseSchema = z.object({
  id: z.string().min(1).max(64),
  headline: z.string().min(1).max(200),
  body: z.string().min(1).max(20000),
  announcementType: z.string().min(1).max(40),
  social: z.string().min(1).max(320),
  createdAt: z.string().min(1).max(40),
});

export const pressKitTrackSchema = z.object({
  title: z.string().min(1).max(120),
  url: z.string().url().max(500),
});

export const pressKitQuoteSchema = z.object({
  quote: z.string().min(1).max(500),
  source: z.string().min(1).max(120),
});

/* ── Page layout ─────────────────────────────────────────────────────────
   Which of the public page's sections show, and in what order. The
   public page (/press/:handle) renders exactly six content sections
   under its fixed hero header — bio, achievements, press quotes, top
   tracks, photos, booking & contact — and these keys are those six, in
   the order the page has always rendered them. A kit's saved layout is
   the ordered list of { key, visible } entries; NULL (every kit saved
   before layout editing existed) means the default below: all six
   sections, visible, in canonical order — the historical render. */
export const PRESS_KIT_SECTION_KEYS = [
  "bio",
  "achievements",
  "press_quotes",
  "top_tracks",
  "photos",
  "contact",
] as const;

export type PressKitSectionKey = (typeof PRESS_KIT_SECTION_KEYS)[number];

export interface PressKitLayoutEntry {
  key: PressKitSectionKey;
  visible: boolean;
}

export type PressKitLayout = PressKitLayoutEntry[];

export const pressKitSectionKeySchema = z.enum(PRESS_KIT_SECTION_KEYS);

export const pressKitLayoutSchema = z
  .array(
    z.object({
      key: pressKitSectionKeySchema,
      visible: z.boolean(),
    }),
  )
  .max(PRESS_KIT_SECTION_KEYS.length)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((entry, i) => {
      if (seen.has(entry.key)) {
        ctx.addIssue({
          code: "custom",
          path: [i, "key"],
          message: `Duplicate press-kit section: ${entry.key}`,
        });
      }
      seen.add(entry.key);
    });
  });

export const DEFAULT_PRESS_KIT_LAYOUT: PressKitLayout = PRESS_KIT_SECTION_KEYS.map(
  (key) => ({ key, visible: true }),
);

/** Normalize any stored layout into the full ordered section list the
    public page renders by: saved entries keep their saved order and
    visibility; sections a saved layout never mentions append in
    canonical order, visible; unknown and duplicate keys drop out.
    NULL / non-array → the default layout, byte-for-byte the render
    every kit had before layout editing existed. */
export function resolvePressKitLayout(layout: unknown): PressKitLayout {
  if (!Array.isArray(layout)) return DEFAULT_PRESS_KIT_LAYOUT.map((e) => ({ ...e }));
  const out: PressKitLayout = [];
  const seen = new Set<string>();
  for (const raw of layout) {
    if (!raw || typeof raw !== "object") continue;
    const { key, visible } = raw as { key?: unknown; visible?: unknown };
    if (typeof key !== "string" || seen.has(key)) continue;
    if (!(PRESS_KIT_SECTION_KEYS as readonly string[]).includes(key)) continue;
    seen.add(key);
    out.push({ key: key as PressKitSectionKey, visible: visible !== false });
  }
  for (const key of PRESS_KIT_SECTION_KEYS) {
    if (!seen.has(key)) out.push({ key, visible: true });
  }
  return out;
}

export const pressKitsTable = pgTable("press_kits", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  /** URL-safe public handle, unique across the site. */
  handle: text("handle").notNull().unique(),
  artist_name: text("artist_name").notNull(),
  tagline: text("tagline"),
  /** AI-written bio (3-credit generation) — editable for free after. */
  bio: text("bio"),
  genre: text("genre"),
  location: text("location"),
  booking_email: text("booking_email"),
  website: text("website"),
  instagram_url: text("instagram_url"),
  tiktok_url: text("tiktok_url"),
  youtube_url: text("youtube_url"),
  spotify_url: text("spotify_url"),
  /** Free-text achievements, one per line in the UI, stored as JSON array. */
  achievements: jsonb("achievements").$type<string[]>().default([]),
  press_quotes: jsonb("press_quotes").$type<PressKitQuote[]>().default([]),
  /** Photo URLs pulled from the artist vault gallery. */
  photo_urls: jsonb("photo_urls").$type<string[]>().default([]),
  top_tracks: jsonb("top_tracks").$type<PressKitTrack[]>().default([]),
  /** Saved press releases (from the Press Release Generator panel). */
  press_releases: jsonb("press_releases").$type<PressKitRelease[]>().default([]),
  /** Public-page layout: ordered { key, visible } over the six sections
      (see PRESS_KIT_SECTION_KEYS). NULL = the default layout. */
  layout: jsonb("layout").$type<PressKitLayout | null>(),
  /** Artist vault this kit was built from (bio source + photos). */
  artist_vault_id: uuid("artist_vault_id"),
  is_public: boolean("is_public").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPressKitSchema = createInsertSchema(pressKitsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export const selectPressKitSchema = createSelectSchema(pressKitsTable);

export type PressKit = typeof pressKitsTable.$inferSelect;
export type InsertPressKit = z.infer<typeof insertPressKitSchema>;

/** Public shape served at /press/:handle — never leaks user_id. */
export const publicPressKitSchema = selectPressKitSchema.omit({ user_id: true });
export type PublicPressKit = z.infer<typeof publicPressKitSchema>;

/** Handle rules: 3-30 chars, lowercase letters/numbers/hyphens, no leading/trailing hyphen. */
export const pressKitHandleSchema = z
  .string()
  .min(3, "Handle must be at least 3 characters")
  .max(30, "Handle must be at most 30 characters")
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "Handle must be lowercase letters, numbers, and hyphens only");
