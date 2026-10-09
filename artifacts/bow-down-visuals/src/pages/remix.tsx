import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Flame, Sparkles, ArrowRight } from "lucide-react";
import { usePageTitle } from "@/hooks/use-page-title";
import { TRENDING_PRESETS, type TrendingPreset } from "@/data/trending-presets";

const CATEGORIES = ["All", "Motion", "Style", "Transition", "Effect"] as const;

const CATEGORY_ACCENT: Record<string, string> = {
  Motion: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  Style: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-300",
  Transition: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  Effect: "border-amber-400/30 bg-amber-400/10 text-amber-300",
};

/* ─── /remix — Trending Remix Feed ──────────────────────────────────────────
   Viral motion/style presets. One tap remixes the trend with your character
   via deep-link into Visual Vibes (/video-editor). */
export default function RemixPage() {
  usePageTitle("Remix Trends", "Remix trending motions and styles with your character.");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");

  const presets = useMemo(() => {
    const list = category === "All"
      ? [...TRENDING_PRESETS]
      : TRENDING_PRESETS.filter((p) => p.category === category);
    return list.sort((a, b) => b.trendScore - a.trendScore);
  }, [category]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-black text-white">
        <Flame className="h-6 w-6 text-[#C9A84C]" /> Remix Trends
      </h1>
      <p className="mb-6 text-sm text-white/50">
        Trending motions and styles. Tap <span className="font-bold text-[#C9A84C]">Remix</span> to
        apply one to your project in Visual Vibes.
      </p>

      {/* Category filter */}
      <div className="mb-6 flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`rounded-full px-4 py-1.5 text-xs font-black transition-colors ${
              category === c
                ? "bg-[#C9A84C] text-black"
                : "border border-white/10 bg-white/[0.03] text-white/60 hover:text-white hover:border-[#C9A84C]/40"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Preset grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {presets.map((p: TrendingPreset) => {
          const remixUrl = `/video-editor?${new URLSearchParams(p.remixParams).toString()}`;
          return (
            <div
              key={p.slug}
              className="rounded-2xl border border-white/10 bg-[#0d0d0f] p-5 transition-colors hover:border-[#C9A84C]/40"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${CATEGORY_ACCENT[p.category] ?? "border-white/10 text-white/50"}`}>
                  {p.category}
                </span>
                <span className="flex items-center gap-1 text-xs font-black text-[#C9A84C]">
                  <Flame className="h-3 w-3" /> {p.trendScore}
                </span>
              </div>
              <h3 className="mb-1 font-black text-white">{p.name}</h3>
              <p className="mb-4 text-xs leading-relaxed text-white/50">{p.description}</p>
              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  {p.platform.map((pl) => (
                    <span key={pl} className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-bold text-white/40">
                      {pl}
                    </span>
                  ))}
                </div>
                <Link href={remixUrl}>
                  <span className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] px-4 py-2 text-xs font-black text-black hover:brightness-110 transition-all">
                    <Sparkles className="h-3.5 w-3.5" /> Remix <ArrowRight className="h-3 w-3" />
                  </span>
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {presets.length === 0 && (
        <p className="py-12 text-center text-sm text-white/40">No presets in this category yet.</p>
      )}
    </div>
  );
}
