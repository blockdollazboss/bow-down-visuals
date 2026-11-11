/**
 * StyleStealerSection (steal a style formula) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An editor section with no mount load, the failure-taxonomy
 * shape (the MemeMachineSection family): a 402 status OR
 * the body's own out_of_credits code lands on the credits
 * branch BEFORE the general gate, and the formula renders
 * only from an ok response carrying it (`!res.ok ||
 * !data.formula`) — a failure body never renders as a
 * stolen style. The busy flag clears in finally.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./StyleStealerSection.tsx");

describe("credits speak first; the formula requires the proven payload", () => {
  it("the taxonomy and the gate are pinned", () => {
    expect(src).toContain('if (res.status === 402 || data.error === "out_of_credits") {');
    expect(src).toContain('if (!res.ok || !data.formula) throw new Error(apiErrorMessage(data, "Analysis failed."));');
    expect(src).toContain("setLoading(false);");
  });
});
