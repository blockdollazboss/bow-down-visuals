/**
 * library-desk-components — stack1600 wave 4 (Stack 100 item
 * 26 / B15) source-contract pins, desk #99. The Library desk
 * must sit in the My Studio stack as a board desk with:
 * - all three breadths in-panel: presets (the page's catalog,
 *   live preview stage, the editor door), fonts (the page's
 *   catalog + its copy-the-CSS apply), wishlist (the rails);
 * - every action riding its rail: presets open the Visual
 *   Vibes Editor STATION carrying the picked look through the
 *   library-preset payload (the step-through seeds the SAME
 *   param the preset's 2D deep link carries — phase-2 join
 *   repair), fonts write the seam's snippet to the clipboard,
 *   wishlist removes ride the seam's DELETE path;
 * - the honest states separate: wishlist loading, empty,
 *   failed + retry; gone products named as gone;
 * - no page pull-ups: no Link, no href to a product, no
 *   window navigation anywhere in the desk;
 * - no spend path (everything here is free);
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/LibraryDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");
const seam = read("./library-desk.ts");
const wishlistLib = read("../wishlists.ts");

describe("the board-desk shape + the My Studio mount", () => {
  it("is a named board desk rooted at its testid", () => {
    expect(desk).toContain("export function LibraryDesk(");
    expect(desk).toContain('data-testid="world-library-desk"');
    expect(desk).toContain("isLight");
    expect(desk).toContain("onOpenStation");
  });

  it("StationPanel stacks it at the My Studio board behind a DeskDoor, lazy", () => {
    expect(panel).toContain(
      'const LibraryDesk = lazy(() => import("@/components/world/native/LibraryDesk")',
    );
    expect(panel).toContain("<LibraryDesk isLight={isLight} onOpenStation={props.onOpenStation} />");
    /* It stacks beside Saved — the library's other World shelf. */
    const savedAt = panel.indexOf("<SavedDesk isLight={isLight} />");
    const libraryAt = panel.indexOf("<LibraryDesk isLight={isLight}");
    expect(savedAt).toBeGreaterThan(-1);
    expect(libraryAt).toBeGreaterThan(savedAt);
  });
});

describe("all three breadths present", () => {
  it("the breadth tabs render from the seam's breadth list", () => {
    expect(desk).toContain("LIBRARY_BREADTHS.map");
    expect(desk).toContain("data-testid={`world-library-desk-tab-${b}`}");
    expect(desk).toContain('data-testid="world-library-desk-presets"');
    expect(desk).toContain('data-testid="world-library-desk-fonts"');
    expect(desk).toContain('data-testid="world-library-desk-wishlist"');
  });

  it("presets: the seam's filters drive the shelf; the stage applies the picked look live", () => {
    expect(desk).toContain("filterLibraryPresets(presetCat, query)");
    expect(desk).toContain("LIBRARY_PRESET_CATEGORY_FILTERS.map");
    expect(desk).toContain('data-testid="world-library-desk-stage"');
    expect(desk).toContain("presetStageStyle(staged)");
    expect(desk).toContain("filter: stagedStyle.cssFilter");
    expect(desk).toContain("fontFamily: stagedStyle.fontFamily");
    expect(desk).toContain('data-testid="world-library-desk-presets-empty"');
  });

  it("fonts: the seam's filters drive the shelf and the page's loader runs", () => {
    expect(desk).toContain("filterLibraryFonts(fontCat, query)");
    expect(desk).toContain("LIBRARY_FONT_CATEGORY_FILTERS.map");
    expect(desk).toContain("ensureLibraryFonts()");
    expect(desk).toContain("fontPreviewFamily(f)");
    expect(desk).toContain('data-testid="world-library-desk-fonts-empty"');
  });

  it("favorites ride the seam's store helpers on both catalog tabs", () => {
    expect(desk).toContain("toggleLibraryFavorite");
    expect(desk).toContain("writeLibraryFavorites");
    expect(desk).toContain("recordLibraryUse");
  });
});

