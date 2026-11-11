/**
 * BrandOutreachPanel (the in-World brand outreach board) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * Both of the board's legs run the native parse-or-nothing
 * doctrine: the outreach result and the UGC-briefs result
 * are each computed as `res.ok ? normalize…(body) : null` —
 * a non-ok response yields null (the board's failure/empty
 * handling), never a normalized reading of an error body,
 * and a malformed ok body normalizes to null the same way.
 * Pitch and brief data are never painted from an unproven
 * payload.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./BrandOutreachPanel.tsx");

describe("both legs are parse-or-nothing", () => {
  it("the two gated normalizations are pinned", () => {
    expect(src).toContain("const result = res.ok ? normalizeBrandOutreachResult(body) : null;");
    expect(src).toContain("const result = res.ok ? normalizeUgcBriefResult(body) : null;");
  });
});
