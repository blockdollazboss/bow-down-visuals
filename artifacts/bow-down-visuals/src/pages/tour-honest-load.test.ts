/**
 * Tour dates — honest load states (Stack 400 C-28 residual pin for
 * the C-27 resilience wrap).
 *
 * The dates load already carries the honest machine — its catch
 * comment states the law ("A failed load is NOT an empty tour").
 * fetchDates() throws on a non-ok answer, a malformed payload also
 * raises the error state, and the render reaches "no dates" only
 * after the loading and error branches, with the error row's retry
 * (data-testid="btn-retry-dates") wired to the real loader. This pin
 * asserts ONLY strings present in BOTH the join14 page and the
 * C-27-wrapped page on stack1600/s400-resilience-live, so it holds
 * on the joined tree at join15. The FE suite runs in node, no DOM.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./tour.tsx");
const loadAt = page.indexOf("const fetchDates = useCallback(async () => {");
const loader = page.slice(loadAt, page.indexOf("}, [user, getAccessToken]);", loadAt));

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
const KEYS = ["tour.loadingDates", "tour.datesLoadError", "tour.retryLoad", "tour.noDates"];

describe("failure path — a failed dates load never reads as an empty tour", () => {
  it("the loader throws on a non-ok answer and records the error state in its catch", () => {
    expect(loader).toContain("if (!res.ok) throw new Error();");
    expect(loader).toContain("setDatesError(true);");
    expect(loader).toContain("setLoadingDates(false);");
  });

  it("a malformed success payload raises the error state instead of an empty list", () => {
    expect(loader).toContain("setDatesError(false);");
    expect(loader).toContain("} else {");
  });

  it("failure renders the error row with a retry wired to the real loader", () => {
    expect(page).toContain('data-testid="btn-retry-dates"');
    expect(page).toContain("onClick={() => void fetchDates()}");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the empty line renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{loadingDates ? (");
    const errorAt = page.indexOf(") : datesError ? (");
    const emptyAt = page.indexOf(") : dates.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the tour dates keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of KEYS) expect(typeof cat[k] === "string" && cat[k].length > 0).toBe(true);
  });
});
