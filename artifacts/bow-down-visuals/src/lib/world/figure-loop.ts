/**
 * figure-loop.ts — living loops: the generated idle-motion loops
 * that replace a standing figure's still texture in the hall.
 *
 * The guards' loops are bundled site assets, each generated FROM
 * the character's own approved art; a vault character's loop (the
 * King's today) arrives in the character payload itself — see the
 * resolution note below.
 *
 * Resolution mirrors the figure pipeline's own identity rules
 * (figure.ts): guards resolve by guard VARIANT (a dealt guard has
 * no character ref at all — the variant is the identity), vault
 * portraits by their character ref's loopUrl — the character's
 * own living asset, resolved server-side from its vault row
 * (reference_video_url) and carried in the broadcast payload.
 * Keyed by the row's identity, NEVER by name: names are
 * user-editable and broadcast to the whole room, so a name match
 * would let any renamed character wear another's loop — and the
 * real owner, renamed, would lose theirs.
 *
 * The guards' loops were generated from the light-grey character
 * sheets, so the video frames carry the studio backdrop. The
 * figure itself stands in the hall as the proven transparent
 * matte (the guarded PNGs) — so a guard loop is drawn THROUGH the
 * still's own alpha (masked: true), remapped tight (see
 * remapMaskAlpha + MASK_INSET_PX): the loop supplies the living
 * color, the matte supplies the silhouette. The measured sheet
 * geometry behind sourceCrop: each matted PNG is an exact crop of
 * its sheet (template-matched at RGB difference 0.00) — male at
 * sheet (36,53) sized 979×2167, female at (44,49) sized 1003×2171,
 * sheets 1120×2240 — and the loop videos are those same sheets
 * animated, so the crop lands the video figure exactly where the
 * still stands. Silhouette deviation between the loop frames and
 * the matte measured at a median of ~0–2 video px (scanline edge
 * tracking over 8 frames per guard); the tight mask absorbs it.
 *
 * The one loop measured so far — the King's, arriving via his
 * vault row like any other — carries NO lip overlay in practice:
 * the overlay is drawn only where the Face Landmarker finds a
 * mouth, and the measurement behind this lane (the pipeline's own
 * vendored landmarker + model, run over the still and 10 loop
 * frames) finds no face on the King at all — the detector is
 * human-trained and a shark's head is not a face to it
 * (control-verified on a human portrait in the same run: 1 face,
 * clean mouth box; the guards' stills: also no face). So there is
 * no overlay for his loop to fight: the loop plays, speaking or
 * not. The drift machinery below stays as the honest gate for any
 * future character who DOES landmark (a human-faced one): measure
 * first, then let mouthDriftPercent + the rule decide.
 *
 * Pure decisions + measurements, unit-tested; hall-scene.ts does
 * the video/canvas lifting.
 */

import { houseGuardVariantForId, type GuardVariant } from "./figure";
import type { MouthBox } from "./lips";

/** A loop a standing figure can wear. Guard paths are public/
 *  slots, resolved BASE_URL-aware like every hall texture; vault
 *  loops arrive as payload URLs and pass through untouched. */
export interface FigureLoopDef {
  /** Stable identity of the loop itself (registry key). */
  key: string;
  /** The loop video: a public/ slot or an absolute payload URL. */
  videoPath: string;
  /** The loop's own poster frame slot (public/) — the still the
   *  figure already wears remains the in-hall first paint; the
   *  poster ships for surfaces that show the loop directly. Vault
   *  loops carry no poster today (empty string). */
  posterPath: string;
  /** Normalized rect of the video frame that lands on the figure
   *  canvas — the still's footprint within the frame's own space.
   *  Null = the whole frame cover-fits exactly like the still. */
  sourceCrop: { x: number; y: number; w: number; h: number } | null;
  /** Draw the video through the still's alpha (the loop carries a
   *  backdrop the hall must never see). */
  masked: boolean;
  /** Speech swaps the figure back to its still + lip overlay
   *  instead of letting the overlay ride the loop — the honest
   *  rule when the mouth measurably wanders (see the drift rule). */
  stillWhileSpeaking: boolean;
}

export const GUARD_LOOP_PATHS: Record<GuardVariant, { video: string; poster: string }> = {
  male: {
    video: "/world/loops/palace-guard-male-idle-loop.mp4",
    poster: "/world/loops/palace-guard-male-idle-poster.png",
  },
  female: {
    video: "/world/loops/palace-guard-female-idle-loop.mp4",
    poster: "/world/loops/palace-guard-female-idle-poster.png",
  },
};

/** Speech-rule threshold: a mouth that stays within this drift
 *  (% of frame height) keeps its overlay riding the loop; beyond
 *  it, the overlay would visibly swim, so speech falls back to
 *  the still the mouth was landmarked on. */
export const MOUTH_DRIFT_RIDE_LIMIT_PERCENT = 2;

const GUARD_SOURCE_CROPS: Record<GuardVariant, { x: number; y: number; w: number; h: number }> = {
  // sheet space 1120×2240; male matte at (36,53) 979×2167
  male: { x: 36 / 1120, y: 53 / 2240, w: 979 / 1120, h: 2167 / 2240 },
  // female matte at (44,49) 1003×2171
  female: { x: 44 / 1120, y: 49 / 2240, w: 1003 / 1120, h: 2171 / 2240 },
};

function guardLoopDef(variant: GuardVariant): FigureLoopDef {
  const paths = GUARD_LOOP_PATHS[variant];
  return {
    key: `guard-${variant}`,
    videoPath: paths.video,
    posterPath: paths.poster,
    sourceCrop: GUARD_SOURCE_CROPS[variant],
    masked: true,
    stillWhileSpeaking: false,
  };
}

