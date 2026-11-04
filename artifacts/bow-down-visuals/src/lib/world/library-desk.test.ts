/**
 * library-desk — stack1600 wave 4 (Stack 100 item 26 / B15)
 * pins, desk #99.
 *
 * The Library desk carries the /library page's three
 * un-carried tabs into the World. These pins hold: the
 * catalogs ARE the page's own data modules (one source, no
 * drift); the filters mirror the page's category + token-AND
 * search semantics; a text-style preset resolves its font from
 * the page's TEXT_STYLE_PRESETS; the font copy line is the
 * page's exact string; favorites + recents ride the page's
 * own localStorage keys and shapes; the wishlist guard keeps
 * gone-product rows, drops malformed rows, and parses a
 * malformed payload to null (failed state, never a dressed-up
 * empty); price views compute the drop the way the page
 * speaks it. Everything here is free — no registry row, no
 * price literal anywhere in the seam.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LIBRARY_BREADTHS,
  LIBRARY_BREADTH_LABELS,
  LIBRARY_DESK_PROMOTION,
  LIBRARY_EDITOR_STATION_ID,
  LIBRARY_FAVORITES_KEY,
  LIBRARY_FONT_CATEGORY_FILTERS,
  LIBRARY_MAX_RECENT,
  LIBRARY_PRESET_CATEGORY_FILTERS,
  LIBRARY_RECENT_KEY,
  WISHLISTS_PATH,
  filterLibraryFonts,
  filterLibraryPresets,
  fontCssSnippet,
  fontPreviewFamily,
  libraryFontCategoryCount,
  libraryFontCount,
  libraryPresetCategoryCount,
  libraryPresetCount,
  presetEditorParam,
  presetStageStyle,
  readLibraryFavorites,
  readLibraryRecent,
  recordLibraryUse,
  textStyleFontFamily,
  toggleLibraryFavorite,
  wishlistDropLine,
  wishlistOfResponse,
  wishlistPriceView,
  wishlistRemovePath,
  withoutWishlistEntry,
  writeLibraryFavorites,
  writeLibraryRecent,
  type LibraryRecentItem,
} from "./library-desk";
import { LIBRARY_PRESETS, TEXT_STYLE_PRESETS } from "@/data/library-presets";
import { LIBRARY_FONTS } from "@/data/library-fonts";
import { LIBRARY_FONT_CATEGORIES } from "@/data/library-fonts";

const seamSrc = readFileSync(resolve(__dirname, "library-desk.ts"), "utf8");

/* ─── The catalogs are the page's own ───────────────────────────── */

describe("library-desk — catalogs shared with the page", () => {
  it("counts ride the data modules themselves", () => {
    expect(libraryPresetCount()).toBe(LIBRARY_PRESETS.length);
    expect(libraryPresetCount()).toBe(65);
    expect(libraryFontCount()).toBe(LIBRARY_FONTS.length);
    expect(libraryFontCount()).toBe(31);
  });

  it("category filters are All + the data modules' own lists", () => {
    expect(LIBRARY_PRESET_CATEGORY_FILTERS).toEqual(["All", "Effects", "Text Styles", "Transitions"]);
    expect(LIBRARY_FONT_CATEGORY_FILTERS[0]).toBe("All");
    expect(LIBRARY_FONT_CATEGORY_FILTERS.slice(1)).toEqual([...LIBRARY_FONT_CATEGORIES]);
    expect(libraryPresetCategoryCount("All")).toBe(65);
    expect(libraryPresetCategoryCount("Effects")).toBe(30);
    expect(libraryPresetCategoryCount("Text Styles")).toBe(20);
    expect(libraryPresetCategoryCount("Transitions")).toBe(15);
    expect(libraryFontCategoryCount("All")).toBe(31);
  });

  it("the seam imports the data modules — it never re-declares the catalogs", () => {
    expect(seamSrc).toContain('from "@/data/library-presets"');
    expect(seamSrc).toContain('from "@/data/library-fonts"');
    expect(seamSrc).not.toContain("cssFilter: \"brightness");
    expect(seamSrc).not.toContain("apiName:");
  });
});

/* ─── Filters mirror the page ───────────────────────────────────── */

