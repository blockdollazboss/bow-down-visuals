/**
 * nameplate.ts — what a peer's nameplate SAYS, as pure label logic.
 *
 * The scene (hall-scene.ts) paints the plate on a canvas; every
 * string it paints is built here so the wording is unit-tested
 * without a renderer. THE-GAME §5 Q1 (owner default): a creator's
 * stars live on the NAMEPLATE ONLY — beside the name, where the
 * room already reads who you are — and NEVER on the character:
 * no star is ever stamped on a figure, a portrait, or a texture.
 */

/** The fields of a peer the plate reads (a structural subset of
 *  WorldPeer, so the scene and tests can both feed it plainly). */
export interface NameplatePeer {
  displayName: string;
  stars?: number;
  guest: boolean;
  voiceOff: boolean;
  voiceDeaf: boolean;
  profileSlug: string | null;
}

/** The star marks for a level: one ★ per star (e.g. "★★★" for a
 *  3-star creator). No stars on record — a guest, or a member the
 *  door couldn't resolve — renders NO marks, never a fake zero. */
export function starsMark(stars: number | undefined | null): string {
  if (typeof stars !== "number" || !Number.isInteger(stars) || stars < 1) return "";
  return "★".repeat(Math.min(6, stars));
}

/** The plate's name line: the name, with its stars beside it. */
export function nameplateTitle(peer: Pick<NameplatePeer, "displayName" | "stars">): string {
  const name = peer.displayName.slice(0, 24);
  const mark = starsMark(peer.stars);
  return mark ? `${name} ${mark}` : name;
}

/**
 * The plate's sub-line. Priority is the hall's at-a-glance truth:
 * voice-off outranks everything ("this person can't hear you"),
 * then deafened (in voice, hearing nobody), then the guest label;
 * a member reads as their Front Row honor and/or their @slug.
 */
export function nameplateSub(peer: NameplatePeer, frontRow = false): string {
  if (peer.voiceOff) return "voice off";
  if (peer.voiceDeaf) return "deafened";
  if (peer.guest) return "guest";
  return [frontRow ? "Front Row" : null, peer.profileSlug ? `@${peer.profileSlug}` : null]
    .filter(Boolean)
    .join(" · ");
}
