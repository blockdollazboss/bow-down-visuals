/**
 * First 100 Fans (#155) — the honesty contract, pinned:
 *  - the count is REAL follow rows, deduplicated by account
 *    (a duplicated row can never inflate it);
 *  - milestones are 1 / 10 / 25 / 50 / 100, reached at >=, with the
 *    boundary at exactly 100 completing the program;
 *  - a creator already past 100 reads as completed, with their
 *    early fans still being the FIRST 100 in follow order;
 *  - celebrations are planned exactly once (pending = reached minus
 *    celebrated) and a failed notification is never marked sent;
 *  - steps derive from real facts only;
 *  - the smart-law surface rule: snooze respected, a fresh milestone
 *    breaks it, a completed program retires.
 */
import { describe, expect, it } from "vitest";
import {
  FIRST100_MILESTONES,
  buildFirst100Status,
  celebrateFirst100,
  dedupeFollows,
  dismissFirst100,
  milestoneStates,
  nextMilestone,
  planCelebrations,
  reachedMilestones,
  shouldSurfaceFirst100,
  type First100Facts,
  type First100FollowRow,
  type First100PersistedState,
  type First100Sources,
  type First100Store,
} from "../first100";

const T = (iso: string) => new Date(iso);
const NOW = T("2026-10-26T12:00:00Z");

function follows(n: number, start = "2026-01-01T00:00:00Z"): First100FollowRow[] {
  const base = T(start).getTime();
  return Array.from({ length: n }, (_, i) => ({
    followerUserId: `u-${String(i + 1).padStart(3, "0")}`,
    createdAt: new Date(base + i * 60_000),
  }));
}

const FACTS_NEW: First100Facts = {
  hasProfile: false, profileComplete: false, isPublic: false, publishedWorks: 0, groupCount: 0,
};
const FACTS_READY: First100Facts = {
  hasProfile: true, profileComplete: true, isPublic: true, publishedWorks: 2, groupCount: 1,
};

function sources(partial: Partial<First100Sources>): First100Sources {
  return { follows: [], fanCards: new Map(), facts: FACTS_NEW, ...partial };
}
function state(partial: Partial<First100PersistedState>): First100PersistedState {
  return { celebrated: [], dismissedAt: null, snoozeUntil: null, completedAt: null, ...partial };
}

describe("milestone math from real follow fixtures", () => {
  it("exposes the ruled milestone ladder", () => {
    expect([...FIRST100_MILESTONES]).toEqual([1, 10, 25, 50, 100]);
  });

  it("reaches a milestone at exactly its number, not before", () => {
    expect(reachedMilestones(0)).toEqual([]);
    expect(reachedMilestones(1)).toEqual([1]);
    expect(reachedMilestones(9)).toEqual([1]);
    expect(reachedMilestones(10)).toEqual([1, 10]);
    expect(reachedMilestones(24)).toEqual([1, 10]);
    expect(reachedMilestones(25)).toEqual([1, 10, 25]);
    expect(reachedMilestones(50)).toEqual([1, 10, 25, 50]);
    expect(reachedMilestones(99)).toEqual([1, 10, 25, 50]);
  });

  it("boundary: exactly 100 reaches every milestone and completes", () => {
    expect(reachedMilestones(100)).toEqual([1, 10, 25, 50, 100]);
    const s = buildFirst100Status({ sources: sources({ follows: follows(100), facts: FACTS_READY }), state: state({}), now: NOW });
    expect(s.fanCount).toBe(100);
    expect(s.completed).toBe(true);
    expect(s.progressPct).toBe(100);
    expect(s.nextMilestone).toBeNull();
    expect(s.fansToNext).toBeNull();
    expect(s.currentMilestone).toBe(100);
  });

  it("99 fans is not complete and is 1 away from the final milestone", () => {
    const s = buildFirst100Status({ sources: sources({ follows: follows(99) }), state: state({}), now: NOW });
    expect(s.completed).toBe(false);
    expect(s.nextMilestone).toBe(100);
    expect(s.fansToNext).toBe(1);
    expect(s.progressPct).toBe(99);
  });

  it("next milestone steps through the ladder", () => {
    expect(nextMilestone(0)).toBe(1);
    expect(nextMilestone(1)).toBe(10);
    expect(nextMilestone(10)).toBe(25);
    expect(nextMilestone(49)).toBe(50);
    expect(nextMilestone(100)).toBeNull();
    expect(nextMilestone(250)).toBeNull();
  });
});

