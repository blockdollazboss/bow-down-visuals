/**
 * Albums section (Songs page tab) — honest load states (Stack 400
 * C-28: the honest-load pin layer completing the "empty lie" audit).
 *
 * The albums list is HONEST-WITH-CO-RENDER: loadAlbums() throws on
 * a non-ok answer, the catch records the error text, and that error
 * line renders above the list — so on failure the page shows the
 * failure in words even though the empty panel also renders. A
 * failure is never silent. This file pins that shape in source,
 * like the sibling honest-load pins (the FE suite runs in node, no
 * DOM). The copy is hardcoded English in the page, so the literals
 * are pinned and there is no catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./albums-section.tsx");
const loadAt = page.indexOf("const loadAlbums = useCallback(async () => {");
const loader = page.slice(loadAt, page.indexOf("}, [authHeaders]);", loadAt));

describe("failure path — a failed albums load is never silent", () => {
  it("the loader throws on a non-ok answer and records the error text in its catch", () => {
    expect(loader).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, "Could not load albums."));');
    expect(loader).toContain('setError(plainErrorText(e, "Could not load albums."));');
    expect(loader).toContain("setAlbums(data.albums ?? []);");
    expect(loader).toContain("setLoading(false);");
  });

  it("the error line renders above the list, before the loading/empty branches", () => {
    const errorAt = page.indexOf('{error && <p className="text-sm text-red-400 mb-4">{error}</p>}');
    const loadingAt = page.indexOf("{loading ? (", errorAt);
    const emptyAt = page.indexOf(") : albums.length === 0 ? (", errorAt);
    expect(errorAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(errorAt);
    expect(emptyAt).toBeGreaterThan(loadingAt);
    expect(page).toContain("No albums yet");
  });
});
