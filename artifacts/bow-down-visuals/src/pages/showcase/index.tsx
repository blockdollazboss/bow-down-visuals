import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { MarketingBadge } from "@/components/MarketingBadge";
import { LuxReveal } from "@/components/LuxReveal";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";
import { ArrowRight, Heart, Eye, Play, Music, Image as ImageIcon } from "lucide-react";

/* ─── Public creator showcase ───
   Opt-in gallery of community creations. No login required to browse;
   each item links to its own indexable page (/showcase/:slug). */

export interface ShowcaseItem {
  id: string;
  slug: string;
  title: string;
  description: string;
  media_type: "image" | "video" | "song";
  media_url: string;
  thumbnail_url: string | null;
  creator_name: string;
  likes: number;
  views: number;
  created_at: string;
}

const TYPE_FILTERS = [
  { value: "", label: "All" },
  { value: "image", label: "Thumbnails" },
  { value: "video", label: "Videos" },
  { value: "song", label: "Songs" },
] as const;

function MediaThumb({ item }: { item: ShowcaseItem }) {
  if (item.media_type === "video") {
    return (
      <div className="relative aspect-video bg-black/60 overflow-hidden">
        {item.thumbnail_url ? (
          <img src={item.thumbnail_url} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <video src={item.media_url} className="w-full h-full object-cover" preload="metadata" muted playsInline />
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-black/60 p-3 border border-white/20">
            <Play className="h-5 w-5 text-white" />
          </span>
        </span>
      </div>
    );
  }
  if (item.media_type === "song") {
    return (
      <div className="relative aspect-video bg-gradient-to-br from-[#c9a84c]/20 to-black flex items-center justify-center overflow-hidden">
        <Music className="h-12 w-12 text-[#e8c86a]/60" />
      </div>
    );
  }
  return (
    <div className="relative aspect-video bg-black/60 overflow-hidden">
      <img src={item.media_url} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
    </div>
  );
}

export default function Showcase() {
  const { t } = useTranslation();
  usePageTitle(
    "Creator Showcase — Made with Bow Down Visuals",
    "Browse thumbnails, videos, and songs made by the Bow Down Visuals creator community. Get inspired and make your own."
  );
  const [type, setType] = useState<string>("");
  const [items, setItems] = useState<ShowcaseItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/showcase${type ? `?type=${type}` : ""}`)
      .then((r) => r.json())
      .then((d) => setItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [type]);

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Creator Showcase",
    description: "Thumbnails, videos, and songs made by the Bow Down Visuals community.",
    url: "https://bowdownvisuals.com/showcase",
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `https://bowdownvisuals.com/showcase/${item.slug}`,
      name: item.title,
    })),
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <JsonLd data={itemListJsonLd} />
      <div className="mx-auto max-w-6xl px-6 py-16">
        <LuxReveal>
          <div className="text-center mb-10">
            <MarketingBadge variant="kicker">Community showcase</MarketingBadge>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
              Made with <span className="text-[#e8c86a]">Bow Down Visuals</span>
            </h1>
            <p className="mt-4 text-white/50 max-w-2xl mx-auto">
              Real thumbnails, videos, and songs made by creators in the
              community. Get inspired — then make your own.
            </p>
          </div>
        </LuxReveal>

        {/* Type filter */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setType(f.value)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                type === f.value
                  ? "bg-[#e8c86a] text-black"
                  : "border border-white/15 text-white/60 hover:border-white/30 hover:text-white"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-center text-white/40 py-16">Loading showcase…</p>
        ) : items.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-white/10 bg-white/[0.02]">
            <p className="text-white/50 mb-2">The showcase is just getting started.</p>
            <p className="text-sm text-white/35">Be the first to publish your creation.</p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, i) => (
              <LuxReveal key={item.id} delay={Math.min(i * 0.05, 0.3)}>
                <Link href={`/showcase/${item.slug}`}>
                  <article className="group rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden hover:border-[#e8c86a]/40 transition-colors h-full flex flex-col cursor-pointer">
                    <MediaThumb item={item} />
                    <div className="p-5 flex flex-col flex-1">
                      <h2 className="font-bold mb-1 group-hover:text-[#e8c86a] transition-colors line-clamp-1">
                        {item.title}
                      </h2>
                      <p className="text-xs text-white/40 mb-3">by {item.creator_name}</p>
                      <div className="flex items-center gap-4 text-xs text-white/40 mt-auto">
                        <span className="flex items-center gap-1">
                          <Heart className="h-3.5 w-3.5" /> {item.likes}
                        </span>
                        <span className="flex items-center gap-1">
                          <Eye className="h-3.5 w-3.5" /> {item.views}
                        </span>
                      </div>
                    </div>
                  </article>
                </Link>
              </LuxReveal>
            ))}
          </div>
        )}

        {/* Bottom CTA */}
        <div className="mt-16 text-center rounded-2xl border border-[#c9a84c]/25 bg-gradient-to-b from-[#c9a84c]/[0.07] to-transparent p-10">
          <h2 className="text-2xl font-bold mb-3">Get featured here</h2>
          <p className="text-white/50 mb-6 max-w-xl mx-auto text-sm">
            Made something you're proud of? Publish it to the showcase from
            any of your creations — it's free, and your page is shareable.
          </p>
          <Link href="/dashboard">
            <Button className="bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110">
              Open Dashboard <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
