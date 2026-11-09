/**
 * DJ Set Prep — honest load states (Stack 400 C-28: the honest-load
 * pin layer completing the "empty lie" audit).
 *
 * The page loads two list sources — the DJ library and the crates —
 * as independent sections, each with the full machine: the section
 * loader throws on a non-ok answer and reports a boolean, its catch
 * raises the section's own error flag, and each section renders its
 * error row (with a retry wired to that section's loader) BEFORE
 * its empty line. When both sources fail together the page-level
 * error line fires as well. What was missing is the PIN; this file
 * pins the shape in source, like the sibling honest-load pins (the
 * FE suite runs in node, no DOM).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./dj-set-prep.tsx");

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
const KEYS = ["djSets.errorLoad", "djSets.noTracks", "djSets.noCrates"];

describe("section loaders — each source fails on its own flag", () => {
  it("the library loader throws on a non-ok answer and raises libError in its catch", () => {
    expect(page).toContain('if (!libRes.ok) throw new Error(apiErrorMessage(lib, t("djSets.errorLoad")));');
    expect(page).toContain("setLibError(true);");
    expect(page).toContain("setLibError(false);");
  });

  it("the crates loader throws on a non-ok answer and raises cratesError in its catch", () => {
    expect(page).toContain('if (!crateRes.ok) throw new Error(apiErrorMessage(cr, t("djSets.errorLoad")));');
    expect(page).toContain("setCratesError(true);");
    expect(page).toContain("setCratesError(false);");
  });

  it("when both sources fail together, the page-level error line fires too", () => {
    expect(page).toContain('if (!libOk && !cratesOk) setError(t("djSets.errorLoad"));');
  });
});

describe("rendering — each section's error row precedes its empty line, with its own retry", () => {
  it("the library error row renders before the no-tracks line", () => {
    const errorAt = page.indexOf("{libError ? (");
    const emptyAt = page.indexOf(") : tracks.length === 0 ? (", errorAt);
    expect(errorAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain("onClick={() => void loadLibrarySection()}");
  });

  it("the crates error row renders before the no-crates line", () => {
    const errorAt = page.indexOf("{cratesError ? (");
    const emptyAt = page.indexOf(") : !selectedCrate ? (", errorAt);
    expect(errorAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain("onClick={() => void loadCratesSection()}");
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the djSets keys", (loc) => {
    const cat = flat(JSON.parse(read(`../../locales/${loc}.json`)));
    for (const k of KEYS) expect(typeof cat[k] === "string" && cat[k].length > 0).toBe(true);
  });
});
