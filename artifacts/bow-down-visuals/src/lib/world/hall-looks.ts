/**
 * hall-looks.ts — the King's Hall wears two faces, picked by the owner
 * (2026-10-16) and switched by the visitor's site theme:
 *
 *   LIGHT theme → Look A, "Golden Hour Palace": a sunlit cream-and-gold
 *   marble palace — tall windows pouring warm daylight across a polished
 *   marble floor, dust hanging in the beams, gold columns, the throne on
 *   a wide dais under the big screen.
 *
 *   DARK theme → Look B, "Midnight Throne Room": black marble with gold
 *   veining, candle sconces and fire braziers, warm light pooled in deep
 *   shadow, haze drifting over a mirror-dark floor.
 *
 * This module is pure data (no three.js, no DOM) so the wiring can be
 * unit-tested anywhere; hall-scene.ts turns a HallLook into materials,
 * geometry and light. In BOTH looks the big screen stays centre of the
 * front wall — that placement is the room's law, not a theme choice.
 */

export type HallTheme = "light" | "dark";

/** Anything that isn't explicitly the light theme is the dark hall —
 *  the same default the app shell boots with (main.tsx). */
export function normalizeHallTheme(value: string | null | undefined): HallTheme {
  return value === "light" ? "light" : "dark";
}

/** The big screen: centred on the front wall in both looks, always. */
export const HALL_SCREEN = {
  centerX: 0,
  centerY: 3.55,
  z: -17.95,
  width: 13.4,
  height: 5.6,
} as const;

const TEXTURE_BASE = "/world/textures";

export interface HallLook {
  theme: HallTheme;
  /** The owner's name for the look (design reference, not UI copy). */
  name: "Golden Hour Palace" | "Midnight Throne Room";
  /** Scene background + fog (linear fog, distances in metres). */
  background: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  /** Renderer tone-mapping exposure for this look. */
  exposure: number;
  /** Strength of the themed environment reflections (0–1+). */
  environmentIntensity: number;
  /** PBR texture maps (public assets, loaded with the world chunk). */
  marbleTextureUrl: string;
  throneFabricTextureUrl: string;
  /** Exterior stone courses for the palace façade + roofline
   *  (Stage C item 1/2, art lane item 10): dark ashlar at night,
   *  warm light ashlar by day. */
  facadeStoneTextureUrl: string;
  /** Gold-vein marble for the façade's accent pieces (plinth,
   *  pilasters, pediment, dome): black/gold at night, cream/gold
   *  by day — the Living Night Palace direction and its twin. */
  facadeMarbleTextureUrl: string;
  /** The plaza grounds' own surfaces (Stage C items 5/6/8, art
   *  lane item 10): real outdoor paving for the broad floor (dark
   *  setts at night, warm light stone by day), textured grass for
   *  the lawns (deep green at dusk, bright by day), and the
   *  backdrop moat's water (a dusk still-water base in both looks
   *  — the art lane shipped one water file; by day it reads as
   *  shaded water under the pale sky). */
  pavingTextureUrl: string;
  lawnTextureUrl: string;
  waterTextureUrl: string;
  /** Legacy: the floor's old whole-tile repeat count. Repeats are
   *  per-metre now (pbr-materials.repeatForSize, overhaul item 7) —
   *  hall-scene no longer reads this; kept as look history. */
  floorRepeat: number;
  /** How much of the mirror floor shows through the marble overlay. */
  floorOverlayOpacity: number;
  /** The floor polish this look designs for — now encoded in the
   *  derived marble-floor roughness map (≈ this value on the field,
   *  rougher in the veins) rather than a material scalar. */
  floorRoughness: number;
  /** Tint multiplied into the planar reflection (Reflector colour). */
  floorReflectionTint: number;
  /** Column build for this look. */
  columnStyle: "gold-round" | "black-square";
  /** Tall sunlit windows on the left wall (Look A). */
  windows: boolean;
  /** The sun itself: a warm directional raking in from the windows. */
  sun: { present: boolean; color: number; intensity: number };
  /** Fake god-ray planes + drifting dust motes in the sunbeams. */
  lightBeams: boolean;
  dust: boolean;
  /** Candle sconces + fire braziers with real flickering point light. */
  candles: boolean;
  /** Slow smoke/haze planes drifting over the floor (Look B). */
  haze: boolean;
  /** Gilt chandeliers hanging over the audience floor (Look A). */
  chandeliers: boolean;
  /** Ambient + hemisphere wash. */
  ambient: { color: number; intensity: number };
  hemisphere: { sky: number; ground: number; intensity: number };
  /** The three stage spots, retuned per look. */
  stageSpot: { color: number; intensity: number };
  /** The warm house point light over the audience floor. */
  houseLight: { color: number; intensity: number };
}

