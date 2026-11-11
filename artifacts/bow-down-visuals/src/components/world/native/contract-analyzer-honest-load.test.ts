/**
 * ContractAnalyzer (the in-World contract analyzer) —
 * honest action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A native-desk action panel with a THREE-WAY failure
 * taxonomy: a 402 gets the credits branch; any other non-ok
 * gets the status error carrying the server's message; and
 * an ok response whose payload fails the shape check gets
 * its OWN shape error (contractErrorShape) — a malformed
 * analysis is never rendered as a contract verdict, and
 * each failure class is distinguishable from the copy
 * alone. The verdict renders only past all three.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ContractAnalyzer.tsx");

describe("credits, status, and shape failures are three different lines", () => {
  it("the three-way taxonomy is pinned", () => {
    expect(src).toContain("if (res.status === 402) {");
    expect(src).toContain('setError(apiErrorMessage(data, t("worldTeamLegal.contractErrorStatus")));');
    expect(src).toContain('setError(t("worldTeamLegal.contractErrorShape"));');
    expect(src).toContain('setError(plainErrorText(err, t("worldTeamLegal.contractError")));');
  });
});
