/**
 * Storefronts (shop directory) — honest load states (Stack 400 C-28:
 * the honest-load pin layer completing the "empty lie" audit).
 *
 * The directory load already carries the textbook machine — its own
 * comment states the law ("A non-OK response is a failed load, NOT
 * 'no shops yet'"). load() sets loadError on a non-ok answer and in
 * its catch, and the render reaches the genuine empty panel only
 * after the loading and error branches, with the error panel's
 * retry bumping the nonce that re-runs the real loader. What was
 * missing is the PIN; this file pins the shape in source, like the
 * sibling honest-load pins (the FE suite runs in node, no DOM). The
 * error copy is hardcoded English in the page, so the literals are
 * pinned; the empty panel's keys ride the catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./storefronts.tsx");
const loadAt = page.indexOf("async function load(query: string) {");
const loader = page.slice(loadAt, page.indexOf("useEffect(() => {", loadAt));

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}
const KEYS = ["storefronts.emptyTitle", "storefronts.emptySubtitle"];

describe("failure path — a failed directory load never reads as an empty directory", () => {
  it("the loader records the error state on a non-ok answer and in its catch", () => {
    expect(loader).toContain('if (!res.ok) { setLoadError(true); return; }');
    expect(loader).toContain("setLoadError(true);");
    expect(loader).toContain("setLoading(false);");
    expect(page).toContain('A non-OK response is a failed load, NOT "no shops yet"');
  });

  it("failure renders its own panel, worded as a failure, with a retry that re-runs the load", () => {
    expect(page).toContain("Couldn't load the shops.");
    expect(page).toContain("that's not the same as no shops yet.");
    expect(page).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(page).toContain("}, [q, retryNonce]);");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the empty panel renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{loading ? (");
    const errorAt = page.indexOf(") : loadError ? (");
    const emptyAt = page.indexOf(") : shops.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the storefronts empty keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of KEYS) expect(typeof cat[k] === "string" && cat[k].length > 0).toBe(true);
  });
});