export const HALL_LOOKS: Record<HallTheme, HallLook> = {
  light: {
    theme: "light",
    name: "Golden Hour Palace",
    background: 0xe6d7b4,
    fogColor: 0xe2d0a8,
    fogNear: 30,
    fogFar: 68,
    exposure: 1.12,
    environmentIntensity: 0.55,
    marbleTextureUrl: `${TEXTURE_BASE}/marble-cream.jpg`,
    throneFabricTextureUrl: `${TEXTURE_BASE}/brocade-gold.jpg`,
    facadeStoneTextureUrl: `${TEXTURE_BASE}/stone-light.jpg`,
    facadeMarbleTextureUrl: `${TEXTURE_BASE}/marble-cream-goldvein.jpg`,
    pavingTextureUrl: `${TEXTURE_BASE}/paving-light.jpg`,
    lawnTextureUrl: `${TEXTURE_BASE}/lawn-light.jpg`,
    waterTextureUrl: `${TEXTURE_BASE}/water-dark.jpg`,
    floorRepeat: 3,
    floorOverlayOpacity: 0.5,
    floorRoughness: 0.07,
    floorReflectionTint: 0xb0a58e,
    columnStyle: "gold-round",
    windows: true,
    sun: { present: true, color: 0xffdf9e, intensity: 3.1 },
    lightBeams: true,
    dust: true,
    candles: false,
    haze: false,
    chandeliers: true,
    ambient: { color: 0xffe9c4, intensity: 0.5 },
    hemisphere: { sky: 0xfff3da, ground: 0x8a6f4d, intensity: 0.7 },
    stageSpot: { color: 0xffe9bb, intensity: 130 },
    houseLight: { color: 0xffd9a0, intensity: 55 },
  },
  dark: {
    theme: "dark",
    name: "Midnight Throne Room",
    background: 0x030303,
    fogColor: 0x060505,
    fogNear: 16,
    fogFar: 46,
    exposure: 1.05,
    environmentIntensity: 0.3,
    marbleTextureUrl: `${TEXTURE_BASE}/marble-black.jpg`,
    throneFabricTextureUrl: `${TEXTURE_BASE}/velvet-black.jpg`,
    facadeStoneTextureUrl: `${TEXTURE_BASE}/stone-dark.jpg`,
    facadeMarbleTextureUrl: `${TEXTURE_BASE}/marble-black-goldvein.jpg`,
    pavingTextureUrl: `${TEXTURE_BASE}/paving-dark.jpg`,
    lawnTextureUrl: `${TEXTURE_BASE}/lawn-dark.jpg`,
    waterTextureUrl: `${TEXTURE_BASE}/water-dark.jpg`,
    floorRepeat: 3,
    floorOverlayOpacity: 0.58,
    floorRoughness: 0.06,
    floorReflectionTint: 0x4a4a4a,
    columnStyle: "black-square",
    windows: false,
    sun: { present: false, color: 0xffdf9e, intensity: 0 },
    lightBeams: false,
    dust: false,
    candles: true,
    haze: true,
    chandeliers: false,
    ambient: { color: 0x4a3a22, intensity: 0.5 },
    hemisphere: { sky: 0x2a2438, ground: 0x050403, intensity: 0.4 },
    stageSpot: { color: 0xffbe78, intensity: 95 },
    houseLight: { color: 0xffc98a, intensity: 30 },
  },
};

export function hallLookFor(theme: HallTheme): HallLook {
  return HALL_LOOKS[theme];
}
