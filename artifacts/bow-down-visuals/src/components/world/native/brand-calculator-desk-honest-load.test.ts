/**
 * BrandCalculatorDesk (the in-World brand-rate calculator)
 * — honest action states (Stack-400 C-28 components
 * residual, deep-pins tranche 6).
 *
 * A native-desk action panel, the parse-or-nothing doctrine:
 * the result renders only from `res.ok ?
 * brandCalcResultOf(data) : null` — a non-ok response AND a
 * malformed ok body both yield null, which lands on the
 * hiccup error line; a calculation is never painted from an
 * unproven payload. The form validates first (bcFillFirst),
 * a 402 gets its own branch with a profile refresh (the
 * balance truth is re-read, never assumed), and the busy
 * state settles in the shared catch/finally path.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./BrandCalculatorDesk.tsx");

describe("the calculation renders only from a parsed proven result", () => {
  it("the parse-or-nothing gate and the validation are pinned", () => {
    expect(src).toContain("const parsed = res.ok ? brandCalcResultOf(data) : null;");
    expect(src).toContain('setError(t("worldCoachMoney.bcFillFirst"));');
    expect(src).toContain('setError(plainErrorText(e, t("worldCoachMoney.bcHiccup")));');
  });
});
