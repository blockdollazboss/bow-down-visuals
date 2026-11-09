/**
 * Shoutouts — honest load states (Stack 400 C-28: the honest-load pin
 * layer completing the "empty lie" audit). Residual pin verified
 * against both shapes: this page was wrapped by resilience-live
 * (stack1600/s400-resilience-live @ df87eb650) with SectionBoundary
 * wrappers only — every string asserted here is present verbatim in
 * BOTH the join14 page and the banked branch version (loader logic
 * identical; only wrapping/indentation moved).
 *
 * Two list surfaces, both honest. (1) The fan-side creators browse:
 * fetchCreators throws on !res.ok, the catch sets creatorsLoadError
 * (guarded by creatorsLoadedRef, so a later failed reload never
 * blanks creators already on screen), and the render runs loading,
 * then the error panel with a retry wired to fetchCreators, and the
 * genuine-empty state only after both. (2) The creator tab: settings,
 * requests and revenue settle per-source, each with its own error
 * note + retry inside its own panel, and creatorLoadError is reserved
 * for the total failure (all three down before anything loaded) with
 * its own retry wired to fetchCreatorData. The error copy is
 * hardcoded English in the page, so the literals are pinned; the
 * empty copy rides i18n keys, pinned in all 10 catalogs.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./shoutouts.tsx");
const fcAt = page.indexOf("async function fetchCreators() {");
const fetchCreators = page.slice(fcAt, page.indexOf("/* Per-source creator-tab states", fcAt));

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

describe("creators browse — a failed creators load never reads as no creators yet", () => {
  it("the loader throws on a non-ok response and records the error state in its catch", () => {
    expect(fetchCreators).toContain('if (!res.ok) throw new Error("load failed");');
    expect(fetchCreators).toContain("if (!creatorsLoadedRef.current) setCreatorsLoadError(true);");
  });

  it("a successful load records the creators and always clears loading", () => {
    expect(fetchCreators).toContain("setCreators(j.creators ?? []);");
    expect(fetchCreators).toContain("creatorsLoadedRef.current = true;");
    expect(fetchCreators).toContain("setCreatorsLoading(false);");
  });

  it("failure renders the error panel with its copy and a retry wired to the real loader", () => {
    expect(page).toContain("Couldn't load creators.");
    expect(page).toContain("the creators are out there, this page just couldn't reach them.");
    expect(page).toContain("onClick={() => fetchCreators()}");
  });

  it("the empty state renders only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{creatorsLoading ? (");
    const errorAt = page.indexOf(") : creatorsLoadError ? (");
    const emptyAt = page.indexOf(") : creators.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain('t("shoutouts.noCreators")');
  });
});

describe("creator tab — a failed creator load never reads as empty requests or zero revenue", () => {
  it("the total failure renders its own error panel with a retry wired to the real loader", () => {
    expect(page).toContain("Couldn't load your creator tab.");
    expect(page).toContain("your settings, requests and revenue are safe, this page just couldn't load them.");
    expect(page).toContain("onClick={() => fetchCreatorData()}");
    expect(page).toContain(") : creatorLoadError ? (");
  });

  it("the requests empty state renders only after its per-source error branch", () => {
    expect(page).toContain("requestsError ? sectionErrorNote(() => void fetchRequestsSection()) : requests.length === 0 ? (");
    expect(page).toContain('t("shoutouts.noRequests")');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the shoutouts honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["shoutouts.noCreators", "shoutouts.noRequests"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
