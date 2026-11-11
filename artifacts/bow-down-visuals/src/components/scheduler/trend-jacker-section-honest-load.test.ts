/**
 * TrendJackerSection (trend → hook + script draft) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An action panel with no mount load, the failure-taxonomy
 * shape (the MemeMachineSection family): a 402 status OR
 * the body's own out_of_credits code lands on the credits
 * branch BEFORE the general gate, and the draft renders only
 * from an ok response carrying BOTH halves of the package
 * (`!res.ok || !data.hook || !data.script`) — a partial
 * package is a failure line, never a half-draft presented as
 * the result. The busy flag clears in finally.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./TrendJackerSection.tsx");

describe("credits speak first; the draft requires both proven halves", () => {
  it("the taxonomy and the gate are pinned", () => {
    expect(src).toContain('if (res.status === 402 || data.error === "out_of_credits") {');
    expect(src).toContain('if (!res.ok || !data.hook || !data.script) throw new Error(apiErrorMessage(data, "Draft failed."));');
    expect(src).toContain("setLoading(false);");
  });
});