describe("library-desk — filters", () => {
  it("presets: category gate, then name/blurb token match", () => {
    expect(filterLibraryPresets("All", "")).toHaveLength(65);
    expect(filterLibraryPresets("Effects", "").every((p) => p.category === "Effects")).toBe(true);
    expect(filterLibraryPresets("Effects", "")).toHaveLength(30);
    const gold = filterLibraryPresets("All", "gold");
    expect(gold.length).toBeGreaterThan(0);
    expect(gold.every((p) => `${p.name} ${p.blurb}`.toLowerCase().includes("gold"))).toBe(true);
    expect(filterLibraryPresets("All", "no such look zzz")).toHaveLength(0);
  });

  it("presets: a multi-word query needs every word somewhere (the shared matcher)", () => {
    const hits = filterLibraryPresets("All", "warm gold");
    expect(hits.map((p) => p.slug)).toContain("fx-gold-hour");
  });

  it("fonts: category gate, then family/blurb token match", () => {
    expect(filterLibraryFonts("All", "")).toHaveLength(31);
    expect(filterLibraryFonts("Display", "").every((f) => f.category === "Display")).toBe(true);
    const serif = filterLibraryFonts("All", "serif");
    expect(serif.length).toBeGreaterThan(0);
    expect(filterLibraryFonts("All", "no such family zzz")).toHaveLength(0);
  });
});

/* ─── Preset stage + editor param ───────────────────────────────── */

describe("library-desk — preset application", () => {
  it("an effect preset stages with its exact filter and no font", () => {
    const goldHour = LIBRARY_PRESETS.find((p) => p.slug === "fx-gold-hour")!;
    const style = presetStageStyle(goldHour);
    expect(style.cssFilter).toBe(goldHour.cssFilter);
    expect(style.cssFilter).not.toBe("none");
    expect(style.fontFamily).toBeUndefined();
  });

  it("a text-style preset stages with its font from TEXT_STYLE_PRESETS and no filter", () => {
    const textPreset = TEXT_STYLE_PRESETS[0]!;
    expect(textStyleFontFamily(textPreset.slug)).toBe(textPreset.fontFamily);
    const style = presetStageStyle(textPreset);
    expect(style.fontFamily).toBe(textPreset.fontFamily);
    expect(style.cssFilter).toBeUndefined();
    expect(textStyleFontFamily("fx-gold-hour")).toBeNull();
  });

  it("the editor param derives from the category — and matches the data module's own useUrl", () => {
    for (const p of LIBRARY_PRESETS) {
      const param = presetEditorParam(p);
      expect(p.useUrl, p.slug).toContain(`?${param}=`);
      expect(p.useUrl, p.slug).toContain(`?${param}=${p.slug}`);
    }
  });

  it("the editor door is the Visual Vibes Editor station", () => {
    expect(LIBRARY_EDITOR_STATION_ID).toBe("visual-vibes-editor");
  });
});

/* ─── Fonts — the copy line is the page's ───────────────────────── */

describe("library-desk — fonts", () => {
  it("the copy line is the page's exact CSS snippet", () => {
    const playfair = LIBRARY_FONTS.find((f) => f.family === "Playfair Display")!;
    expect(fontCssSnippet(playfair)).toBe("font-family: 'Playfair Display', sans-serif;");
    expect(fontPreviewFamily(playfair)).toBe("'Playfair Display', sans-serif");
    for (const f of LIBRARY_FONTS) {
      expect(fontCssSnippet(f)).toBe(`font-family: '${f.family}', sans-serif;`);
    }
  });
});

/* ─── Favorites + recents — the page's own store ────────────────── */

function memoryStorage(): { store: Map<string, string>; getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
  };
}

describe("library-desk — favorites + recents store", () => {
  it("the keys are the page's own", () => {
    expect(LIBRARY_FAVORITES_KEY).toBe("thy-library-favorites-v1");
    expect(LIBRARY_RECENT_KEY).toBe("thy-library-recent-v1");
  });

  it("favorites round-trip and toggle both ways", () => {
    const s = memoryStorage();
    expect(readLibraryFavorites(s)).toEqual([]);
    writeLibraryFavorites(["fx-gold-hour"], s);
    expect(s.store.get(LIBRARY_FAVORITES_KEY)).toBe('["fx-gold-hour"]');
    expect(readLibraryFavorites(s)).toEqual(["fx-gold-hour"]);
    expect(toggleLibraryFavorite(["fx-gold-hour"], "anton")).toEqual(["fx-gold-hour", "anton"]);
    expect(toggleLibraryFavorite(["fx-gold-hour", "anton"], "fx-gold-hour")).toEqual(["anton"]);
  });

  it("a corrupt store reads as empty, never throws", () => {
    const s = memoryStorage();
    s.store.set(LIBRARY_FAVORITES_KEY, "{not json");
    expect(readLibraryFavorites(s)).toEqual([]);
    s.store.set(LIBRARY_RECENT_KEY, "42");
    expect(readLibraryRecent(s)).toEqual([]);
    expect(readLibraryFavorites(null)).toEqual([]);
  });

  it("recents: newest first, same-slug replaced, capped at the page's max", () => {
    const start: LibraryRecentItem[] = [
      { kind: "preset", slug: "a", at: 1 },
      { kind: "font", slug: "b", at: 2 },
    ];
    const next = recordLibraryUse(start, "font", "b", 3);
    expect(next).toEqual([
      { kind: "font", slug: "b", at: 3 },
      { kind: "preset", slug: "a", at: 1 },
    ]);
    let list: LibraryRecentItem[] = [];
    for (let i = 0; i < LIBRARY_MAX_RECENT + 3; i++) {
      list = recordLibraryUse(list, "preset", `p${i}`, i);
    }
    expect(list).toHaveLength(LIBRARY_MAX_RECENT);
    expect(list[0]!.slug).toBe(`p${LIBRARY_MAX_RECENT + 2}`);
    const s = memoryStorage();
    writeLibraryRecent(list, s);
    expect(readLibraryRecent(s)).toEqual(list);
  });
});

