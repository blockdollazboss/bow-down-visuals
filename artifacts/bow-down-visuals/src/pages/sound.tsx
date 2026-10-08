import { useEffect, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import { Music2, Play, Pause, Loader2, ArrowLeft, BadgeDollarSign, Wand2, Trophy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/* ─── Sound page — /sound/:id ──────────────────────────────────────────────
   The sound's home turf: play it, see every video running it, grab it for
   your own edit. "This sound is earning" shows the money when priced products
   ride it — guide them to the money, every step. */

interface SoundVideo {
  id: string; title: string; video_url: string; thumbnail_url: string | null;
  view_count: number; like_count: number; download_price_cents: number; for_sale: boolean;
  creator: { slug: string; display_name: string; avatar_url: string | null };
}

interface SoundData {
  sound: { id: string; title: string | null; url: string | null; use_count: number; is_earning: boolean; earning_count: number };
  videos: SoundVideo[];
  earning_items: { id: string; title: string; price_cents: number; creator: SoundVideo["creator"] }[];
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function SoundPage() {
  const [, params] = useRoute("/sound/:id");
  const soundId = params?.id ? decodeURIComponent(params.id) : "";
  const { toast } = useToast();
  const [data, setData] = useState<SoundData | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/sounds/${encodeURIComponent(soundId)}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as SoundData;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) toast({ title: "Never heard of that sound", description: "It might have gone quiet." });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [soundId, toast]);

  function togglePlay() {
    const a = audioRef.current;
    if (!a || !data?.sound.url) return;
    if (a.paused) { a.play().catch(() => {}); setPlaying(true); }
    else { a.pause(); setPlaying(false); }
  }

  if (loading) {
    return <div className="flex h-[calc(100dvh-4rem)] items-center justify-center bg-black"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (!data) {
    return (
      <div className="flex h-[calc(100dvh-4rem)] flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <Music2 className="h-12 w-12 text-white/20" />
        <p className="text-white/60">That sound's not on the map.</p>
        <Link href="/shorts" className="rounded-full bg-primary px-6 py-2.5 font-bold text-black">Back to Shorts</Link>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-black px-4 py-6 md:px-8">
      <Link href="/shorts" className="mb-6 inline-flex items-center gap-2 text-sm text-white/60 hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Back to Shorts
      </Link>

      {/* hero */}
      <div className="mb-8 flex flex-col items-start gap-5 rounded-2xl border border-primary/25 bg-gradient-to-br from-zinc-950 to-zinc-900 p-6 md:flex-row md:items-center">
        <button onClick={togglePlay} disabled={!data.sound.url} title="Play sound"
          className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-primary text-black shadow-[0_0_30px_rgba(212,175,55,0.4)] transition hover:scale-105 disabled:opacity-40">
          {playing ? <Pause className="h-9 w-9" /> : <Play className="ml-1 h-9 w-9" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Sound</p>
          <h1 className="truncate text-2xl font-black text-white md:text-3xl">{data.sound.title ?? "Untitled sound"}</h1>
          <p className="mt-1 text-sm text-white/50">{fmt(data.sound.use_count)} videos running this sound</p>
          {data.sound.is_earning && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
              <BadgeDollarSign className="h-4 w-4" />
              This sound is earning — {data.sound.earning_count} priced {data.sound.earning_count === 1 ? "video" : "videos"} ride it
            </p>
          )}
        </div>
        {/* creation loop: straight into the editor with the sound loaded */}
        <Link href={`/video-editor?sound=${encodeURIComponent(data.sound.id)}`}
          className="flex shrink-0 items-center gap-2 rounded-full bg-primary px-6 py-3 font-bold text-black hover:brightness-110">
          <Wand2 className="h-5 w-5" /> Use this sound
        </Link>
      </div>
      {data.sound.url && <audio ref={audioRef} src={data.sound.url} onEnded={() => setPlaying(false)} />}

      {/* earning items — the money angle leads */}
      {data.earning_items.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-black text-white">
            <Trophy className="h-5 w-5 text-primary" /> Cash in on this sound
          </h2>
          <p className="mb-3 text-sm text-white/50">These videos sell while their creators sleep. Yours could be next.</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {data.earning_items.map((v) => (
              <Link key={v.id} href={`/store/buy/video/${v.id}`}
                className="group overflow-hidden rounded-xl border border-primary/30 bg-zinc-950">
                <div className="aspect-[9/16] bg-zinc-900">
                  <Link href={`/shorts?start=${v.id}`} className="block h-full w-full">
                    {v.thumbnail_url
                      ? <img src={v.thumbnail_url} alt={v.title} className="h-full w-full object-cover" loading="lazy" />
                      : <div className="flex h-full w-full items-center justify-center"><Music2 className="h-8 w-8 text-white/15" /></div>}
                  </Link>
                </div>
                <div className="p-2.5">
                  <p className="truncate text-sm font-bold text-white">{v.title}</p>
                  <p className="text-xs font-bold text-primary">${(v.price_cents / 100).toFixed(2)} · buy</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* all videos using it */}
      <section>
        <h2 className="mb-3 text-lg font-black text-white">Running this sound ({fmt(data.videos.length)})</h2>
        {data.videos.length === 0 ? (
          <p className="text-white/40">Nobody's run with it yet — be the first and set the price.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            {data.videos.map((v) => (
              <Link key={v.id} href={`/shorts?start=${v.id}`} className="group">
                <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-zinc-900">
                  {v.thumbnail_url
                    ? <img src={v.thumbnail_url} alt={v.title} className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
                    : <div className="flex h-full w-full items-center justify-center"><Music2 className="h-8 w-8 text-white/15" /></div>}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 pt-6">
                    <p className="truncate text-xs font-bold text-white">{v.title}</p>
                    <Link href={`/creator/${v.creator.slug}`} onClick={(e) => e.stopPropagation()}
                      className="text-[11px] text-primary hover:underline">@{v.creator.display_name}</Link>
                    <p className="text-[11px] text-white/50">{fmt(v.view_count)} views</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
