import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { MarketingBadge } from "@/components/MarketingBadge";
import { LuxReveal } from "@/components/LuxReveal";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";
import { ArrowRight, Image as ImageIcon, Zap, MessageSquare } from "lucide-react";

/* ─── Public template library hub ───
   No login required. Galleries deep-link into tools with templates preloaded. */

const GALLERIES = [
  {
    slug: "thumbnails",
    icon: ImageIcon,
    emoji: "🖼️",
    title: "Thumbnail Templates",
    blurb:
      "High-CTR YouTube thumbnail styles for fitness, gaming, podcasts, finance and more.",
    count: "12 templates",
    live: true,
  },
  {
    slug: "hooks",
    icon: Zap,
    emoji: "🪝",
    title: "Hook Templates",
    blurb:
      "Scroll-stopping video hooks for Shorts, TikTok, and Reels — plug into Hook Studio.",
    count: "Coming soon",
    live: false,
  },
  {
    slug: "captions",
    icon: MessageSquare,
    emoji: "✍️",
    title: "Caption Packs",
    blurb:
      "Done-for-you caption packs for launches, promos, and everyday posts.",
    count: "Coming soon",
    live: false,
  },
];

export default function TemplatesHub() {
  const { t } = useTranslation();
  usePageTitle(
    "Free Creator Templates — Thumbnails, Hooks & Captions | Bow Down Visuals",
    "Free templates for creators: YouTube thumbnail templates, video hook templates, and caption packs. Click any template to generate it with AI."
  );

  return (
    <div className="min-h-screen bg-black text-white">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Creator Template Library",
          description:
            "Free templates for creators: thumbnails, hooks, and captions.",
          url: "https://bowdownvisuals.com/templates",
        }}
      />
      <div className="mx-auto max-w-5xl px-6 py-16">
        <LuxReveal>
          <div className="text-center mb-12">
            <MarketingBadge variant="kicker">Free for creators</MarketingBadge>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              Template <span className="text-[#e8c86a]">Library</span>
            </h1>
            <p className="mt-4 text-white/50 max-w-2xl mx-auto">
              Proven templates, free to browse. Pick one and our AI builds it
              for you — credits apply when you generate.
            </p>
          </div>
        </LuxReveal>

        <div className="grid gap-6 md:grid-cols-3">
          {GALLERIES.map((g, i) => (
            <LuxReveal key={g.slug} delay={Math.min(i * 0.08, 0.24)}>
              <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 h-full flex flex-col hover:border-[#e8c86a]/40 transition-colors">
                <span className="text-4xl mb-4">{g.emoji}</span>
                <h2 className="text-xl font-bold mb-2">{g.title}</h2>
                <p className="text-sm text-white/50 mb-2 flex-1">{g.blurb}</p>
                <p className="text-xs text-[#e8c86a] mb-5">{g.count}</p>
                {g.live ? (
                  <Link href={`/templates/${g.slug}`}>
                    <Button className="w-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110">
                      Browse templates <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </Link>
                ) : (
                  <Button
                    disabled
                    variant="outline"
                    className="w-full border-white/10 text-white/30"
                  >
                    Coming soon
                  </Button>
                )}
              </article>
            </LuxReveal>
          ))}
        </div>
      </div>
    </div>
  );
}
