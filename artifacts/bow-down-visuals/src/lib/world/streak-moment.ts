/**
 * streak-moment.ts — the Treasury streak MOMENT (THE-GAME §5(a),
 * Lane K2, item 3): when a member's creation streak crosses a
 * STREAK_MILESTONES step, the Treasury presents it as a moment —
 * flame step-up, the milestone, the new streak count, the VB it
 * carries.
 *
 * Detection mirrors level-watch.ts exactly, because the problem is
 * the same shape: the SERVER streak rail (GET /api/retention/streak)
 * is the only source of truth — currentStreak and each milestone's
 * reached/claimed flags come from it, never from a local counter.
 * This module only decides whether what the server reports is NEWS
 * on this device:
 *
 * - first-ever sighting → the highest reached milestone becomes the
 *   baseline SILENTLY. A milestone you crossed before the Treasury
 *   could see it is not news.
 * - highest reached milestone > baseline → a crossing: present the
 *   highest newly crossed milestone, then move the baseline up.
 * - highest reached < baseline → the baseline quietly follows down
 *   (the streak broke and rebuilt); a later re-crossing is news
 *   again on this device.
 *
 * WHY THIS MOMENT STAYS PERSONAL (no peer.moment broadcast): the
 * K1 witnessed-moment machinery verifies exactly two kinds
 * server-side — a quest claim (a quest_progress row with a claim
 * timestamp inside a 2-minute window) and a level-up (the server's
 * own level record). A streak milestone has NEITHER record: the
 * streak row stores only milestonesClaimed (a bare day-count array,
 * no timestamps) and lastCreationDate (a date, not a moment). There
 * is no server record a room could check a "streak crossed just
 * now" claim against, and this lane adds no schema — so the moment
 * is presented to the achiever in their Treasury only, and is never
 * sent as a moment.celebrate intent. Extending the protocol with
 * an unverifiable kind would let any client announce fake wins.
 */

import type { StreakMilestoneShape, StreakStatusShape } from "./objective-strip";

export const WORLD_STREAK_SEEN_PREFIX = "bdv_world_streak_seen_";

export function seenStreakKey(userId: string): string {
  return `${WORLD_STREAK_SEEN_PREFIX}${userId}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function saneMilestoneDays(n: unknown): number | null {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 10_000 ? n : null;
}

/** The highest milestone (in days) this device has already seen
 *  this user reach, or null when it has never seen one. */
export function readSeenStreakMilestone(storage: StorageLike, userId: string): number | null {
  try {
    const raw = storage.getItem(seenStreakKey(userId));
    if (raw == null) return null;
    return saneMilestoneDays(Number.parseInt(raw, 10));
  } catch {
    return null;
  }
}

export function writeSeenStreakMilestone(storage: StorageLike, userId: string, days: number): void {
  const sane = saneMilestoneDays(days);
  if (sane == null) return;
  try {
    storage.setItem(seenStreakKey(userId), String(sane));
  } catch {
    /* storage unavailable — detection simply re-baselines next time */
  }
}

/** The highest milestone the SERVER says this streak has reached
 *  (0 when none). Reached is the server's own flag — a milestone
 *  counts only when the rail marks it reached. */
export function highestReachedMilestone(status: StreakStatusShape): StreakMilestoneShape | null {
  let best: StreakMilestoneShape | null = null;
  for (const m of status.milestones) {
    if (m.reached && (best === null || m.days > best.days)) best = m;
  }
  return best;
}

export type StreakMomentVerdict =
  /** No trustworthy baseline yet: store `milestoneDays`, present nothing. */
  | { kind: "baseline"; milestoneDays: number }
  /** The streak crossed a new milestone since the baseline: present it. */
  | {
      kind: "crossed";
      milestone: StreakMilestoneShape;
      currentStreak: number;
    }
  /** Nothing new. */
  | { kind: "none" };

export function evaluateStreakCrossing(
  seenDays: number | null,
  status: StreakStatusShape,
): StreakMomentVerdict {
  const highest = highestReachedMilestone(status);
  const highestDays = highest?.days ?? 0;
  if (seenDays == null) return { kind: "baseline", milestoneDays: highestDays };
  if (highestDays > seenDays && highest) {
    return { kind: "crossed", milestone: highest, currentStreak: status.currentStreak };
  }
  if (highestDays < seenDays) return { kind: "baseline", milestoneDays: highestDays };
  return { kind: "none" };
}
