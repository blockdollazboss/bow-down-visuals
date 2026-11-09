/**
 * Genres index (/genres) — honest load states (Stack 400 C-28: the
 * honest-load pin layer completing the "empty lie" audit).
 *
 * Before: an HTTP error returned early leaving genres null (skeleton
 * forever) and a thrown error set [] — the fake "No genres tagged
 * yet". After (already in source): both failure shapes set loadError,
 * success records the genres array, and the render reaches "No
 * genres tagged yet" only after the error branch and the null
 * (loading) branch, with the error branch's retry bumping
 * retryNonce to re-run the real effect. This file pins that shape
 * in source, like the sibling honest-load pins (the FE suite runs
 * in node, no DOM). The error/empty copy is hardcoded English in
 * the page, so the literals are pinned and there is no catalog
 * block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./genres.tsx");
const loadAt = page.indexOf("const r = await fetch(`/api/discovery/genres");
const loader = page.slice(loadAt, page.indexOf("}, [vertical, retryNonce]);", loadAt));

describe("failure path — a failed genres load never reads as no genres tagged", () => {
  it("the loader records the error state on a non-ok response and on a throw", () => {
    expect(loader).toContain("if (!r.ok) { if (!cancelled) setLoadError(true); return; }");
    expect(loader).toContain("if (!cancelled) setLoadError(true);");
  });

  it("a successful load records the genres array", () => {
    expect(loader).toContain("setGenres(Array.isArray(d.genres) ? d.genres : []);");
  });

  it("the list starts unloaded (null = loading) with a distinct error state", () => {
    expect(page).toContain("const [genres, setGenres] = useState<GenreRow[] | null>(null);");
    expect(page).toContain("const [loadError, setLoadError] = useState(false);");
  });

  it("failure renders the error panel with a retry wired to the real load", () => {
    expect(page).toContain("Couldn't load the genres.");
    expect(page).toContain("that's not the same as no genres tagged yet.");
    expect(page).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(page).toContain("Try again");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the empty panel renders only after the error and loading branches", () => {
    const errorAt = page.indexOf("{loadError ? (");
    const loadingAt = page.indexOf(") : !genres ? (");
    const emptyAt = page.indexOf(") : genres.length === 0 ? (");
    expect(errorAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(errorAt);
    expect(emptyAt).toBeGreaterThan(loadingAt);
    expect(page).toContain('title="No genres tagged yet"');
  });
});
