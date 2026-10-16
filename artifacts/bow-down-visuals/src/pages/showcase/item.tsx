import { useState, useEffect } from "react";
import { Link, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { LuxReveal } from "@/components/LuxReveal";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { useTranslation } from "react-i18next";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { ArrowLeft, ArrowRight, Heart, Eye, AlertTriangle, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import ShareMenu from "@/components/ShareMenu";
import type { ShowcaseItem } from "./index";

/* ─── Public showcase item page ───
   Indexable per-creation page (/showcase/:slug) with social proof
   (likes, views) and share buttons — the viral loop. */

export default function ShowcaseItemPage() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { getAccessToken } = useAuth();
  const [, params] = useRoute("/showcase/:slug");
  const slug = params?.slug ?? "";
  const [item, setItem] = useState<ShowcaseItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  /* Load failures (500s, network) are NOT "this doesn't exist" — they
     get their own error state with a retry. notFound is reserved for a
     genuine HTTP 404 response ONLY. */
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [likes, setLikes] = useState(0);
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setNotFound(false);
    setLoadError(false);
    fetch(`/api/showcase/${encodeURIComponent(slug)}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        if (!r.ok) throw new Error("load failed");
        return r.json();
      })
      .then((d) => {
        if (d?.item) { setItem(d.item); setLikes(d.item.likes); }
        else if (d) setLoadError(true);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, retryNonce]);

  usePageTitle(
    item ? `${item.title} — Creator Showcase` : "Creator Showcase",
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

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-white/40">Loading…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
        <div className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
          <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
          <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>Couldn't load this creation.</p>
          <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            Something went wrong on our end — this page just couldn't reach it.
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
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
          <div className={`rounded-2xl overflow-hidden border mb-8 ${isLight ? "border-[#C9A84C]/40 bg-[#FBF6E9]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
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
              {/* Share-to-earn viral loop: tracked shares, sharer's ?ref= on the link, quest credit. */}
              <ShareMenu
                getToken={getAccessToken}
                shareUrl={typeof window !== "undefined" ? window.location.href : ""}
                text={item ? `${item.title} — made with Bow Down Visuals` : undefined}
                contentType="showcase"
                contentId={slug}
              />
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
