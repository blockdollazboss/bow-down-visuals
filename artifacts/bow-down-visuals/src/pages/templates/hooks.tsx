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
  HOOK_TEMPLATES,
  HOOK_CATEGORIES,
} from "@/data/hook-templates";

/* ─── Public hook template gallery ───
   No login required. "Use this template" deep-links into Hook Studio
   with ?template=<slug> — login + credits kick in at generation. */

export default function HookTemplates() {
  const { t } = useTranslation();
  usePageTitle(
    "Video Hook Templates — Free Ideas & AI Generator | Bow Down Visuals",
    "Browse free video hook templates for Shorts, TikTok, and Reels. Click any template to generate scroll-stopping hooks with AI."
  );
  const [category, setCategory] = useState<string>("All");

  const filtered =
    category === "All"
      ? HOOK_TEMPLATES
      : HOOK_TEMPLATES.filter((tpl) => tpl.category === category);

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Video Hook Templates",
    description:
      "Free video hook templates for Shorts, TikTok, and Reels — generate them with AI.",
    url: "https://bowdownvisuals.com/templates/hooks",
    numberOfItems: HOOK_TEMPLATES.length,
    itemListElement: HOOK_TEMPLATES.map((tpl, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `https://bowdownvisuals.com/templates/hooks#${tpl.slug}`,
      name: tpl.title,
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
              Video Hook <span className="text-[#e8c86a]">Templates</span>
            </h1>
            <p className="mt-4 text-white/50 max-w-2xl mx-auto">
              Scroll-stopping hooks for Shorts, TikTok, and Reels. Pick a
              template, hit “Use this template,” and our AI writes 5 hooks
              for your video — free to browse, credits apply when you generate.
            </p>
          </div>
        </LuxReveal>

        {/* Category filter */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {HOOK_CATEGORIES.map((cat) => (
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
            <LuxReveal key={tpl.slug} delay={Math.min(i * 0.05, 0.3)}>
              <article
                id={tpl.slug}
                className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 hover:border-[#e8c86a]/40 transition-colors h-full flex flex-col"
              >
                <div className="flex items-start justify-between mb-4">
                  <span className="text-4xl">{tpl.emoji}</span>
                  <span className="rounded-full border border-[#c9a84c]/30 bg-[#c9a84c]/10 px-3 py-1 text-xs font-medium text-[#e8c86a]">
                    {tpl.category}
                  </span>
                </div>
                <h2 className="text-xl font-bold mb-2">{tpl.title}</h2>
                <p className="text-sm text-white/50 mb-4 flex-1">{tpl.blurb}</p>
                <div className="rounded-xl bg-black/40 border border-white/[0.07] px-4 py-3 mb-5">
                  <p className="text-[11px] uppercase tracking-wider text-white/35 mb-1">
                    Topic starter
                  </p>
                  <p className="text-sm font-bold text-white/90">
                    “{tpl.topic}”
                  </p>
                </div>
                <Link href={`/hooks?template=${tpl.slug}`}>
                  <Button className="w-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110">
                    <Sparkles className="h-4 w-4 mr-2" />
                    Use this template
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
            Need hooks for something else?
          </h2>
          <p className="text-white/50 mb-6 max-w-xl mx-auto text-sm">
            Hook Studio writes hooks for any topic and video type — plus
            pre-flight virality checks and caption packs in the same place.
          </p>
          <Link href="/hooks">
            <Button
              variant="outline"
              className="border-[#c9a84c]/40 text-[#e8c86a] hover:bg-[#c9a84c]/10"
            >
              Open Hook Studio <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>

        {/* SEO copy block */}
        <div className="mt-16 max-w-3xl mx-auto text-sm text-white/40 space-y-4">
          <h2 className="text-lg font-bold text-white/70">
            Why the first 3 seconds decide everything
          </h2>
          <p>
            On Shorts, TikTok, and Reels, viewers decide in under 3 seconds
            whether to keep watching. The hook — your opening line — is the
            highest-leverage sentence in your entire video. The best hooks
            open a curiosity gap, make a bold claim, or name the exact result
            the viewer wants.
          </p>
          <p>
            Every template above is built on hook structures that consistently
            stop the scroll across music promo, behind-the-scenes, tutorials,
            and announcements. Pick one, plug in your topic, and let the AI
            write 5 variations — then run the winner through the pre-flight
            virality check before you post.
          </p>
        </div>
      </div>
    </div>
  );
}
