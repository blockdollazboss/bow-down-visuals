/**
 * "Your First 10 Minutes" — the tutorial rail (lib/world-tutorial
 * + lib/quest-pool, Ring 3, Phase 6).
 *
 * Pinned contract:
 * - The seven steps complete IN ORDER. A verb counts only while
 *   its step is current — nothing banks early, nothing skips.
 * - Fact steps reconcile off the real rails on every read,
 *   advancing through any consecutive satisfied run.
 * - The completion reward (30 VB) pays ONCE, ever, and rides the
 *   shared weekly quest pool (quest claims + King gifts +
 *   tutorial rewards ≤ 300 VB/week, the one envelope in
 *   lib/quest-pool): a spent week refuses with "pool" and the
 *   reward waits; a failed grant unstamps the claim so the
 *   member can land it on a retry.
 */
import { describe, it, expect } from "vitest";
import {
  TUTORIAL_REWARD_VB,
  TUTORIAL_STEPS,
  getTutorialStatus,
  noteTutorialVerb,
  createTutorialClaimer,
  type TutorialStore,
  type TutorialProgressRow,
  type TutorialFacts,
} from "../world-tutorial";
import {
  questPoolWeekStart,
  questPoolSpendVb,
  type QuestPoolStore,
} from "../quest-pool";

const NO_FACTS: TutorialFacts = {
  dailyClaimedToday: false,
  songMadeThisWeek: false,
  hasPublishedTrack: false,
  hasClaimedQuest: false,
};
const ALL_FACTS: TutorialFacts = {
  dailyClaimedToday: true,
  songMadeThisWeek: true,
  hasPublishedTrack: true,
  hasClaimedQuest: true,
};

class FakeTutorialStore implements TutorialStore {
  rows = new Map<string, TutorialProgressRow>();
  factSet: TutorialFacts = { ...NO_FACTS };
  grants: { userId: string; amountVb: number }[] = [];
  grantFails = false;

  async getProgress(userId: string) {
    const row = this.rows.get(userId);
    return row ? { ...row, completedSteps: [...row.completedSteps] } : null;
  }
  async ensureProgress(userId: string) {
    if (!this.rows.has(userId)) {
      this.rows.set(userId, {
        currentStep: 1,
        completedSteps: [],
        completedAt: null,
        rewardAmountVb: null,
        rewardClaimedAt: null,
      });
    }
    return this.getProgress(userId) as Promise<TutorialProgressRow>;
  }
  async saveProgress(
    userId: string,
    patch: { currentStep: number; completedSteps: string[]; completedAt: Date | null },
  ) {
    const row = this.rows.get(userId);
    if (!row) throw new Error("no row");
    row.currentStep = patch.currentStep;
    row.completedSteps = [...patch.completedSteps];
    row.completedAt = patch.completedAt;
  }
  async markRewardClaimed(userId: string, amountVb: number, now: Date) {
    const row = this.rows.get(userId);
    if (!row || !row.completedAt || row.rewardClaimedAt) return false;
    row.rewardAmountVb = amountVb;
    row.rewardClaimedAt = now;
    return true;
  }
  async unmarkRewardClaimed(userId: string) {
    const row = this.rows.get(userId);
    if (row) {
      row.rewardAmountVb = null;
      row.rewardClaimedAt = null;
    }
  }
  async grant(userId: string, amountVb: number) {
    if (this.grantFails) throw new Error("grant boom");
    this.grants.push({ userId, amountVb });
  }
  async facts() {
    return { ...this.factSet };
  }
}

const NOW = new Date("2026-10-17T12:00:00.000Z"); // Saturday

/** Walk a member through the whole line on the given store:
 *  verbs in order, with every fact satisfied so the fact steps
 *  reconcile through. */
async function walkTheLine(store: FakeTutorialStore, userId = "user-a") {
  store.factSet = { ...ALL_FACTS };
  await noteTutorialVerb(store, userId, "meet-king", NOW);
  await getTutorialStatus(store, userId, NOW); // fact 2 reconciles → step 3
  await noteTutorialVerb(store, userId, "quest-board", NOW);
  await getTutorialStatus(store, userId, NOW); // facts 4+5 reconcile → step 6
  await noteTutorialVerb(store, userId, "applaud", NOW); // 6 + fact 7 → complete
}

