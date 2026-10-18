/**
 * moments.ts — the witnessed-moment surface language (THE-GAME §5(a)).
 *
 * Two pure pieces the page and the claim flow share:
 * - the DOM event a successful quest claim fires, and
 * - the line a witnessed moment reads as in the world chrome.
 */
import type { WorldMoment } from "./world-client";

/**
 * Fired (as a DOM CustomEvent) by the Treasury quest claim flow the
 * moment a claim succeeds. Harmless on the 2D site, which ignores
 * it; pages/world.tsx listens while the palace is open and turns it
 * into the room's celebrate intent + a level re-check. Detail
 * carries the claim's own facts for listeners that want them — the
 * room itself never trusts them (it verifies server-side).
 */
export const QUEST_CLAIMED_EVENT = "bdv:quest-claimed";

export interface QuestClaimedDetail {
  questKey: string;
  reward: number;
}

/** Dispatch the quest-claimed event. A no-op where there is no
 *  window (tests, SSR) — the claim itself already succeeded; the
 *  event is only ever a notification. */
export function dispatchQuestClaimed(detail: QuestClaimedDetail): void {
  try {
    if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
    window.dispatchEvent(new CustomEvent<QuestClaimedDetail>(QUEST_CLAIMED_EVENT, { detail }));
  } catch {
    /* the event is a courtesy — never let it break a claim */
  }
}

/**
 * The moment line, exactly as the room reads it. Wins are public,
 * balances and progress stay private (§5 Q3): a quest moment names
 * the quest and its reward, a level-up names the new star count —
 * nothing else about the achiever's numbers is ever in the line.
 */
export function formatMomentLine(moment: WorldMoment): string {
  if (moment.kind === "quest") {
    return `★ ${moment.name} completed '${moment.questName}' — +${moment.rewardVb} VB`;
  }
  return `${moment.name} leveled up — now ${moment.stars} stars`;
}
