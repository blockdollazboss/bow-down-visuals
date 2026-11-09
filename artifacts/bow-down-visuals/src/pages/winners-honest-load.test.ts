/**
 * Winners' Circle — honest load states (Stack 400 C-28: the
 * honest-load pin layer completing the "empty lie" audit).
 *
 * The hall-of-fame / per-challenge winners load already carries the
 * honest machine: both fetch branches throw on a non-ok answer, the
 * catch sets loadError, a genuine 404 is kept apart as notFound, and
 * the render reaches the "No crowns handed out yet" panel only after
 * the loading and error branches — the error panel's retry bumps
 * the nonce that re-runs the real load. What was missing is the PIN;
 * this file pins the shape in source, like the sibling honest-load
 * pins (the FE suite runs in node, no DOM). The copy is hardcoded
 * English in the page, so the literals are pinned and there is no
 * catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./winners.tsx");

describe("failure path — a failed winners load never reads as an empty hall of fame", () => {
  it("both load branches throw on a non-ok answer and the catch records the error state", () => {
    expect(page.match(/if \(!res\.ok\) throw new Error\(String\(res\.status\)\);/g)?.length).toBeGreaterThanOrEqual(2);
    expect(page).toContain("if (!cancelled) setLoadError(true);");
    expect(page).toContain("if (!cancelled) setLoading(false);");
  });

  it("a genuine 404 is a not-found state, never conflated with a failed load", () => {
    expect(page).toContain("if (res.status === 404) { if (!cancelled) setNotFound(true); return; }");
  });

  it("failure renders its own panel, worded as a failure, with a retry that re-runs the load", () => {
    expect(page).toContain("Couldn't load the winners' circle.");
    expect(page).toContain("the crowns are safe, this page just couldn't reach them.");
    expect(page).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(page).toContain("}, [perChallenge, slug, retryNonce]);");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the no-crowns panel renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{loading ? (");
    const errorAt = page.indexOf(") : loadError ? (");
    const emptyAt = page.indexOf(") : !announced || notFound ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain("No crowns handed out yet.");
  });
});
