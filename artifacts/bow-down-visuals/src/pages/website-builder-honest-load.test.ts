/**
 * Website Builder saved sites — honest load states (Stack 400 C-28
 * residual pin for the C-26 resilience wrap).
 *
 * The saved-builds load already carries the honest machine:
 * loadSavedBuilds() throws on a non-ok answer, the catch records the
 * same honest message as the error state, and the render reaches
 * the empty line only after the loading and error branches. This
 * pin asserts ONLY strings present in BOTH the join14 page and the
 * C-26-wrapped page on stack1600/s400-resilience-money, so it holds
 * on the joined tree at join15. The FE suite runs in node, no DOM.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./website-builder.tsx");
const loadAt = page.indexOf("async function loadSavedBuilds() {");
const loader = page.slice(loadAt, page.indexOf("async function loadVersions", loadAt));

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
const KEYS = ["websiteBuilder.loadSavedFailed", "websiteBuilder.savedSitesTitle", "websiteBuilder.savedSitesEmpty"];

describe("failure path — a failed saved-sites load never reads as 'no saved sites'", () => {
  it("the loader throws on a non-ok answer and records the error state in its catch", () => {
    expect(loader).toContain('if (!res.ok) throw new Error(t("websiteBuilder.loadSavedFailed"));');
    expect(loader).toContain('setSavedError(t("websiteBuilder.loadSavedFailed"));');
    expect(loader).toContain("setSavedBuilds(data.projects ?? []);");
    expect(loader).toContain("setSavedLoading(false);");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the empty line renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{savedLoading ? (");
    const errorAt = page.indexOf(") : savedError ? (");
    const emptyAt = page.indexOf(") : savedBuilds.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the website-builder saved keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of KEYS) expect(typeof cat[k] === "string" && cat[k].length > 0).toBe(true);
  });
});
