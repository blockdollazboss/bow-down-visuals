/**
 * room-trim.ts — per-room trim identity for the palace's indoor
 * rooms (Stack-100 #2, board item 41).
 *
 * Facet A G-2: every indoor room wore the identical gold trim
 * line at the identical height (5.7 m, single, bright gold), so
 * the six wing rooms read as one shell re-skinned. This module
 * gives each room a deterministic trim identity — height,
 * profile (single or double line) and accent (bright gold or
 * dark gold) — derived from the room's own id by the same
 * seeded-hash discipline as prop-variation (item 18): the same
 * room wears the same trim on every visit, for every walker,
 * and no two adjacent rooms need agree.
 *
 * Pure data: hall-scene's wall runs take the profile as a
 * parameter; the hall itself keeps the house default (5.7,
 * single, bright) — the variation belongs to the wing rooms.
 */
import { hashSeed } from "./prop-variation";

export interface RoomTrimProfile {
  /** The trim line's height (metres). */
  y: number;
  /** A second line 0.18 m below the first. */
  double: boolean;
  /** Dark gold instead of bright gold. */
  dark: boolean;
}

/** The house default — the hall's own trim, unchanged. */
export const HOUSE_TRIM: RoomTrimProfile = { y: 5.7, double: false, dark: false };

const TRIM_HEIGHTS: readonly number[] = [5.7, 5.42, 5.98, 5.56, 5.84, 5.7];

/** A room's trim profile, from its id alone. Deterministic:
 *  the same id always yields the same profile. */
export function roomTrimProfile(roomId: string): RoomTrimProfile {
  const h = hashSeed(`trim:${roomId}`);
  return {
    y: TRIM_HEIGHTS[h % TRIM_HEIGHTS.length]!,
    double: (h >> 3) % 2 === 1,
    dark: (h >> 5) % 2 === 1,
  };
}
