/**
 * Shorts — honest load states (Stack 400 C-28: the honest-load pin
 * layer completing the "empty lie" audit). Residual pin verified
 * against both shapes: this page was wrapped by resilience-live
 * (stack1600/s400-resilience-live @ df87eb650) with SectionBoundary
 * wrappers only — every string asserted here is present verbatim in
 * BOTH the join14 page and the banked branch version (loader logic
 * identical; only wrapping/indentation moved).
 *
 * Before: a failed feed load only toasted, items stayed empty, and
 * once loading ended the genuine "No shorts yet" state rendered —
 * a failed load dressed as an empty stage. After: apiGet throws on
 * !res.ok, the first-page effect's catch sets loadError, and the
 * render's early returns run loading, then the error panel (with a
 * retry wired to retryNonce re-running the real effect), and the
 * empty state only after both. The copy is hardcoded English in the
 * page, so the literals are pinned and there is no catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./shorts.tsx");

describe("failure path — a failed feed load never reads as an empty stage", () => {
  it("the feed getter throws on a non-ok response", () => {
    expect(page).toContain("if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);");
  });

  it("the first-page load records the error state in its catch and always clears loading", () => {
    expect(page).toContain("const [loadError, setLoadError] = useState(false);");
    expect(page).toContain("setLoadError(false);");
    expect(page).toContain("setLoadError(true);");
    expect(page).toContain("if (!cancelled) setLoading(false);");
  });

  it("a successful load records the feed items", () => {
    expect(page).toContain("setItems(first.items);");
  });

  it("failure renders the error panel with its copy and a retry wired to the real load", () => {
    expect(page).toContain("Couldn't load the shorts feed.");
    expect(page).toContain("Something went wrong on our end — that's a failed load, not an empty stage.");
    expect(page).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the empty state renders only after the loading and error early returns", () => {
    const loadingAt = page.indexOf("if (loading) {");
    const errorAt = page.indexOf("if (loadError && !items.length) {");
    const emptyAt = page.indexOf("if (!items.length) {");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain("No shorts yet — the stage is yours.");
  });
});
