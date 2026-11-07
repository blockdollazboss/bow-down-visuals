/**
 * Creator Room dressing choices — the pure client seam (THE-GAME
 * Ring 4).
 *
 * The CATALOG lives server-side (artifacts/api-server/src/lib/
 * world-room-dressing.ts): twenty-four template variants, four per
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
  { key: "shadow", label: "Shadow", palette: "inverted", trimStyle: "bar", bannerStyle: "none" },
];

/** The mirror catalog: 6 bands × 4 variants, in picker order
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

/* ── i18n string bundle (stack100 locale unit 48) ──────────────────
   The composed picker words below take an optional strings
   bundle whose defaults are the original English, byte-identical;
   the desk builds the bundle from the worldCreatorRooms catalog
   keys. The rung names and the variant names stay literal: they
   are the ladder's own catalog data, pinned against the server's
   list on both sides (see the header) — the lock template
   carries them through as {{band}} / {{name}} data tokens. */

function fillToken(template: string, token: string, value: string): string {
  return template.split(token).join(value);
}

export interface RoomDressingStrings {
  /** Template: {{band}} + {{name}} tokens (ladder data). */
  lockReason: string;
  paletteHouse: string;
  paletteInverted: string;
  paletteGilded: string;
  trimBar: string;
  trimDouble: string;
  trimCrown: string;
  bannerFlank: string;
  bannerTrio: string;
  bannerNone: string;
}

export const ROOM_DRESSING_STRINGS_EN: RoomDressingStrings = {
  lockReason: "Unlocks at ★{{band}} {{name}} — dressing from a higher rung.",
  paletteHouse: "House hues",
  paletteInverted: "Swapped hues",
  paletteGilded: "Gilded banners",
  trimBar: "Single trim",
  trimDouble: "Double trim",
  trimCrown: "Crown trim",
  bannerFlank: "Flank banners",
  bannerTrio: "Three banners",
  bannerNone: "Bare walls",
};

/** Build the bundle from a translate function (the desk's `t`):
 *  every field reads its worldCreatorRooms catalog key. */
export function roomDressingStrings(
  translate: (key: string) => string,
): RoomDressingStrings {
  return {
    lockReason: translate("worldCreatorRooms.dressingLockReason"),
    paletteHouse: translate("worldCreatorRooms.dressingPaletteHouse"),
    paletteInverted: translate("worldCreatorRooms.dressingPaletteInverted"),
    paletteGilded: translate("worldCreatorRooms.dressingPaletteGilded"),
    trimBar: translate("worldCreatorRooms.dressingTrimBar"),
    trimDouble: translate("worldCreatorRooms.dressingTrimDouble"),
    trimCrown: translate("worldCreatorRooms.dressingTrimCrown"),
    bannerFlank: translate("worldCreatorRooms.dressingBannerFlank"),
    bannerTrio: translate("worldCreatorRooms.dressingBannerTrio"),
    bannerNone: translate("worldCreatorRooms.dressingBannerNone"),
  };
}

/** The honest reason a variant stands locked — the same sentence
 *  the server's write refusal uses, naming the rung that opens
 *  it. */
export function roomDressingLockReason(
  variant: RoomDressingVariant,
  strings: RoomDressingStrings = ROOM_DRESSING_STRINGS_EN,
): string {
  return fillToken(
    fillToken(strings.lockReason, "{{band}}", String(variant.band)),
    "{{name}}",
    RUNG_NAMES[variant.band - 1]!,
  );
}

/** A band's rung name — the ladder's word for the band, for the
 *  picker's band headers. */
export function roomDressingBandName(band: number): string {
  const idx = Math.min(RUNG_NAMES.length, Math.max(1, Math.floor(band) || 1)) - 1;
  return RUNG_NAMES[idx]!;
}

const PALETTE_WORDS: Record<RoomDressingPalette, keyof RoomDressingStrings> = {
  house: "paletteHouse",
  inverted: "paletteInverted",
  gilded: "paletteGilded",
};
const TRIM_WORDS: Record<RoomDressingTrimStyle, keyof RoomDressingStrings> = {
  bar: "trimBar",
  double: "trimDouble",
  crown: "trimCrown",
};
const BANNER_WORDS: Record<RoomDressingBannerStyle, keyof RoomDressingStrings> = {
  flank: "bannerFlank",
  trio: "bannerTrio",
  none: "bannerNone",
};

/** What a variant wears, in the picker's plain words — its three
 *  parameters, named for a person choosing a look, not an
 *  engineer reading a tuple. */
export function roomDressingStyleWords(
  variant: RoomDressingVariant,
  strings: RoomDressingStrings = ROOM_DRESSING_STRINGS_EN,
): string {
  return `${strings[PALETTE_WORDS[variant.palette]]} · ${strings[TRIM_WORDS[variant.trimStyle]]} · ${strings[BANNER_WORDS[variant.bannerStyle]]}`;
}

interface RoomDressingOption {
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
export function roomDressingOptions(
  gateStars: number,
  strings: RoomDressingStrings = ROOM_DRESSING_STRINGS_EN,
): RoomDressingOption[] {
  const gate = Math.min(6, Math.max(1, Math.floor(gateStars) || 1));
  return CREATOR_ROOM_DRESSING_VARIANTS.map((variant) => {
    const locked = variant.band > gate;
    return {
      variant,
      locked,
      lockReason: locked ? roomDressingLockReason(variant, strings) : null,
    };
  });
}

/** The scene's dressing parameters: palette, trim style, banner
 *  style. The classic tuple — the Phase 5 rendering, worn by
 *  every unpicked room and by any room whose dressing resolved
 *  null. */
interface RoomDressingSceneParams {
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
