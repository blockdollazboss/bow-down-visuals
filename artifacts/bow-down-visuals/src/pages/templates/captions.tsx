import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { MarketingBadge } from "@/components/MarketingBadge";
import { LuxReveal } from "@/components/LuxReveal";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";
import { ArrowRight, Sparkles } from "lucide-react";
import {
  CAPTION_PACKS,
  CAPTION_CATEGORIES,
} from "@/data/caption-templates";

/* ─── Public caption pack gallery ───
   No login required. "Use this pack" deep-links into Hook Studio's captions
   tab with ?tab=captions&template=<slug> — login + credits kick in at
   generation. */

const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  twitter: "X / Twitter",
};

export default function CaptionPacks() {
  const { t } = useTranslation();
  usePageTitle(
    "Social Media Caption Packs — Free Ideas & AI Generator | Bow Down Visuals",
    "Browse free caption packs for launches, promos, and everyday posts. Click any pack to generate captions with AI."
  );
  const [category, setCategory] = useState<string>("All");

  const filtered =
    category === "All"
      ? CAPTION_PACKS
      : CAPTION_PACKS.filter((p) => p.category === category);

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Social Media Caption Packs",
    description:
      "Free caption packs for launches, promos, and everyday posts — generate them with AI.",
    url: "https://bowdownvisuals.com/templates/captions",
    numberOfItems: CAPTION_PACKS.length,
    itemListElement: CAPTION_PACKS.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `https://bowdownvisuals.com/templates/captions#${p.slug}`,
      name: p.title,
    })),
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <JsonLd data={itemListJsonLd} />
      <div className="mx-auto max-w-6xl px-6 py-16">
        <LuxReveal>
          <div className="text-center mb-10">
            <MarketingBadge variant="kicker">Free template gallery</MarketingBadge>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              Caption <span className="text-[#e8c86a]">Packs</span>
            </h1>
            <p className="mt-4 text-white/50 max-w-2xl mx-auto">
              Done-for-you caption starters for launches, promos, and everyday
              posts. Pick a pack, hit “Use this pack,” and our AI writes
              captions in your tone — free to browse, credits apply when you
              generate.
            </p>
          </div>
        </LuxReveal>

        {/* Category filter */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {CAPTION_CATEGORIES.map((cat) => (
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

        {/* Pack cards */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((pack, i) => (
            <LuxReveal key={pack.slug} delay={Math.min(i * 0.05, 0.3)}>
              <article
                id={pack.slug}
                className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 hover:border-[#e8c86a]/40 transition-colors h-full flex flex-col"
              >
                <div className="flex items-start justify-between mb-4">
                  <span className="text-4xl">{pack.emoji}</span>
                  <span className="rounded-full border border-[#c9a84c]/30 bg-[#c9a84c]/10 px-3 py-1 text-xs font-medium text-[#e8c86a]">
                    {pack.category}
                  </span>
                </div>
                <h2 className="text-xl font-bold mb-2">{pack.title}</h2>
                <p className="text-sm text-white/50 mb-4 flex-1">{pack.blurb}</p>
                <div className="rounded-xl bg-black/40 border border-white/[0.07] px-4 py-3 mb-3">
                  <p className="text-[11px] uppercase tracking-wider text-white/35 mb-1">
                    Topic starter
                  </p>
                  <p className="text-sm font-bold text-white/90">
                    “{pack.topic}”
                  </p>
                </div>
                <div className="flex gap-2 mb-5">
                  <span className="rounded-full bg-white/[0.06] px-3 py-1 text-[11px] text-white/60">
                    {PLATFORM_LABEL[pack.platform] ?? pack.platform}
                  </span>
                  <span className="rounded-full bg-white/[0.06] px-3 py-1 text-[11px] text-white/60">
                    {pack.tone}
                  </span>
                </div>
                <Link href={`/hooks?tab=captions&template=${pack.slug}`}>
                  <Button className="w-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110">
                    <Sparkles className="h-4 w-4 mr-2" />
                    Use this pack
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </Link>
              </article>
            </LuxReveal>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-16 text-center rounded-2xl border border-[#c9a84c]/25 bg-gradient-to-b from-[#c9a84c]/[0.07] to-transparent p-10">
          <h2 className="text-2xl font-bold mb-3">
            Need captions for something else?
          </h2>
          <p className="text-white/50 mb-6 max-w-xl mx-auto text-sm">
            Hook Studio writes captions for any topic, platform, and tone —
            plus scroll-stopping hooks and pre-flight virality checks in the
            same place.
          </p>
          <Link href="/hooks?tab=captions">
            <Button
              variant="outline"
              className="border-[#c9a84c]/40 text-[#e8c86a] hover:bg-[#c9a84c]/10"
            >
              Open Caption Writer <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>

        {/* SEO copy block */}
        <div className="mt-16 max-w-3xl mx-auto text-sm text-white/40 space-y-4">
          <h2 className="text-lg font-bold text-white/70">
            Why captions do more than you think
          </h2>
          <p>
            A great caption does three jobs: it gives the algorithm keywords
            to rank you on, it gives viewers a reason to comment, and it
            carries your call-to-action — stream the song, buy the ticket,
            join the list. Most creators dash off a caption in 10 seconds and
            leave all three on the table.
          </p>
          <p>
            Every pack above is built on caption structures that drive saves,
            shares, and comments across TikTok, Instagram, YouTube, and X.
            Pick a pack, set your tone, and let the AI draft options — then
            make the final call with your own voice.
          </p>
        </div>
      </div>
    </div>
  );
}
