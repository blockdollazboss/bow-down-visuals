/**
 * AudienceRoomPanel (the Audience Room analytics panel) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A four-state data panel: the loader resets loading +
 * error each run; a 404 lands on its OWN branch (the room
 * doesn't exist yet — an answer, not a failure); any other
 * non-ok throws into the dedicated error line ("Couldn't
 * load your Audience Room — try again."); loading clears in
 * finally. Audience data is never painted from an error
 * body, and "no room yet" is never dressed as a load error.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./AudienceRoomPanel.tsx");

describe("404 is an answer; every other failure is an error", () => {
  it("the branch order and the error line are pinned", () => {
    const notFoundIdx = src.indexOf("if (res.status === 404) {");
    const gateIdx = src.indexOf('if (!res.ok) throw new Error("load failed");');
    expect(notFoundIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(notFoundIdx);
    expect(src).toContain('setError("Couldn\'t load your Audience Room — try again.");');
    expect(src).toContain("setLoading(false);");
  });
});
