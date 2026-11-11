/**
 * AdminBenchBits (the shared admin-bench state machinery)
 * — honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A classification pin for shared INFRASTRUCTURE: this file
 * is the phase machine the World's admin benches render
 * through — BenchPhase is "loading" | "denied" | "failed" |
 * "ready", with DENIED as its own phase (an access refusal
 * is an answer about permissions, never dressed as a load
 * failure or an empty bench) and FAILED distinct from every
 * flavor of empty. The shared renderer draws exactly the
 * phase the bench's proven state machine is in; benches
 * that consume it inherit the four-state law from here.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./AdminBenchBits.tsx");

describe("denied and failed are phases of their own", () => {
  it("the phase machine is pinned", () => {
    expect(src).toContain('export type BenchPhase = "loading" | "denied" | "failed" | "ready";');
    expect(src).toContain('useState<BenchPhase>("loading")');
    expect(src).toContain('if (phase === "loading") {');
  });
});