describe("the quest line (lib/world-tutorial)", () => {
  it("the line stands as THE-GAME §4.6 item 6 rules it: seven steps, in order", () => {
    expect(TUTORIAL_STEPS.map((s) => s.key)).toEqual([
      "meet-the-king",
      "claim-daily-drop",
      "quest-board",
      "make-a-song",
      "publish",
      "applaud",
      "claim-quest-reward",
    ]);
    expect(TUTORIAL_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("a fresh member stands at step 1 with nothing done", async () => {
    const store = new FakeTutorialStore();
    const status = await getTutorialStatus(store, "user-a", NOW);
    expect(status.currentStep).toBe(1);
    expect(status.completed).toBe(false);
    expect(status.steps.every((s) => !s.done)).toBe(true);
    expect(status.reward).toEqual({ amountVb: TUTORIAL_REWARD_VB, claimed: false });
  });

  it("a verb counts only while its step is current — applause at step 1 banks nothing", async () => {
    const store = new FakeTutorialStore();
    await noteTutorialVerb(store, "user-a", "applaud", NOW);
    await noteTutorialVerb(store, "user-a", "quest-board", NOW);
    const status = await getTutorialStatus(store, "user-a", NOW);
    expect(status.currentStep).toBe(1);
    expect(status.steps.every((s) => !s.done)).toBe(true);
  });

  it("facts reconcile through consecutive steps on one read, and stop at an unsatisfied step", async () => {
    const store = new FakeTutorialStore();
    await noteTutorialVerb(store, "user-a", "meet-king", NOW);
    store.factSet = { ...ALL_FACTS, hasClaimedQuest: false };
    const mid = await getTutorialStatus(store, "user-a", NOW);
    // Step 2 (daily fact) lands from the verb's own reconcile;
    // step 3 is a verb and waits.
    expect(mid.currentStep).toBe(3);
    expect(mid.steps.filter((s) => s.done).map((s) => s.key)).toEqual([
      "meet-the-king",
      "claim-daily-drop",
    ]);
    await noteTutorialVerb(store, "user-a", "quest-board", NOW);
    const late = await getTutorialStatus(store, "user-a", NOW);
    // Steps 4 + 5 (song + publish facts) reconcile through in one
    // read; step 6 is the applaud verb and waits.
    expect(late.currentStep).toBe(6);
    expect(late.steps.filter((s) => s.done).map((s) => s.n)).toEqual([1, 2, 3, 4, 5]);
  });

  it("the whole line completes and the status reads done", async () => {
    const store = new FakeTutorialStore();
    await walkTheLine(store);
    const status = await getTutorialStatus(store, "user-a", NOW);
    expect(status.completed).toBe(true);
    expect(status.currentStep).toBeNull();
    expect(status.steps.every((s) => s.done)).toBe(true);
  });
});

describe("the completion reward", () => {
  const poolOf = (spend: number): QuestPoolStore => ({
    questClaimsVb: async () => spend,
    kingClaimsVb: async () => 0,
    tutorialClaimsVb: async () => 0,
  });

  it("an unfinished line refuses not-completed and pays nothing", async () => {
    const store = new FakeTutorialStore();
    await getTutorialStatus(store, "user-a", NOW);
    const claim = createTutorialClaimer(store, poolOf(0));
    await expect(claim("user-a", NOW)).resolves.toEqual({ ok: false, reason: "not-completed" });
    expect(store.grants).toEqual([]);
  });

  it("a finished line pays TUTORIAL_REWARD_VB once — the second claim reads already", async () => {
    const store = new FakeTutorialStore();
    await walkTheLine(store);
    const claim = createTutorialClaimer(store, poolOf(0));
    await expect(claim("user-a", NOW)).resolves.toEqual({ ok: true, amountVb: TUTORIAL_REWARD_VB });
    expect(store.grants).toEqual([{ userId: "user-a", amountVb: TUTORIAL_REWARD_VB }]);
    await expect(claim("user-a", NOW)).resolves.toEqual({ ok: false, reason: "already" });
    expect(store.grants).toHaveLength(1);
  });

  it("the reward rides the shared pool: 270 spent pays (270+30=300), 280 refuses pool", async () => {
    const store = new FakeTutorialStore();
    await walkTheLine(store);
    await expect(createTutorialClaimer(store, poolOf(280))("user-a", NOW)).resolves.toEqual({
      ok: false,
      reason: "pool",
    });
    expect(store.grants).toEqual([]);
    await expect(createTutorialClaimer(store, poolOf(270))("user-a", NOW)).resolves.toEqual({
      ok: true,
      amountVb: TUTORIAL_REWARD_VB,
    });
  });

  it("a failed grant unstamps the claim — the member can land it on a retry", async () => {
    const store = new FakeTutorialStore();
    await walkTheLine(store);
    store.grantFails = true;
    const claim = createTutorialClaimer(store, poolOf(0));
    await expect(claim("user-a", NOW)).resolves.toEqual({ ok: false, reason: "error" });
    const row = await store.getProgress("user-a");
    expect(row?.rewardClaimedAt).toBeNull();
    store.grantFails = false;
    await expect(claim("user-a", NOW)).resolves.toEqual({ ok: true, amountVb: TUTORIAL_REWARD_VB });
  });
});

describe("the shared pool (lib/quest-pool)", () => {
  it("the week starts Monday (UTC): Wednesday and Sunday share a week, Monday starts its own", () => {
    expect(questPoolWeekStart(new Date("2026-10-14T09:00:00.000Z"))).toBe("2026-10-12"); // Wed
    expect(questPoolWeekStart(new Date("2026-10-18T23:00:00.000Z"))).toBe("2026-10-12"); // Sun
    expect(questPoolWeekStart(new Date("2026-10-19T00:00:00.000Z"))).toBe("2026-10-19"); // Mon
    expect(questPoolWeekStart(new Date("2026-10-17T12:00:00.000Z"))).toBe("2026-10-12"); // Sat
  });

  it("spend is the sum of all three rails — quests, King gifts, tutorial rewards", async () => {
    const pool: QuestPoolStore = {
      questClaimsVb: async () => 120,
      kingClaimsVb: async () => 50,
      tutorialClaimsVb: async () => 30,
    };
    await expect(questPoolSpendVb(pool, "user-a", "2026-10-12")).resolves.toBe(200);
  });
});
