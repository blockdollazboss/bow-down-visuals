/**
 * My Music (buyer library) — honest load states (Stack 400 C-28:
 * the honest-load pin layer completing the "empty lie" audit).
 *
 * The purchases load already carries the honest machine: load()
 * throws on a non-ok answer, the catch records the error state, and
 * the render reaches "Nothing here yet" only after the loading and
 * error branches, with the header Refresh button wired to the real
 * loader as the retry. This file pins that shape in source, like the
 * sibling honest-load pins (the FE suite runs in node, no DOM). The
 * error/empty copy is hardcoded English in the page, so the literals
 * are pinned and there is no catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./my-music.tsx");
const loadAt = page.indexOf("const load = useCallback(async () => {");
const loader = page.slice(loadAt, page.indexOf("async function freshDownload", loadAt));

describe("failure path — a failed library load never reads as an empty library", () => {
  it("the loader throws on a non-ok response and records the error state in its catch", () => {
    expect(loader).toContain('if (!res.ok) throw new Error(apiErrorMessage(body, "Couldn\'t load your library."));');
    expect(loader).toContain('setError(plainErrorText(err, "Couldn\'t load your library."));');
  });

  it("a successful load records the purchases and always clears loading", () => {
    expect(loader).toContain("setLoading(true);");
    expect(loader).toContain("setPurchases(body.purchases ?? []);");
    expect(loader).toContain("setLoading(false);");
  });

  it("failure renders the error state, and the retry is wired to the real loader", () => {
    expect(page).toContain(") : error ? (");
    expect(page).toContain("{error}");
    /* the header Refresh button re-runs the real load */
    expect(page).toContain("onClick={load}");
    expect(page).toContain("Refresh");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the empty panel renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{loading ? (");
    const errorAt = page.indexOf(") : error ? (");
    const emptyAt = page.indexOf(") : purchases.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain("Nothing here yet");
  });
});
