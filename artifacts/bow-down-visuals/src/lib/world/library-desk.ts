/**
 * library-desk — the Library desk's pure logic seam
 * (stack1600 wave 4, Stack 100 manifest item 26 / B15 — desk #99).
 *
 * THE FEATURE (website): Thy Library (pages/library.tsx) — the
 * connective tissue between tools: templates, presets, fonts,
 * wishlist, feature orders, purchases. The World already carries
 * purchases (the Listening Booth shelf) and templates ride their
 * own desks; the three tabs no World surface carried were:
 *
 *   PRESETS — the 65-look catalog (data/library-presets):
 *     30 effect grades, 20 text styles, 15 transitions. Static
 *     site data — the desk imports the page's own data module,
 *     never a copy, so the two shelves can never drift.
 *   FONTS — the 31-family catalog (data/library-fonts), loaded
 *     through lib/load-fonts' ensureLibraryFonts, exactly as
 *     the page loads them. The page's "use" for a font is
 *     copying its CSS font-family line; the desk's is the same.
 *   WISHLIST — the member's save-for-later list on the
 *     /api/wishlists rails (lib/wishlists is the 2D client):
 *       GET    /api/wishlists            → { items }
 *       DELETE /api/wishlists/:kind/:id  → { removed }
 *     FREE — no registry rows exist for these paths because
 *     nothing is charged. Saving happens at the product itself
 *     (its shop/store surface); the desk's job is keeping and
 *     clearing, like the Saved desk's.
 *
 * APPLY, HONESTLY: a preset's 2D "Use" is a deep link into the
 * Visual Vibes editor (?fx= / ?textstyle= / ?transition=),
 * which applies it there. In-World the editor is the Create
 * Wing's step-through door, and the desk's "Use" now carries
 * the picked look through the panel-payload channel (the
 * library-preset kind): the step-through seeds the SAME param
 * into the editor's search and the editor's own param reader
 * applies it there — no second apply path exists (stack100
 * phase-2 join repair; the desk also applies the preset LIVE
 * to its own preview stage — the exact cssFilter / font the
 * card promises). Fonts apply for real: the copied CSS line is
 * the whole application, in-World and on the page alike.
 *
 * FAVORITES + RECENTS: the page keeps them in localStorage
 * (thy-library-favorites-v1 / thy-library-recent-v1). The desk
 * reads and writes the SAME store in the SAME shape, so a
 * favorite marked in the World is the page's favorite too.
 *
 * DRIFT DISCIPLINE (wishlist): a row that fails the rail's
 * shape is dropped; a wholly malformed payload parses to null
 * and the desk shows its failed state — a broken read is
 * never dressed up as an empty wishlist. An entry whose
 * product is gone (currentPriceCents null) is kept and reads
 * as gone, with Remove still working, so the list can always
 * be cleaned.
 */
import {
  LIBRARY_PRESETS,
  LIBRARY_PRESET_CATEGORIES,
  TEXT_STYLE_PRESETS,
  type LibraryPreset,
  type LibraryPresetCategory,
} from "@/data/library-presets";
import {
  LIBRARY_FONTS,
  LIBRARY_FONT_CATEGORIES,
  type LibraryFont,
  type LibraryFontCategory,
} from "@/data/library-fonts";
import { matchesQuery } from "@/lib/search-match";
import { wishlistMoney, type WishlistEntry, type WishlistItemKind } from "@/lib/wishlists";

/* ─── The desk's three breadths ─────────────────────────────────── */

export const LIBRARY_BREADTHS = ["presets", "fonts", "wishlist"] as const;
export type LibraryBreadth = (typeof LIBRARY_BREADTHS)[number];

export const LIBRARY_BREADTH_LABELS: Record<LibraryBreadth, string> = {
  presets: "Presets",
  fonts: "Fonts",
  wishlist: "Wishlist",
};

/** The station a preset's "Use" opens: the Create Wing's Visual
 *  Vibes Editor door — the same station the Daily Drop catalog
 *  sends video drops to. Opened with a null payload on purpose
 *  (see the header): no prefill is promised because none can
 *  honestly land today. */
export const LIBRARY_EDITOR_STATION_ID = "visual-vibes-editor";

/* ─── Presets — the page's own catalog, the page's own filters ──── */

export const LIBRARY_PRESET_CATEGORY_FILTERS: Array<"All" | LibraryPresetCategory> = [
  "All",
  ...LIBRARY_PRESET_CATEGORIES,
];

export function libraryPresetCount(): number {
  return LIBRARY_PRESETS.length;
}

/** The page's preset filter, verbatim semantics: the category
 *  gate, then the shared token-AND matcher over name + blurb. */
export function filterLibraryPresets(
  category: "All" | LibraryPresetCategory,
  query: string,
): LibraryPreset[] {
  const q = query.trim().toLowerCase();
  const matchQ = (s: string) => !q || matchesQuery(s, query);
  return LIBRARY_PRESETS.filter(
    (p) => (category === "All" || p.category === category) && (matchQ(p.name) || matchQ(p.blurb)),
  );
}

