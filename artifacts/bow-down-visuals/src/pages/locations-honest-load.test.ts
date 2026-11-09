/**
 * Locations — honest load states for the gallery
 * (Stack 400 C-28 follow-on: the lying-loads lane).
 *
 * This gallery was the PARTIAL finding among the four LYING
 * findings the honest-load census pinned: loadLocations() was
 * already honest (it throws on a non-ok answer and records the
 * shared error state), but the gallery's empty copy was not
 * gated on that error, the shared banner also serves
 * add/upload/delete action errors, and no retry was wired to
 * loadLocations. The loader now also records a dedicated
 * load-only flag (setLoadError), the gallery reaches the empty
 * copy only after the loading and load-error branches, and the
 * error branch's retry re-runs loadLocations specifically.
 * This file pins that shape in source, like the sibling
 * honest-load pins (the FE suite runs in node, no DOM). The
 * honest-load copy goes through locations.* keys, pinned for
 * all 10 catalogs below.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./locations.tsx");
const loadAt = page.indexOf("const loadLocations = useCallback(async () => {");
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

describe("failure path — a failed locations load never reads as an empty gallery", () => {
  it("the loader throws on a non-ok answer and records the dedicated load-error flag", () => {
    expect(loader).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("locations.errLoad")));');
    expect(loader).toContain("setLoadError(true);");
  });

  it("a successful load clears the load-error flag and always clears loading", () => {
    expect(loader).toContain("setLocations(data.locations ?? []);");
    expect(loader).toContain("setLoadError(false);");
    expect(loader).toContain("setLoading(false);");
  });

  it("failure renders the error panel with a retry wired to loadLocations specifically", () => {
    expect(page).toContain('t("locations.errLoad")');
    expect(page).toContain('data-testid="btn-retry-locations"');
    expect(page).toContain("onClick={() => void loadLocations()}");
    expect(page).toContain('t("locations.retryLoad", { defaultValue: "Try again" })');
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the empty panel renders only after the loading and load-error branches", () => {
    const loadingAt = page.indexOf("{loading ? (");
    const errorAt = page.indexOf(") : loadError && locations.length === 0 ? (");
    const emptyAt = page.indexOf(") : locations.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain('t("locations.noLocations")');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the locations honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["locations.errLoad", "locations.retryLoad", "locations.noLocations"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
