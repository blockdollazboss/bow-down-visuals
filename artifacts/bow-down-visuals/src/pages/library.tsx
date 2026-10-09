import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Library as LibraryIcon, Search, Sparkles, Type, Wand2, Heart,
  ArrowRight, Clock, X, Check, Copy, ChevronRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  LIBRARY_TEMPLATES, LIBRARY_TEMPLATE_CATEGORIES,
  type LibraryTemplate, type LibraryTemplateCategory,
} from "@/data/library-templates";
import {
  LIBRARY_PRESETS, LIBRARY_PRESET_CATEGORIES, TEXT_STYLE_PRESETS,
  type LibraryPreset, type LibraryPresetCategory,
} from "@/data/library-presets";
import {
  LIBRARY_FONTS, LIBRARY_FONT_CATEGORIES,
  type LibraryFont, type LibraryFontCategory,
} from "@/data/library-fonts";

/* ─── Thy Library ───────────────────────────────────────────────────────
   The connective tissue between tools: templates, presets, and fonts.
   Every "Use" deep-links into the exact tool with the item pre-loaded.
   - ?tab=templates|presets|fonts — pre-select tab (context-aware entry)
   - ?category=<name> — pre-select category
   - ?tool=thumbnail|video|brand — context hint from the calling tool
   Recent + favorites tracked in localStorage per user. */

type LibraryTab = "templates" | "presets" | "fonts";

const RECENT_KEY = "thy-library-recent-v1";
const FAV_KEY = "thy-library-favorites-v1";
const MAX_RECENT = 8;

interface RecentItem { kind: "template" | "preset" | "font"; slug: string; at: number; }

function readRecent(): RecentItem[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; }
}
function readFavs(): string[] {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]"); } catch { return []; }
}

function useQueryParams() {
  const [loc] = useLocation();
  return useMemo(() => new URLSearchParams(loc.split("?")[1] ?? ""), [loc]);
}

