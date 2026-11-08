import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack 400 A-08 — the Viral Sharer "Reward TBD" badge is gone.
 *
 * The owner ruled the Viral Sharer reward on 2026-11-08: 25 Visual
 * Bucs, drawn from the existing shared 300 VB/week quest pool. The
 * widget renders each quest's reward from the server payload (the
 * backend QUEST_DEFS are the single source), so the ruled def is
 * what makes the real reward show and the TBD pill unreachable for
 * this quest. These pins hold that wiring: if the def ever drops
 * back to an unruled number, or the widget stops rendering the
 * payload reward, this file goes red.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("quests reward ruling (Stack 400 A-08)", () => {
  it("backend QUEST_DEFS carry the ruled 25 VB for viral-sharer", () => {
    const retention = read("../../../api-server/src/lib/retention.ts");
    const defLine = retention
      .split("\n")
      .find((line) => line.includes('"viral-sharer"') && line.includes("Viral Sharer"));
    expect(defLine).toBeDefined();
    expect(defLine).toContain("reward: 25");
  });

  it("the widget renders the payload reward, so the ruled 25 VB is what shows", () => {
    const widget = read("../components/QuestsWidget.tsx");
    /* The reward slot renders "{q.reward} VB" from the server
       payload whenever the reward is a ruled (positive) number —
       the TBD pill only exists behind the reward <= 0 branch. */
    expect(widget).toContain("{q.reward} VB");
    expect(widget).toContain("q.reward > 0");
  });

  it("the widget hard-codes no reward of its own for viral-sharer (single source)", () => {
    const widget = read("../components/QuestsWidget.tsx");
    const metaLine = widget
      .split("\n")
      .find((line) => line.includes('"viral-sharer":'));
    expect(metaLine).toBeDefined();
    expect(metaLine).not.toContain("reward");
  });
});