describe("no double count", () => {
  it("duplicate follow rows for one account count once", () => {
    const rows = [
      { followerUserId: "u-a", createdAt: T("2026-01-01T00:00:00Z") },
      { followerUserId: "u-a", createdAt: T("2026-01-02T00:00:00Z") },
      { followerUserId: "u-b", createdAt: T("2026-01-03T00:00:00Z") },
    ];
    expect(dedupeFollows(rows)).toHaveLength(2);
    const s = buildFirst100Status({ sources: sources({ follows: rows }), state: state({}), now: NOW });
    expect(s.fanCount).toBe(2);
    expect(s.earlyFans.map((f) => f.userId)).toEqual(["u-a", "u-b"]);
    expect(s.earlyFans[0].followedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("orders fans by follow time, so fan numbers are the real order", () => {
    const rows = [
      { followerUserId: "u-late", createdAt: T("2026-02-01T00:00:00Z") },
      { followerUserId: "u-early", createdAt: T("2026-01-01T00:00:00Z") },
    ];
    const s = buildFirst100Status({ sources: sources({ follows: rows }), state: state({}), now: NOW });
    expect(s.earlyFans.map((f) => [f.fanNumber, f.userId])).toEqual([[1, "u-early"], [2, "u-late"]]);
  });

  it("names fans from their real profile card; a fan with no profile gets no invented name", () => {
    const s = buildFirst100Status({
      sources: sources({
        follows: follows(2),
        fanCards: new Map([["u-001", { displayName: "Thy Cheat Code", slug: "thy-cheat-code", avatarUrl: null }]]),
      }),
      state: state({}),
      now: NOW,
    });
    expect(s.earlyFans[0]).toMatchObject({ displayName: "Thy Cheat Code", slug: "thy-cheat-code" });
    expect(s.earlyFans[1].displayName).toBeNull();
    expect(s.earlyFans[1].slug).toBeNull();
  });
});

describe("already-past-100 creators", () => {
  it("read as completed; the early list is still the FIRST 100, not the latest", () => {
    const s = buildFirst100Status({
      sources: sources({ follows: follows(137), facts: FACTS_READY }),
      state: state({ celebrated: [1, 10, 25, 50, 100], completedAt: T("2026-03-01T00:00:00Z") }),
      now: NOW,
    });
    expect(s.fanCount).toBe(137);
    expect(s.completed).toBe(true);
    expect(s.earlyFans).toHaveLength(100);
    expect(s.earlyFans[0].fanNumber).toBe(1);
    expect(s.earlyFans[99].fanNumber).toBe(100);
    expect(s.pendingCelebrations).toEqual([]);
    expect(s.surface).toBe(false);
    expect(s.steps.every((step) => step.done)).toBe(true);
    expect(s.nextStep).toBeNull();
  });

  it("a past-100 creator who was never celebrated is owed every celebration, once", () => {
    expect(planCelebrations(137, [])).toEqual([1, 10, 25, 50, 100]);
    expect(planCelebrations(137, [1, 10, 25, 50, 100])).toEqual([]);
  });
});

describe("celebration planning (exactly once)", () => {
  it("plans only reached-and-uncelebrated milestones", () => {
    expect(planCelebrations(0, [])).toEqual([]);
    expect(planCelebrations(3, [])).toEqual([1]);
    expect(planCelebrations(3, [1])).toEqual([]);
    expect(planCelebrations(30, [1])).toEqual([10, 25]);
    expect(planCelebrations(30, [1, 10, 25])).toEqual([]);
  });

  it("milestone states separate reached from celebrated", () => {
    expect(milestoneStates(12, [1])).toEqual([
      { milestone: 1, reached: true, celebrated: true },
      { milestone: 10, reached: true, celebrated: false },
      { milestone: 25, reached: false, celebrated: false },
      { milestone: 50, reached: false, celebrated: false },
      { milestone: 100, reached: false, celebrated: false },
    ]);
  });
});

describe("steps derive from real facts", () => {
  it("a brand-new creator has every step open and finish_profile first", () => {
    const s = buildFirst100Status({ sources: sources({}), state: state({}), now: NOW });
    expect(s.steps.map((x) => x.done)).toEqual([false, false, false, false, false]);
    expect(s.nextStep).toBe("finish_profile");
  });

  it("each fact completes exactly its own step", () => {
    const s = buildFirst100Status({
      sources: sources({ facts: { ...FACTS_NEW, hasProfile: true, profileComplete: true, isPublic: true } }),
      state: state({}),
      now: NOW,
    });
    expect(s.steps.find((x) => x.key === "finish_profile")?.done).toBe(true);
    expect(s.steps.find((x) => x.key === "go_public")?.done).toBe(true);
    expect(s.steps.find((x) => x.key === "drop_first_work")?.done).toBe(false);
    expect(s.nextStep).toBe("drop_first_work");
  });

  it("a private profile is not discoverable even with work published", () => {
    const s = buildFirst100Status({
      sources: sources({ facts: { ...FACTS_READY, isPublic: false } }),
      state: state({}),
      now: NOW,
    });
    expect(s.steps.find((x) => x.key === "go_public")?.done).toBe(false);
  });
});

describe("smart-law surface rule", () => {
  it("surfaces while the journey is live and unsnoozed", () => {
    expect(shouldSurfaceFirst100({ fanCount: 4, celebrated: [1], snoozeUntil: null, now: NOW })).toBe(true);
  });

  it("respects an active snooze with no new milestone", () => {
    expect(shouldSurfaceFirst100({
      fanCount: 4, celebrated: [1], snoozeUntil: T("2026-11-01T00:00:00Z"), now: NOW,
    })).toBe(false);
  });

  it("a fresh milestone breaks the snooze (celebration, not a nag)", () => {
    expect(shouldSurfaceFirst100({
      fanCount: 10, celebrated: [1], snoozeUntil: T("2026-11-01T00:00:00Z"), now: NOW,
    })).toBe(true);
  });

  it("an expired snooze surfaces again", () => {
    expect(shouldSurfaceFirst100({
      fanCount: 4, celebrated: [1], snoozeUntil: T("2026-10-20T00:00:00Z"), now: NOW,
    })).toBe(true);
  });

  it("retires once 100 is reached and fully celebrated, snooze or not", () => {
    expect(shouldSurfaceFirst100({
      fanCount: 150, celebrated: [1, 10, 25, 50, 100], snoozeUntil: null, now: NOW,
    })).toBe(false);
  });
});

/* ─── Service behaviour over a fake store ────────────────────────── */

function fakeStore(opts: {
  src: First100Sources;
  st?: Partial<First100PersistedState>;
  failNotifyFor?: number[];
}) {
  const persisted = state(opts.st ?? {});
  const sent: number[] = [];
  const store: First100Store = {
    loadSources: async () => opts.src,
    loadState: async () => ({ ...persisted, celebrated: [...persisted.celebrated] }),
    saveCelebrated: async (_u, celebrated, completedAt) => {
      persisted.celebrated = [...celebrated];
      persisted.completedAt = completedAt;
    },
    saveDismissal: async (_u, dismissedAt, snoozeUntil) => {
      persisted.dismissedAt = dismissedAt;
      persisted.snoozeUntil = snoozeUntil;
    },
    notify: async (_u, milestone) => {
      if (opts.failNotifyFor?.includes(milestone)) throw new Error("notify down");
      sent.push(milestone);
    },
  };
  return { store, sent, persisted };
}

describe("celebrateFirst100 (service)", () => {
  it("sends each pending celebration once, then never again", async () => {
    const { store, sent } = fakeStore({ src: sources({ follows: follows(30), facts: FACTS_READY }) });
    const first = await celebrateFirst100("creator-1", store, NOW);
    expect(sent).toEqual([1, 10, 25]);
    expect(first.pendingCelebrations).toEqual([]);
    const second = await celebrateFirst100("creator-1", store, NOW);
    expect(sent).toEqual([1, 10, 25]);
    expect(second.pendingCelebrations).toEqual([]);
  });

  it("stamps completion when the 100th fan's celebration lands", async () => {
    const { store, persisted } = fakeStore({ src: sources({ follows: follows(100), facts: FACTS_READY }) });
    const s = await celebrateFirst100("creator-1", store, NOW);
    expect(s.completed).toBe(true);
    expect(persisted.completedAt).toEqual(NOW);
    expect(persisted.celebrated).toEqual([1, 10, 25, 50, 100]);
  });

  it("a failed notification is not marked celebrated and is retried later", async () => {
    const { store, sent, persisted } = fakeStore({
      src: sources({ follows: follows(30), facts: FACTS_READY }),
      failNotifyFor: [25],
    });
    await celebrateFirst100("creator-1", store, NOW);
    expect(sent).toEqual([1, 10]);
    expect(persisted.celebrated).toEqual([1, 10]);
    const retry = fakeStore({
      src: sources({ follows: follows(30), facts: FACTS_READY }),
      st: { celebrated: persisted.celebrated },
    });
    await celebrateFirst100("creator-1", retry.store, NOW);
    expect(retry.sent).toEqual([25]);
  });

  it("sends nothing for a creator with no fans", async () => {
    const { store, sent } = fakeStore({ src: sources({}) });
    const s = await celebrateFirst100("creator-1", store, NOW);
    expect(sent).toEqual([]);
    expect(s.fanCount).toBe(0);
  });
});

describe("dismissFirst100 (service)", () => {
  it("snoozes the card for 7 days", async () => {
    const { store, persisted } = fakeStore({ src: sources({ follows: follows(3) }), st: { celebrated: [1] } });
    const s = await dismissFirst100("creator-1", store, NOW);
    expect(persisted.dismissedAt).toEqual(NOW);
    expect(persisted.snoozeUntil?.toISOString()).toBe("2026-11-02T12:00:00.000Z");
    expect(s.surface).toBe(false);
  });
});