export default function Library() {
  const { t } = useTranslation();
  usePageTitle(t("library.pageTitle", { defaultValue: "Thy Library" }), t("library.pageDescription", { defaultValue: "Templates, presets, and fonts for creators." }));
  const params = useQueryParams();

  const initialTab = ((): LibraryTab => {
    const tab = params.get("tab");
    if (tab === "presets" || tab === "fonts" || tab === "templates") return tab;
    // Context-aware: tool hint selects the most relevant tab
    const tool = params.get("tool");
    if (tool === "video") return "presets";
    return "templates";
  })();

  const [tab, setTab] = useState<LibraryTab>(initialTab);
  const [query, setQuery] = useState("");
  const [templateCat, setTemplateCat] = useState<string>(params.get("category") ?? "All");
  const [presetCat, setPresetCat] = useState<string>("All");
  const [fontCat, setFontCat] = useState<string>("All");
  const [recent, setRecent] = useState<RecentItem[]>(() => readRecent());
  const [favs, setFavs] = useState<string[]>(() => readFavs());
  const [copiedFont, setCopiedFont] = useState<string | null>(null);

  // Context-aware: ?tool=thumbnail preselects the Thumbnails category
  useEffect(() => {
    const tool = params.get("tool");
    if (tool === "thumbnail") setTemplateCat("Thumbnails");
    else if (tool === "carousel") setTemplateCat("Carousels");
    else if (tool === "brand") setTemplateCat("Intros & Outros");
    else if (tool === "video") setPresetCat("Effects");
  }, [params]);

  function trackUse(kind: RecentItem["kind"], slug: string) {
    const next = [{ kind, slug, at: Date.now() }, ...recent.filter((r) => r.slug !== slug)].slice(0, MAX_RECENT);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* noop */ }
  }

  function toggleFav(slug: string) {
    const next = favs.includes(slug) ? favs.filter((f) => f !== slug) : [...favs, slug];
    setFavs(next);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch { /* noop */ }
  }

  function copyFont(f: LibraryFont) {
    const css = `font-family: '${f.family}', sans-serif;`;
    navigator.clipboard?.writeText(css).catch(() => {});
    setCopiedFont(f.family);
    trackUse("font", f.family);
    setTimeout(() => setCopiedFont(null), 2000);
  }

  const q = query.trim().toLowerCase();
  const matchQ = (s: string) => !q || s.toLowerCase().includes(q);

  const filteredTemplates = useMemo(() => LIBRARY_TEMPLATES.filter((tpl) =>
    (templateCat === "All" || tpl.category === templateCat) &&
    (matchQ(tpl.title) || matchQ(tpl.blurb) || matchQ(tpl.niche))
  ), [templateCat, q]);

  const filteredPresets = useMemo(() => LIBRARY_PRESETS.filter((p) =>
    (presetCat === "All" || p.category === presetCat) &&
    (matchQ(p.name) || matchQ(p.blurb))
  ), [presetCat, q]);

  const filteredFonts = useMemo(() => LIBRARY_FONTS.filter((f) =>
    (fontCat === "All" || f.category === fontCat) &&
    (matchQ(f.family) || matchQ(f.blurb))
  ), [fontCat, q]);

  const recentTemplates = useMemo(() =>
    recent.filter((r) => r.kind === "template")
      .map((r) => LIBRARY_TEMPLATES.find((t) => t.slug === r.slug))
      .filter((t): t is LibraryTemplate => !!t).slice(0, 4),
  [recent]);

  const tabs: { key: LibraryTab; label: string; icon: typeof Sparkles; count: number }[] = [
    { key: "templates", label: t("library.tabTemplates", { defaultValue: "Templates" }), icon: Sparkles, count: LIBRARY_TEMPLATES.length },
    { key: "presets", label: t("library.tabPresets", { defaultValue: "Presets" }), icon: Wand2, count: LIBRARY_PRESETS.length },
    { key: "fonts", label: t("library.tabFonts", { defaultValue: "Fonts" }), icon: Type, count: LIBRARY_FONTS.length },
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8 md:py-12">
        {/* ── Hero ── */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#c9a84c]/30 bg-[#c9a84c]/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-[#e8c86a]">
            <LibraryIcon className="h-3.5 w-3.5" />
            {t("library.kicker", { defaultValue: "Thy creative arsenal" })}
          </div>
          <h1 className="mt-4 text-4xl md:text-5xl font-black tracking-tight">
            {t("library.headingA", { defaultValue: "Thy" })} <span className="text-[#e8c86a]">{t("library.headingB", { defaultValue: "Library" })}</span>
          </h1>
          <p className="mt-3 text-white/50 max-w-2xl mx-auto">
            {t("library.sub", { defaultValue: "Templates, presets, and fonts that plug straight into your tools. Pick one, hit Use, keep creating." })}
          </p>
        </div>

        {/* ── Search ── */}
        <div className="relative max-w-xl mx-auto mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("library.searchPlaceholder", { defaultValue: "Search templates, presets, fonts…" })}
            className="w-full rounded-full border border-white/10 bg-white/[0.04] pl-11 pr-10 py-3 text-sm text-white placeholder:text-white/30 focus:border-[#c9a84c]/50 focus:outline-none"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white" aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* ── Tabs ── */}
        <div className="flex justify-center gap-2 mb-8 overflow-x-auto pb-1" role="tablist">
          {tabs.map(({ key, label, icon: Icon, count }) => (
            <button
              key={key} role="tab" aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 whitespace-nowrap shrink-0 rounded-full px-5 py-2.5 text-sm font-bold transition ${
                tab === key
                  ? "bg-[#c9a84c] text-black shadow-[0_0_18px_rgba(201,168,76,0.35)]"
                  : "border border-white/10 bg-white/[0.04] text-white/60 hover:border-[#c9a84c]/40 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
              <span className={`text-xs ${tab === key ? "text-black/60" : "text-white/30"}`}>{count}</span>
            </button>
          ))}
        </div>

        {/* ── Recently used ── */}
        {recentTemplates.length > 0 && tab === "templates" && !q && (
          <div className="mb-10">
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-white/40 mb-4">
              <Clock className="h-4 w-4" /> {t("library.recentlyUsed", { defaultValue: "Recently used" })}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {recentTemplates.map((tpl) => (
                <TemplateCard key={tpl.slug} tpl={tpl} compact
                  isFav={favs.includes(tpl.slug)} onFav={() => toggleFav(tpl.slug)}
                  onUse={() => trackUse("template", tpl.slug)} t={t} />
              ))}
            </div>
          </div>
        )}

        {/* ═══ TEMPLATES ═══ */}
        {tab === "templates" && (
          <>
            <CategoryPills
              categories={["All", ...LIBRARY_TEMPLATE_CATEGORIES]}
              active={templateCat} onChange={setTemplateCat}
            />
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredTemplates.map((tpl) => (
                <TemplateCard key={tpl.slug} tpl={tpl}
                  isFav={favs.includes(tpl.slug)} onFav={() => toggleFav(tpl.slug)}
                  onUse={() => trackUse("template", tpl.slug)} t={t} />
              ))}
            </div>
            {filteredTemplates.length === 0 && <EmptyState t={t} />}
          </>
        )}

        {/* ═══ PRESETS ═══ */}
        {tab === "presets" && (
          <>
            <CategoryPills
              categories={["All", ...LIBRARY_PRESET_CATEGORIES]}
              active={presetCat} onChange={setPresetCat}
            />
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredPresets.map((p) => (
                <PresetCard key={p.slug} preset={p}
                  isFav={favs.includes(p.slug)} onFav={() => toggleFav(p.slug)}
                  onUse={() => trackUse("preset", p.slug)} t={t} />
              ))}
            </div>
            {filteredPresets.length === 0 && <EmptyState t={t} />}
          </>
        )}

        {/* ═══ FONTS ═══ */}
        {tab === "fonts" && (
          <>
            <CategoryPills
              categories={["All", ...LIBRARY_FONT_CATEGORIES]}
              active={fontCat} onChange={setFontCat}
            />
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {filteredFonts.map((f) => (
                <FontCard key={f.family} font={f}
                  isFav={favs.includes(f.family)} onFav={() => toggleFav(f.family)}
                  copied={copiedFont === f.family} onCopy={() => copyFont(f)} t={t} />
              ))}
            </div>
            {filteredFonts.length === 0 && <EmptyState t={t} />}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Category pills ─── */
function CategoryPills({ categories, active, onChange }: { categories: string[]; active: string; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-2 mb-8 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap sm:justify-center">
      {categories.map((c) => (
        <button
          key={c} onClick={() => onChange(c)}
          className={`whitespace-nowrap shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
            active === c
              ? "bg-[#c9a84c] text-black"
              : "border border-white/10 text-white/60 hover:border-[#c9a84c]/40 hover:text-white"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

/* ─── Template card ─── */
function TemplateCard({ tpl, compact, isFav, onFav, onUse, t }: {
  tpl: LibraryTemplate; compact?: boolean; isFav: boolean; onFav: () => void; onUse: () => void; t: (k: string, o?: any) => string;
}) {
  return (
    <article className="group rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden hover:border-[#c9a84c]/40 hover:-translate-y-1 transition-all">
      <div className="relative h-28 flex items-center justify-center overflow-hidden" style={{ background: tpl.gradient }}>
        <span className="text-5xl drop-shadow-lg" aria-hidden="true">{tpl.emoji}</span>
        <span className="absolute bottom-2 left-3 text-[10px] font-bold uppercase tracking-widest text-white/70 bg-black/40 px-2 py-0.5 rounded-full backdrop-blur">
          {tpl.niche}
        </span>
        <button
          onClick={onFav} aria-label="Favorite"
          className={`absolute top-2 right-2 h-8 w-8 rounded-full flex items-center justify-center backdrop-blur transition ${
            isFav ? "bg-[#c9a84c] text-black" : "bg-black/40 text-white/60 hover:text-white"
          }`}
        >
          <Heart className={`h-4 w-4 ${isFav ? "fill-current" : ""}`} />
        </button>
      </div>
      <div className="p-4">
        <h3 className="font-bold text-white truncate">{tpl.title}</h3>
        {!compact && <p className="text-xs text-white/45 mt-1 line-clamp-2 leading-relaxed">{tpl.blurb}</p>}
        <div className="flex items-center justify-between mt-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#e8c86a]/80">{tpl.toolLabel}</span>
          <Link href={tpl.useUrl} onClick={onUse}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#c9a84c] text-black text-xs font-black px-4 py-2 hover:bg-[#e8c86a] transition">
            {t("library.use", { defaultValue: "Use" })} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </article>
  );
}

/* ─── Preset card (live CSS filter preview) ─── */
function PresetCard({ preset, isFav, onFav, onUse, t }: {
  preset: LibraryPreset; isFav: boolean; onFav: () => void; onUse: () => void; t: (k: string, o?: any) => string;
}) {
  const isText = preset.category === "Text Styles";
  const textPreset = TEXT_STYLE_PRESETS.find((p) => p.slug === preset.slug);
  return (
    <article className="group rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden hover:border-[#c9a84c]/40 hover:-translate-y-1 transition-all">
      <div className="relative h-28 overflow-hidden" style={{ background: preset.gradient }}>
        {isText && textPreset ? (
          <div className="absolute inset-0 flex items-center justify-center p-3">
            <span className="text-2xl font-black text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] text-center leading-tight"
              style={{ fontFamily: textPreset.fontFamily }}>
              Thy Cheat Code
            </span>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center" style={{ filter: preset.cssFilter !== "none" ? preset.cssFilter : undefined }}>
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[#e8c86a] via-[#c9a84c] to-[#8a6d2f] shadow-2xl" />
          </div>
        )}
        <span className="absolute bottom-2 left-3 text-[10px] font-bold uppercase tracking-widest text-white/70 bg-black/40 px-2 py-0.5 rounded-full backdrop-blur">
          {preset.category}
        </span>
        <button
          onClick={onFav} aria-label="Favorite"
          className={`absolute top-2 right-2 h-8 w-8 rounded-full flex items-center justify-center backdrop-blur transition ${
            isFav ? "bg-[#c9a84c] text-black" : "bg-black/40 text-white/60 hover:text-white"
          }`}
        >
          <Heart className={`h-4 w-4 ${isFav ? "fill-current" : ""}`} />
        </button>
      </div>
      <div className="p-4">
        <h3 className="font-bold text-white truncate">{preset.name}</h3>
        <p className="text-xs text-white/45 mt-1 line-clamp-2 leading-relaxed">{preset.blurb}</p>
        <div className="flex items-center justify-between mt-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#e8c86a]/80">{preset.toolLabel}</span>
          <Link href={preset.useUrl} onClick={onUse}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#c9a84c] text-black text-xs font-black px-4 py-2 hover:bg-[#e8c86a] transition">
            {t("library.use", { defaultValue: "Use" })} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </article>
  );
}

/* ─── Font card (live font preview) ─── */
function FontCard({ font, isFav, onFav, copied, onCopy, t }: {
  font: LibraryFont; isFav: boolean; onFav: () => void; copied: boolean; onCopy: () => void; t: (k: string, o?: any) => string;
}) {
  return (
    <article className="group rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden hover:border-[#c9a84c]/40 hover:-translate-y-1 transition-all">
      <div className="relative h-32 flex flex-col items-center justify-center p-4 bg-gradient-to-br from-white/[0.04] to-transparent overflow-hidden">
        <span className="text-3xl text-white text-center leading-tight" style={{ fontFamily: `'${font.family}', sans-serif` }}>
          Thy Cheat Code
        </span>
        <span className="mt-2 text-xs text-white/40" style={{ fontFamily: `'${font.family}', sans-serif` }}>
          ABCDEFG abcdefg 123
        </span>
        <button
          onClick={onFav} aria-label="Favorite"
          className={`absolute top-2 right-2 h-8 w-8 rounded-full flex items-center justify-center backdrop-blur transition ${
            isFav ? "bg-[#c9a84c] text-black" : "bg-black/40 text-white/60 hover:text-white"
          }`}
        >
          <Heart className={`h-4 w-4 ${isFav ? "fill-current" : ""}`} />
        </button>
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white truncate">{font.family}</h3>
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#e8c86a]/80 shrink-0 ml-2">{font.category}</span>
        </div>
        <p className="text-xs text-white/45 mt-1">{font.blurb}</p>
        <button
          onClick={onCopy}
          className={`mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-full text-xs font-black px-4 py-2 transition ${
            copied ? "bg-green-500 text-black" : "bg-[#c9a84c] text-black hover:bg-[#e8c86a]"
          }`}
        >
          {copied ? <><Check className="h-3.5 w-3.5" /> {t("library.copied", { defaultValue: "Copied!" })}</>
                   : <><Copy className="h-3.5 w-3.5" /> {t("library.useFont", { defaultValue: "Copy font" })}</>}
        </button>
      </div>
    </article>
  );
}

/* ─── Empty state ─── */
function EmptyState({ t }: { t: (k: string, o?: any) => string }) {
  return (
    <div className="text-center py-16">
      <LibraryIcon className="h-10 w-10 text-white/20 mx-auto mb-4" />
      <p className="text-white/40">{t("library.noResults", { defaultValue: "Nothing found — try another search." })}</p>
    </div>
  );
}

/* ─── Browse Library button (drop into any tool) ─── */
export function BrowseLibraryButton({ tab, category, tool, className }: {
  tab?: LibraryTab; category?: string; tool?: string; className?: string;
}) {
  const { t } = useTranslation();
  const href = `/library?tab=${tab ?? "templates"}${category ? `&category=${encodeURIComponent(category)}` : ""}${tool ? `&tool=${tool}` : ""}`;
  return (
    <Link href={href}
      className={`inline-flex items-center gap-1.5 rounded-full border border-[#c9a84c]/30 bg-[#c9a84c]/10 text-[#e8c86a] text-xs font-bold px-4 py-2 hover:bg-[#c9a84c]/20 transition ${className ?? ""}`}>
      <LibraryIcon className="h-3.5 w-3.5" />
      {t("library.browse", { defaultValue: "Browse Library" })}
      <ChevronRight className="h-3.5 w-3.5" />
    </Link>
  );
}
