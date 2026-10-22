/**
 * figure.ts — which standing figure a presence wears in the hall.
 *
 * Three kinds, one pipeline:
 *  - "portrait": a Creative Vault character — the member's own art
 *    on the gold-framed easel panel, lips landmarked (unchanged).
 *  - "default": the house default — a life-size full-body figure of
 *    a King Shark palace guard (the owner's ruling: a King Shark,
 *    never his main character). TWO approved guards stand in the
 *    hall (owner approval, 2026-10-16): the male guard in the slot
 *    at public/world/default-character.png and the female guard at
 *    public/world/default-character-female.png. A presence with no
 *    explicit pick wears the guard a deterministic hash of its
 *    identity deals it, so the hall reads as a guard corps rather
 *    than clones of one figure, and a person keeps the same guard
 *    for the whole session. Picking either guard in the "Walk in
 *    as" picker overrides the deal. Both faces are frontal, so the
 *    same landmarked-lips treatment applies.
 *  - "capsule": the fallback ONLY — what stands while a guard's art
 *    is still loading, or if its slot file can't load at all
 *    (exactly how a failed portrait load behaved before it).
 *
 * Pure decisions + measurements, unit-tested; the scene does the
 * three.js lifting.
 */

import { mediaUrl } from "../media-cdn";

/** The asset slot for the approved male palace-guard art (public/). */
export const DEFAULT_CHARACTER_PATH = "/world/default-character.png";

/** The asset slot for the approved female palace-guard art (public/). */
export const DEFAULT_CHARACTER_FEMALE_PATH = "/world/default-character-female.png";

/** Which of the two house guards a default presence stands as. */
export type GuardVariant = "male" | "female";

/** Both guard slots, by variant. */
export const GUARD_CHARACTER_PATHS: Record<GuardVariant, string> = {
  male: DEFAULT_CHARACTER_PATH,
  female: DEFAULT_CHARACTER_FEMALE_PATH,
};

/** The pick ids the "Walk in as" picker sends for the house guards.
 *  They ride the character-pick frame like a vault id, but they're
 *  house property: the room resolves them itself (no vault row, no
 *  ownership to verify) and broadcasts them back as character refs
 *  the scene recognises here. Keep in sync with the mirrored ids in
 *  api-server's world room. */
export const HOUSE_GUARD_ID = "house:palace-guard";
export const HOUSE_GUARD_FEMALE_ID = "house:palace-guard-female";

/** The variant a character id names, when it names a house guard at
 *  all — null for vault ids and for no pick. */
export function houseGuardVariantForId(id: string | null | undefined): GuardVariant | null {
  if (id === HOUSE_GUARD_ID) return "male";
  if (id === HOUSE_GUARD_FEMALE_ID) return "female";
  return null;
}

/** Deal a presence its guard: FNV-1a over a stable identity key
 *  (the member's profile slug when they have one, else the presence
 *  id) — same key, same guard, on every client and every frame, so
 *  the whole room agrees on who stands as whom. */
export function guardVariantForKey(key: string): GuardVariant {
  let hash = 0x811c9dc5;
  const s = key || "presence";
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 2 === 0 ? "male" : "female";
}

/** Life-size: the same standing height family as the capsule it
 *  replaces (capsule head tops out ~2.04 m; the guard stands 1.92). */
export const DEFAULT_FIGURE_HEIGHT = 1.92;

export type DefaultArtState = "pending" | "ready" | "failed";
export type FigureKind = "portrait" | "default" | "capsule";

export function figureKindFor(hasCharacter: boolean, defaultArt: DefaultArtState): FigureKind {
  if (hasCharacter) return "portrait";
  return defaultArt === "ready" ? "default" : "capsule";
}

/** The male slot path resolved the way the hall resolves its textures:
 *  through the media CDN (the bucket's CORS policy covers the site's
 *  origins, so the hall's crossOrigin="anonymous" loads stay clean).
 *  The baseUrl argument is retained for call-site compatibility; media
 *  paths resolve through mediaUrl(), which is itself BASE_URL-aware
 *  when no CDN is configured. */
export function defaultCharacterUrl(baseUrl: string): string {
  void baseUrl;
  return mediaUrl(DEFAULT_CHARACTER_PATH);
}

/** A guard slot path resolved the way the hall resolves its textures
 *  (media CDN — see defaultCharacterUrl). */
export function guardCharacterUrl(baseUrl: string, variant: GuardVariant): string {
  void baseUrl;
  return mediaUrl(GUARD_CHARACTER_PATHS[variant]);
}

/** Width for a standing figure of `height` from the art's aspect
 *  (w/h) — aspect preserved, never stretched; a wild aspect is
 *  clamped to a sane humanoid band rather than trusted blindly. */
export function figureWidthForHeight(height: number, aspect: number): number {
  const a = Number.isFinite(aspect) && aspect > 0 ? Math.min(1.5, Math.max(0.25, aspect)) : 0.5;
  return height * a;
}

/** The canvas a default figure's art is drawn onto: tall enough to
 *  stay crisp at life size, sized to the ART's aspect so the shared
 *  cover-fit drawing lands edge-to-edge with nothing cropped and
 *  nothing stretched. Height 1536 (overhaul audit T9): the approved
 *  guard art is ~2167 px tall — the old 768 cap discarded ~65% of it
 *  before the GPU ever saw it. 1536 keeps most of the art while a
 *  per-peer canvas stays ~4 MB. */
export function defaultFigureCanvasSize(aspect: number): { w: number; h: number } {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 0.5;
  const h = 1536;
  const w = Math.min(1024, Math.max(128, Math.round(h * a)));
  return { w, h };
}
