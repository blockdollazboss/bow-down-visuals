/**
 * Creator Room dressing choices — the pure client seam (THE-GAME
 * Ring 4).
 *
 * The CATALOG lives server-side (artifacts/api-server/src/lib/
 * world-room-dressing.ts): eighteen template variants, three per
 * rung, each a parameter tuple in the dressing system's own
 * vocabulary — palette treatment, trim style, banner style. This
 * module mirrors that list for the picker (what stands where,
 * what it is called, what it would wear) and is pinned against
 * the server's list by tests on both sides: change one side
 * without the other and a suite goes red.
 *
 * What this module does NOT do: resolve a room's dressing. That
 * is the server's word, carried on the room DTO (creator-rooms.ts)
 * so a visitor sees the host's pick. Here we only answer the
 * picker's questions — which variants stand at or below a gate,
 * which stand locked and why — and translate a resolved dressing
 * into the scene's parameters, defaulting to the classic tuple
 * (the Phase 5 rendering) whenever there is nothing to translate.
 */

import type { CreatorRoomDressing } from "./creator-rooms";

export type RoomDressingPalette = CreatorRoomDressing["palette"];
export type RoomDressingTrimStyle = CreatorRoomDressing["trimStyle"];
export type RoomDressingBannerStyle = CreatorRoomDressing["bannerStyle"];

export interface RoomDressingVariant {
  id: string;
  /** The rung this variant belongs to (1–6): its minimum gate. */
  band: number;
  name: string;
  palette: RoomDressingPalette;
  trimStyle: RoomDressingTrimStyle;
  bannerStyle: RoomDressingBannerStyle;
}

/* The rung names are the ladder's (STAR_TITLES on the server,
 * STAR_RANKS here) — the picker speaks the same words as every
 * other rank surface, composed the same way the server composes
 * them. */
const RUNG_NAMES = [
  "Street Punk",
  "Hustler",
  "Gangster",
  "Shot Caller",
  "Crime Boss",
  "Kingpin",
] as const;

const DRESSING_STYLES: ReadonlyArray<{
  key: string;
  label: string;
  palette: RoomDressingPalette;
  trimStyle: RoomDressingTrimStyle;
  bannerStyle: RoomDressingBannerStyle;
}> = [
  { key: "classic", label: "Classic", palette: "house", trimStyle: "bar", bannerStyle: "flank" },
  { key: "bold", label: "Bold", palette: "inverted", trimStyle: "double", bannerStyle: "flank" },
  { key: "regal", label: "Regal", palette: "gilded", trimStyle: "crown", bannerStyle: "trio" },
];

/** The mirror catalog: 6 bands × 3 variants, in picker order
 *  (band ascending, classic first — the default leads its band). */
export const CREATOR_ROOM_DRESSING_VARIANTS: readonly RoomDressingVariant[] = [1, 2, 3, 4, 5, 6].flatMap(
  (band) =>
    DRESSING_STYLES.map((style) => ({
      id: `t${band}-${style.key}`,
      band,
      name: `${RUNG_NAMES[band - 1]} ${style.label}`,
      palette: style.palette,
      trimStyle: style.trimStyle,
      bannerStyle: style.bannerStyle,
    })),
);

const VARIANT_BY_ID = new Map(CREATOR_ROOM_DRESSING_VARIANTS.map((v) => [v.id, v]));

export function creatorRoomDressingVariantById(id: string | null | undefined): RoomDressingVariant | null {
  if (!id) return null;
  return VARIANT_BY_ID.get(id) ?? null;
}

/** The honest reason a variant stands locked — the same sentence
 *  the server's write refusal uses, naming the rung that opens
 *  it. */
export function roomDressingLockReason(variant: RoomDressingVariant): string {
  return `Unlocks at ★${variant.band} ${RUNG_NAMES[variant.band - 1]} — dressing from a higher rung.`;
}

/** A band's rung name — the ladder's word for the band, for the
 *  picker's band headers. */
export function roomDressingBandName(band: number): string {
  const idx = Math.min(RUNG_NAMES.length, Math.max(1, Math.floor(band) || 1)) - 1;
  return RUNG_NAMES[idx]!;
}

const PALETTE_WORDS: Record<RoomDressingPalette, string> = {
  house: "House hues",
  inverted: "Swapped hues",
  gilded: "Gilded banners",
};
const TRIM_WORDS: Record<RoomDressingTrimStyle, string> = {
  bar: "Single trim",
  double: "Double trim",
  crown: "Crown trim",
};
const BANNER_WORDS: Record<RoomDressingBannerStyle, string> = {
  flank: "Flank banners",
  trio: "Three banners",
  none: "Bare walls",
};

/** What a variant wears, in the picker's plain words — its three
 *  parameters, named for a person choosing a look, not an
 *  engineer reading a tuple. */
export function roomDressingStyleWords(variant: RoomDressingVariant): string {
  return `${PALETTE_WORDS[variant.palette]} · ${TRIM_WORDS[variant.trimStyle]} · ${BANNER_WORDS[variant.bannerStyle]}`;
}

export interface RoomDressingOption {
  variant: RoomDressingVariant;
  locked: boolean;
  /** Why it stands locked; null when it can be worn. */
  lockReason: string | null;
}

/** Every variant, dressed for the picker at a gate: at or below
 *  the gate it can be worn (lower bands included — dressing down
 *  is the owner's choice); above it, visible but locked with the
 *  honest reason. The gate the picker passes is the house gate —
 *  gateStarsFor(earned, saved dial) from UserModeContext — so the
 *  grandfather rule applies here exactly as it does to every
 *  control-exposure gate. */
export function roomDressingOptions(gateStars: number): RoomDressingOption[] {
  const gate = Math.min(6, Math.max(1, Math.floor(gateStars) || 1));
  return CREATOR_ROOM_DRESSING_VARIANTS.map((variant) => {
    const locked = variant.band > gate;
    return {
      variant,
      locked,
      lockReason: locked ? roomDressingLockReason(variant) : null,
    };
  });
}

/** The scene's dressing parameters: palette, trim style, banner
 *  style. The classic tuple — the Phase 5 rendering, worn by
 *  every unpicked room and by any room whose dressing resolved
 *  null. */
export interface RoomDressingSceneParams {
  palette: RoomDressingPalette;
  trimStyle: RoomDressingTrimStyle;
  bannerStyle: RoomDressingBannerStyle;
}

export const DEFAULT_ROOM_DRESSING_PARAMS: RoomDressingSceneParams = {
  palette: "house",
  trimStyle: "bar",
  bannerStyle: "flank",
};

/** A resolved dressing (off the room DTO) → the scene's
 *  parameters. Null dressing wears the classic tuple, so a room
 *  the server left unmeasured renders exactly as it did before
 *  dressing choices existed. */
export function creatorRoomDressingSceneParams(
  dressing: CreatorRoomDressing | null | undefined,
): RoomDressingSceneParams {
  if (!dressing) return { ...DEFAULT_ROOM_DRESSING_PARAMS };
  return {
    palette: dressing.palette,
    trimStyle: dressing.trimStyle,
    bannerStyle: dressing.bannerStyle,
  };
}
