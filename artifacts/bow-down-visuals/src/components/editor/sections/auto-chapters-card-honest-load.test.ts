/**
 * AutoChaptersCard (automatic chapter generation) — honest
 * action states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An editor card with no mount load: the generate call
 * branches on non-ok BEFORE touching the timeline — it
 * parses the error body for the server's own message (with
 * the "Chapter generation failed" fallback) and routes it
 * to the error surface, so a failed generation never writes
 * chapters the analysis didn't return.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./AutoChaptersCard.tsx");

describe("chapters apply only from an ok response", () => {
  it("the non-ok branch reads the server's message before failing", () => {
    expect(src).toContain("if (!res.ok) {");
    expect(src).toContain('await res.json().catch(() => ({ error: "Chapter generation failed" }))');
  });
});
