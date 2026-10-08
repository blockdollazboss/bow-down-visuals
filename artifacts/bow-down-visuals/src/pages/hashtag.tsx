import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Hash, Loader2, ArrowLeft, Music2, Clapperboard, Trophy } from "lucide-react";

/* ─── Hashtag hub — /hashtag/:tag ───────────────────────────────────────────
   Every tag is a doorway: shorts + videos + tracks + challenges, all linked.
   No dead ends on this feed. */

interface TaggedMedia {
  id: string; title: string; video_url?: string; audio_url?: string;
  thumbnail_url?: string | null; artwork_url?: string | null;
  view_count?: number; play_count?: number; like_count: number;
  download_price_cents?: number;
  creator: { slug: string; display_name: string; avatar_url: string | null };
}

interface HashtagData {
  tag: string;
  shorts: TaggedMedia[];
  videos: TaggedMedia[];
  tracks: TaggedMedia[];
  challenges: { slug: string; title: string; hashtag: string; entry_count: number; prize_text: string }[];
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function HashtagPage() {
  const [, params] = useRoute("/hashtag/:tag");
  const tag = params?.tag ? decodeURIComponent(params.tag) : "";
  const [data, setData] = useState<HashtagData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/hashtag/${encodeURIComponent(tag)}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as HashtagData;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tag]);

  if (loading) {
    return <div className="flex h-[calc(100dvh-4rem)] items-center justify-center bg-black"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const total = (data?.shorts.length ?? 0) + (data?.videos.length ?? 0) + (data?.tracks.length ?? 0);

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-black px-4 py-6 md:px-8">
      <Link href="/shorts" className="mb-6 inline-flex items-center gap-2 text-sm text-white/60 hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Back to Shorts
      </Link>
      <div className="mb-8 flex items-center gap-4">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15"><Hash className="h-8 w-8 text-primary" /></span>
        <div>
          <h1 className="text-3xl font-black text-white">#{tag}</h1>
          <p className="text-sm text-white/50">{fmt(total)} pieces of content tagged</p>
        </div>
      </div>

      {!data || total === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center">
          <p className="text-white/50">Nothing tagged #{tag} yet. Tag it first — own the search.</p>
          <Link href="/publish?type=video&category=video" className="mt-4 inline-block rounded-full bg-primary px-6 py-2.5 font-bold text-black">
            Post with #{tag}
          </Link>
        </div>
      ) : (
        <>
          {data.challenges.length > 0 && (
            <Section title="Challenges" icon={<Trophy className="h-5 w-5 text-primary" />}>
              {data.challenges.map((c) => (
                <Link key={c.slug} href={`/challenge/${c.slug}`}
                  className="rounded-xl border border-primary/30 bg-zinc-950 p-4 hover:border-primary/60">
                  <p className="font-bold text-white">{c.title}</p>
                  <p className="text-xs text-primary">{fmt(c.entry_count)} entries</p>
                  {c.prize_text && <p className="mt-1 text-xs text-white/60">🏆 {c.prize_text}</p>}
                </Link>
              ))}
            </Section>
          )}
          {data.shorts.length > 0 && (
            <Section title="Shorts" icon={<Music2 className="h-5 w-5 text-primary" />}>
              {data.shorts.map((m) => <MediaTile key={m.id} m={m} kind="short" />)}
            </Section>
          )}
          {data.videos.length > 0 && (
            <Section title="Videos" icon={<Clapperboard className="h-5 w-5 text-primary" />}>
              {data.videos.map((m) => <MediaTile key={m.id} m={m} kind="video" />)}
            </Section>
          )}
          {data.tracks.length > 0 && (
            <Section title="Tracks" icon={<Music2 className="h-5 w-5 text-primary" />}>
              {data.tracks.map((m) => <MediaTile key={m.id} m={m} kind="track" />)}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-black text-white">{icon} {title}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">{children}</div>
    </section>
  );
}

function MediaTile({ m, kind }: { m: TaggedMedia; kind: "short" | "video" | "track" }) {
  const href = kind === "track" ? `/artist/${m.creator.slug}` : `/shorts?start=${m.id}`;
  const thumb = m.thumbnail_url ?? m.artwork_url ?? null;
  const plays = m.view_count ?? m.play_count ?? 0;
  return (
    <Link href={href} className="group">
      <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-zinc-900">
        {thumb
          ? <img src={thumb} alt={m.title} className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
          : <div className="flex h-full w-full items-center justify-center"><Music2 className="h-8 w-8 text-white/15" /></div>}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 pt-6">
          <p className="truncate text-xs font-bold text-white">{m.title}</p>
          <p className="text-[11px] text-primary">@{m.creator.display_name}</p>
          <p className="text-[11px] text-white/50">{fmt(plays)} {kind === "track" ? "plays" : "views"}
            {(m.download_price_cents ?? 0) > 0 && <span className="ml-1 font-bold text-primary">· ${(m.download_price_cents! / 100).toFixed(2)}</span>}
          </p>
        </div>
      </div>
    </Link>
  );
}
