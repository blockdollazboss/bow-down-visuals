/**
 * Distribute — honest load states for the "My Releases" list
 * (Stack 400 C-28 follow-on: the lying-loads lane).
 *
 * This list was one of the four LYING findings the honest-load
 * census pinned as a defect: loadReleases() set state only on
 * res.ok && Array.isArray(...), a non-ok answer fell through
 * silently, and the catch was commented "non-fatal" with no error
 * state — so any failed load rendered the genuine "no releases
 * yet" copy. The loader now throws on a non-ok or non-array
 * answer, its catch sets releasesError, and the render reaches
 * the empty copy only after the listLoading and releasesError
 * branches, with the error branch's retry wired to the real
 * loader. (The same file's wizard song-library sub-load was
 * already honest and is untouched.) This file pins that shape in
 * source, like the sibling honest-load pins (the FE suite runs
 * in node, no DOM). The honest-load copy goes through
 * distribute.* keys, pinned for all 10 catalogs below.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./distribute.tsx");
const loadAt = page.indexOf("const loadReleases = useCallback(async () => {");
const loader = page.slice(loadAt, page.indexOf("useEffect(() => { void loadReleases(); }", loadAt));

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

describe("failure path — a failed releases load never reads as an empty release list", () => {
  it("the loader throws on a non-ok or non-array answer and records the error state in its catch", () => {
    expect(loader).toContain("if (!res.ok || !Array.isArray(data.releases)) throw new Error();");
    expect(loader).toContain("setReleasesError(true);");
  });

  it("a successful load records the releases, clears the error, and always clears loading", () => {
    expect(loader).toContain("setReleases(data.releases);");
    expect(loader).toContain("setReleasesError(false);");
    expect(loader).toContain("setListLoading(false);");
  });

  it("failure renders the error panel with a retry wired to the real loader", () => {
    expect(page).toContain('t("distribute.releases_load_error", { defaultValue: "We couldn');
    expect(page).toContain('data-testid="btn-retry-releases"');
    expect(page).toContain("onClick={() => void loadReleases()}");
    expect(page).toContain('t("distribute.retry_load", { defaultValue: "Try again" })');
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the first load renders the pending state, not the empty panel", () => {
    expect(page).toContain('t("distribute.loading_releases")');
  });

  it("the empty panel renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{listLoading ? (");
    const errorAt = page.indexOf(") : releasesError ? (");
    const emptyAt = page.indexOf(") : releases.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain('t("distribute.no_releases_yet_hit")');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the distribute honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["distribute.loading_releases", "distribute.releases_load_error", "distribute.retry_load", "distribute.no_releases_yet_hit"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
