/**
 * quest-reward-ruling.test.ts — Stack 400 A-08 pins.
 *
 * The Viral Sharer quest showed users a "Reward TBD" badge because
 * its reward had never been ruled. On 2026-11-08 the owner ruled it:
 * "Set the price on whatever you recommend" — 25 Visual Bucs, drawn
 * from the EXISTING shared weekly quest pool (lib/quest-pool). These
 * pins hold the ruling in place:
 *   - the def carries the ruled 25 VB;
 *   - every quest on the slate carries a ruled reward (> 0), so no
 *     quest surface can render the TBD badge for a live quest;
 *   - the slate still fits inside the weekly pool, and the pool
 *     envelope itself is unchanged at 300 VB/week (no cap raised,
 *     no new pool created).
 */
import { describe, it, expect } from "vitest";
import { QUEST_DEFS } from "../retention";
import { WEEKLY_QUEST_POOL_VB } from "../quest-pool";

describe("A-08 — Viral Sharer reward ruling (2026-11-08)", () => {
  it("the Viral Sharer def carries the ruled 25 VB reward", () => {
    const def = QUEST_DEFS.find((q) => q.key === "viral-sharer");
    expect(def).toBeDefined();
    expect(def!.reward).toBe(25);
    expect(def!.target).toBe(3);
    expect(def!.kinds).toEqual(["share"]);
  });

  it("every quest on the slate carries a ruled reward — no TBD badge can render", () => {
    /* The quest surfaces (QuestsWidget, Treasury Quest Depths) render
       the "Reward TBD" pill exactly when a quest's reward is <= 0.
       With every def ruled, that branch is unreachable for the live
       slate and each quest shows its real reward instead. */
    for (const def of QUEST_DEFS) {
      expect(def.reward, `${def.key} reward`).toBeGreaterThan(0);
    }
  });

  it("the slate fits the shared pool and the pool envelope is unchanged", () => {
    const slateTotal = QUEST_DEFS.reduce((sum, q) => sum + q.reward, 0);
    expect(slateTotal).toBe(265); // 40 + 80 + 120 + 25
    expect(slateTotal).toBeLessThanOrEqual(WEEKLY_QUEST_POOL_VB);
    /* The envelope is standing law (≤300 VB/wk shared with King
       gifts, the tutorial reward and the Daily Quest Trio): the
       ruling spends from it, it does not raise it. */
    expect(WEEKLY_QUEST_POOL_VB).toBe(300);
  });
});
