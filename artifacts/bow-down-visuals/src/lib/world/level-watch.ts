/**
 * level-watch.ts — level-up detection for the World (THE-GAME §5(a)).
 *
 * The game detects a rise, the server witnesses it: this module is
 * only the detection half, kept pure so the baseline rules are
 * unit-tested. The page calls the existing level-check endpoint
 * (GET /api/retention/level-check) on World entry and after each
 * quest claim, compares the creator's current stars against the
 * last level this device has SEEN for that user (localStorage,
 * per user), and:
 *
 * - first-ever sighting → the level becomes the baseline SILENTLY.
 *   A level you already held before the game could see it is not
 *   news, and the palace does not announce old rank as a rise.
 * - current > seen → a rise: the page records the celebration on
 *   the existing rail, fires the levelup intent (the room verifies
 *   it against the server's own level record before broadcasting),
 *   and the baseline moves up to the new level.
 * - current < seen → the baseline quietly follows down (the dial
 *   was lowered); a later return to the old level is a rise over
 *   the lowered baseline on this device, but the server-side
 *   session dedupe + its own level record keep it from ever being
 *   announced twice for a level already witnessed.
 */

export const WORLD_LEVEL_SEEN_PREFIX = "bdv_world_level_seen_";

export function seenLevelKey(userId: string): string {
  return `${WORLD_LEVEL_SEEN_PREFIX}${userId}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function saneLevel(n: unknown): number | null {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 6 ? n : null;
}

/** The last level this device has seen for the user, or null when
 *  it has never seen one (or what's stored is not a level). */
export function readSeenLevel(storage: StorageLike, userId: string): number | null {
  try {
    const raw = storage.getItem(seenLevelKey(userId));
    if (raw == null) return null;
    return saneLevel(Number.parseInt(raw, 10));
  } catch {
    return null;
  }
}

export function writeSeenLevel(storage: StorageLike, userId: string, level: number): void {
  const sane = saneLevel(level);
  if (sane == null) return;
  try {
    storage.setItem(seenLevelKey(userId), String(sane));
  } catch {
    /* storage unavailable — detection simply re-baselines next time */
  }
}

export type LevelVerdict =
  /** No trustworthy baseline for this level yet: store `level`, announce nothing. */
  | { kind: "baseline"; level: number }
  /** The level rose over the baseline: announce `level`, then store it. */
  | { kind: "rise"; level: number }
  /** Nothing changed (or the current reading is not a level). */
  | { kind: "none" };

export function evaluateLevel(seen: number | null, current: number): LevelVerdict {
  const cur = saneLevel(current);
  if (cur == null) return { kind: "none" };
  if (seen == null) return { kind: "baseline", level: cur };
  if (cur > seen) return { kind: "rise", level: cur };
  if (cur < seen) return { kind: "baseline", level: cur };
  return { kind: "none" };
}
