/**
 * Brand Deals marketplace — honest load states (Stack 400 C-28: the
 * honest-load pin layer completing the "empty lie" audit).
 *
 * The marketplace deals grid already carries the honest machine:
 * loadDeals() throws on a non-ok answer, the catch records
 * dealsError, and the grid renders sign-in → loading → error →
 * empty, in that order — the "no deals" panel can only appear after
 * a successful load. What was missing is the PIN; this file pins the
 * shape in source, like the sibling honest-load pins (the FE suite
 * runs in node, no DOM). The page's other lists are not network list
 * loads (the outreach tracker is local-storage state), so the deals
 * grid is the surface pinned here.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./brand-deals.tsx");
const loadAt = page.indexOf("async function loadDeals()");
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

describe("failure path — a failed deals load never reads as an empty marketplace", () => {
  it("the loader throws on a non-ok response and records the error state in its catch", () => {
    expect(loader).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("sponsors.errorLoadDeals")));');
    expect(loader).toContain('setDealsError(plainErrorText(err, t("sponsors.errorLoadDeals")));');
  });

  it("each attempt raises loading and clears the error first; loading always clears", () => {
    expect(loader).toContain("setDealsLoading(true);");
    expect(loader).toContain("setDealsError(null);");
    expect(loader).toContain("setDealsLoading(false);");
    expect(loader.indexOf("setDealsError(null);")).toBeLessThan(loader.indexOf("throw new Error"));
  });

  it("a successful load records the deals", () => {
    expect(loader).toContain("setDeals(Array.isArray(data.deals) ? data.deals : []);");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the grid reaches the empty panel only after the loading and error branches", () => {
    const loadingAt = page.indexOf(") : dealsLoading ? (");
    const errorAt = page.indexOf(") : dealsError ? (");
    const emptyAt = page.indexOf(") : filtered.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
  });

  it("the loading branch carries its own copy, distinct from the empty panel", () => {
    expect(page).toContain('t("sponsors.loadingDeals")');
    expect(page).toContain('t("sponsors.emptyNoDeals")');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the sponsors honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["sponsors.errorLoadDeals", "sponsors.loadingDeals", "sponsors.emptyNoDeals", "sponsors.emptyNoMatch"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
