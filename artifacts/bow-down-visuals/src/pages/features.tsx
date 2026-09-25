import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Search, ArrowRight, Crown, Megaphone, Sparkles } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import {
  SITE_FEATURES,
  FEATURE_CATEGORIES,
  type FeatureCategory,
} from "@/data/features";

/* ─── Features — the showcase ─────────────────────────────────────────────
   Every user-facing Bow Down Visuals feature in one place: search it, filter
   it by category, and jump straight in. Data-driven from the feature
   registry (src/data/features.ts) — adding a feature there adds its card
   here automatically. */

type Filter = "all" | FeatureCategory;

const cardClass =
  "group flex flex-col rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent " +
  "p-6 transition-all duration-300 hover:border-primary/50 hover:from-white/[0.08] hover:shadow-[0_0_40px_-12px_rgba(212,175,55,0.35)]";

export default function Features() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SITE_FEATURES.filter((f) => {
      if (filter !== "all" && f.category !== filter) return false;
      if (!q) return true;
      return (
        f.name.toLowerCase().includes(q) ||
        f.tagline.toLowerCase().includes(q)
      );
    });
  }, [query, filter]);

  const countFor = (c: Filter) =>
    c === "all" ? SITE_FEATURES.length : SITE_FEATURES.filter((f) => f.category === c).length;

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 55% at 50% -5%, rgba(212,175,55,0.16), transparent 70%)",
          }}
        />
        <div className="relative mx-auto max-w-7xl px-5 md:px-8 pt-16 md:pt-24 pb-10 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
            <Crown className="h-3.5 w-3.5" />
            The Arsenal
          </div>
          <h1 className="mt-6 text-4xl md:text-6xl font-extrabold tracking-tight">
            The Content Creator{" "}
            <span className="bg-gradient-to-r from-amber-200 via-primary to-amber-200 bg-clip-text text-transparent">
              Cheat Code
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-white/60 text-base md:text-lg">
            Every AI tool a creator needs — make the music, shoot the video,
            write the hooks, run the business. One vault, one credit system,
            zero excuses.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/pricing">
              <span className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-6 py-3 text-sm font-bold text-black transition hover:brightness-110 cursor-pointer">
                <Sparkles className="h-4 w-4" />
                Get Credits
              </span>
            </Link>
            <Link href="/promote">
              <span className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-6 py-3 text-sm font-semibold text-white/80 transition hover:border-primary/40 hover:text-white cursor-pointer">
                <Megaphone className="h-4 w-4" />
                Promote These Features
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* Search + filters */}
      <section className="mx-auto max-w-7xl px-5 md:px-8 pb-6">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search features — try 'thumbnail', 'voice', 'money'…"
              className="w-full rounded-xl border border-white/10 bg-black/60 pl-11 pr-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {(["all", ...FEATURE_CATEGORIES.map((c) => c.key)] as Filter[]).map((c) => {
              const label = c === "all" ? "All" : FEATURE_CATEGORIES.find((x) => x.key === c)!.label;
              const active = filter === c;
              return (
                <button
                  key={c}
                  onClick={() => setFilter(c)}
                  className={
                    "rounded-full px-4 py-2 text-xs font-semibold transition " +
                    (active
                      ? "bg-gradient-to-r from-amber-400 to-yellow-500 text-black"
                      : "border border-white/15 bg-white/[0.04] text-white/60 hover:border-primary/40 hover:text-white")
                  }
                >
                  {label} · {countFor(c)}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Grid */}
      <section className="mx-auto max-w-7xl px-5 md:px-8 pb-20">
        {results.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-16 text-center">
            <p className="text-lg font-semibold text-white/80">Nothing matches “{query}”</p>
            <p className="mt-2 text-sm text-white/40">
              Try a different search — or{" "}
              <button onClick={() => { setQuery(""); setFilter("all"); }} className="text-primary underline underline-offset-4">
                reset the filters
              </button>
              .
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((f) => {
              const Icon = f.icon;
              const cat = FEATURE_CATEGORIES.find((c) => c.key === f.category)!;
              return (
                <div key={f.key} className={cardClass}>
                  <div className="flex items-start justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400/25 to-yellow-600/10 border border-primary/30">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      {f.badge && (
                        <span
                          className={
                            "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider " +
                            (f.badge === "NEW"
                              ? "bg-emerald-400/15 text-emerald-300 border border-emerald-400/30"
                              : "bg-primary/15 text-primary border border-primary/30")
                          }
                        >
                          {f.badge}
                        </span>
                      )}
                      <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/50">
                        {f.creditCost}
                      </span>
                    </div>
                  </div>
                  <h3 className="mt-4 text-lg font-bold">{f.name}</h3>
                  <p className="mt-1.5 flex-1 text-sm leading-relaxed text-white/55">{f.tagline}</p>
                  <div className="mt-5 flex items-center justify-between border-t border-white/[0.07] pt-4">
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-white/35">
                      {cat.label}
                    </span>
                    <Link href={f.route}>
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition group-hover:gap-2.5 cursor-pointer">
                        Try it <ArrowRight className="h-4 w-4" />
                      </span>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Promote CTA */}
        <div className="mt-14 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-r from-amber-500/[0.12] via-transparent to-amber-500/[0.12] p-8 md:p-12 text-center">
          <Megaphone className="mx-auto h-10 w-10 text-primary" />
          <h2 className="mt-4 text-2xl md:text-3xl font-extrabold">
            Running a feature launch? Let the AI write the promo.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-white/60">
            Pick any feature above and generate ready-to-post social copy, email
            blasts, banner headlines and ad copy — in your tone, with hashtags
            and CTAs included.
          </p>
          <Link href="/promote">
            <span className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-500 px-7 py-3.5 text-sm font-bold text-black transition hover:brightness-110 cursor-pointer">
              Open the Promo Generator <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