/** The loop for a guard figure, by the variant it stands as — the
 *  same identity the figure pipeline itself resolves (an explicit
 *  pick or the deterministic deal). */
export function loopForGuardVariant(variant: GuardVariant): FigureLoopDef {
  return guardLoopDef(variant);
}

/** The slice of a character ref loop resolution reads: the row's
 *  identity and the living asset the server resolved from it.
 *  Nothing else — in particular NOT the name, which is display
 *  text, user-editable, and no kind of key. */
export interface LoopCharacterRef {
  id: string;
  loopUrl?: string | null;
}

/** The loop a vault figure wears, or null when its row carries no
 *  living asset (the overwhelming majority — such a character
 *  simply stands as its still, as before). House guard picks
 *  resolve to null HERE on purpose: a picked guard stands as the
 *  full-body guard figure, whose loop resolves by variant — never
 *  as an easel portrait.
 *
 *  stillWhileSpeaking is false for payload loops: the payload
 *  carries no per-character drift data, and the one measured
 *  character (the King's row) has no landmarked mouth on its
 *  still or its loop at all, so there is no overlay to protect.
 *  A future character who DOES landmark gets measured before
 *  anyone flips this — the drift rule below is the gate. */
export function loopForCharacterRef(ref: LoopCharacterRef | null | undefined): FigureLoopDef | null {
  if (!ref) return null;
  if (houseGuardVariantForId(ref.id)) return null;
  const loopUrl = typeof ref.loopUrl === "string" ? ref.loopUrl.trim() : "";
  if (!loopUrl) return null;
  return {
    key: `vault-${ref.id}`,
    videoPath: loopUrl,
    posterPath: "",
    sourceCrop: null,
    masked: false,
    stillWhileSpeaking: false,
  };
}

/** The loop video URL resolved the way the hall resolves its
 *  textures (BASE_URL-aware). Absolute URLs (a future vault loop
 *  field points at mirrored storage) pass through untouched. */
export function loopVideoUrl(baseUrl: string, def: FigureLoopDef): string {
  if (/^https?:\/\//i.test(def.videoPath)) return def.videoPath;
  return `${baseUrl}${def.videoPath.replace(/^\//, "")}`;
}

/* ── The drift rule ───────────────────────────────────────────────────
   The mouth overlay is drawn at the mouth the landmarks found on
   the STILL. On a loop, the mouth itself breathes. mouthDriftPercent
   measures how far the landmarked mouth center travels across loop
   frames, as a percent of frame height (the y-normalized landmark
   space — x is converted through the frame aspect so the number is
   one honest distance). */

/** Max mouth-center drift across `samples` vs the still's box. */
export function mouthDriftPercent(
  samples: Array<MouthBox | null>,
  reference: MouthBox | null,
  frameAspect: number,
): number {
  if (!reference) return 0;
  const aspect = Number.isFinite(frameAspect) && frameAspect > 0 ? frameAspect : 1;
  let max = 0;
  for (const s of samples) {
    if (!s) continue;
    const dx = (s.cx - reference.cx) * aspect;
    const dy = s.cy - reference.cy;
    const d = Math.hypot(dx, dy) * 100;
    if (d > max) max = d;
  }
  return max;
}

/** The speech rule a drift measurement buys: at or under the ride
 *  limit the overlay rides the loop (re-landmarked on the loop's
 *  own frames, which sit within the limit of the still's box);
 *  beyond it, the figure speaks from its still. */
export function stillWhileSpeakingForDrift(driftPercent: number): boolean {
  return driftPercent > MOUTH_DRIFT_RIDE_LIMIT_PERCENT;
}

/** Whether this figure, right now, should be showing its still
 *  instead of its loop because it is speaking. */
export function loopSuspendedForSpeech(def: FigureLoopDef, speaking: boolean): boolean {
  return def.stillWhileSpeaking && speaking;
}

/* ── The playback budget ──────────────────────────────────────────────
   House law: the hall stays smooth on phones. At most this many
   loop videos decode at once — the nearest visible figures win;
   everyone else holds their still. */

/** Hard cap on simultaneously decoding loop videos. */
export const MAX_LIVE_LOOPS = 6;

export interface LoopCandidate {
  /** The rig's identity (peer id, or the self marker). */
  key: string;
  /** Distance from the camera, meters. */
  distance: number;
  /** In the camera frustum (and the rig shown) this frame. */
  visible: boolean;
}

/** Pick which loop-fed figures may play: visible only, nearest
 *  first, capped. Deterministic on ties (key order) so every
 *  client makes the same call about its own hall. */
export function selectLiveLoops(candidates: LoopCandidate[], cap: number = MAX_LIVE_LOOPS): Set<string> {
  const limit = Math.max(0, Math.floor(cap));
  const ranked = candidates
    .filter((c) => c.visible && Number.isFinite(c.distance))
    .sort((a, b) => a.distance - b.distance || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return new Set(ranked.slice(0, limit).map((c) => c.key));
}

/* ── The guard mask ───────────────────────────────────────────────────
   The still's alpha, tightened: the matte's faint outer skirt
   (alpha under ~48) reads as a pale rim when the video's backdrop
   shows through it against the dark hall, so the levels remap
   kills the skirt and saturates the core; the mask is then drawn
   inset by MASK_INSET_PX so its edge sits just inside the video
   figure's own edge. One-time build per figure (hall-scene). */

/** Inset (canvas px per side) applied to the loop mask. */
export const MASK_INSET_PX = 2;

/** Levels remap for a mask alpha byte: ≤48 → 0, ≥218 → 255,
 *  linear between. */
export function remapMaskAlpha(a: number): number {
  if (!Number.isFinite(a) || a <= 48) return 0;
  if (a >= 218) return 255;
  return Math.round((a - 48) * 1.5);
}
