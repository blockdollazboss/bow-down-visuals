/**
 * Live Shopping — honest load states (Stack 400 C-28, C-27 residual
 * pin verified against both shapes: the join14 page and the
 * SectionBoundary-wrapped shape banked on
 * stack1600/s400-resilience-live @ df87eb650 — every string asserted
 * here is present verbatim in BOTH versions, so the pin holds
 * whichever shape lands).
 *
 * The page loads three sources independently (catalog, streams,
 * dashboard): each section loader throws on a non-ok answer and its
 * catch records that section's own error state; a total failure
 * raises the page-level error. Each tab renders its section error
 * card — copy plus a retry wired to that section's real loader —
 * before any empty copy. This file pins that shape in source, like
 * the sibling honest-load pins (the FE suite runs in node, no DOM).
 * The copy runs through i18n keys (the section card's retry label is
 * a hardcoded "Try again" literal), so the keys are pinned plus a
 * catalog block.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./live-shopping.tsx");
const catalogAt = page.indexOf("const loadCatalogSection = useCallback(async (): Promise<boolean> => {");
const catalogLoader = page.slice(catalogAt, page.indexOf("const loadStreamsSection", catalogAt));
const streamsAt = page.indexOf("const loadStreamsSection = useCallback(async (): Promise<boolean> => {");
const streamsLoader = page.slice(streamsAt, page.indexOf("const loadDashboardSection", streamsAt));
const dashAt = page.indexOf("const loadDashboardSection = useCallback(async (): Promise<boolean> => {");
const dashLoader = page.slice(dashAt, page.indexOf("const loadAll", dashAt));

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

describe("failure path — no source's failure reads as that source being empty", () => {
  it("the catalog loader throws on a non-ok response and records its error state in its catch", () => {
    expect(catalogLoader).toContain('if (!res.ok) throw new Error("catalog load failed");');
    expect(catalogLoader).toContain("setCatalogError(true);");
  });

  it("a successful catalog load records the products and clears its error state", () => {
    expect(catalogLoader).toContain("setProducts(cat.products ?? []);");
    expect(catalogLoader).toContain("setCatalogError(false);");
  });

  it("the streams and dashboard loaders throw and record their own error states", () => {
    expect(streamsLoader).toContain('if (!res.ok) throw new Error("streams load failed");');
    expect(streamsLoader).toContain("setStreamsError(true);");
    expect(dashLoader).toContain('if (!res.ok) throw new Error("dashboard load failed");');
    expect(dashLoader).toContain("setDashboardError(true);");
  });

  it("a total failure of all three sources raises the page-level error", () => {
    expect(page).toContain('if (!catOk && !streamOk && !dashOk) setError(t("liveShopping.errLoad"));');
  });

  it("the section error card carries the error copy and a retry wired through its callback", () => {
    expect(page).toContain("const sectionErrorCard = (retry: () => void) => (");
    expect(page).toContain('t("liveShopping.errLoad")');
    expect(page).toContain("<button onClick={retry}");
    expect(page).toContain("Try again");
  });

  it("each tab's error card is wired to that section's real loader", () => {
    expect(page).toContain("{catalogError ? sectionErrorCard(() => void loadCatalogSection()) : (<>");
    expect(page).toContain("{streamsError ? sectionErrorCard(() => void loadStreamsSection()) : !activeStream ? (");
    expect(page).toContain("sectionErrorCard(() => void loadDashboardSection())");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the page starts in a loading state and renders it before any tab content", () => {
    expect(page).toContain("const [loading, setLoading] = useState(true);");
    expect(page).toContain('t("liveShopping.loadingShop")');
  });

  it("the products empty copy renders only inside the non-error branch", () => {
    const errorAt = page.indexOf("{catalogError ? sectionErrorCard(() => void loadCatalogSection()) : (<>");
    const emptyAt = page.indexOf("{products.length === 0 && !formOpen && (");
    expect(errorAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(page).toContain('t("liveShopping.noProducts")');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the liveShopping honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["liveShopping.errLoad", "liveShopping.loadingShop", "liveShopping.noProducts"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
