/**
 * StoryboardPlanner (the World storyboard desk) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 2).
 *
 * - THE BOARDS LOAD rides an explicit loading/ready/failed
 *   machine: a non-ok read throws (with a human message) into
 *   the failed state; the board list and the open board record
 *   only from a proven payload, and the open board is picked
 *   from THAT payload — never carried over as if it were part
 *   of a list that didn't load.
 * - Panel writes and the frame-generation flow narrate from
 *   their checked responses (the desk's shared error state);
 *   the frame poll is the CreateDesks discipline — a finished
 *   frame lands only from a proven poll read.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const planner = read("./StoryboardPlanner.tsx");

describe("the boards load: loading, ready, failed — the open board comes from the payload", () => {
  it("a non-ok read throws into the failed state before anything records", () => {
    expect(planner).toContain('setLoadState("loading");');
    expect(planner).toContain('if (!res.ok) throw new Error("Your storyboards didn\'t load.");');
    expect(planner).toContain("const list = normalizeStoryboardList(await res.json());");
    expect(planner).toContain("setBoards(list);");
    expect(planner).toContain('setLoadState("ready");');
    expect(planner).toContain('setLoadState("failed");');
    expect(planner.indexOf('throw new Error("Your storyboards')).toBeLessThan(planner.indexOf("setBoards(list);"));
  });

  it("the open board is picked from the just-loaded list", () => {
    expect(planner).toContain("const open = list.find((b) => b.id === openId) ?? list[0] ?? null;");
    expect(planner).toContain("setBoard(open);");
  });
});
