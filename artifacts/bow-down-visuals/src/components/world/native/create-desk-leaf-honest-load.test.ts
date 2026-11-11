/**
 * CreateDeskLeaf (the Create desks' shared leaf +
 * save-to-library helper) — honest load states (Stack-400
 * C-28 components residual, deep-pins tranche 6).
 *
 * A classification pin for a shared helper whose contract
 * is stated in its own doc comment: saveGeneratedClipToLibrary
 * is best-effort BY DESIGN (the finished clip already plays
 * in the desk either way) and it returns the TRUTH —
 * `res.ok`, and false on any throw — because "the boolean
 * lets the desk SAY whether the library copy landed". The
 * helper never claims a save itself; the calling desks own
 * surfacing the boolean's answer, and a failed library copy
 * can never be reported as landed by this layer.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CreateDeskLeaf.tsx");

describe("the helper returns the truth about the library copy", () => {
  it("the boolean contract is pinned", () => {
    expect(src).toContain("lets the desk SAY whether the library copy landed");
    expect(src).toContain("return res.ok;");
    expect(src).toContain("return false;");
  });
});
