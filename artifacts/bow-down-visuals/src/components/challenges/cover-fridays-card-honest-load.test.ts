/**
 * CoverFridaysCard (the Cover Fridays challenge card) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An optional challenge card whose doctrine is stated in
 * its own source: the read is ok-gated, the payload passes
 * through the one contract door (normalizeCoverFridaysPayload
 * — "the wire is not the view model"), and the normalizer
 * returns null when the payload carries no theme, "which
 * keeps the card's rule: a failed or empty read hides the
 * card". The card's LIVE state derives only from the proven
 * normalized challenge (`data.challenge.status === "live"`)
 * — a challenge is never shown as running on an unproven
 * read.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./CoverFridaysCard.tsx");

describe("a failed or empty read hides the card; live derives from proven data", () => {
  it("the ok gate, the normalizer door, and the live derivation are pinned", () => {
    expect(src).toContain(".then((r) => (r.ok ? r.json() : null))");
    expect(src).toContain("a failed or empty read hides the card");
    expect(src).toContain('const live = data.challenge && data.challenge.status === "live";');
  });
});