describe("each breadth drives its rail", () => {
  it("preset Use opens the editor station carrying the picked look (library-preset payload)", () => {
    /* Phase-2 join repair: the step-through CAN honestly carry the
       preset now — the payload names the editor param + slug, the
       host seeds them into the editor's search, and the editor's
       own param reader applies the look. No 2D eject anywhere. */
    expect(desk).toContain("libraryPresetPayload(presetEditorParam(preset), preset.slug)");
    expect(desk).toContain("LIBRARY_EDITOR_STATION_ID,");
    expect(seam).toContain('LIBRARY_EDITOR_STATION_ID = "visual-vibes-editor"');
    expect(desk).toContain("Use in the Visual Vibes Editor");
    /* The desk never builds the 2D deep link — no ?fx= eject. */
    expect(desk).not.toContain("useUrl");
    expect(desk).not.toContain("?fx=");
    /* The host side of the channel: StationPanel parses the payload
       for the editor station and seeds the step-through with it. */
    expect(panel).toContain('stepPayload?.kind === "library-preset"');
    expect(panel).toContain("preset={presetSeed}");
  });

  it("font Copy writes the seam's snippet — the page's exact line — to the clipboard", () => {
    expect(desk).toContain("navigator.clipboard.writeText(snippet)");
    expect(desk).toContain("fontCssSnippet(font)");
    expect(desk).toContain("Copy font");
    expect(desk).toContain("Copied!");
  });

  it("wishlist reads the seam path and removes ride the seam's DELETE path", () => {
    expect(desk).toContain("fetch(WISHLISTS_PATH, { headers })");
    expect(desk).toContain("wishlistOfResponse(");
    expect(desk).toContain("wishlistRemovePath(entry.itemKind, entry.itemId)");
    expect(desk).toContain('method: "DELETE"');
    expect(desk).toContain("withoutWishlistEntry(prev, entry.id)");
    /* …and the seam's paths are the 2D client's own rails. */
    expect(wishlistLib).toContain('fetch("/api/wishlists"');
    expect(wishlistLib).toContain("`/api/wishlists/${itemKind}/${itemId}`");
    expect(seam).toContain('WISHLISTS_PATH = "/api/wishlists"');
  });
});

describe("the honest states", () => {
  it("wishlist loading, empty and failed-with-retry render as themselves", () => {
    expect(desk).toContain("Loading your wishlist…");
    expect(desk).toContain('data-testid="world-library-desk-wishlist-empty"');
    expect(desk).toContain("Nothing on your wishlist yet");
    expect(desk).toContain('data-testid="world-library-desk-wishlist-failed"');
    expect(desk).toContain("wouldn&rsquo;t load");
    expect(desk).toContain("Try again");
    /* A failed read is a failure: the failed branch renders
       before the items branch, never beside an empty shelf. */
    expect(desk.indexOf("wishFailed ?")).toBeLessThan(desk.indexOf("wishItems === null"));
    expect(desk.indexOf("wishItems === null")).toBeLessThan(
      desk.indexOf("wishItems.length === 0"),
    );
  });

  it("gone products are named as gone, drops spoken by the seam, remove still offered", () => {
    expect(desk).toContain("view.nowLabel === null");
    expect(desk).toContain("isn&rsquo;t listed anymore");
    expect(desk).toContain("wishlistDropLine(entry)");
    expect(desk).toContain("wishlistPriceView(entry)");
    expect(desk).toContain("Not on sale right now.");
    expect(desk).toContain("data-testid={`world-library-desk-remove-${entry.id}`}");
  });

  it("a refused remove restores the row and says so", () => {
    expect(desk).toContain("That remove didn't land");
    expect(desk).toContain("void loadWishlist()");
  });
});

describe("World law + free rails + themes", () => {
  it("no page pull-ups: no Link, no product href, no navigation", () => {
    expect(desk).not.toContain("wouter");
    expect(desk).not.toContain("<Link");
    expect(desk).not.toContain("entry.link");
    expect(desk).not.toContain("window.location");
    expect(desk).not.toContain("video-editor");
  });

  it("plain fetches only, never a spend path — everything here is free", () => {
    expect(desk).not.toContain("confirmedFetch");
    expect(desk).not.toContain("CreditConfirm");
    expect(desk).not.toContain("CREDIT_COSTS");
    expect(seam).not.toContain("CREDIT_COSTS");
  });

  it("light/dark parity rides the isLight branches", () => {
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain("#d4af37");
  });
});
