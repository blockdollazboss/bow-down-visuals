/**
 * Level-up detection (lib/world/level-watch) — THE-GAME §5(a):
 * the first-ever sighting sets the baseline silently, only a rise
 * over the baseline is news, and the baseline is kept per user.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateLevel,
  readSeenLevel,
  seenLevelKey,
  writeSeenLevel,
} from "./level-watch";
import { formatMomentLine } from "./moments";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    map,
  };
}

describe("seen-level storage", () => {
  it("is keyed per user and round-trips a level", () => {
    const s = fakeStorage();
    expect(readSeenLevel(s, "user-a")).toBeNull();
    writeSeenLevel(s, "user-a", 3);
    expect(s.map.get(seenLevelKey("user-a"))).toBe("3");
    expect(readSeenLevel(s, "user-a")).toBe(3);
    expect(readSeenLevel(s, "user-b")).toBeNull();
  });

  it("garbage in storage reads as never-seen; garbage writes are refused", () => {
    const s = fakeStorage();
    s.map.set(seenLevelKey("user-a"), "banana");
    expect(readSeenLevel(s, "user-a")).toBeNull();
    s.map.set(seenLevelKey("user-a"), "9");
    expect(readSeenLevel(s, "user-a")).toBeNull();
    writeSeenLevel(s, "user-a", 0);
    expect(s.map.get(seenLevelKey("user-a"))).toBe("9");
  });
});

describe("evaluateLevel", () => {
  it("first-ever sighting baselines silently — no moment for a level you already had", () => {
    expect(evaluateLevel(null, 4)).toEqual({ kind: "baseline", level: 4 });
    expect(evaluateLevel(null, 1)).toEqual({ kind: "baseline", level: 1 });
  });

  it("a rise over the baseline is the only news", () => {
    expect(evaluateLevel(2, 3)).toEqual({ kind: "rise", level: 3 });
    expect(evaluateLevel(2, 6)).toEqual({ kind: "rise", level: 6 });
    expect(evaluateLevel(3, 3)).toEqual({ kind: "none" });
  });

  it("a lowered level re-baselines silently rather than arming a fake rise later", () => {
    expect(evaluateLevel(5, 2)).toEqual({ kind: "baseline", level: 2 });
  });

  it("a non-level current reading decides nothing", () => {
    expect(evaluateLevel(2, 0)).toEqual({ kind: "none" });
    expect(evaluateLevel(null, 7)).toEqual({ kind: "none" });
    expect(evaluateLevel(2, 2.5)).toEqual({ kind: "none" });
  });
});

describe("formatMomentLine", () => {
  it("a quest moment names the quest and its reward — no balance, no progress", () => {
    expect(
      formatMomentLine({ kind: "quest", peerId: "w1", name: "Nova Vale", questName: "Export a video", rewardVb: 120 }),
    ).toBe("★ Nova Vale completed 'Export a video' — +120 VB");
  });

  it("a level-up moment names the new star count", () => {
    expect(formatMomentLine({ kind: "levelup", peerId: "w1", name: "Nova Vale", stars: 4 })).toBe(
      "Nova Vale leveled up — now 4 stars",
    );
  });
});
