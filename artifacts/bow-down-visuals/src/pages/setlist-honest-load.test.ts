/**
 * Setlist Builder — honest load states (Stack 400 C-28: the
 * honest-load pin layer completing the "empty lie" audit).
 *
 * The setlist itself is local in-memory state (built by hand or from
 * the library; nothing is fetched for it on mount), so its empty
 * panel is a genuine local empty, not a load state. The one network
 * LIST on this page is the library picker: loadLibrary() throws on a
 * non-ok answer, the catch sets libraryError, `finally` always clears
 * libraryLoading, and the modal renders loading, then the error
 * message, and the "no more songs" empty state only after both. One
 * shape difference from the sibling pins, stated plainly: the error
 * branch has no dedicated retry button — the wired reload is the
 * modal itself (opening it re-runs loadLibrary via the effect pinned
 * below). The pin asserts that real mechanism instead of inventing a
 * button. Copy rides i18n keys, pinned in all 10 catalogs.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./setlist.tsx");
const loadAt = page.indexOf("const loadLibrary = useCallback(async () => {");
const loader = page.slice(loadAt, page.indexOf("if (libraryOpen) void loadLibrary();", loadAt));

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

describe("failure path — a failed library load never reads as an empty library", () => {
  it("the loader throws on a non-ok response and records the error state in its catch", () => {
    expect(loader).toContain('if (!res.ok) throw new Error(t("setlist.errorLoadLibrary"));');
    expect(loader).toContain('setLibraryError(plainErrorText(err, t("setlist.errorLoadLibrary")));');
  });

  it("the loader starts by clearing the error and always clears loading", () => {
    expect(loader).toContain("setLibraryLoading(true);");
    expect(loader).toContain("setLibraryError(null);");
    expect(loader).toContain("setLibraryLoading(false);");
  });

  it("a successful load records the library songs", () => {
    expect(loader).toContain("setLibrarySongs(");
  });

  it("opening the picker is the wired reload of the real loader", () => {
    expect(page).toContain("if (libraryOpen) void loadLibrary();");
  });

  it("failure renders the error message in its own branch", () => {
    expect(page).toContain(") : libraryError ? (");
    expect(page).toContain('<p className="text-sm text-red-300">{libraryError}</p>');
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the empty state renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{libraryLoading ? (");
    const errorAt = page.indexOf(") : libraryError ? (");
    const emptyAt = page.indexOf(") : librarySongs.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain('t("setlist.noMoreSongs")');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the setlist honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["setlist.errorLoadLibrary", "setlist.noMoreSongs"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