export function libraryPresetCategoryCount(category: "All" | LibraryPresetCategory): number {
  return category === "All"
    ? LIBRARY_PRESETS.length
    : LIBRARY_PRESETS.filter((p) => p.category === category).length;
}

/** The font a text-style preset renders in — the page reads it
 *  from TEXT_STYLE_PRESETS; every other category has none. */
export function textStyleFontFamily(slug: string): string | null {
  return TEXT_STYLE_PRESETS.find((p) => p.slug === slug)?.fontFamily ?? null;
}

export interface LibraryPresetStageStyle {
  /** The CSS filter to apply to the stage's sample frame —
   *  undefined when the preset's filter is "none" (text styles
   *  and transitions carry no filter; the page does the same). */
  cssFilter?: string;
  /** The sample text's font for a text-style preset. */
  fontFamily?: string;
}

/** What applying a preset to the desk's preview stage means:
 *  its filter over the sample frame and, for text styles, its
 *  font on the sample text — the exact config the data module
 *  promises, resolved in one place. */
export function presetStageStyle(preset: LibraryPreset): LibraryPresetStageStyle {
  const out: LibraryPresetStageStyle = {};
  if (preset.cssFilter !== "none") out.cssFilter = preset.cssFilter;
  const font = textStyleFontFamily(preset.slug);
  if (font) out.fontFamily = font;
  return out;
}

/** Which editor query param a preset's 2D deep link carries —
 *  derived from its category, matching the useUrl the data
 *  module already builds. Named here so the desk (and its
 *  pins) can speak about the link without parsing URLs. */
export function presetEditorParam(preset: LibraryPreset): "fx" | "textstyle" | "transition" {
  switch (preset.category) {
    case "Text Styles":
      return "textstyle";
    case "Transitions":
      return "transition";
    default:
      return "fx";
  }
}

/* ─── Fonts — the page's own catalog, filters, and copy line ────── */

export const LIBRARY_FONT_CATEGORY_FILTERS: Array<"All" | LibraryFontCategory> = [
  "All",
  ...LIBRARY_FONT_CATEGORIES,
];

export function libraryFontCount(): number {
  return LIBRARY_FONTS.length;
}

/** The page's font filter, verbatim semantics: the category
 *  gate, then the shared token-AND matcher over family + blurb. */
export function filterLibraryFonts(
  category: "All" | LibraryFontCategory,
  query: string,
): LibraryFont[] {
  const q = query.trim().toLowerCase();
  const matchQ = (s: string) => !q || matchesQuery(s, query);
  return LIBRARY_FONTS.filter(
    (f) => (category === "All" || f.category === category) && (matchQ(f.family) || matchQ(f.blurb)),
  );
}

export function libraryFontCategoryCount(category: "All" | LibraryFontCategory): number {
  return category === "All"
    ? LIBRARY_FONTS.length
    : LIBRARY_FONTS.filter((f) => f.category === category).length;
}

/** The exact line the page's "Copy font" puts on the clipboard —
 *  one builder, so the desk can never copy a different line
 *  than the page does. */
export function fontCssSnippet(font: LibraryFont): string {
  return `font-family: '${font.family}', sans-serif;`;
}

/** The font-family value a live preview renders in. */
export function fontPreviewFamily(font: LibraryFont): string {
  return `'${font.family}', sans-serif`;
}

/* ─── Favorites + recents — the page's localStorage store ───────── */

export const LIBRARY_FAVORITES_KEY = "thy-library-favorites-v1";
export const LIBRARY_RECENT_KEY = "thy-library-recent-v1";
export const LIBRARY_MAX_RECENT = 8;

export type LibraryRecentKind = "template" | "preset" | "font";
export interface LibraryRecentItem {
  kind: LibraryRecentKind;
  slug: string;
  at: number;
}

type LibraryStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): LibraryStorage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function readLibraryFavorites(storage: LibraryStorage | null = defaultStorage()): string[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(LIBRARY_FAVORITES_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === "string") : [];
  } catch {
    return [];
  }
}

export function writeLibraryFavorites(
  favs: readonly string[],
  storage: LibraryStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(LIBRARY_FAVORITES_KEY, JSON.stringify([...favs]));
  } catch {
    /* the store is a courtesy — a full/blocked store loses
       nothing but the mark itself */
  }
}

/** The page's toggle, as a pure step: present → removed,
 *  absent → appended. */
export function toggleLibraryFavorite(favs: readonly string[], slug: string): string[] {
  return favs.includes(slug) ? favs.filter((f) => f !== slug) : [...favs, slug];
}

