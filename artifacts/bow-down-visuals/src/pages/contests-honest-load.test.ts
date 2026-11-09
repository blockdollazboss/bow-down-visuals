/**
 * Contests — honest load states (Stack 400 C-28: the honest-load pin
 * layer completing the "empty lie" audit).
 *
 * The contests list already carries the honest machine — its error
 * panel says the law out loud ("that's a failed load, not an empty
 * list"). loadContests() throws on a non-ok answer, the catch sets
 * listLoadError, and the render reaches the no-contests panel only
 * after the loading and error branches, with the error branch's
 * retry wired to the real loader. What was missing is the PIN; this
 * file pins the shape in source, like the sibling honest-load pins
 * (the FE suite runs in node, no DOM). The list copy is hardcoded
 * English in the page; the empty panel's key is pinned in the
 * catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./contests.tsx");
const loadAt = page.indexOf("async function loadContests()");
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

describe("failure path — a failed contests load never reads as an empty list", () => {
  it("the loader throws on a non-ok response and records the list error in its catch", () => {
    expect(loader).toContain('if (!res.ok) throw new Error("Could not load contests");');
    expect(loader).toContain("setListLoadError(true);");
    expect(loader).toContain('setError(plainErrorText(e, "Could not load contests"));');
  });

  it("each attempt raises loading and clears the list error first; loading always clears", () => {
    expect(loader).toContain("setLoading(true);");
    expect(loader).toContain("setListLoadError(false);");
    expect(loader).toContain("setLoading(false);");
    expect(loader.indexOf("setListLoadError(false);")).toBeLessThan(loader.indexOf("throw new Error"));
  });

  it("a successful load records the contests", () => {
    expect(loader).toContain("setContests(data.contests ?? []);");
  });

  it("failure renders the error panel with a retry wired to the real loader", () => {
    expect(page).toContain("Couldn't load your contests — that's a failed load, not an empty list.");
    expect(page).toContain("onClick={() => void loadContests()}");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the empty panel renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{loading ? (");
    const errorAt = page.indexOf(") : listLoadError ? (");
    const emptyAt = page.indexOf(") : contests.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the contests empty key", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    const k = "contests.no_contests_yet_launch_your_firs";
    expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
  });
});
