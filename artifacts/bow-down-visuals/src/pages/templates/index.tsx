import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { MarketingBadge } from "@/components/MarketingBadge";
import { LuxReveal } from "@/components/LuxReveal";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { ArrowRight, Clapperboard, Image as ImageIcon, Zap, MessageSquare, Trophy } from "lucide-react";
import { VIDEO_TEMPLATE_METAS } from "@/data/video-templates";
import { THUMBNAIL_TEMPLATES } from "@/data/thumbnail-templates";
import { HOOK_TEMPLATES } from "@/data/hook-templates";
import { CAPTION_PACKS } from "@/data/caption-templates";

/* ─── Public template library hub ───
   No login required. Galleries deep-link into tools with templates preloaded.
   Counts are computed from the data files themselves — they can never
   drift away from the real template set. */

const GALLERIES = [
  {
    slug: "videos",
    icon: Clapperboard,
    emoji: "🎬",
    title: "Video Edit Templates",
    blurb:
      "Pro auto edits: photo dump montages, lyric sync cuts, product promos, before/after reveals and more. Drop in clips, get a finished video.",
    count: `${VIDEO_TEMPLATE_METAS.length} templates`,
    live: true,
  },
  {
    slug: "thumbnails",
    icon: ImageIcon,
    emoji: "🖼️",
    title: "Thumbnail Templates",
    blurb:
      "High-CTR YouTube thumbnail styles for fitness, gaming, podcasts, finance and more.",
    count: `${THUMBNAIL_TEMPLATES.length} templates`,
    live: true,
  },
  {
    slug: "hooks",
    icon: Zap,
    emoji: "🪝",
    title: "Hook Templates",
    blurb:
      "Scroll-stopping video hooks for Shorts, TikTok, and Reels — plug into Hook Studio.",
    count: `${HOOK_TEMPLATES.length} templates`,
    live: true,
  },
  {
    slug: "captions",
    icon: MessageSquare,
    emoji: "✍️",
    title: "Caption Packs",
    blurb:
      "Done-for-you caption packs for launches, promos, and everyday posts.",
    count: `${CAPTION_PACKS.length} packs`,
    live: true,
  },
];

export default function TemplatesHub() {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
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
            "Free templates for creators: video edit templates, thumbnails, hooks, and captions.",
          url: "https://bowdownvisuals.com/templates",
        }}
      />
      <div className="mx-auto max-w-5xl px-6 py-16">
        <LuxReveal>
          <div className="text-center mb-12">
            <MarketingBadge variant="kicker">Free for creators</MarketingBadge>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              Template <span className={isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}>Library</span>
            </h1>
            <p className={`mt-4 max-w-2xl mx-auto ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
              Proven templates, free to browse. Pick one and our AI builds it
              for you — credits apply when you generate.
            </p>
          </div>
        </LuxReveal>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {GALLERIES.map((g, i) => (
            <LuxReveal key={g.slug} delay={Math.min(i * 0.08, 0.24)}>
              <article className={`rounded-2xl border p-8 h-full flex flex-col transition-colors ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3] text-[#2A1E07] shadow-[0_10px_30px_rgba(122,90,18,0.12)] hover:border-[#C9A84C]/70" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] hover:border-[#e8c86a]/40"}`}>
                <span className="text-4xl mb-4">{g.emoji}</span>
                <h2 className="text-xl font-bold mb-2">{g.title}</h2>
                <p className={`text-sm mb-2 flex-1 ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>{g.blurb}</p>
                <p className={`text-xs mb-5 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{g.count}</p>
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

        {/* Community showcase promo */}
        <LuxReveal delay={0.1}>
          <div className="mt-12 text-center rounded-2xl border border-[#c9a84c]/25 bg-gradient-to-b from-[#c9a84c]/[0.07] to-transparent p-10">
            <Trophy className={`h-8 w-8 mx-auto mb-4 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
            <h2 className="text-2xl font-bold mb-3">Community Showcase</h2>
            <p className={`mb-6 max-w-xl mx-auto text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
              See what creators are making with Bow Down Visuals — thumbnails,
              videos, and songs from the community.
            </p>
            <Link href="/showcase">
              <Button className="bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110">
                Browse the showcase <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        </LuxReveal>
      </div>
    </div>
  );
}
