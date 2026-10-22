import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { MarketingBadge } from "@/components/MarketingBadge";
import { LuxReveal } from "@/components/LuxReveal";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowRight, Clapperboard, Search, Sparkles, X } from "lucide-react";
import {
  VIDEO_TEMPLATE_METAS,
  VIDEO_TEMPLATE_CATEGORIES,
} from "@/data/video-templates";
import ShareMenu from "@/components/ShareMenu";

/* ─── Public video-edit template library ───
   No login required. Search + category + sort over the real template set
   (data/video-templates.ts — the same keys the editor's server catalog
   serves). The default sort is "Featured — our picks": the curated order
   of the data file. There is NO usage tracking behind these templates
   (applies run through in-memory render jobs), so no popularity counts
   are shown — never fabricated.
   REMAKE: the card button deep-links into the Video Editor with
   ?tab=templates&template=<key>; the editor preselects the template and
   the creator maps their own clips/photos + overlay text into its slots
   — login + credits kick in at apply.
   SHARE: every card carries the tracked ShareMenu (POST /api/shares,
   referral code appended to the share link) pointing at the card's
   shareable URL, /templates/videos?template=<key>. */

const ASPECT_CLASS: Record<string, string> = {
  "9:16": "aspect-[9/16]",
  "16:9": "aspect-[16/9]",
  "1:1": "aspect-square",
};

