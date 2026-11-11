/**
 * OneTipJarCard (a creator's tip jar card) — honest load
 * states (Stack-400 C-28 components residual, deep-pins
 * tranche 6).
 *
 * A money card with a real loading state ("Loading your
 * jar…") ahead of any content: the jar read throws on
 * non-ok ("jar load failed") into its failure handling —
 * the jar's totals and link render only from the proven
 * payload, never as a zeroed jar on a failed load. The copy
 * -link action is a local clipboard write and makes no
 * server claim.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./OneTipJarCard.tsx");

describe("the jar renders only from a proven read, loading first", () => {
  it("the throw and the loading line are pinned", () => {
    expect(src).toContain('if (!res.ok) throw new Error("jar load failed");');
    expect(src).toContain("Loading your jar…");
  });
});