/* ─── Wishlist rails ────────────────────────────────────────────── */

const ENTRY = {
  id: "w1",
  itemKind: "store_product" as const,
  itemId: "prod-1",
  title: "Crown Tee",
  priceAtAddCents: 5000,
  lowestCents: 4200,
  currentPriceCents: 4200,
  available: true,
  link: "/store/item/prod-1",
  createdAt: "2026-11-01T00:00:00.000Z",
};

describe("library-desk — wishlist", () => {
  it("the paths are the rails' own", () => {
    expect(WISHLISTS_PATH).toBe("/api/wishlists");
    expect(wishlistRemovePath("store_product", "prod-1")).toBe("/api/wishlists/store_product/prod-1");
    expect(wishlistRemovePath("shop_product", "p9")).toBe("/api/wishlists/shop_product/p9");
  });

  it("a well-formed payload parses; gone products are kept", () => {
    const gone = { ...ENTRY, id: "w2", itemId: "prod-2", currentPriceCents: null, available: false };
    const rows = wishlistOfResponse({ items: [ENTRY, gone] });
    expect(rows).toHaveLength(2);
    expect(rows![1]!.currentPriceCents).toBeNull();
  });

  it("malformed rows drop; a malformed payload is null — failed, never empty", () => {
    const bad = { ...ENTRY, id: "w3", priceAtAddCents: "5000" };
    const wrongKind = { ...ENTRY, id: "w4", itemKind: "beat" };
    expect(wishlistOfResponse({ items: [ENTRY, bad, wrongKind] })).toEqual([ENTRY]);
    expect(wishlistOfResponse({})).toBeNull();
    expect(wishlistOfResponse({ items: "nope" })).toBeNull();
    expect(wishlistOfResponse(null)).toBeNull();
    expect(wishlistOfResponse("[]")).toBeNull();
    expect(wishlistOfResponse({ items: [] })).toEqual([]);
  });

  it("price views: saved, now, and the drop spoken in the page's words", () => {
    const view = wishlistPriceView(ENTRY);
    expect(view.savedLabel).toBe("$50.00");
    expect(view.nowLabel).toBe("$42.00");
    expect(view.droppedCents).toBe(800);
    expect(view.unavailable).toBe(false);
    expect(wishlistDropLine(ENTRY)).toBe("Down $8.00 since you saved it");

    const flat = { ...ENTRY, currentPriceCents: 5000 };
    expect(wishlistPriceView(flat).droppedCents).toBeNull();
    expect(wishlistDropLine(flat)).toBeNull();

    const gone = { ...ENTRY, currentPriceCents: null, available: false };
    expect(wishlistPriceView(gone).nowLabel).toBeNull();
    expect(wishlistPriceView(gone).unavailable).toBe(false);

    const offSale = { ...ENTRY, currentPriceCents: 5000, available: false };
    expect(wishlistPriceView(offSale).unavailable).toBe(true);
  });

  it("remove applies by id only after the fact; unknown ids are a no-op", () => {
    const rows = [ENTRY, { ...ENTRY, id: "w2" }];
    expect(withoutWishlistEntry(rows, "w1").map((e) => e.id)).toEqual(["w2"]);
    expect(withoutWishlistEntry(rows, "nope")).toEqual(rows);
  });
});

/* ─── The desk's identity ───────────────────────────────────────── */

describe("library-desk — identity", () => {
  it("three breadths, the page's own tab names", () => {
    expect(LIBRARY_BREADTHS).toEqual(["presets", "fonts", "wishlist"]);
    expect(LIBRARY_BREADTH_LABELS).toEqual({ presets: "Presets", fonts: "Fonts", wishlist: "Wishlist" });
  });

  it("promotion carries desk #99", () => {
    expect(LIBRARY_DESK_PROMOTION).toContain("#99");
  });

  it("free throughout: no credit rail, no price literal in the seam", () => {
    expect(seamSrc).not.toContain("CREDIT_COSTS");
    expect(seamSrc).not.toContain("price-book");
    expect(seamSrc).not.toMatch(/\bVB\b/);
    expect(seamSrc).not.toContain("CreditConfirm");
  });
});
