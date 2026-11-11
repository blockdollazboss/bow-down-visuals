/**
 * RandomizerBench (the in-World idea randomizer + AI leg) —
 * honest action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * - THE LOCAL RANDOMIZER is client-side play: it makes no
 *   server claim at all — its ideas come from the local pool
 *   in the member's own browser, and nothing about it is
 *   presented as fetched or proven data.
 * - THE AI LEG follows the bench doctrine: credits get
 *   their own branch (402 status or the body's
 *   out_of_credits code), and the AI ideas render only from
 *   `!res.ok || !ideas` inverted — a parsed proven payload;
 *   the local pool is never quietly substituted for an AI
 *   result the call didn't return.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./RandomizerBench.tsx");

describe("the AI leg requires a parsed proven payload", () => {
  it("the taxonomy and the parse gate are pinned", () => {
    expect(src).toContain('if (res.status === 402 || (data as { error?: string }).error === "out_of_credits") {');
    expect(src).toContain("if (!res.ok || !ideas) {");
  });
});