export function readLibraryRecent(
  storage: LibraryStorage | null = defaultStorage(),
): LibraryRecentItem[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(LIBRARY_RECENT_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is LibraryRecentItem =>
        !!r &&
        typeof r === "object" &&
        (r as LibraryRecentItem).kind !== undefined &&
        typeof (r as LibraryRecentItem).slug === "string" &&
        typeof (r as LibraryRecentItem).at === "number",
    );
  } catch {
    return [];
  }
}

export function writeLibraryRecent(
  recent: readonly LibraryRecentItem[],
  storage: LibraryStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(LIBRARY_RECENT_KEY, JSON.stringify([...recent]));
  } catch {
    /* courtesy store — see favorites */
  }
}

/** The page's trackUse, as a pure step: the use goes first,
 *  any earlier use of the same slug is replaced, and the list
 *  is capped at the page's MAX_RECENT. */
export function recordLibraryUse(
  recent: readonly LibraryRecentItem[],
  kind: LibraryRecentKind,
  slug: string,
  at: number,
): LibraryRecentItem[] {
  return [{ kind, slug, at }, ...recent.filter((r) => r.slug !== slug)].slice(0, LIBRARY_MAX_RECENT);
}

/* ─── Wishlist — the /api/wishlists rails ───────────────────────── */

export const WISHLISTS_PATH = "/api/wishlists";

export const WISHLIST_KIND_LABELS: Record<WishlistItemKind, string> = {
  store_product: "Store",
  shop_product: "Shop",
};

const WISHLIST_KINDS: readonly string[] = ["store_product", "shop_product"];

/** The DELETE path, built exactly as lib/wishlists builds it. */
export function wishlistRemovePath(itemKind: WishlistItemKind, itemId: string): string {
  return `${WISHLISTS_PATH}/${itemKind}/${itemId}`;
}

function isWishlistEntry(v: unknown): v is WishlistEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e["id"] === "string" &&
    typeof e["itemKind"] === "string" &&
    WISHLIST_KINDS.includes(e["itemKind"]) &&
    typeof e["itemId"] === "string" &&
    typeof e["title"] === "string" &&
    typeof e["priceAtAddCents"] === "number" &&
    typeof e["lowestCents"] === "number" &&
    (typeof e["currentPriceCents"] === "number" || e["currentPriceCents"] === null) &&
    typeof e["available"] === "boolean" &&
    typeof e["link"] === "string" &&
    typeof e["createdAt"] === "string"
  );
}

/** The rail's answer, guarded: a well-formed payload yields its
 *  entries (rows that fail the shape drop); anything else —
 *  no items array at all — parses to null, and null means the
 *  read FAILED, never that the wishlist is empty. */
export function wishlistOfResponse(json: unknown): WishlistEntry[] | null {
  if (!json || typeof json !== "object") return null;
  const items = (json as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  return items.filter(isWishlistEntry);
}

/** Remove one entry by id (after the rail confirms — the desk
 *  never removes on hope). Unknown ids leave the list untouched. */
export function withoutWishlistEntry(entries: readonly WishlistEntry[], id: string): WishlistEntry[] {
  return entries.filter((e) => e.id !== id);
}

export interface WishlistPriceView {
  /** "Saved at" — the price when the member saved the item. */
  savedLabel: string;
  /** "Now" — the current price, or null when the product is
   *  gone (the row then reads "No longer listed"). */
  nowLabel: string | null;
  /** Cents dropped since the save, when the price truly fell
   *  below the saved price — the drop is the list's whole
   *  point, so it is computed in one place and spoken plainly. */
  droppedCents: number | null;
  /** Listed but not on sale right now (the page's note). */
  unavailable: boolean;
}

export function wishlistPriceView(entry: WishlistEntry): WishlistPriceView {
  const dropped =
    entry.currentPriceCents !== null && entry.currentPriceCents < entry.priceAtAddCents
      ? entry.priceAtAddCents - entry.currentPriceCents
      : null;
  return {
    savedLabel: wishlistMoney(entry.priceAtAddCents),
    nowLabel: entry.currentPriceCents === null ? null : wishlistMoney(entry.currentPriceCents),
    droppedCents: dropped,
    unavailable: !entry.available && entry.currentPriceCents !== null,
  };
}

/** The dropped-by line, in the page's own words and money format. */
export function wishlistDropLine(entry: WishlistEntry): string | null {
  const view = wishlistPriceView(entry);
  return view.droppedCents === null
    ? null
    : `Down ${wishlistMoney(view.droppedCents)} since you saved it`;
}

export const LIBRARY_DESK_PROMOTION =
  "#99 Thy Library full breadth at the My Studio board: the /library page's three un-carried tabs as one native desk — the 65-preset catalog browsed from the page's own data module with the picked look applied live to the desk's preview stage and the Visual Vibes Editor door one tap away, the 31-font catalog with the page's own copy-the-CSS apply, and the member's wishlist on the /api/wishlists rails with saved-vs-now prices, drop callouts and remove — favorites and recents shared with the page's own localStorage store, free throughout";
