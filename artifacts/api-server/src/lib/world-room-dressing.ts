/* ─── Creator Room dressing choices (THE-GAME Ring 4) ──────────────────
   "Room dressing choices within your level tier (template variants,
   still no freeform building)."

   Ring 3 Phase 5 dressed a Creator Room by its owner's EARNED rank
   alone: one trim per rung, resolved server-side off lib/creator-rank,
   nothing for the owner to pick. Ring 4 adds the CHOICE inside the
   tier: a small catalog of template variants — three per rung — that
   restyle the room through the dressing system's own parameters
   (palette treatment, trim style, banner style). No freeform
   building, no new art: a variant is a parameter tuple the scene's
   dressing already knows how to wear.

   THE RULES
   - The catalog lives here (server) and nowhere else; the client
     mirror in lib/world/creator-room-dressing.ts is pinned against
     this list by tests on both sides.
   - A variant belongs to a BAND (its rung). It is selectable only
     when the owner's GATE stars reach the band — gate stars being
     the earned-rank build's own rule: max(earned, saved dial), the
     grandfather floor (see decideRoomDressingWrite for how the
     client-held floor reaches this check).
   - The pick persists in the profile's theme_config under
     ROOM_DRESSING_CONFIG_KEY — the room's existing state store, the
     same JSONB the room's hues already ride. No new table, no
     migration.
   - Resolution is server-side: the room DTO carries the resolved
     variant, so a VISITOR sees the owner's pick, never a default
     they chose locally. A stored pick is honored as recorded (it
     was gated when it was made); an unknown stored value falls
     back to the band default rather than dressing the room in
     garbage.
   - The DEFAULT is the band's "classic" variant, whose parameters
     reproduce the Phase 5 rendering exactly — an owner who never
     picks sees the room they have today, pixel for pixel.
   - An UNMEASURED room (the rank read failed, evolution null)
     resolves NO dressing at all (null) — the Phase 5 rule: never
     fabricate a tier. A stored pick still resolves in that case:
     it is recorded state, not a rank claim.
*/

import { starTitle } from "./creator-rank";

/* ── The parameter vocabulary ───────────────────────────────────────── */

/** How the room's own theme hues are dealt onto the dressing:
 *  house = runner in accent, banners in primary (the Phase 5 look);
 *  inverted = the two swap; gilded = the banners wear the tier's
 *  own gold instead of the theme primary. */
export type RoomDressingPalette = "house" | "inverted" | "gilded";

/** The rank-plate trim bar: bar = the Phase 5 single bar; double =
 *  a second bar under the plate; crown = one wider, taller bar. */
export type RoomDressingTrimStyle = "bar" | "double" | "crown";

/** The screen banners: flank = the Phase 5 pair flanking the
 *  screen; trio = the pair plus a third on the east wall; none =
 *  bare walls, the runner carries the color alone. */
export type RoomDressingBannerStyle = "flank" | "trio" | "none";

export interface RoomDressingVariant {
  id: string;
  /** The rung this variant belongs to (1–6): its minimum gate. */
  band: number;
  name: string;
  palette: RoomDressingPalette;
  trimStyle: RoomDressingTrimStyle;
  bannerStyle: RoomDressingBannerStyle;
}

/** The three template styles every band offers, in picker order.
 *  "classic" is always the default: its parameters ARE the Phase 5
 *  rendering. */
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

/** The whole catalog: 6 bands × 3 variants. Names carry the
 *  ladder's own rung names (STAR_TITLES via starTitle — the single
 *  source), never a second set of words. */
export const ROOM_DRESSING_VARIANTS: readonly RoomDressingVariant[] = [1, 2, 3, 4, 5, 6].flatMap(
  (band) =>
    DRESSING_STYLES.map((style) => ({
      id: `t${band}-${style.key}`,
      band,
      name: `${starTitle(band)} ${style.label}`,
      palette: style.palette,
      trimStyle: style.trimStyle,
      bannerStyle: style.bannerStyle,
    })),
);

const VARIANT_BY_ID = new Map(ROOM_DRESSING_VARIANTS.map((v) => [v.id, v]));

/** A catalog variant by id, or null for anything that isn't one —
 *  client input and stored JSONB both pass through here, and
 *  neither is trusted. */
export function roomDressingVariantById(id: unknown): RoomDressingVariant | null {
  if (typeof id !== "string") return null;
  return VARIANT_BY_ID.get(id) ?? null;
}

/** A band's default variant — its "classic", the Phase 5 look.
 *  The band clamps to the ladder like every rank read. */
export function defaultRoomDressingVariant(stars: number): RoomDressingVariant {
  const band = Math.min(6, Math.max(1, Math.floor(stars) || 1));
  return VARIANT_BY_ID.get(`t${band}-classic`)!;
}

/** theme_config key the pick persists under. */
export const ROOM_DRESSING_CONFIG_KEY = "roomDressing";

/** The stored pick on a profile's theme_config, validated against
 *  the catalog: an unknown or malformed value reads as NO pick
 *  (the band default applies), never as a variant of its own. */
