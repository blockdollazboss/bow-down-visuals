/**
 * GroupDigestSettings (the group-digest account prefs) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A member of the house settings family (the pattern
 * exemplar, FeedbackPromptSettings, is pinned in this same
 * tranche): the prefs load throws on non-ok into a dedicated
 * loadError state whose retry bumps retryNonce and re-runs
 * the real load — a failed load never paints the default
 * prefs as the member's saved choices; the save is
 * optimistic WITH rollback (setPrefs(prev) on failure), so
 * the panel never keeps a state the server didn't store.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./GroupDigestSettings.tsx");

describe("the prefs load errors honestly instead of painting defaults", () => {
  it("non-ok lands on loadError and the retry re-runs the load", () => {
    expect(src).toContain('if (!res.ok) throw new Error("load failed");');
    expect(src).toContain("if (!cancelled) setLoadError(true);");
    expect(src).toContain("}, [user, getAccessToken, retryNonce]);");
  });
});

describe("the save rolls back on failure", () => {
  it("a refused save restores the previous proven prefs", () => {
    expect(src).toContain('if (!res.ok) throw new Error("save failed");');
    expect(src).toContain("setPrefs(prev); // revert on failure");
  });
});
