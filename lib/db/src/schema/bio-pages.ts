import { pgTable, uuid, text, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

/* Link-in-Bio pages (migration 0076).
   bio_pages: a creator's public link-in-bio page at /bio/:slug.
   bio_link_clicks: per-link click analytics for the builder dashboard. */

export interface BioLinkRow {
  title: string;
  url: string;
  icon: string;
}

interface BioSocials {
  instagram?: string;
  tiktok?: string;
  youtube?: string;
  x?: string;
  spotify?: string;
  discord?: string;
}

export interface BioFeaturedItem {
  label: string;
  url: string;
  kind: string;
}

export const bioPagesTable = pgTable("bio_pages", {
  id:          uuid("id").primaryKey().defaultRandom(),
  userId:      uuid("user_id").notNull(),
  slug:        text("slug").notNull().unique(),
  displayName: text("display_name").notNull().default(""),
  headline:    text("headline").notNull().default(""),
  bio:         text("bio").notNull().default(""),
  avatarUrl:   text("avatar_url"),
  /* [{ title, url, icon }] — the link rows */
  links:       jsonb("links").$type<BioLinkRow[]>().notNull().default([]),
  /* { instagram, tiktok, youtube, x, spotify, discord } -> url */
  socials:     jsonb("socials").$type<BioSocials>().notNull().default({}),
  theme:       text("theme").notNull().default("gold-royal"),
  /* [{ label, url, kind }] — featured hub assets, deep-link to the work */
  featured:    jsonb("featured").$type<BioFeaturedItem[]>().notNull().default([]),
  tipJarUrl:   text("tip_jar_url"),
  isPublished: boolean("is_published").notNull().default(false),
  viewCount:   integer("view_count").notNull().default(0),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const bioLinkClicksTable = pgTable("bio_link_clicks", {
  id:        uuid("id").primaryKey().defaultRandom(),
  bioPageId: uuid("bio_page_id").notNull().references(() => bioPagesTable.id, { onDelete: "cascade" }),
  linkIndex: integer("link_index").notNull().default(-1),
  linkTitle: text("link_title").notNull().default(""),
  referrer:  text("referrer"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* Luxury theme variants for bio pages — dark and light designs.
   Backend-validated on save. Keys + English label/blurb mirror the FE
   design registry (components/promote/bio-themes.tsx) and the World
   desk's BIO_PAGE_THEMES; bio-themes-shelf.test.ts pins all three. */
export const BIO_THEMES = [
  { key: "gold-royal", label: "Gold Royal", blurb: "Black + radiant gold — the signature Bow Down look" },
  { key: "midnight-gold", label: "Midnight Gold", blurb: "Deep blue-black with warm gold accents" },
  { key: "onyx-minimal", label: "Onyx Minimal", blurb: "Pure black, hairline gold rules — ultra clean" },
  { key: "velvet-noir", label: "Velvet Noir", blurb: "Black-cherry velvet with champagne gold trim" },
  { key: "emerald-court", label: "Emerald Court", blurb: "Deep emerald and gold — the royal court look" },
  { key: "smoke-platinum", label: "Smoke Platinum", blurb: "Graphite smoke with cool platinum shine" },
  { key: "golden-marble", label: "Golden Marble", blurb: "Warm golden marble with antique gold — the house light look" },
  { key: "ivory-pearl", label: "Ivory Pearl", blurb: "Soft ivory pearl with champagne gold lines" },
  { key: "rose-champagne", label: "Rose Champagne", blurb: "Blush marble with rose-gold shine" },
  { key: "cobalt-stage", label: "Cobalt Stage", blurb: "Deep cobalt with silver-gold trim — cool stage light" },
  { key: "mint-atelier", label: "Mint Atelier", blurb: "Pale mint with antique gold — a fresh, tailored light look" },
  { key: "amber-dusk", label: "Amber Dusk", blurb: "Burnt amber over espresso — sunset turned after-dark" },
] as const;
export const BIO_THEME_KEYS = new Set(BIO_THEMES.map((t) => t.key));

export const BIO_LINK_ICON_KEYS = new Set([
  "link", "music", "video", "mic", "shopping-bag", "ticket", "calendar",
  "mail", "heart", "star", "crown", "sparkles", "globe", "image", "play",
]);
