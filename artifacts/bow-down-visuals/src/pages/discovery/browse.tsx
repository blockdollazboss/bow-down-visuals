import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Music2, Clapperboard, Gamepad2, Mic, Film, Tv, Star, GraduationCap, Sparkles,
  Compass, ArrowRight,
} from "lucide-react";
import { VERTICALS, VERTICAL_META, type VerticalKey } from "@/lib/verticals";
import { formatCount } from "@/lib/streaming";
import { CardSkeleton } from "@/components/discovery/cards";
import { CreateCta } from "@/components/discovery/FollowButton";

/* ─── /browse — every lane on the platform ────────────────────────────────
   Vertical landing grid. Each card links to /vertical/:key. */

const VERTICAL_ICONS: Record<VerticalKey, React.ReactNode> = {
  music: <Music2 className="h-8 w-8" />,
  video: <Clapperboard className="h-8 w-8" />,
  gaming: <Gamepad2 className="h-8 w-8" />,
  podcast: <Mic className="h-8 w-8" />,
  film: <Film className="h-8 w-8" />,
  tv: <Tv className="h-8 w-8" />,
  influencer: <Star className="h-8 w-8" />,
  education: <GraduationCap className="h-8 w-8" />,
  other: <Sparkles className="h-8 w-8" />,
};

interface VerticalStat {
  key: string;
  label: string;
  creators: number;
  followers: number;
  plays: number;
}

export default function Browse() {
  const [stats, setStats] = useState<VerticalStat[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/discovery/verticals");
        if (!r.ok || cancelled) return;
        const d = await r.json();
        if (!cancelled) setStats(d.verticals ?? []);
      } catch {
        /* grid renders without counts */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const countFor = (key: string) => stats?.find((s) => s.key === key);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <div className="mb-8 text-center">
        <p className="mb-2 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-[#e8c86a]">
          <Compass className="h-4 w-4" /> Browse
        </p>
        <h1 className="text-3xl font-black tracking-tight md:text-5xl">
          Pick your <span className="bg-gradient-to-b from-[#ffe9a8] to-[#c9a84c] bg-clip-text text-transparent">lane.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-white/50 md:text-base">
          Music, gaming, podcasts, film — every kind of creator has a home here.
          Find your lane, or get nosy in someone else's.
        </p>
      </div>

      {!stats ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {VERTICALS.map((v) => {
            const meta = VERTICAL_META[v];
            const c = countFor(v);
            return (
              <Link key={v} href={`/vertical/${v}`}>
                <article className="group flex h-full cursor-pointer flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-all hover:-translate-y-1 hover:border-[#e8c86a]/50 hover:shadow-[0_8px_40px_rgba(232,200,106,0.12)]">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#c9a84c]/30 bg-gradient-to-b from-[#c9a84c]/15 to-transparent text-[#e8c86a]">
                    {VERTICAL_ICONS[v]}
                  </div>
                  <h2 className="text-xl font-black group-hover:text-[#e8c86a]">{meta.label}</h2>
                  <p className="mt-1 text-sm text-white/45">{meta.tagline}</p>
                  <div className="mt-4 flex items-center gap-4 text-xs text-white/40">
                    <span><strong className="text-white/70">{formatCount(c?.creators ?? 0)}</strong> creators</span>
                    <span><strong className="text-white/70">{formatCount(c?.plays ?? 0)}</strong> plays</span>
                  </div>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-[#e8c86a]">
                    Enter the {meta.label.toLowerCase()} hub
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </span>
                </article>
              </Link>
            );
          })}
        </div>
      )}

      <div className="mt-10 flex flex-wrap items-center justify-center gap-3 text-sm">
        <span className="text-white/40">Or go straight to:</span>
        <Link href="/charts" className="font-bold text-[#e8c86a] hover:underline">The Charts</Link>
        <span className="text-white/20">·</span>
        <Link href="/genres" className="font-bold text-[#e8c86a] hover:underline">Genres</Link>
        <span className="text-white/20">·</span>
        <Link href="/search" className="font-bold text-[#e8c86a] hover:underline">Search</Link>
      </div>

      <CreateCta />
    </div>
  );
}

