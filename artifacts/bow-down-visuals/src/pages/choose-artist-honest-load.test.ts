/**
 * Choose Artist — honest load states (Stack 400 C-28: the honest-load
 * pin layer completing the "empty lie" audit).
 *
 * The vault picker already carries the honest machine — the loader's
 * own comment states the law ("A failed load is NOT an empty vault").
 * The load runs in an effect keyed by a retry nonce: it throws on a
 * non-ok answer, the catch sets loadError, and the render reaches
 * the no-profiles empty state only after the loading and error
 * branches, with the error branch's retry bumping the nonce to run
 * the real load again. What was missing is the PIN; this file pins
 * the shape in source, like the sibling honest-load pins (the FE
 * suite runs in node, no DOM).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./choose-artist.tsx");
const loadAt = page.indexOf('const res = await fetch("/api/artist-vaults", {');
const loader = page.slice(page.lastIndexOf("useEffect(() => {", loadAt), page.indexOf("}, [getAccessToken, retryNonce]);", loadAt));

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

describe("failure path — a failed load never reads as a creator with no artists", () => {
  it("the loader throws on a non-ok response and records the error state in its catch", () => {
    expect(loader).toContain("if (!res.ok) throw new Error();");
    expect(loader).toContain("if (!cancelled) setLoadError(true);");
  });

  it("a successful load records the vaults and clears the error; loading always clears", () => {
    expect(loader).toContain("setVaults(data.vaults ?? []);");
    expect(loader).toContain("setLoadError(false);");
    expect(loader).toContain("if (!cancelled) setLoading(false);");
  });

  it("failure renders the error panel with a retry that re-runs the real load", () => {
    expect(page).toContain('t("chooseArtist.loadErrorTitle", { defaultValue: "We couldn\'t load your artists" })');
    expect(page).toContain('data-testid="btn-retry-vaults"');
    expect(page).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the empty state renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{loading ? (");
    const errorAt = page.indexOf(") : loadError ? (");
    const emptyAt = page.indexOf(") : vaults.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain('t("chooseArtist.emptyTitle")');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the chooseArtist honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["chooseArtist.loadErrorTitle", "chooseArtist.loadErrorDescription", "chooseArtist.retryLoad", "chooseArtist.emptyTitle", "chooseArtist.emptyDescription"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
