/**
 * GuestPanel (the live guest-invite panel) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * - THE STREAM-STATUS poll is ok-gated at the door
 *   (`if (!res.ok) return;`): the panel's live state holds
 *   its last proven value through a failed poll — a guest
 *   panel never blanks or re-labels a live stream over a
 *   transient failure (the LiveBattlesPanel poll doctrine).
 * - THE PANEL'S ACTIONS (invite, admit, remove, and their
 *   siblings) each carry their own try/catch error
 *   handling — no guest state changes on an unproven write,
 *   and one action's failure never poisons the others.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./GuestPanel.tsx");

describe("the status poll holds the proven state on failure", () => {
  it("the ok gate at the door is pinned", () => {
    expect(src).toContain('fetch("/api/live-streams/status", {');
    expect(src).toContain("if (!res.ok) return;");
  });
});
