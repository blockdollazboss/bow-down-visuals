/**
 * AudienceAutoSegment (the auto-built audience segment
 * card) — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 6).
 *
 * A LoadState kind machine whose header states its own
 * doctrine — "Honest states: loading, no fans yet (no…)" —
 * the segment load throws on non-ok (its status rides the
 * error) into the machine's failure kind, so the card
 * renders exactly one of its labeled states: loading, the
 * proven segment, the genuine no-fans state, or the failure
 * state. A segment's size is never painted from an error
 * body, and "no fans yet" is reachable only from a proven
 * empty payload.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./AudienceAutoSegment.tsx");

describe("the segment renders exactly one labeled honest state", () => {
  it("the machine and the throw are pinned", () => {
    expect(src).toContain("Honest states: loading, no fans yet");
    expect(src).toContain('useState<LoadState>({ kind: "loading" })');
    expect(src).toContain("if (!res.ok) throw new Error(`fan-segments ${res.status}`);");
  });
});
