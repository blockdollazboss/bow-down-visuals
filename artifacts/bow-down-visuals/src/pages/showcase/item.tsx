import { useState, useEffect } from "react";
import { Link, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { LuxReveal } from "@/components/LuxReveal";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Heart, Eye, Share2, Check } from "lucide-react";
import type { ShowcaseItem } from "./index";

/* ─── Public showcase item page ───
   Indexable per-creation page (/showcase/:slug) with social proof
   (likes, views) and share buttons — the viral loop. */

export default function ShowcaseItemPage() {
  const { t } = useTranslation();
  const [, params] = useRoute("/showcase/:slug");
  const slug = params?.slug ?? "";
  const [item, setItem] = useState<ShowcaseItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [likes, setLikes] = useState(0);
  const [liked, setLiked] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/showcase/${encodeURIComponent(slug)}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then((d) => {
        if (d?.item) { setItem(d.item); setLikes(d.item.likes); }
        else if (!notFound) setNotFound(true);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  usePageTitle(
    item ? `${item.title} — Creator Showcase | Bow Down Visuals` : "Creator Showcase | Bow Down Visuals",
    item ? `${item.description || item.title} — made by ${item.creator_name} with Bow Down Visuals.` : "Browse community creations made with Bow Down Visuals."
  );

  async function handleLike() {
    if (liked || !slug) return;
    setLiked(true);
    try {
      const r = await fetch(`/api/showcase/${encodeURIComponent(slug)}/like`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (typeof d.likes === "number") setLikes(d.likes);
      else setLikes((l) => l + 1);
    } catch {
      setLikes((l) => l + 1);
    }
  }

  async function handleShare() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard unavailable — fall back to prompt-less copy via selection */
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-white/40">Loading…</p>
      </div>
    );
  }

  if (notFound || !item) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-xl font-bold mb-2">Creation not found</p>
          <p className="text-white/40 text-sm mb-6">It may have been removed by its creator.</p>
          <Link href="/showcase">
            <Button variant="outline" className="border-white/15 text-white/70">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to showcase
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const pageUrl = `https://bowdownvisuals.com/showcase/${item.slug}`;
  const creativeWorkJsonLd = {
    "@context": "https://schema.org",
    "@type": item.media_type === "video" ? "VideoObject" : item.media_type === "song" ? "AudioObject" : "ImageObject",
    name: item.title,
    description: item.description || item.title,
    contentUrl: item.media_url,
    thumbnailUrl: item.thumbnail_url || item.media_url,
    url: pageUrl,
    creator: { "@type": "Person", name: item.creator_name },
    interactionStatistic: [
      { "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: likes },
      { "@type": "InteractionCounter", interactionType: "https://schema.org/WatchAction", userInteractionCount: item.views },
    ],
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <JsonLd data={creativeWorkJsonLd} />
      <div className="mx-auto max-w-4xl px-6 py-12">
        <LuxReveal>
          <Link href="/showcase">
            <button className="flex items-center gap-2 text-sm text-white/40 hover:text-white mb-8 transition">
              <ArrowLeft className="h-4 w-4" /> Back to showcase
            </button>
          </Link>

          {/* Media */}
          <div className="rounded-2xl overflow-hidden border border-white/10 bg-white/[0.02] mb-8">
            {item.media_type === "video" ? (
              <video src={item.media_url} controls poster={item.thumbnail_url ?? undefined} className="w-full max-h-[70vh]" playsInline />
            ) : item.media_type === "song" ? (
              <div className="p-10 text-center bg-gradient-to-b from-[#c9a84c]/10 to-transparent">
                <p className="text-5xl mb-6">🎵</p>
                <audio src={item.media_url} controls className="w-full max-w-md mx-auto" />
              </div>
            ) : (
              <img src={item.media_url} alt={item.title} className="w-full" />
            )}
          </div>

          {/* Meta + social proof */}
          <div className="flex flex-wrap items-start justify-between gap-6 mb-8">
            <div className="flex-1 min-w-[240px]">
              <h1 className="text-3xl font-bold mb-2">{item.title}</h1>
              <p className="text-sm text-white/40 mb-3">by <span className="text-[#e8c86a]">{item.creator_name}</span></p>
              {item.description && <p className="text-white/60 text-sm leading-relaxed">{item.description}</p>}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleLike}
                disabled={liked}
                className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold border transition ${
                  liked
                    ? "bg-[#e8c86a] text-black border-[#e8c86a]"
                    : "border-white/15 text-white/70 hover:border-[#e8c86a]/50 hover:text-white"
                }`}
              >
                <Heart className={`h-4 w-4 ${liked ? "fill-black" : ""}`} />
                {likes}
              </button>
              <button
                onClick={handleShare}
                className="flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold border border-white/15 text-white/70 hover:border-[#e8c86a]/50 hover:text-white transition"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Share2 className="h-4 w-4" />}
                {copied ? "Copied!" : "Share"}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-white/35 mb-12">
            <Eye className="h-3.5 w-3.5" /> {item.views} views
          </div>

          {/* CTA */}
          <div className="text-center rounded-2xl border border-[#c9a84c]/25 bg-gradient-to-b from-[#c9a84c]/[0.07] to-transparent p-10">
            <h2 className="text-2xl font-bold mb-3">Make your own</h2>
            <p className="text-white/50 mb-6 max-w-xl mx-auto text-sm">
              This was made with Bow Down Visuals — the AI toolkit for
              creators. Thumbnails, videos, songs, hooks, captions, and more.
            </p>
            <Link href="/signup">
              <Button className="bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110">
                Start creating <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        </LuxReveal>
      </div>
    </div>
  );
}
