/**
 * MilestoneTracker (creator milestone progress) — honest
 * load states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A textbook data panel: signed-out settles loading
 * immediately (no fake fetch); the loader resets loading +
 * error per run, throws on non-ok with the server's message
 * (the milestones.loadFailed copy behind it), and lands
 * failures on the error state via plainErrorText — milestone
 * progress (earned-rank data) is never painted from an
 * error body or shown as zero-progress on a failed load.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./MilestoneTracker.tsx");

describe("milestones load proven or error — never as fake zero progress", () => {
  it("the throw and the error landing are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("milestones.loadFailed")));');
    expect(src).toContain('setError(plainErrorText(e, t("milestones.loadFailed")));');
    expect(src).toContain("if (!user) { setLoading(false); return; }");
  });
});
