/**
 * SocialKitBench (the in-World social-kit bench) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A native-bench twin of the 2D SocialKitPanel: a 402 gets
 * its own branch, and the kit renders only from `!res.ok ||
 * !list` inverted — the payload must parse into a real list,
 * so a malformed body can never paint a kit. The follow-up
 * asset save is wrapped non-fatal with its reason stated in
 * the source ("the asset still shows on the bench") — the
 * PROVEN result is already on screen; the save's failure
 * never un-shows it or errors over it.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SocialKitBench.tsx");

describe("the kit requires a parsed proven payload", () => {
  it("the 402 branch and the parse gate are pinned", () => {
    expect(src).toContain("if (res.status === 402) {");
    expect(src).toContain("if (!res.ok || !list) {");
    expect(src).toContain("/* non-fatal — the asset still shows on the bench */");
  });
});
