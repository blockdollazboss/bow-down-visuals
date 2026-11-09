/**
 * Hashtag hub (/hashtag/:tag) — honest load states (Stack 400 C-28:
 * the honest-load pin layer completing the "empty lie" audit).
 *
 * The tag payload (shorts + videos + tracks + challenges) already
 * carries the honest machine — its own comment states the law
 * ("a failed load is NOT '0 pieces of content'"): the loader throws
 * on a non-ok response, the catch sets loadError and clears data,
 * the spinner renders while loading, and the "Nothing tagged #…
 * yet" panel renders only after the error branch, whose retry
 * bumps retryNonce to re-run the real effect. This file pins that
 * shape in source, like the sibling honest-load pins (the FE suite
 * runs in node, no DOM). The error/empty copy is hardcoded English
 * in the page, so the literals are pinned and there is no catalog
 * block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./hashtag.tsx");
const loadAt = page.indexOf("const res = await fetch(`/api/hashtag/");
const loader = page.slice(loadAt, page.indexOf("}, [tag, retryNonce]);", loadAt));

describe("failure path — a failed tag load never reads as zero pieces of content", () => {
  it("the loader throws on a non-ok response and records the error state in its catch", () => {
    expect(loader).toContain("if (!res.ok) throw new Error(String(res.status));");
    expect(loader).toContain("if (!cancelled) { setData(null); setLoadError(true); }");
  });

  it("a successful load records the payload and always clears loading", () => {
    expect(loader).toContain("if (!cancelled) setData(json);");
    expect(loader).toContain("if (!cancelled) setLoading(false);");
  });

  it("the state machine starts loading with a distinct error state", () => {
    expect(page).toContain("const [loading, setLoading] = useState(true);");
    expect(page).toContain("const [loadError, setLoadError] = useState(false);");
  });

  it("failure renders the error panel with a retry wired to the real load", () => {
    expect(page).toContain('data-testid="hashtag-load-error"');
    expect(page).toContain("This hashtag couldn't load — it may have plenty tagged. Nothing was counted.");
    expect(page).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(page).toContain("Try again");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the loading spinner renders before any content branch", () => {
    expect(page.indexOf("if (loading) {")).toBeGreaterThan(-1);
    expect(page.indexOf("if (loading) {")).toBeLessThan(page.indexOf("{loadError ? ("));
  });

  it("the empty panel renders only after the error branch", () => {
    const errorAt = page.indexOf("{loadError ? (");
    const emptyAt = page.indexOf(") : !data || total === 0 ? (");
    expect(errorAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain("Nothing tagged #");
  });
});
