/**
 * Public album page (/albums/:slug) — honest load states (Stack-400
 * pin batch, the "empty lie" family).
 *
 * The single fetch loads the album record and its tracklist. Before
 * the Stack-28 #29 / A3-F7 fix, every failure landed on "Album not
 * found". After: only a genuine 404 is not-found; any other failure
 * (non-ok status, a payload with no album, a network throw) raises
 * the load-error panel with a retry, the spinner renders while the
 * load is in flight, and the tracklist renders only after all three
 * settled branches. The failure copy is hardcoded English literals,
 * so this pin asserts the literals and carries no catalog block.
 *
 * The FE suite runs in node (no DOM), so — like the sibling
 * honest-load pins — these tests pin the state machine in source:
 * which setter each load outcome calls, and which render branch
 * each state reaches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./public.tsx");
const loadAt = page.indexOf("fetch(`/api/albums/public/${encodeURIComponent(slug)}`)");
const loader = page.slice(loadAt, page.indexOf("}, [slug, retryNonce]);", loadAt));

describe("failure path — a failed album load never reads as not-found", () => {
  it("only a 404 records not-found; other non-ok responses record the load error", () => {
    expect(loader).toContain("if (r.status === 404) { setNotFound(true); return null; }");
    expect(loader).toContain("if (!r.ok) { setLoadError(true); return null; }");
  });

  it("a payload with no album, and a network throw, also record the load error", () => {
    expect(loader).toContain("else setLoadError(true);");
    expect(loader).toContain(".catch(() => setLoadError(true))");
  });

  it("a successful load records the album", () => {
    expect(loader).toContain("setAlbum(d.album);");
  });

  it("each attempt resets loading, not-found and load-error first", () => {
    expect(page).toContain("setLoading(true);");
    expect(page).toContain("setNotFound(false);");
    expect(page).toContain("setLoadError(false);");
  });

  it("failure renders the error panel with a retry wired to the real load", () => {
    expect(page).toContain('data-testid="album-load-error"');
    expect(page).toContain("This album couldn't load");
    expect(page).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
  });
});

describe("loading and not-found paths stay distinct from failure", () => {
  it("the branches render in loading → load-error → not-found order", () => {
    const loadingAt = page.indexOf("if (loading) {");
    const errAt = page.indexOf('data-testid="album-load-error"');
    const notFoundAt = page.indexOf("Album not found");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errAt).toBeGreaterThan(loadingAt);
    expect(notFoundAt).toBeGreaterThan(errAt);
  });

  it("the tracklist renders only after the not-found branch", () => {
    const notFoundAt = page.indexOf("Album not found");
    const tracksAt = page.indexOf("album.tracks.map((track, i) => {");
    expect(tracksAt).toBeGreaterThan(notFoundAt);
  });
});
