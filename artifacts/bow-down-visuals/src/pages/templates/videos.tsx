import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { MarketingBadge } from "@/components/MarketingBadge";
import { LuxReveal } from "@/components/LuxReveal";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowRight, Check, Clapperboard, Link2, Sparkles } from "lucide-react";
import {
  VIDEO_TEMPLATE_METAS,
  VIDEO_TEMPLATE_CATEGORIES,
} from "@/data/video-templates";

/* ─── Public video-edit template gallery ───
   No login required. "Use this template" deep-links into the Video Editor
   with ?tab=templates&template=<key> — login + credits kick in at apply.
   Every card has a shareable link (/templates/videos?template=<key>) that
   carries the viewer's referral code when they're signed in. */

const ASPECT_CLASS: Record<string, string> = {
  "9:16": "aspect-[9/16]",
  "16:9": "aspect-[16/9]",
  "1:1": "aspect-square",
};

export default function VideoTemplates() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user, getAccessToken } = useAuth();
  usePageTitle(
    "Video Edit Templates — CapCut-Style Auto Edits | Bow Down Visuals",
    "Free video edit templates: photo dump montages, lyric sync cuts, product promos, before/after reveals, travel recaps and more. Pick a template, drop in your clips, get an auto-edited video.",
  );
  const [category, setCategory] = useState("All");
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);

  const filtered =
    category === "All"
      ? VIDEO_TEMPLATE_METAS
      : VIDEO_TEMPLATE_METAS.filter((tpl) => tpl.category === category);

  /* Shareable deep link: ?template=<key> highlights + scrolls to the card */
  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("template");
    if (key && VIDEO_TEMPLATE_METAS.some((m) => m.key === key)) {
      setHighlightKey(key);
      requestAnimationFrame(() => {
        document.getElementById(`vt-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }, []);

  /* Carry the viewer's referral code on share links when signed in */
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const token = await getAccessToken().catch(() => null);
        if (!token) return;
        const res = await fetch("/api/referrals/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.code) setReferralCode(String(data.code));
      } catch {
        /* referral lookup is best-effort — share links still work without it */
      }
    })();
  }, [user, getAccessToken]);

  const shareLink = useMemo(
    () => (key: string) => {
      const base = `${window.location.origin}/templates/videos?template=${key}`;
      return referralCode ? `${base}&ref=${encodeURIComponent(referralCode)}` : base;
    },
    [referralCode],
  );

  async function copyShareLink(key: string) {
    try {
      await navigator.clipboard.writeText(shareLink(key));
      setCopiedKey(key);
      toast({ title: t("videoTemplatesPage.linkCopied") });
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
    } catch {
      toast({ title: t("videoTemplatesPage.copyFailed") });
    }
  }

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Video Edit Templates",
    description:
      "CapCut-style video edit templates: photo dump montages, lyric sync cuts, product promos, before/after reveals, travel recaps, talking head polish, hype trailers, and podcast highlights.",
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

        {/* Category filter */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {VIDEO_TEMPLATE_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                category === cat
                  ? "bg-[#e8c86a] text-black"
                  : "border border-white/15 text-white/60 hover:border-white/30 hover:text-white"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Template cards */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((tpl, i) => (
            <LuxReveal key={tpl.key} delay={Math.min(i * 0.05, 0.3)}>
              <article
                id={`vt-${tpl.key}`}
                className={`group rounded-2xl border bg-white/[0.03] p-6 transition-colors h-full flex flex-col ${
                  highlightKey === tpl.key
                    ? "border-[#e8c86a]/70 shadow-[0_0_32px_rgba(232,200,106,0.15)]"
                    : "border-white/10 hover:border-[#e8c86a]/40"
                }`}
              >
                {/* Animated preview */}
                <div className={`relative ${ASPECT_CLASS[tpl.aspect]} w-full max-h-56 mx-auto overflow-hidden rounded-xl bg-gradient-to-br from-[#141414] via-[#0a0a0a] to-[#1c1408] border border-white/5 mb-5`}>
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
                <p className="text-sm text-white/50 mb-3 flex-1">{tpl.description}</p>
                <div className="rounded-xl bg-black/40 border border-white/[0.07] px-4 py-3 mb-5">
                  <p className="text-[11px] uppercase tracking-wider text-white/35 mb-1">
                    {t("videoTemplatesPage.outcomeLabel")}
                  </p>
                  <p className="text-sm font-bold text-[#e8c86a]">{tpl.outcome}</p>
                </div>
                <div className="flex items-center gap-2 text-xs text-white/40 mb-4">
                  <Clapperboard className="h-3.5 w-3.5 text-[#e8c86a]" />
                  {t("videoTemplatesPage.slotsLabel", { count: tpl.slotCount })}
                  <span className="rounded-full border border-[#c9a84c]/30 bg-[#c9a84c]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#e8c86a] ml-auto">
                    {tpl.category}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Link href={`/video-editor?tab=templates&template=${tpl.key}`} className="flex-1">
                    <Button className="w-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110">
                      <Sparkles className="h-4 w-4 mr-2" />
                      {t("videoTemplatesPage.useTemplate")}
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyShareLink(tpl.key)}
                    title={t("videoTemplatesPage.copyShareLink")}
                    className="border-white/15 text-white/60 hover:border-[#e8c86a]/50 hover:text-[#e8c86a] shrink-0"
                  >
                    {copiedKey === tpl.key ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                  </Button>
                </div>
              </article>
            </LuxReveal>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-16 text-center rounded-2xl border border-[#c9a84c]/25 bg-gradient-to-b from-[#c9a84c]/[0.07] to-transparent p-10">
          <h2 className="text-2xl font-bold mb-3">{t("videoTemplatesPage.ctaTitle")}</h2>
          <p className="text-white/50 mb-6 max-w-xl mx-auto text-sm">
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
