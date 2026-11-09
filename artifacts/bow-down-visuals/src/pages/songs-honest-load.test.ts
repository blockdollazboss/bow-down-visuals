/**
 * Songs library — honest load states (Stack 400 C-28: the
 * honest-load pin layer completing the "empty lie" audit).
 *
 * Four network-fed lists live on this page, in two honest shapes:
 *  - The main library and the add-to-album picker are HONEST-WITH-
 *    CO-RENDER: the loader throws on a non-ok answer, the catch
 *    records the error text, and that error line renders above the
 *    list — so on failure the page shows the failure in words even
 *    though the empty line also renders. A failure is never silent.
 *  - The per-song covers and mashups panels are the full machine:
 *    loading, then an error line with a retry wired to the real
 *    loader, and the empty line only after both.
 * The DJ-analysis chips loader is a documented silent shortcut
 * ("the DJ Sets tab is the full surface") and is out of scope.
 * This file pins those shapes in source, like the sibling
 * honest-load pins (the FE suite runs in node, no DOM).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./songs.tsx");
const loadAt = page.indexOf("const loadSongs = useCallback(async () => {");
const loader = page.slice(loadAt, page.indexOf("}, [authHeaders]);", loadAt));

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
const KEYS = [
  "songs.errorLoadSongs",
  "songs.emptyLibrary",
  "songs.coversLoadError",
  "songs.mashupsLoadError",
  "songs.retryLoad",
  "songs.mashupsUsingThisEmpty",
];

describe("main library — honest-with-co-render", () => {
  it("the loader throws on a non-ok answer and records the error text in its catch", () => {
    expect(loader).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("songs.errorLoadSongs")));');
    expect(loader).toContain('setError(plainErrorText(e, t("songs.errorLoadSongs")));');
    expect(loader).toContain("setSongs(data.songs ?? []);");
    expect(loader).toContain("setLoading(false);");
  });

  it("the error line renders above the library, before the loading/empty branches", () => {
    const errorAt = page.indexOf('{error && <p className="text-sm text-red-400 mb-4">{error}</p>}');
    const loadingAt = page.indexOf("{loading ? (", errorAt);
    const emptyAt = page.indexOf(") : songs.length === 0 ? (", errorAt);
    expect(errorAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(errorAt);
    expect(emptyAt).toBeGreaterThan(loadingAt);
  });
});

describe("covers and mashups panels — the full machine, per song", () => {
  it("covers render loading, then error with retry, and the empty line only after both", () => {
    const loadingAt = page.indexOf("{coversLoading === s.id ? (");
    const errorAt = page.indexOf(") : coversError === s.id ? (", loadingAt);
    const emptyAt = page.indexOf(") : (coversById[s.id] ?? []).length === 0 ? (", loadingAt);
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain("btn-retry-covers-");
    expect(page).toContain("onClick={() => void loadCovers(s.id)}");
  });

  it("mashups render loading, then error with retry, and the empty line only after both", () => {
    const loadingAt = page.indexOf("{mashupsLoading === s.id ? (");
    const errorAt = page.indexOf(") : mashupsError === s.id ? (", loadingAt);
    const emptyAt = page.indexOf(") : (mashupsById[s.id] ?? []).length === 0 ? (", loadingAt);
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain("btn-retry-mashups-");
    expect(page).toContain("onClick={() => void loadMashupsUsing(s.id)}");
  });
});

describe("add-to-album picker — honest-with-co-render", () => {
  it("the picker loader throws on a non-ok answer and records the action error", () => {
    expect(page).toContain('setAlbumActionError(plainErrorText(e, "Could not load albums."));');
    expect(page).toContain('{albumActionError && <p className="text-xs text-red-400 mt-3">{albumActionError}</p>}');
  });

  it("the picker renders its loading branch before its empty line", () => {
    const loadingAt = page.indexOf("{albumsLoading ? (");
    const emptyAt = page.indexOf(") : albumsLite.length === 0 ? (", loadingAt);
    expect(loadingAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(loadingAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the songs keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of KEYS) expect(typeof cat[k] === "string" && cat[k].length > 0).toBe(true);
  });
});
