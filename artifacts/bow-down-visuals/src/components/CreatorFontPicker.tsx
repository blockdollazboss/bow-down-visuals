/**
 * CreatorFontPicker — the shared font picker for CREATE tools
 * (Stack-200 fonts lane). NEVER a standalone page: it docks inside the
 * video editor (text/titles), Thumbnail Studio/Maker, Branding Kit,
 * Promo Clips and Cover Art, and every surface renders the chosen
 * family's live preview from the SELF-HOSTED creator library
 * (64 open-license families — see lib/creator-fonts.ts).
 *
 * Features: Cinzel + Manrope pinned on top as the House set, category
 * chips, search, a per-font live preview (the surface's own text when
 * given, else the family name), and favorites (star) persisted via
 * lib/font-favorites.ts. Selecting a font hands the full CreatorFont
 * to the host surface, which applies creatorFontFamily() wherever it
 * renders creator text.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChevronDown, Search, Star } from "lucide-react";
import {
  CREATOR_FONT_CATEGORIES,
  CREATOR_FONTS,
  creatorFontFamily,
  getCreatorFont,
  type CreatorFont,
  type CreatorFontCategory,
} from "@/lib/creator-fonts";
import { ensureCreatorFonts } from "@/lib/load-fonts";
import {
  getFontFavoritesSnapshot,
  setFontFavorite,
  subscribeFontFavorites,
} from "@/lib/font-favorites";

export interface CreatorFontPickerProps {
  /** Current font — creator-font id or canonical family name. */
  value?: string | null;
  onChange: (font: CreatorFont) => void;
  /** Text rendered in every font's live preview (e.g. the tool's title). */
  previewText?: string;
  label?: string;
  defaultOpen?: boolean;
}

type Filter = CreatorFontCategory | "All" | "Favorites";

const FILTERS: Filter[] = ["All", "Favorites", ...CREATOR_FONT_CATEGORIES];

export function CreatorFontPicker({ value, onChange, previewText, label, defaultOpen }: CreatorFontPickerProps) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const favorites = useSyncExternalStore(subscribeFontFavorites, getFontFavoritesSnapshot, getFontFavoritesSnapshot);

  useEffect(() => { ensureCreatorFonts(); }, []);

  const selected = getCreatorFont(value);
  const preview = (previewText && previewText.trim()) || "Bow Down Visuals";

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CREATOR_FONTS.filter((f) => {
      if (filter === "Favorites" && !favorites.includes(f.id)) return false;
      if (filter !== "All" && filter !== "Favorites" && f.category !== filter) return false;
      if (q && !f.family.toLowerCase().includes(q) && !f.blurb.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [filter, query, favorites]);

  return (
    <div className="w-full" data-testid="creator-font-picker">
      {label && (
        <p className="mb-1.5 block text-[11px] font-black uppercase tracking-widest opacity-50">{label}</p>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-lg leading-tight" style={{ fontFamily: creatorFontFamily(selected?.id) }}>
          {preview}
        </span>
        <span className="shrink-0 text-[11px] font-bold opacity-60">
          {selected ? selected.family : "Choose a font"}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 opacity-50" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search 64 fonts…"
              aria-label="Search fonts"
              className="w-full bg-transparent text-xs font-semibold outline-none placeholder:opacity-40"
            />
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                  filter === f
                    ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                    : "border-[hsl(var(--border))] opacity-70 hover:opacity-100"
                }`}
              >
                {f === "Favorites" ? "★ Favorites" : f}
              </button>
            ))}
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto pr-1" role="listbox" aria-label="Creator fonts">
            {visible.map((f) => {
              const isFav = favorites.includes(f.id);
              const isSel = selected?.id === f.id;
              return (
                <div
                  key={f.id}
                  data-font-id={f.id}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
                    isSel ? "border-[hsl(var(--primary))]" : "border-transparent hover:border-[hsl(var(--border))]"
                  }`}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    onClick={() => onChange(f)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-base leading-tight" style={{ fontFamily: creatorFontFamily(f.id) }}>
                      {preview}
                    </span>
                    <span className="block text-[10px] font-bold uppercase tracking-wider opacity-50">
                      {f.family} · {f.category}{f.house ? " · House" : ""} · {f.license}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={isFav ? `Unfavorite ${f.family}` : `Favorite ${f.family}`}
                    aria-pressed={isFav}
                    onClick={() => setFontFavorite(f.id, !isFav)}
                    className="shrink-0 p-1"
                  >
                    <Star className={`h-4 w-4 ${isFav ? "fill-[hsl(var(--primary))] text-[hsl(var(--primary))]" : "opacity-40"}`} />
                  </button>
                </div>
              );
            })}
            {visible.length === 0 && (
              <p className="px-2 py-4 text-center text-xs opacity-50">
                {filter === "Favorites" ? "No favorites yet — star a font to pin it here." : "No fonts match that search."}
              </p>
            )}
          </div>
          <p className="mt-2 text-[10px] opacity-40">
            64 open-license fonts (OFL / Apache), self-hosted — free for your covers, thumbnails and titles, forever.
          </p>
        </div>
      )}
    </div>
  );
}
