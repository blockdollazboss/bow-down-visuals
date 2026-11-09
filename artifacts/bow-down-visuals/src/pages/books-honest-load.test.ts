/**
 * Books — honest load states (Stack 400 C-28: the honest-load pin
 * layer completing the "empty lie" audit).
 *
 * The books library load already carries the honest machine — its own
 * comment states the law ("A failed load is NOT an empty library").
 * What was missing is the PIN: loadBooks() throws on a non-ok answer,
 * the catch sets loadError, and the render reaches "No books yet"
 * only after the loading and error branches, with the error branch's
 * retry wired to the real loader. This file pins that shape in
 * source, like the sibling honest-load pins (the FE suite runs in
 * node, no DOM). The error/empty copy is hardcoded English in the
 * page, so the literals are pinned and there is no catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./books.tsx");
const loadAt = page.indexOf("const loadBooks = useCallback(async () => {");
const loader = page.slice(loadAt, page.indexOf("useEffect(() => { loadBooks(); }, [loadBooks]);", loadAt));

describe("failure path — a failed library load never reads as an empty library", () => {
  it("the loader throws on a non-ok response and records the error state in its catch", () => {
    expect(loader).toContain("if (!res || !res.ok) throw new Error();");
    expect(loader).toContain("setLoadError(true);");
  });

  it("a successful load clears the error state and always clears loading", () => {
    expect(loader).toContain("setBooks(data.books ?? []);");
    expect(loader).toContain("setLoadError(false);");
    expect(loader).toContain("setLoading(false);");
  });

  it("failure renders the error panel with a retry wired to the real loader", () => {
    expect(page).toContain("We couldn&apos;t load your books");
    expect(page).toContain('data-testid="btn-retry-books"');
    expect(page).toContain("onClick={() => void loadBooks()}");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the empty panel renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{loading ? (");
    const errorAt = page.indexOf(") : loadError ? (");
    const emptyAt = page.indexOf(") : books.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain("No books yet");
  });
});
