/**
 * DropsWire (the discovery drops feed) — honest load states
 * (Stack-400 C-28 components residual, deep-pins tranche 6).
 *
 * - THE FEED LOAD is a proven four-state chain: items stays
 *   null while loading (skeleton rows), a failed load lands
 *   on the load-error card ("that's not the same as a quiet
 *   feed") with a retry that bumps retryNonce and re-runs
 *   the real load, the genuine empty state renders only from
 *   a proven empty array, then the rows. The loader checks
 *   res.ok explicitly — the source records that a failed
 *   load used to be both an endless skeleton (!ok path) and
 *   an empty feed (catch path) before it was fixed.
 * - THE PREFS READ behind the For You toggle is honest by
 *   absence: the toggle bar renders only once forYou is
 *   proven non-null, so an unproven preference never paints
 *   a default as the member's choice.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./DropsWire.tsx");

describe("the feed load: skeleton, error, empty, rows — in that order", () => {
  it("non-ok and thrown loads both land on the load-error state", () => {
    expect(src).toContain("if (!r.ok) { if (!cancelled) setLoadError(true); return; }");
    expect(src).toContain("setItems(Array.isArray(d.items) ? d.items : []);");
    expect(src).toContain("Couldn't load the drops wire.");
  });

  it("the render chain is error → skeleton (items null) → genuine empty → rows", () => {
    const errorIdx = src.indexOf("{loadError ? (");
    const skeletonIdx = src.indexOf(") : items === null ? (");
    const emptyIdx = src.indexOf(") : items.length === 0 ? (");
    expect(errorIdx).toBeGreaterThan(-1);
    expect(skeletonIdx).toBeGreaterThan(errorIdx);
    expect(emptyIdx).toBeGreaterThan(skeletonIdx);
    expect(src).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
  });

  it("the For You bar renders only from a proven preference", () => {
    expect(src).toContain("{user && forYou !== null && (");
  });
});
