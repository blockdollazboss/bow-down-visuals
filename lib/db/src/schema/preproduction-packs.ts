import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

/* ── Pre-production packs ──────────────────────────────────────────────────
   Everything it takes to make a clip, generated BEFORE any scene is made and
   locked in: the production bible, the storyboard, the props, the per-shot
   ingredients (generation recipes), and the asset library. Once locked, a
   pack is immutable — scene generation builds its prompts server-side from
   the locked pack so nothing can drift. */

export interface PackBible {
  concept: string;
  visualStyle: string;
  colorPalette: string;
  locations: string;
  wardrobe: string;
  propsNeeded: string;
  cast: string;
  mood: string;
  doNotChange: string;
}

/** One locked storyboard shot. */
export interface PackShot {
  shotNumber: number;
  description: string;
  cameraAngle: string;
  durationSec: number;
}

/** A hero prop, locked in with its reference asset image. */
export interface PackProp {
  name: string;
  description: string;
  /** Which shots need this prop. */
  shots: number[];
  /** Generated reference photo of the prop (null if generation failed). */
  assetImageUrl: string | null;
}

/** The locked generation recipe for one shot — everything the scene
    generator needs, decided up front. */
export interface PackIngredients {
  shotNumber: number;
  /** Final locked prompt for the video model. */
  prompt: string;
  /** Locked negative prompt. */
  negativePrompt: string;
  /** Locked reference asset URLs (prop/location/wardrobe plates). */
  referenceAssetUrls: string[];
  /** Locked continuity reminders injected into every generation. */
  continuityNotes: string;
  /** Suggested model settings, locked in. */
  model: "gen4.5" | "seedance2_5";
  durationSec: number;
  ratio: string;
}

/** A generated production asset (prop plate, location plate, wardrobe...). */
export interface PackAsset {
  id: string;
  category: "Prop" | "Wardrobe" | "Location" | "Vehicle" | "Set Piece" | "Other";
  label: string;
  prompt: string;
  imageUrl: string | null;
  createdAt: string;
}

export const preproductionPacksTable = pgTable("preproduction_packs", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  /** Optional editor project this pack belongs to. */
  project_id: text("project_id"),
  /** Artist vault the pack was built around (identity lock). */
  artist_vault_id: uuid("artist_vault_id"),
  song_title: text("song_title"),
  genre: text("genre"),
  mood: text("mood"),
  /** Locked production bible. */
  bible: jsonb("bible").$type<PackBible>(),
  /** Locked storyboard shots. */
  storyboard: jsonb("storyboard").$type<PackShot[]>(),
  /** Locked hero props with asset images. */
  props: jsonb("props").$type<PackProp[]>(),
  /** Locked per-shot generation recipes. */
  ingredients: jsonb("ingredients").$type<PackIngredients[]>(),
  /** Locked asset library. */
  assets: jsonb("assets").$type<PackAsset[]>(),
  /** generating | ready | locked. Only locked packs feed scene generation. */
  status: text("status").notNull().default("generating"),
  /** Total site credits charged to build this pack. */
  credits_charged: text("credits_charged"),
  locked_at: timestamp("locked_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPreproductionPackSchema = createInsertSchema(preproductionPacksTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export const selectPreproductionPackSchema = createSelectSchema(preproductionPacksTable);

export type PreproductionPack = typeof preproductionPacksTable.$inferSelect;