export default function VideoTemplates() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  usePageTitle(
    "Video Edit Templates — Pro Auto Edits",
    "Video edit templates: photo dump montages, lyric sync cuts, product promos, before/after reveals, travel recaps and more — 18 ready-made cuts in all. Pick a template, drop in your clips, get an auto-edited video.",
  );
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"featured" | "az" | "shortest" | "most-clips">("featured");
  const [highlightKey, setHighlightKey] = useState<string | null>(null);

  const secondsOf = (label: string) => {
    const n = parseInt(label.replace(/[^0-9]/g, ""), 10);
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  };

  const q = query.trim().toLowerCase();
  const filtered = (() => {
    const list = VIDEO_TEMPLATE_METAS.filter((tpl) => {
      if (category !== "All" && tpl.category !== category) return false;
      if (!q) return true;
      const hay = `${tpl.name} ${tpl.tagline} ${tpl.description} ${tpl.category} ${tpl.outcome}`.toLowerCase();
      return hay.includes(q);
    });
    if (sort === "az") return [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "shortest") return [...list].sort((a, b) => secondsOf(a.durationLabel) - secondsOf(b.durationLabel));
    if (sort === "most-clips") return [...list].sort((a, b) => b.slotCount - a.slotCount);
    return list; // featured — the curated order of the data file
  })();

  /* Shareable deep link: ?template=<key> highlights + scrolls to the card.
     Filters reset so the shared card is always visible when it lands. */
  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("template");
    if (key && VIDEO_TEMPLATE_METAS.some((m) => m.key === key)) {
      setCategory("All");
      setQuery("");
      setSort("featured");
      setHighlightKey(key);
      requestAnimationFrame(() => {
        document.getElementById(`vt-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }, []);

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Video Edit Templates",
    description:
      "Pro video edit templates: photo dump montages, lyric sync cuts, product promos, before/after reveals, travel recaps, talking head polish, hype trailers, and podcast highlights.",
    url: "https://bowdownvisuals.com/templates/videos",
    numberOfItems: VIDEO_TEMPLATE_METAS.length,
    itemListElement: VIDEO_TEMPLATE_METAS.map((tpl, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `https://bowdownvisuals.com/templates/videos?template=${tpl.key}`,
      name: tpl.name,
    })),
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <style>{`
        @keyframes vt-shimmer { 0% { transform: translateX(-120%) skewX(-18deg); } 100% { transform: translateX(240%) skewX(-18deg); } }
        @keyframes vt-bar { 0%,100% { transform: scaleX(0.35); opacity:.55; } 50% { transform: scaleX(1); opacity:1; } }
        @keyframes vt-rise { 0%,100% { transform: translateY(6px); opacity:.5; } 50% { transform: translateY(-6px); opacity:1; } }
        .vt-shimmer { animation: vt-shimmer 2.6s ease-in-out infinite; }
        .vt-bar { animation: vt-bar 2.2s ease-in-out infinite; transform-origin: left; }
        .vt-rise { animation: vt-rise 2.8s ease-in-out infinite; }
      `}</style>
      <JsonLd data={itemListJsonLd} />
      <div className="mx-auto max-w-6xl px-6 py-16">
        <LuxReveal>
          <div className="text-center mb-10">
            <MarketingBadge variant="kicker">{t("videoTemplatesPage.kicker")}</MarketingBadge>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              {t("videoTemplatesPage.titleA")} <span className="text-[#e8c86a]">{t("videoTemplatesPage.titleB")}</span>
            </h1>
            <p className="mt-4 text-white/50 max-w-2xl mx-auto">
              {t("videoTemplatesPage.sub")}
            </p>
          </div>
        </LuxReveal>

        {/* Search */}
        <div className="mx-auto mb-6 max-w-md">
          <div className={`flex items-center gap-2 rounded-full border px-4 py-2.5 ${isLight ? "border-[#C9A84C]/50 bg-[#FCF7EA]" : "border-white/15 bg-white/[0.03]"}`}>
            <Search className={`h-4 w-4 shrink-0 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("videoTemplatesPage.searchPlaceholder", { defaultValue: "Search templates — try “lyric”, “promo”, “travel”…" })}
              className={`w-full bg-transparent text-sm outline-none ${isLight ? "text-[#2A1E07] placeholder:text-[#8A7A56]" : "text-white placeholder:text-white/35"}`}
              data-testid="vt-search"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                title={t("videoTemplatesPage.clearSearch", { defaultValue: "Clear search" })}
                className={`shrink-0 ${isLight ? "text-[#8A7A56] hover:text-[#7A5A12]" : "text-white/40 hover:text-white"}`}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Category filter + sort */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-3">
          {VIDEO_TEMPLATE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                category === cat
                  ? "bg-[#e8c86a] text-black"
                  : isLight
                    ? "border border-[#C9A84C]/40 text-[#6B5B36] hover:border-[#C9A84C]/70 hover:text-[#2A1E07]"
                    : "border border-white/15 text-white/60 hover:border-white/30 hover:text-white"
              }`}
            >
              {cat}
            </button>
          ))}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            data-testid="vt-sort"
            className={`rounded-full px-4 py-1.5 text-sm font-medium outline-none transition ${
              isLight
                ? "border border-[#C9A84C]/40 bg-[#FCF7EA] text-[#6B5B36]"
                : "border border-white/15 bg-[#14100a] text-white/70"
            }`}
          >
            <option value="featured">{t("videoTemplatesPage.sortFeatured", { defaultValue: "Featured — our picks" })}</option>
            <option value="az">{t("videoTemplatesPage.sortAz", { defaultValue: "Name A–Z" })}</option>
            <option value="shortest">{t("videoTemplatesPage.sortShortest", { defaultValue: "Shortest first" })}</option>
            <option value="most-clips">{t("videoTemplatesPage.sortMostClips", { defaultValue: "Most clips first" })}</option>
          </select>
        </div>
        <p className={`text-center text-xs mb-10 ${isLight ? "text-[#8A7A56]" : "text-white/35"}`} data-testid="vt-count">
          {t("videoTemplatesPage.resultsCount", { count: filtered.length, defaultValue: "{{count}} templates" })}
        </p>

        {/* Template cards */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((tpl, i) => (
            <LuxReveal key={tpl.key} delay={Math.min(i * 0.05, 0.3)}>
              <article
                id={`vt-${tpl.key}`}
                className={`group rounded-2xl border p-6 transition-colors h-full flex flex-col ${
                  isLight
                    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3] text-[#2A1E07] shadow-[0_10px_30px_rgba(122,90,18,0.12)] hover:border-[#C9A84C]/70"
                    : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] hover:border-[#e8c86a]/40"
                } ${highlightKey === tpl.key ? "ring-2 ring-[#e8c86a]/70 shadow-[0_0_32px_rgba(232,200,106,0.15)]" : ""}`}
              >
                {/* Animated preview */}
                <div className={`relative ${ASPECT_CLASS[tpl.aspect]} w-full max-h-56 mx-auto overflow-hidden rounded-xl border mb-5 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
                  <div className="vt-shimmer absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-[#e8c86a]/25 to-transparent" />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4">
                    <div className="vt-rise flex gap-1">
                      {Array.from({ length: Math.min(tpl.slotCount, 5) }).map((_, d) => (
                        <span key={d} className="h-1.5 w-6 rounded-full bg-[#e8c86a]/70" style={{ animationDelay: `${d * 0.25}s` }} />
                      ))}
                    </div>
                    <div className="vt-bar h-2.5 w-3/4 rounded-full bg-gradient-to-r from-[#e8c86a] to-[#b08d3e]" />
                    <div className="vt-bar h-2 w-1/2 rounded-full bg-white/25" style={{ animationDelay: "0.6s" }} />
                  </div>
                  <span className="absolute top-2 left-2 rounded-full bg-black/70 border border-[#e8c86a]/40 px-2 py-0.5 text-[10px] font-bold text-[#e8c86a]">
                    {tpl.aspect}
                  </span>
                  <span className="absolute top-2 right-2 rounded-full bg-black/70 border border-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/60">
                    {tpl.durationLabel}
                  </span>
                </div>

                <div className="flex items-start justify-between mb-2">
                  <h2 className="text-xl font-bold">{tpl.name}</h2>
                </div>
                <p className={`text-sm mb-3 flex-1 ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>{tpl.description}</p>
                <div className={`rounded-xl border px-4 py-3 mb-5 ${isLight ? "bg-[#C9A84C]/[0.10] border-[#C9A84C]/30" : "bg-black/40 border-white/[0.07]"}`}>
                  <p className={`text-[11px] uppercase tracking-wider mb-1 ${isLight ? "text-[#8A7A56]" : "text-white/35"}`}>
                    {t("videoTemplatesPage.outcomeLabel")}
                  </p>
                  <p className={`text-sm font-bold ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{tpl.outcome}</p>
                </div>
                <div className={`flex items-center gap-2 text-xs mb-4 ${isLight ? "text-[#8A7A56]" : "text-white/40"}`}>
                  <Clapperboard className={`h-3.5 w-3.5 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
                  {t("videoTemplatesPage.slotsLabel", { count: tpl.slotCount })}
                  <span className={`rounded-full border border-[#c9a84c]/30 bg-[#c9a84c]/10 px-2.5 py-0.5 text-[11px] font-medium ml-auto ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
                    {tpl.category}
                  </span>
                </div>
                {/* REMAKE — the front door into the editor flow: the editor
                    preselects this template; the creator maps their own
                    clips/photos + overlay text into its slots. */}
                <Link href={`/video-editor?tab=templates&template=${tpl.key}`} className="block">
                  <Button className="w-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110" data-testid={`vt-remake-${tpl.key}`}>
                    <Sparkles className="h-4 w-4 mr-2" />
                    {t("videoTemplatesPage.remake", { defaultValue: "Remake this" })}
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>

                {/* SHARE — tracked ShareMenu; the referral code rides the
                    link and the share is recorded per template key. The
                    strip is a dark grounded panel in both themes so the
                    menu's buttons stay legible on the ivory light card. */}
                <div className={`mt-3 rounded-xl border px-3.5 py-3 ${isLight ? "border-[#C9A84C]/30 bg-[#241a08]" : "border-white/[0.07] bg-black/40"}`}>
                  <p className="text-[11px] uppercase tracking-wider text-[#e8c86a]/80 mb-2">
                    {t("videoTemplatesPage.shareTemplate", { defaultValue: "Share this template" })}
                  </p>
                  <ShareMenu
                    getToken={getAccessToken}
                    shareUrl={`${window.location.origin}/templates/videos?template=${tpl.key}`}
                    text={`"${tpl.name}" — a Bow Down Visuals video template. Drop in your clips and it auto-edits the video for you.`}
                    contentType="other"
                    contentId={tpl.key}
                  />
                </div>
              </article>
            </LuxReveal>
          ))}
        </div>

        {/* Empty state — honest, with a one-tap reset */}
        {filtered.length === 0 && (
          <div className={`rounded-2xl border border-dashed p-10 text-center ${isLight ? "border-[#C9A84C]/40" : "border-white/15"}`} data-testid="vt-empty">
            <p className={`font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
              {t("videoTemplatesPage.noResultsTitle", { defaultValue: "No templates match that search" })}
            </p>
            <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
              {t("videoTemplatesPage.noResultsSub", { defaultValue: "Try a different word, or clear the search to browse the full library." })}
            </p>
            <Button
              onClick={() => { setQuery(""); setCategory("All"); }}
              className="mt-4 bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110"
            >
              {t("videoTemplatesPage.clearSearch", { defaultValue: "Clear search" })}
            </Button>
          </div>
        )}

        {/* Bottom CTA */}
        <div className="mt-16 text-center rounded-2xl border border-[#c9a84c]/25 bg-gradient-to-b from-[#c9a84c]/[0.07] to-transparent p-10">
          <h2 className="text-2xl font-bold mb-3">{t("videoTemplatesPage.ctaTitle")}</h2>
          <p className={`mb-6 max-w-xl mx-auto text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            {t("videoTemplatesPage.ctaSub")}
          </p>
          <Link href="/video-editor?tab=templates">
            <Button
              variant="outline"
              className="border-[#c9a84c]/40 text-[#e8c86a] hover:bg-[#c9a84c]/10"
            >
              {t("videoTemplatesPage.ctaButton")} <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>

        {/* SEO copy block */}
        <div className="mt-16 max-w-3xl mx-auto text-sm text-white/40 space-y-4">
          <h2 className="text-lg font-bold text-white/70">
            {t("videoTemplatesPage.seoTitle")}
          </h2>
          <p>{t("videoTemplatesPage.seoP1")}</p>
          <p>{t("videoTemplatesPage.seoP2")}</p>
        </div>
      </div>
    </div>
  );
}
