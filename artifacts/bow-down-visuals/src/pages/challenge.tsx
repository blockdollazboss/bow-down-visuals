import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Trophy, Loader2, ArrowLeft, Plus, BadgeDollarSign, Users, Eye } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/* ─── Challenge page — /challenge/:slug ────────────────────────────────────
   Hero, entry grid, join flow. The prize/earning angle leads — guide them to
   the money: prize banner, how-the-money-flows strip, join → publish
   prefilled with the hashtag. */

interface ChallengeEntry {
  id: string; title: string; video_url: string; thumbnail_url: string | null;
  view_count: number; like_count: number; entered_at: string;
  creator: { id: string; slug: string; display_name: string; avatar_url: string | null };
}

interface ChallengeData {
  challenge: {
    id: string; slug: string; title: string; description: string; hashtag: string;
    cover_url: string | null; prize_text: string; entry_count: number; total_views: number;
  };
  entries: ChallengeEntry[];
}

interface TrendingChallenge { slug: string; title: string; hashtag: string; entry_count: number; prize_text: string }

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function ChallengePage() {
  const [, params] = useRoute("/challenge/:slug");
  const slug = params?.slug ?? "";
  const { user } = useAuth();
  const [data, setData] = useState<ChallengeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState<TrendingChallenge[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/challenges/${encodeURIComponent(slug)}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as ChallengeData;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
      try {
        const t = await fetch("/api/challenges/trending?limit=6");
        if (t.ok) {
          const j = await t.json();
          if (!cancelled) setMore((j.challenges ?? []).filter((c: TrendingChallenge) => c.slug !== slug));
        }
      } catch { /* optional */ }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  if (loading) {
    return <div className="flex h-[calc(100dvh-4rem)] items-center justify-center bg-black"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (!data) {
    return (
      <div className="flex h-[calc(100dvh-4rem)] flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <Trophy className="h-12 w-12 text-white/20" />
        <h1 className="text-xl font-bold text-white">No challenge by that name.</h1>
        <p className="text-white/50">Start it yourself — the crown's empty.</p>
        <Link href="/shorts" className="rounded-full bg-primary px-6 py-2.5 font-bold text-black">Back to Shorts</Link>
      </div>
    );
  }

  const { challenge } = data;
  const joinHref = user
    ? `/publish?type=video&category=video&description=${encodeURIComponent(`#${challenge.hashtag} — ${challenge.title}\n`)}`
    : "/login";

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-black px-4 py-6 md:px-8">
      <Link href="/shorts" className="mb-6 inline-flex items-center gap-2 text-sm text-white/60 hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Back to Shorts
      </Link>

      {/* hero — money angle leads */}
      <div className="relative mb-8 overflow-hidden rounded-2xl border border-primary/25">
        {challenge.cover_url && (
          <img src={challenge.cover_url} alt={challenge.title} className="h-56 w-full object-cover md:h-72" />
        )}
        <div className={challenge.cover_url ? "absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/20" : "bg-gradient-to-br from-zinc-950 to-zinc-900"}>
          <div className="flex h-full flex-col justify-end p-6">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">#{challenge.hashtag}</p>
            <h1 className="mt-1 text-3xl font-black text-white md:text-4xl">{challenge.title}</h1>
            {challenge.description && <p className="mt-2 max-w-2xl text-sm text-white/70">{challenge.description}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-white/60">
              <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-primary" /> {fmt(challenge.entry_count)} entries</span>
              <span className="inline-flex items-center gap-1.5"><Eye className="h-4 w-4 text-primary" /> {fmt(challenge.total_views)} views</span>
            </div>
            {challenge.prize_text ? (
              <p className="mt-3 inline-flex w-fit items-center gap-2 rounded-full border border-primary/50 bg-primary/10 px-4 py-1.5 text-sm font-bold text-primary">
                <Trophy className="h-4 w-4" /> Prize: {challenge.prize_text}
              </p>
            ) : (
              <p className="mt-3 inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-white/60">
                <BadgeDollarSign className="h-4 w-4 text-primary" /> No prize posted — win the clout, keep the crown
              </p>
            )}
          </div>
        </div>
      </div>

      {/* join flow — the creation loop */}
      <div className="mb-8 flex flex-col items-start gap-3 rounded-2xl border border-primary/25 bg-zinc-950 p-5 md:flex-row md:items-center">
        <div className="flex-1">
          <h2 className="text-lg font-black text-white">Run the challenge. Keep the bag.</h2>
          <p className="mt-1 text-sm text-white/55">
            Post your entry with <span className="font-bold text-primary">#{challenge.hashtag}</span> and it lands here automatically.
            Entries earn tips, downloads, and sound royalties — the challenge is the stage, the money is the point.
          </p>
        </div>
        <Link href={joinHref}
          className="flex shrink-0 items-center gap-2 rounded-full bg-primary px-6 py-3 font-bold text-black hover:brightness-110">
          <Plus className="h-5 w-5" /> Join challenge
        </Link>
      </div>

      {/* entry grid */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-black text-white">Entries ({fmt(data.entries.length)})</h2>
        {data.entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center">
            <p className="text-white/50">No entries yet. First one in sets the bar — and the price.</p>
            <Link href={joinHref} className="mt-4 inline-block rounded-full bg-primary px-6 py-2.5 font-bold text-black">
              Be the first entry
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            {data.entries.map((e) => (
              <Link key={e.id} href={`/shorts?start=${e.id}`} className="group">
                <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-zinc-900">
                  {e.thumbnail_url
                    ? <img src={e.thumbnail_url} alt={e.title} className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
                    : <div className="flex h-full w-full items-center justify-center"><Trophy className="h-8 w-8 text-white/15" /></div>}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 pt-6">
                    <p className="truncate text-xs font-bold text-white">{e.title}</p>
                    <Link href={`/artist/${e.creator.slug}`} onClick={(ev) => ev.stopPropagation()}
                      className="text-[11px] text-primary hover:underline">@{e.creator.display_name}</Link>
                    <p className="text-[11px] text-white/50">{fmt(e.view_count)} views</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* more challenges — the loop never dead-ends */}
      {more.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-black text-white">More challenges running</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {more.map((c) => (
              <Link key={c.slug} href={`/challenge/${c.slug}`}
                className="rounded-xl border border-white/10 bg-zinc-950 p-4 hover:border-primary/40">
                <p className="font-bold text-white">{c.title}</p>
                <p className="text-xs text-primary">#{c.hashtag} · {fmt(c.entry_count)} entries</p>
                {c.prize_text && <p className="mt-1 text-xs text-white/60">🏆 {c.prize_text}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
