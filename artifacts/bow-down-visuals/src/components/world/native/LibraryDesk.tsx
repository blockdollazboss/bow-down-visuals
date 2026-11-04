/**
 * LibraryDesk — the My Studio board's native Thy Library desk
 * (stack1600 wave 4, Stack 100 item 26 / B15 — desk #99).
 *
 * The /library page's three tabs no World surface carried —
 * Presets, Fonts, Wishlist — as one native desk:
 *
 *   PRESETS — the page's own 65-look catalog (its data module,
 *   imported, never copied). Picking a look applies it live to
 *   the desk's preview stage — the exact filter / font the
 *   data promises — and "Use" opens the Visual Vibes Editor
 *   station right here in the World (the Daily Drop catalog's
 *   video pattern: the door opens with no faked prefill).
 *   FONTS — the page's own 31-family catalog, loaded through
 *   the page's own font loader. "Copy font" puts the page's
 *   exact CSS line on the clipboard — that copy IS the apply,
 *   on the page and here alike; the line is also printed on
 *   the card so it can be typed where a clipboard can't reach.
 *   WISHLIST — the member's save-for-later list on the
 *   /api/wishlists rails: saved-vs-now prices, the drop called
 *   out in the page's own words, gone products named as gone,
 *   and Remove on the DELETE rail (optimistic, restored whole
 *   if the rail refuses — the Saved desk's pattern).
 *
 * Favorites ride the page's own localStorage store, so a heart
 * marked here is the page's heart too. Free throughout — the
 * rails and catalogs charge nothing, so nothing here confirms
 * a spend. Honest states: a failed wishlist read is an error
 * with a retry, never an empty shelf in disguise.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Heart } from "lucide-react";
import {
  LIBRARY_BREADTHS,
  LIBRARY_BREADTH_LABELS,
  LIBRARY_EDITOR_STATION_ID,
  LIBRARY_FONT_CATEGORY_FILTERS,
  LIBRARY_PRESET_CATEGORY_FILTERS,
  WISHLISTS_PATH,
  filterLibraryFonts,
  filterLibraryPresets,
  fontCssSnippet,
  fontPreviewFamily,
  libraryFontCategoryCount,
  libraryPresetCategoryCount,
  presetStageStyle,
  readLibraryFavorites,
  readLibraryRecent,
  recordLibraryUse,
  toggleLibraryFavorite,
  wishlistDropLine,
  wishlistOfResponse,
  wishlistPriceView,
  wishlistRemovePath,
  WISHLIST_KIND_LABELS,
  withoutWishlistEntry,
  writeLibraryFavorites,
  writeLibraryRecent,
  type LibraryBreadth,
} from "@/lib/world/library-desk";
import type { LibraryPreset, LibraryPresetCategory } from "@/data/library-presets";
import type { LibraryFont, LibraryFontCategory } from "@/data/library-fonts";
import type { WishlistEntry } from "@/lib/wishlists";
import type { PanelPayload } from "@/lib/world/panel-payload";
import { ensureLibraryFonts } from "@/lib/load-fonts";
import { useDeskAuthHeaders } from "./CreateDeskLeaf";

export function LibraryDesk({
  isLight,
  onOpenStation,
}: {
  isLight: boolean;
  onOpenStation?: (stationId: string, payload?: PanelPayload | null) => void;
}) {
  const deskHeaders = useDeskAuthHeaders();
  const [breadth, setBreadth] = useState<LibraryBreadth>("presets");
  const [query, setQuery] = useState("");
  const [presetCat, setPresetCat] = useState<"All" | LibraryPresetCategory>("All");
  const [fontCat, setFontCat] = useState<"All" | LibraryFontCategory>("All");
  const [favorites, setFavorites] = useState<string[]>(() => readLibraryFavorites());
  const [staged, setStaged] = useState<LibraryPreset | null>(null);
  const [copiedFamily, setCopiedFamily] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [wishItems, setWishItems] = useState<WishlistEntry[] | null>(null);
  const [wishFailed, setWishFailed] = useState(false);
  const [wishBusyId, setWishBusyId] = useState<string | null>(null);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const chipCls = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
      active
        ? "border-[#d4af37] bg-[#d4af37] text-black"
        : isLight
          ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border-white/15 text-white/75 hover:text-white"
    }`;
  const errCls = `text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`;
  const inputCls = `w-full rounded-xl border px-3 py-2 text-sm outline-none ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/70"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/40"
  }`;

  /* The page loads the catalog's fonts up front so previews
     render true; the desk does the same through the same loader. */
  useEffect(() => {
    ensureLibraryFonts();
  }, []);

  /* ── Wishlist — the rails ─────────────────────────────────── */
  const loadWishlist = useCallback(async () => {
    setWishFailed(false);
    try {
      const headers = await deskHeaders();
      const res = await fetch(WISHLISTS_PATH, { headers });
      if (!res.ok) throw new Error("load failed");
      const parsed = wishlistOfResponse(await res.json().catch(() => ({})));
      if (!parsed) throw new Error("load failed");
      setWishItems(parsed);
    } catch {
      setWishFailed(true);
    }
  }, [deskHeaders]);

  useEffect(() => {
    void loadWishlist();
  }, [loadWishlist]);

  async function removeWish(entry: WishlistEntry) {
    if (wishBusyId) return;
    setWishBusyId(entry.id);
    setNote(null);
    /* Optimistic removal, restored whole if the rail refuses. */
    setWishItems((prev) => (prev ? withoutWishlistEntry(prev, entry.id) : prev));
    try {
      const headers = await deskHeaders();
      const res = await fetch(wishlistRemovePath(entry.itemKind, entry.itemId), {
        method: "DELETE",
        headers,
      });
      if (!res.ok) throw new Error("remove failed");
    } catch {
      setNote("That remove didn't land — the item is back on your list. Try again in a moment.");
      void loadWishlist();
    } finally {
      setWishBusyId(null);
    }
  }

  /* ── Favorites + recents — the page's own store ───────────── */
  function toggleFav(slug: string) {
    setFavorites((prev) => {
      const next = toggleLibraryFavorite(prev, slug);
      writeLibraryFavorites(next);
      return next;
    });
  }

  function trackUse(kind: "preset" | "font", slug: string) {
    writeLibraryRecent(recordLibraryUse(readLibraryRecent(), kind, slug, Date.now()));
  }

  function usePreset(preset: LibraryPreset) {
    setStaged(preset);
    trackUse("preset", preset.slug);
    /* The editor door opens in-World with no payload — the
       step-through cannot honestly carry the preset today, so
       none is promised (the Daily Drop video pattern). */
    onOpenStation?.(LIBRARY_EDITOR_STATION_ID, null);
  }

  async function copyFont(font: LibraryFont) {
    const snippet = fontCssSnippet(font);
    try {
      await navigator.clipboard.writeText(snippet);
      setCopiedFamily(font.family);
      trackUse("font", font.apiName);
      window.setTimeout(() => setCopiedFamily((c) => (c === font.family ? null : c)), 2000);
    } catch {
      setNote(`Copy didn't land — the line is on the card: ${snippet}`);
    }
  }

  const favBtn = (slug: string) => {
    const active = favorites.includes(slug);
    return (
      <button
        type="button"
        aria-label={active ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={active}
        data-testid={`world-library-desk-fav-${slug}`}
        className={`ml-auto inline-flex items-center justify-center rounded-full p-1.5 bdv-touch-target ${
          active ? "text-[#d4af37]" : muted
        }`}
        onClick={() => toggleFav(slug)}
      >
        <Heart className="h-4 w-4" fill={active ? "currentColor" : "none"} />
      </button>
    );
  };

  const presets = filterLibraryPresets(presetCat, query);
  const fonts = filterLibraryFonts(fontCat, query);
  const stagedStyle = staged ? presetStageStyle(staged) : null;

  return (
    <div className="space-y-3" data-testid="world-library-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>Thy Library</p>
        <p className={`text-xs ${muted}`}>
          Looks, fonts and your wishlist — the library&rsquo;s whole shelf, right here.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Library sections">
        {LIBRARY_BREADTHS.map((b) => (
          <button
            key={b}
            type="button"
            role="tab"
            aria-selected={breadth === b}
            data-testid={`world-library-desk-tab-${b}`}
            className={chipCls(breadth === b)}
            onClick={() => setBreadth(b)}
          >
            {LIBRARY_BREADTH_LABELS[b]}
            {b === "wishlist" && wishItems ? ` (${wishItems.length})` : ""}
          </button>
        ))}
      </div>

      {breadth !== "wishlist" ? (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={breadth === "presets" ? "Search looks…" : "Search fonts…"}
          aria-label={breadth === "presets" ? "Search presets" : "Search fonts"}
          data-testid="world-library-desk-search"
          className={inputCls}
        />
      ) : null}

      {breadth === "presets" ? (
        <div className="space-y-3" data-testid="world-library-desk-presets">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Preset categories">
            {LIBRARY_PRESET_CATEGORY_FILTERS.map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={presetCat === c}
                data-testid={`world-library-desk-preset-cat-${c}`}
                className={chipCls(presetCat === c)}
                onClick={() => setPresetCat(c)}
              >
                {c} ({libraryPresetCategoryCount(c)})
              </button>
            ))}
          </div>

          {/* The preview stage: the picked look, applied live —
              its filter over the sample frame, its font on the
              sample line. Nothing is promised beyond what is
              shown; the editor door is one tap below it. */}
          <div className={`rounded-2xl border p-3 ${cardCls}`} data-testid="world-library-desk-stage">
            {staged && stagedStyle ? (
              <div className="space-y-2">
                <div
                  className="flex h-24 items-center justify-center overflow-hidden rounded-xl"
                  style={{ background: staged.gradient, filter: stagedStyle.cssFilter }}
                >
                  <span
                    className="px-3 text-center text-lg font-black text-white"
                    style={stagedStyle.fontFamily ? { fontFamily: stagedStyle.fontFamily } : undefined}
                  >
                    Thy Cheat Code
                  </span>
                </div>
                <p className={`text-sm font-bold ${strong}`}>{staged.name}</p>
                <p className={`text-xs ${muted}`}>
                  {staged.blurb} Live on the stage above, in {staged.toolLabel}.
                </p>
                <button
                  type="button"
                  data-testid="world-library-desk-stage-use"
                  className={chipCls(true)}
                  onClick={() => usePreset(staged)}
                >
                  Use in the Visual Vibes Editor
                </button>
              </div>
            ) : (
              <p className={`text-sm ${muted}`}>
                Pick a look below to see it live on this stage — then take it into the editor.
              </p>
            )}
          </div>

          {presets.length === 0 ? (
            <p className={`text-sm ${muted}`} data-testid="world-library-desk-presets-empty">
              No looks match that search.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-1.5">
              {presets.map((p) => (
                <li
                  key={p.slug}
                  className={`rounded-xl border p-2 ${cardCls}`}
                  data-testid={`world-library-desk-preset-${p.slug}`}
                >
                  <button
                    type="button"
                    className="block w-full text-left"
                    aria-label={`Preview ${p.name}`}
                    onClick={() => {
                      setStaged(p);
                      trackUse("preset", p.slug);
                    }}
                  >
                    <span
                      className="flex h-14 items-center justify-center overflow-hidden rounded-lg"
                      style={{ background: p.gradient, filter: p.cssFilter }}
                    >
                      {p.category === "Text Styles" ? (
                        <span
                          className="text-base font-black text-white"
                          style={{ fontFamily: presetStageStyle(p).fontFamily }}
                        >
                          Ag
                        </span>
                      ) : null}
                    </span>
                    <span className={`mt-1.5 block truncate text-sm font-bold ${strong}`}>{p.name}</span>
                    <span className={`block text-xs ${muted}`}>{p.blurb}</span>
                  </button>
                  <span className="mt-1 flex items-center gap-1">
                    <span className={`text-[11px] font-semibold ${muted}`}>{p.category}</span>
                    {favBtn(p.slug)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {breadth === "fonts" ? (
        <div className="space-y-3" data-testid="world-library-desk-fonts">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Font categories">
            {LIBRARY_FONT_CATEGORY_FILTERS.map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={fontCat === c}
                data-testid={`world-library-desk-font-cat-${c}`}
                className={chipCls(fontCat === c)}
                onClick={() => setFontCat(c)}
              >
                {c} ({libraryFontCategoryCount(c)})
              </button>
            ))}
          </div>

          {fonts.length === 0 ? (
            <p className={`text-sm ${muted}`} data-testid="world-library-desk-fonts-empty">
              No fonts match that search.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {fonts.map((f) => (
                <li
                  key={f.apiName}
                  className={`rounded-xl border px-3 py-2 ${cardCls}`}
                  data-testid={`world-library-desk-font-${f.apiName}`}
                >
                  <p className={`truncate text-lg ${strong}`} style={{ fontFamily: fontPreviewFamily(f) }}>
                    Thy Cheat Code
                  </p>
                  <p className={`truncate text-xs ${muted}`} style={{ fontFamily: fontPreviewFamily(f) }}>
                    ABCDEFG abcdefg 1234567890
                  </p>
                  <p className={`mt-1 text-xs ${muted}`}>
                    <span className={`font-bold ${strong}`}>{f.family}</span> · {f.category} · {f.blurb}
                  </p>
                  <p className={`mt-0.5 font-mono text-[11px] ${muted}`}>{fontCssSnippet(f)}</p>
                  <span className="mt-1.5 flex items-center gap-1">
                    <button
                      type="button"
                      data-testid={`world-library-desk-copy-${f.apiName}`}
                      className={chipCls(false)}
                      onClick={() => void copyFont(f)}
                    >
                      {copiedFamily === f.family ? (
                        <>
                          <Check className="h-3.5 w-3.5" /> Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" /> Copy font
                        </>
                      )}
                    </button>
                    {favBtn(f.apiName)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {breadth === "wishlist" ? (
        <div className="space-y-3" data-testid="world-library-desk-wishlist">
          {wishFailed ? (
            <div data-testid="world-library-desk-wishlist-failed">
              <p className={errCls}>Your wishlist wouldn&rsquo;t load. Give it another shot.</p>
              <button type="button" className={`mt-2 ${chipCls(false)}`} onClick={() => void loadWishlist()}>
                Try again
              </button>
            </div>
          ) : wishItems === null ? (
            <p className={`text-sm ${muted}`}>Loading your wishlist…</p>
          ) : wishItems.length === 0 ? (
            <p className={`text-sm ${muted}`} data-testid="world-library-desk-wishlist-empty">
              Nothing on your wishlist yet — tap the heart on a product and it lands here, watched for a
              price drop.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {wishItems.map((entry) => {
                const view = wishlistPriceView(entry);
                const drop = wishlistDropLine(entry);
                const gone = view.nowLabel === null;
                return (
                  <li
                    key={entry.id}
                    className={`rounded-xl border px-3 py-2 ${cardCls}`}
                    data-testid={`world-library-desk-wish-${entry.id}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={chipCls(false)}>{WISHLIST_KIND_LABELS[entry.itemKind]}</span>
                      <p className={`min-w-0 truncate text-sm font-bold ${gone ? muted : strong}`}>
                        {gone ? "A saved product" : entry.title}
                      </p>
                      <button
                        type="button"
                        data-testid={`world-library-desk-remove-${entry.id}`}
                        className={`ml-auto ${chipCls(false)}`}
                        disabled={wishBusyId !== null}
                        onClick={() => void removeWish(entry)}
                      >
                        {wishBusyId === entry.id ? "Removing…" : "Remove"}
                      </button>
                    </div>
                    {gone ? (
                      <p className={`mt-1 text-xs ${muted}`}>
                        This one isn&rsquo;t listed anymore — removing it keeps the list honest.
                      </p>
                    ) : (
                      <p className={`mt-1 text-xs ${muted}`}>
                        Saved at {view.savedLabel} · Now {view.nowLabel}
                      </p>
                    )}
                    {drop ? (
                      <p className="mt-1 inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-500">
                        {drop}
                      </p>
                    ) : null}
                    {view.unavailable ? (
                      <p className={`mt-1 text-xs ${muted}`}>Not on sale right now.</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {note ? <p className={errCls}>{note}</p> : null}
    </div>
  );
}
