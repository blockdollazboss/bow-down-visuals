/**
 * Wave8RepurposeBenches (the in-World wave8 repurpose
 * benches — highlights leg) — honest action states
 * (Stack-400 C-28 components residual, deep-pins tranche 6).
 *
 * A native-bench twin of the 2D HighlightCutter: a missing
 * source speaks BEFORE the call (errorNoSource); a 402 gets
 * its own branch; and the moments render only from
 * `!res.ok || !parsed` inverted — a parsed proven payload.
 * The hub-tray save after success is wrapped non-fatal with
 * its reason stated ("the hub tray is a bonus, not the
 * result").
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./Wave8RepurposeBenches.tsx");

describe("no-source speaks first; moments require a parsed proven payload", () => {
  it("the precondition, the 402 branch, and the parse gate are pinned", () => {
    expect(src).toContain('setError(t("wave8.highlights.errorNoSource"));');
    expect(src).toContain("if (res.status === 402) {");
    expect(src).toContain("if (!res.ok || !parsed) {");
    expect(src).toContain("/* non-fatal — the hub tray is a bonus, not the result */");
  });
});
