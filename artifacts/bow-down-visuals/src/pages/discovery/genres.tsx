import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Tags, ArrowRight } from "lucide-react";
import { CardSkeleton, EmptyState } from "@/components/discovery/cards";
import { CreateCta } from "@/components/discovery/FollowButton";
import { VERTICALS, VERTICAL_META, type VerticalKey } from "@/lib/verticals";
import { formatCount } from "@/lib/streaming";

/* ─── /genres — every sound and style, counted ──────────────────────────── */

interface GenreRow {
  genre: string;
  items: number;
}

export default function Genres() {
  const [genres, setGenres] = useState<GenreRow[] | null>(null);
  const [vertical, setVertical] = useState<VerticalKey | "all">("all");

  useEffect(() => {
    let cancelled = false;
    setGenres(null);
    (async () => {
      try {
        const r = await fetch(`/api/discovery/genres${vertical === "all" ? "" : `?vertical=${vertical}`}`);
        if (!r.ok || cancelled) return;
        const d = await r.json();
        if (!cancelled) setGenres(d.genres ?? []);
      } catch {
        if (!cancelled) setGenres([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vertical]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <div className="mb-6 text-center">
        <p className="mb-2 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-[#e8c86a]">
          <Tags className="h-4 w-4" /> Genres
        </p>
        <h1 className="text-3xl font-black tracking-tight md:text-5xl">
          Every <span className="bg-gradient-to-b from-[#ffe9a8] to-[#c9a84c] bg-clip-text text-transparent">flavor.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-white/50">
          Pick a sound, find its stars — then find the creators and tracks behind it.
        </p>
      </div>

      <div className="mb-8 flex flex-wrap justify-center gap-2">
        <button
          onClick={() => setVertical("all")}
          className={`rounded-full px-4 py-1.5 text-sm font-bold ${vertical === "all" ? "bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black" : "border border-white/15 text-white/60 hover:text-white"}`}
        >
          All lanes
        </button>
        {VERTICALS.map((v) => (
          <button
            key={v}
            onClick={() => setVertical(v)}
            className={`rounded-full px-4 py-1.5 text-sm font-bold ${vertical === v ? "bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black" : "border border-white/15 text-white/60 hover:text-white"}`}
          >
            {VERTICAL_META[v].label}
          </button>
        ))}
      </div>

      {!genres ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : genres.length === 0 ? (
        <EmptyState
          title="No genres tagged yet"
          blurb="Creators haven't tagged their drops in this lane. Tag yours and own the genre."
          ctaHref="/choose-artist"
          ctaLabel="Start creating"
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {genres.map((g) => (
            <Link
              key={g.genre}
              href={`/genre/${encodeURIComponent(g.genre)}${vertical === "all" ? "" : `?vertical=${vertical}`}`}
            >
              <article className="group flex h-full cursor-pointer flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-all hover:-translate-y-0.5 hover:border-[#e8c86a]/50">
                <h2 className="text-lg font-black group-hover:text-[#e8c86a]">{g.genre}</h2>
                <p className="mt-1 text-xs text-white/40">{formatCount(g.items)} drops</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-[#e8c86a]">
                  Explore <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </article>
            </Link>
          ))}
        </div>
      )}

      <CreateCta headline="Your genre needs a star. Be it." />
    </div>
  );
}
