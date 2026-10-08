import { useEffect, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import {
  Trophy, Loader2, ArrowLeft, Crown, Medal, Share2, Copy, Check,
  ChevronRight, Sparkles,
} from "lucide-react";
import { JsonLd } from "@/components/seo/json-ld";
import { usePageTitle } from "@/hooks/use-page-title";
import { formatBucs, formatBucsShort, ordinal } from "@/lib/visual-bucs";

/* ─── Winners' circle ──────────────────────────────────────────────────────
   /winners                  — all-time hall of fame (SEO-indexable)
   /challenge/:slug/winners  — per-challenge winners (SEO-indexable)

   The fame loop: compete → share entry for votes → winner fame → new users.
   Every winner card is shareable (X, WhatsApp, copy link, native share) so
   the crown markets itself. Gold/black luxury throughout. */

interface WinnerItem {
  place: number; prize_credits: number; announced_at: string;
  challenge: { slug: string; title: string; hashtag?: string };
  video: { id: string; title: string; thumbnail_url?: string | null };
  creator: { slug: string | null; display_name: string | null; avatar_url: string | null };
}

interface ChallengeWinnersResponse {
  challenge: { slug: string; title: string; hashtag: string; cover_url: string | null; status: string };
  announced: boolean;
  winners: Array<{
    place: number; prize_credits: number; announced_at: string;
    video: { id: string; title: string; video_url?: string; thumbnail_url: string | null };
    creator: { slug: string | null; display_name: string | null; avatar_url: string | null };
  }>;
}

const PLACE_STYLE: Record<number, { ring: string; badge: string; label: string; icon: "crown" | "medal" }> = {
  1: { ring: "border-primary/70", badge: "bg-primary text-black", label: "Champion", icon: "crown" },
  2: { ring: "border-zinc-300/50", badge: "bg-zinc-300 text-black", label: "Runner-up", icon: "medal" },
  3: { ring: "border-amber-700/60", badge: "bg-amber-700 text-white", label: "3rd place", icon: "medal" },
};

function PlaceIcon({ place, className }: { place: number; className?: string }) {
  const kind = PLACE_STYLE[place]?.icon ?? "medal";
  return kind === "crown"
    ? <Crown className={className} />
    : <Medal className={className} />;
}

function shareTargets(text: string, url: string) {
  return {
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
  };
}

/* ─── Shareable winner card ─────────────────────────────────────────────── */
function WinnerCard({ w, showChallenge }: { w: WinnerItem; showChallenge: boolean }) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const style = PLACE_STYLE[w.place] ?? PLACE_STYLE[3]!;
  const pageUrl = `https://bowdownvisuals.com/challenge/${w.challenge.slug}/winners`;
  const shareText = `🏆 ${w.creator.display_name ?? "A creator"} took ${ordinal(w.place)} place in the "${w.challenge.title}" challenge on Bow Down Visuals${w.prize_credits > 0 ? ` — ${formatBucs(w.prize_credits)} won` : ""}!`;
  const targets = useMemo(() => shareTargets(shareText, pageUrl), [shareText, pageUrl]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  };
  const nativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: shareText, url: pageUrl });
        setShared(true);
      } catch { /* dismissed */ }
    } else {
      copyLink();
    }
  };

  return (
    <article className={`relative overflow-hidden rounded-2xl border bg-zinc-950 ${style.ring}`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
      <div className="flex items-center gap-4 p-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-black ${style.badge}`}>
          <PlaceIcon place={w.place} className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-primary">{ordinal(w.place)} place · {style.label}</p>
          {showChallenge && (
            <Link href={`/challenge/${w.challenge.slug}`} className="block truncate text-sm font-bold text-white hover:text-primary">
              {w.challenge.title}
            </Link>
          )}
          <p className="truncate text-sm text-white/80">"{w.video.title}"</p>
          {w.creator.slug ? (
            <Link href={`/artist/${w.creator.slug}`} className="text-xs font-bold text-primary hover:underline">
              @{w.creator.display_name ?? w.creator.slug}
            </Link>
          ) : (
            <p className="text-xs text-white/50">@{w.creator.display_name ?? "creator"}</p>
          )}
          {w.prize_credits > 0 && (
            <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-black text-primary">
              <Trophy className="h-3 w-3" /> {formatBucs(w.prize_credits)}
            </p>
          )}
        </div>
        {w.video.thumbnail_url && (
          <Link href={`/shorts?start=${w.video.id}`} className="hidden shrink-0 sm:block">
            <img src={w.video.thumbnail_url} alt={w.video.title}
              className="h-20 w-14 rounded-lg object-cover" loading="lazy" />
          </Link>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-white/10 px-4 py-2.5">
        <span className="mr-auto flex items-center gap-1.5 text-[11px] text-white/40">
          <Share2 className="h-3.5 w-3.5" /> Share the crown
        </span>
        <a href={targets.x} target="_blank" rel="noopener noreferrer" title="Share on X"
          className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20">𝕏 Post</a>
        <a href={targets.whatsapp} target="_blank" rel="noopener noreferrer" title="Share on WhatsApp"
          className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20">WhatsApp</a>
        <button onClick={copyLink} title="Copy link"
          className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button onClick={nativeShare} title="Share"
          className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-black text-black hover:brightness-110">
          <Share2 className="h-3.5 w-3.5" /> {shared ? "Shared" : "Share"}
        </button>
      </div>
    </article>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────────── */
export default function WinnersPage() {
  const [isHof] = useRoute("/winners");
  const [, chParams] = useRoute("/challenge/:slug/winners");
  const slug = chParams?.slug ?? "";
  const perChallenge = !isHof && !!slug;

  const [hof, setHof] = useState<WinnerItem[] | null>(null);
  const [ch, setCh] = useState<ChallengeWinnersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    (async () => {
      try {
        if (perChallenge) {
          const res = await fetch(`/api/challenges/${encodeURIComponent(slug)}/winners`);
          if (res.status === 404) { if (!cancelled) setNotFound(true); return; }
          if (!res.ok) throw new Error(String(res.status));
          const json = (await res.json()) as ChallengeWinnersResponse;
          if (!cancelled) setCh(json);
        } else {
          const res = await fetch("/api/challenges/hall-of-fame?limit=60");
          if (!res.ok) throw new Error(String(res.status));
          const json = (await res.json()) as { winners: WinnerItem[] };
          if (!cancelled) setHof(json.winners ?? []);
        }
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [perChallenge, slug]);

  const title = perChallenge
    ? (ch ? `${ch.challenge.title} — Winners` : "Challenge Winners")
    : "Winners' Circle — Hall of Fame";
  const description = perChallenge
    ? (ch ? `Winners of the "${ch.challenge.title}" challenge on Bow Down Visuals — prizes paid in Visual Bucs.` : "Challenge winners on Bow Down Visuals.")
    : "The Bow Down Visuals hall of fame — every challenge champion, every crown, every Visual Bucs prize.";
  usePageTitle(title, description);

  const jsonLd = useMemo(() => {
    const items: WinnerItem[] = perChallenge
      ? (ch?.winners.map((w) => ({
          place: w.place, prize_credits: w.prize_credits, announced_at: w.announced_at,
          challenge: { slug: ch.challenge.slug, title: ch.challenge.title, hashtag: ch.challenge.hashtag },
          video: { id: w.video.id, title: w.video.title, thumbnail_url: w.video.thumbnail_url },
          creator: w.creator,
        })) ?? [])
      : (hof ?? []);
    return {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: title,
      description,
      url: perChallenge ? `/challenge/${slug}/winners` : "/winners",
      numberOfItems: items.length,
      itemListElement: items.slice(0, 30).map((w, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: `${ordinal(w.place)} place — ${w.challenge.title}`,
        url: `/challenge/${w.challenge.slug}/winners`,
      })),
    };
  }, [perChallenge, ch, hof, slug, title, description]);

  if (loading) {
    return <div className="flex h-[calc(100dvh-4rem)] items-center justify-center bg-black"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const items: WinnerItem[] = perChallenge
    ? (ch?.winners.map((w) => ({
        place: w.place, prize_credits: w.prize_credits, announced_at: w.announced_at,
        challenge: { slug: ch.challenge.slug, title: ch.challenge.title, hashtag: ch.challenge.hashtag },
        video: { id: w.video.id, title: w.video.title, thumbnail_url: w.video.thumbnail_url },
        creator: w.creator,
      })) ?? [])
    : (hof ?? []);

  const announced = perChallenge ? !!ch?.announced : items.length > 0;

  return (
    <>
      <JsonLd data={jsonLd} />
      <div className="min-h-[calc(100dvh-4rem)] bg-black px-4 py-6 md:px-8">
        <Link href={perChallenge ? `/challenge/${slug}` : "/shorts"}
          className="mb-6 inline-flex items-center gap-2 text-sm text-white/60 hover:text-primary">
          <ArrowLeft className="h-4 w-4" /> {perChallenge ? "Back to challenge" : "Back to Shorts"}
        </Link>

        {/* hero */}
        <div className="relative mb-8 overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-zinc-950 via-black to-zinc-950 p-6 md:p-8">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
              <Trophy className="h-7 w-7 text-primary" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-primary">
                {perChallenge ? `#${ch?.challenge.hashtag ?? slug}` : "All-time"}
              </p>
              <h1 className="text-2xl font-black text-white md:text-3xl">
                {perChallenge ? `${ch?.challenge.title ?? "Challenge"} — Winners` : "Winners' Circle"}
              </h1>
              <p className="mt-1 text-sm text-white/55">
                {perChallenge
                  ? "Crowned by community votes. Prizes paid in Visual Bucs."
                  : "Every champion, every crown, every bag secured. This is the hall of fame."}
              </p>
            </div>
          </div>
          {perChallenge && ch && (
            <Link href={`/challenge/${slug}`}
              className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline">
              Enter the next round <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </div>

        {!announced || notFound ? (
          <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center">
            <Crown className="mx-auto h-10 w-10 text-white/20" />
            <p className="mt-3 font-bold text-white">No crowns handed out yet.</p>
            <p className="mt-1 text-sm text-white/50">
              {perChallenge
                ? "Winners haven't been announced for this challenge — the votes are still being counted."
                : "The first challenge hasn't crowned a winner yet. That could be you."}
            </p>
            <Link href="/shorts"
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110">
              <Sparkles className="h-4 w-4" /> Find a challenge to enter
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((w, i) => (
              <WinnerCard key={`${w.challenge.slug}-${w.place}-${i}`} w={w} showChallenge={!perChallenge} />
            ))}
          </div>
        )}

        {/* the loop: winners → enter */}
        {announced && (
          <div className="mt-10 flex flex-col items-start gap-3 rounded-2xl border border-primary/25 bg-zinc-950 p-5 md:flex-row md:items-center">
            <div className="flex-1">
              <h2 className="text-lg font-black text-white">Your name belongs up there.</h2>
              <p className="mt-1 text-sm text-white/55">
                Enter a live challenge, rally votes on your entry, and take the crown —
                prizes land straight in your Visual Bucs balance.
              </p>
            </div>
            <Link href="/shorts"
              className="flex shrink-0 items-center gap-2 rounded-full bg-primary px-6 py-3 font-bold text-black hover:brightness-110">
              <Trophy className="h-5 w-5" /> Enter a challenge
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
