/**
 * Showcase (public gallery) — honest load states (Stack 400 C-28:
 * the honest-load pin layer completing the "empty lie" audit).
 *
 * The gallery load already carries the honest machine — its own
 * comment states the law ("List-load failures are NOT an empty
 * gallery"). What was missing is the PIN: the fetch throws on a
 * non-ok answer, the catch sets loadError, `finally` clears loading,
 * and the render reaches "The showcase is just getting started" only
 * after the loading and error branches, with the error branch's
 * retry wired to retryNonce re-running the real effect. This file
 * pins that shape in source, like the sibling honest-load pins (the
 * FE suite runs in node, no DOM). The copy is hardcoded English in
 * the page, so the literals are pinned and there is no catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./index.tsx");
const loadAt = page.indexOf("fetch(`/api/showcase");
const loader = page.slice(page.indexOf("useEffect(() => {"), page.indexOf("}, [type, retryNonce]);"));

describe("failure path — a failed gallery load never reads as an empty gallery", () => {
  it("the loader throws on a non-ok response and records the error state in its catch", () => {
    expect(loadAt).toBeGreaterThan(-1);
    expect(loader).toContain('if (!r.ok) throw new Error("load failed");');
    expect(loader).toContain(".catch(() => setLoadError(true))");
  });

  it("the loader starts clean and always clears loading; success records the items", () => {
    expect(loader).toContain("setLoading(true);");
    expect(loader).toContain("setLoadError(false);");
    expect(loader).toContain(".then((d) => setItems(Array.isArray(d.items) ? d.items : []))");
    expect(loader).toContain(".finally(() => setLoading(false));");
    expect(page).toContain("const [loadError, setLoadError] = useState(false);");
  });

  it("failure renders the error panel with its copy and a retry wired to the real load", () => {
    expect(page).toContain("Couldn't load the showcase.");
    expect(page).toContain("Something went wrong on our end — the creations are safe, this page just couldn't reach them.");
    expect(page).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the first load renders the pending state, not the empty panel", () => {
    expect(page).toContain("Loading showcase…");
  });

  it("the empty panel renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{loading ? (");
    const errorAt = page.indexOf(") : loadError ? (");
    const emptyAt = page.indexOf(") : items.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain("The showcase is just getting started.");
  });
});
