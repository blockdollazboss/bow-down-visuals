import {
  pgTable,
  text,
  integer,
  timestamp,
  primaryKey,
  jsonb,
  boolean,
  uuid,
  index,
} from "drizzle-orm/pg-core";

/**
 * Theme pack purchases (migration 0220). Premium theme packs are a
 * one-time 1,000 VB purchase, owned forever (owner pricing ruling
 * 2026-10-24). One row per (user, pack) — the primary key is the
 * exactly-once anchor for the purchase rail in routes/theme-packs.ts.
 * Creator Elite entitlement is NOT stored here: it is resolved live
 * from creator_subscriptions, so a lapse ends Elite access while rows
 * here (outright purchases) keep their packs.
 */
export const themePackPurchasesTable = pgTable(
  "theme_pack_purchases",
  {
    userId: text("user_id").notNull(),
    packId: text("pack_id").notNull(),
    priceVb: integer("price_vb").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.packId] })],
);

export type ThemePackPurchase = typeof themePackPurchasesTable.$inferSelect;

/**
 * Buyer customizations (migration 0243, Stack-200 UPGRADES item 39 —
 * the customization capstone). One row per (user, pack, component,
 * device): `component` is one of the 12 kit component ids, `device`
 * is 'all' | 'phone' | 'tablet' | 'desktop', and `settings` carries
 * that component's buyer choices (art source, accent, cursor, sound
 * additions, branded flag, …) as validated by the kit rail.
 */
export const themePackCustomizationsTable = pgTable(
  "theme_pack_customizations",
  {
    userId: text("user_id").notNull(),
    packId: text("pack_id").notNull(),
    component: text("component").notNull(),
    device: text("device").notNull().default("all"),
    settings: jsonb("settings").notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.packId, t.component, t.device] })],
);

export type ThemePackCustomization = typeof themePackCustomizationsTable.$inferSelect;

/**
 * Creator-made packs (migration 0243). A creator designs a pack from
 * a house base pack plus a customization mix (the same shape buyers
 * save in theme_pack_customizations, flattened per component) and
 * sells or gives it away. Sales ride the flat-5% fee law
 * (lib/platform-fees feeSplit at PLATFORM_FEE_BPS) and ownership
 * lands in theme_pack_purchases with pack_id = 'creator:<id>' — the
 * same exactly-once anchor as house premium packs.
 */
export const creatorThemePacksTable = pgTable(
  "creator_theme_packs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorUserId: text("creator_user_id").notNull(),
    name: text("name").notNull(),
    basePackId: text("base_pack_id").notNull(),
    priceVb: integer("price_vb").notNull().default(0),
    mix: jsonb("mix").notNull().default({}),
    published: boolean("published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("creator_theme_packs_creator_idx").on(t.creatorUserId),
    index("creator_theme_packs_published_idx").on(t.published),
  ],
);

export type CreatorThemePack = typeof creatorThemePacksTable.$inferSelect;