export function storedRoomDressingVariant(
  themeConfig: Record<string, unknown> | null | undefined,
): RoomDressingVariant | null {
  if (!themeConfig || typeof themeConfig !== "object" || Array.isArray(themeConfig)) return null;
  return roomDressingVariantById(themeConfig[ROOM_DRESSING_CONFIG_KEY]);
}

/* ── Gating ─────────────────────────────────────────────────────────── */

function clampStars(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : 1;
  return Math.min(6, Math.max(1, v));
}

/** Gate stars for dressing — the earned-rank build's grandfather
 *  rule, the same math the client's gateStarsFor runs: the saved
 *  pre-rank dial is a floor, earned stars take over past it, and
 *  neither term can push past the ladder's ends. The floor is a
 *  client-held value by that build's design (localStorage
 *  bdv_user_mode_*), asserted on the write; dressing is a cosmetic
 *  exposure gate, exactly like the data-min-stars gates the rule
 *  already governs — it can never raise the DISPLAYED rank, which
 *  stays earned-only everywhere including this room's rank plate. */
export function roomDressingGateStars(earnedStars: number, savedDial: unknown): number {
  return Math.max(clampStars(earnedStars), clampStars(savedDial));
}

/** True when a gate reaches a variant's band. Bands at or below
 *  the gate are the owner's to wear — including lower bands: the
 *  gate locks only what stands ABOVE it. */
export function roomDressingSelectable(variant: RoomDressingVariant, gateStars: number): boolean {
  return variant.band <= clampStars(gateStars);
}

/** The honest reason a variant stands locked, naming the rung that
 *  opens it — the picker's locked rows and the write refusal share
 *  this one sentence. */
export function roomDressingLockReason(variant: RoomDressingVariant): string {
  return `Unlocks at ★${variant.band} ${starTitle(variant.band)} — dressing from a higher rung.`;
}

/* ── Resolution (what a visitor's room read carries) ────────────────── */

export interface WorldRoomDressingDto {
  variantId: string;
  band: number;
  name: string;
  palette: RoomDressingPalette;
  trimStyle: RoomDressingTrimStyle;
  bannerStyle: RoomDressingBannerStyle;
  /** True when the owner picked this variant; false when it is
   *  the band default an unpicked room wears. */
  picked: boolean;
}

export function roomDressingDto(variant: RoomDressingVariant, picked: boolean): WorldRoomDressingDto {
  return {
    variantId: variant.id,
    band: variant.band,
    name: variant.name,
    palette: variant.palette,
    trimStyle: variant.trimStyle,
    bannerStyle: variant.bannerStyle,
    picked,
  };
}

/** Resolve a room's dressing for the DTO: the owner's stored pick
 *  when one is recorded; else the default of the owner's earned
 *  band; else null when the rank is unmeasured and nothing is
 *  stored — no dressing claimed, exactly as Phase 5 left an
 *  unmeasured room. */
export function resolveRoomDressing(input: {
  themeConfig: Record<string, unknown> | null | undefined;
  earnedStars: number | null;
}): WorldRoomDressingDto | null {
  const stored = storedRoomDressingVariant(input.themeConfig);
  if (stored) return roomDressingDto(stored, true);
  if (input.earnedStars == null) return null;
  return roomDressingDto(defaultRoomDressingVariant(input.earnedStars), false);
}

/* ── The write decision (the room-authority rule, pure) ─────────────── */

export type RoomDressingWriteDecision =
  | { ok: true; variant: RoomDressingVariant }
  | { ok: false; status: number; error: string };

/** Decide an owner's dressing change. Pure — the route loads the
 *  rows and the rank, this decides:
 *  - no profile, or a profile that isn't the caller's: the closed
 *    door (404), the same answer the room reads give a private or
 *    unknown slug — a non-owner is never even told the room
 *    exists, and can never redress it;
 *  - a variant id that isn't in the catalog: 400;
 *  - a variant above the caller's gate (earned, grandfather-
 *    floored): 403 with the honest unlock reason;
 *  - otherwise the pick stands.
 *  earnedStars is only consulted after ownership is proven, so the
 *  caller may pass any placeholder for a non-owner. */
export function decideRoomDressingWrite(input: {
  profile: { userId: string } | null;
  callerUserId: string;
  variantId: unknown;
  earnedStars: number;
  savedDial: unknown;
}): RoomDressingWriteDecision {
  if (!input.profile || input.profile.userId !== input.callerUserId) {
    return {
      ok: false,
      status: 404,
      error: "That creator's room isn't open — their profile is private or doesn't exist.",
    };
  }
  const variant = roomDressingVariantById(input.variantId);
  if (!variant) {
    return {
      ok: false,
      status: 400,
      error: "That dressing isn't one of the room templates. Pick from the list.",
    };
  }
  const gate = roomDressingGateStars(input.earnedStars, input.savedDial);
  if (!roomDressingSelectable(variant, gate)) {
    return { ok: false, status: 403, error: roomDressingLockReason(variant) };
  }
  return { ok: true, variant };
}
