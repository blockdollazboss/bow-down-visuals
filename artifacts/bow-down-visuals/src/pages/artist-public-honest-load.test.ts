/**
 * Public creator profile (/artist/:slug) — honest load states
 * (Stack-400 pin batch, the "empty lie" family).
 *
 * The page's main load is the profile record via fetchPublicProfile
 * (lib/artist-profiles): its json() boundary throws on !res.ok with
 * the HTTP status preserved, so the page can tell a genuine 404
 * ("doesn't exist") from a 500/network failure ("couldn't load").
 * The spinner renders while loading; the load-error panel with a
 * retry renders on failure; the not-found panel renders only for a
 * 404 or a confirmed non-public profile. The block-layout load is
 * NOT a page failure surface: its catch falls back to the Grand
 * Stage order built from the profile's own sections, so it never
 * renders an empty state. The copy is hardcoded English literals,
 * so this pin asserts the literals and carries no catalog block.
 *
 * The FE suite runs in node (no DOM), so — like the sibling
 * honest-load pins — these tests pin the state machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./artist-public.tsx");
const lib = read("../lib/artist-profiles.ts");
const loadAt = page.indexOf("const p = await fetchPublicProfile(slug);");
const loader = page.slice(loadAt, page.indexOf("}, [slug, retryNonce]);", loadAt));

describe("failure path — a failed profile load never reads as not-found", () => {
  it("the fetch boundary throws on a non-ok response with the status preserved", () => {
    expect(lib).toContain("err.status = res.status;");
    expect(lib).toContain("throw err;");
  });

  it("the page records not-found only for a 404 and the load error otherwise", () => {
    expect(loader).toContain("if (status === 404) setNotFound(true);");
    expect(loader).toContain("else setLoadError(true);");
  });

  it("a successful load records the profile; a non-public one records not-found", () => {
    expect(loader).toContain("setProfile(p.is_public ? p : null);");
    expect(loader).toContain("if (!cancelled && !p.is_public) setNotFound(true);");
  });

  it("failure renders the error panel with a retry wired to the real load", () => {
    expect(page).toContain("Couldn't load this profile.");
    expect(page).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
  });

  it("a failed layout load falls back to the Grand Stage blocks, never to empty", () => {
    expect(page).toContain("setBlocks(grandStageFallbackBlocks(profile.sections));");
  });
});

describe("loading and not-found paths stay distinct from failure", () => {
  it("the branches render in loading → load-error → not-found order", () => {
    const loadingAt = page.indexOf("if (loading) {");
    const errAt = page.indexOf("if (loadError) {");
    const notFoundAt = page.indexOf("if (notFound || !profile) {");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errAt).toBeGreaterThan(loadingAt);
    expect(notFoundAt).toBeGreaterThan(errAt);
  });

  it("the not-found panel carries its own distinct copy", () => {
    expect(page).toContain("This page doesn't exist — yet.");
  });
});
