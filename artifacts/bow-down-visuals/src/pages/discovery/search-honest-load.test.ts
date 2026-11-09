/**
 * Search (/search) — honest load states (Stack 400 C-28: the
 * honest-load pin layer completing the "empty lie" audit).
 *
 * The search payload (creators + tracks + videos + playlists)
 * already carries the honest machine: getJson() returns null ONLY
 * on failure (non-ok or network), the effect turns that null into
 * loadError — the page's own comment states the law ("that is a
 * load error, not 'no hits'") — and NoSearchResults renders for a
 * committed query only after the loading branch and the error
 * branch, with the error branch's retry bumping retryNonce to
 * re-run the real effect. This file pins that shape in source,
 * like the sibling honest-load pins (the FE suite runs in node,
 * no DOM). The error copy is hardcoded English in the page, so
 * the literals are pinned and there is no catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./search.tsx");
const helper = page.slice(page.indexOf("async function getJson"), page.indexOf("function PlaylistCard"));
const loadAt = page.indexOf("const d = await getJson<SearchPayload>(");
const loader = page.slice(loadAt, page.indexOf("}, [committedQ, type, vertical, genre, retryNonce]);", loadAt));

describe("failure path — a failed search never reads as no hits", () => {
  it("the fetch helper returns null on a non-ok response", () => {
    expect(helper).toContain("if (!r.ok) return null;");
  });

  it("the effect records the error state on failure and clears it with data on success", () => {
    expect(loader).toContain("if (!d) setLoadError(true); else { setLoadError(false); setData(d); }");
    expect(loader).toContain("setLoading(false);");
  });

  it("the page carries a distinct loading flag and error state", () => {
    expect(page).toContain("const [loading, setLoading] = useState(false);");
    expect(page).toContain("const [loadError, setLoadError] = useState(false);");
  });

  it("failure renders the error panel with a retry wired to the real load", () => {
    expect(page).toContain("Couldn't run that search.");
    expect(page).toContain("that's not the same as no hits.");
    expect(page).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(page).toContain("Try again");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the no-results panel renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf(") : loading && !data ? (");
    const errorAt = page.indexOf(") : loadError ? (");
    const emptyAt = page.indexOf(") : !hasResults ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain("<NoSearchResults q={committedQ.trim()} />");
  });
});
