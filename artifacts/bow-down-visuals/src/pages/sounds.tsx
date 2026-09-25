import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  AudioWaveform, Sparkles, Loader2, Heart, Search, ArrowRight,
  Music2, Clock3, Lightbulb, Timer, Clapperboard,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Viral Sound Finder ────────────────────────────────────────────────
   /sounds — find trending sounds for TikTok/Reels/Shorts.
   Browsing the curated starter database is FREE (pure UI, no compute).
   The AI "sound match" is 1 credit per match (GPT-6 Sol, charge-before-
   generate, auto-refund on failure). Favorites live in localStorage —
   pure UI state, no charge. */

const NICHES = [
  { key: "all", label: "All niches" },
  { key: "music-promo", label: "Music Promo" },
  { key: "fitness", label: "Fitness" },
  { key: "comedy", label: "Comedy" },
  { key: "lifestyle", label: "Lifestyle" },
  { key: "gaming", label: "Gaming" },
  { key: "beauty", label: "Beauty" },
  { key: "business", label: "Business" },
  { key: "food", label: "Food" },
] as const;

const MOODS = [
  { key: "all", label: "Any mood" },
  { key: "hype", label: "Hype" },
  { key: "chill", label: "Chill" },
  { key: "emotional", label: "Emotional" },
  { key: "funny", label: "Funny" },
  { key: "luxury", label: "Luxury" },
  { key: "nostalgic", label: "Nostalgic" },
] as const;

const PLATFORMS = [
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Reels" },
  { key: "youtube", label: "Shorts" },
] as const;

const MATCH_CREDIT_COST = 1;
const FAVORITES_KEY = "bdv-sound-favorites";

interface TrendingSound {
  id: string;
  title: string;
  artist: string;
  niche: string[];
  mood: string[];
  platforms: string[];
  whyTrending: string;
  bestFor: string;
  hookWindow: string;
}

interface TrendingResponse {
  sounds?: TrendingSound[];
  disclaimer?: string;
  error?: string;
}

interface SoundMatch {
  soundType: string;
  why: string;
  searchTerms: string[];
  timingTip: string;
}

interface MatchResponse {
  matches?: SoundMatch[];
  disclaimer?: string;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

const platformDot: Record<string, string> = {
  tiktok: "bg-cyan-400",
  instagram: "bg-pink-400",
  youtube: "bg-red-400",
};

function moodColor(mood: string): string {
  switch (mood) {
    case "hype": return "border-red-400/40 bg-red-400/10 text-red-300";
    case "chill": return "border-sky-400/40 bg-sky-400/10 text-sky-300";
    case "emotional": return "border-purple-400/40 bg-purple-400/10 text-purple-300";
    case "funny": return "border-amber-400/40 bg-amber-400/10 text-amber-300";
    case "luxury": return "border-primary/50 bg-primary/10 text-primary";
    case "nostalgic": return "border-orange-400/40 bg-orange-400/10 text-orange-300";
    default: return "border-white/15 bg-white/[0.05] text-white/60";
  }
}

export default function ViralSoundFinder() {
  const { user, getAccessToken, refreshProfile } = useAuth();

  /* browse state */
  const [sounds, setSounds] = useState<TrendingSound[]>([]);
  const [disclaimer, setDisclaimer] = useState("");
  const [browseLoading, setBrowseLoading] = useState(true);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [niche, setNiche] = useState<string>("all");
  const [mood, setMood] = useState<string>("all");
  const [query, setQuery] = useState("");

  /* favorites (localStorage — free, pure UI) */
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  });
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  /* AI match state */
  const [videoIdea, setVideoIdea] = useState("");
  const [matchNiche, setMatchNiche] = useState<string>("music-promo");
  const [matchPlatform, setMatchPlatform] = useState<string>("tiktok");
  const [matches, setMatches] = useState<SoundMatch[]>([]);
  const [matchDisclaimer, setMatchDisclaimer] = useState("");
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBrowseLoading(true);
      setBrowseError(null);
      try {
        const params = new URLSearchParams();
        if (niche !== "all") params.set("niche", niche);
        if (mood !== "all") params.set("mood", mood);
        const res = await fetch(`/api/sounds/trending?${params.toString()}`);
        const data = (await res.json().catch(() => ({}))) as TrendingResponse;
        if (!res.ok) throw new Error(data.error || "Couldn't load trending sounds.");
        if (cancelled) return;
        setSounds(Array.isArray(data.sounds) ? data.sounds : []);
        setDisclaimer(data.disclaimer ?? "");
      } catch (err) {
        if (!cancelled) setBrowseError(err instanceof Error ? err.message : "Couldn't load trending sounds.");
      } finally {
        if (!cancelled) setBrowseLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [niche, mood]);

  function toggleFavorite(id: string) {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id];
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      } catch {
        /* storage full or blocked — favorites just won't persist */
      }
      return next;
    });
  }

  const visibleSounds = useMemo(() => {
    let list = sounds;
    if (showFavoritesOnly) list = list.filter((s) => favorites.includes(s.id));
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((s) =>
        `${s.title} ${s.artist} ${s.whyTrending} ${s.bestFor}`.toLowerCase().includes(q),
      );
    }
    return list;
  }, [sounds, showFavoritesOnly, favorites, query]);

  async function runMatch() {
    if (matchLoading || !user) return;
    if (!videoIdea.trim()) {
      setMatchError("Describe your video idea first — that's what the matcher works with.");
      return;
    }
    setMatchLoading(true);
    setMatchError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/sound-finder/match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          videoIdea: videoIdea.trim(),
          niche: matchNiche,
          platform: matchPlatform,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as MatchResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.matches) || data.matches.length === 0) {
        throw new Error(data.message || data.error || "Sound matching failed — try again.");
      }
      setMatches(data.matches);
      setMatchDisclaimer(data.disclaimer ?? "");
      refreshProfile();
      setTimeout(() => {
        document.getElementById("match-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setMatchError(err instanceof Error ? err.message : "Sound matching failed — try again.");
    } finally {
      setMatchLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      <main className="relative mx-auto max-w-6xl px-5 pb-24 pt-14 md:pt-20">
        {/* glow */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[640px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <AudioWaveform className="h-3 w-3" aria-hidden="true" /> Ride the wave, don't chase it
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            Viral Sound <span className="text-primary">Finder</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            Browse what's moving on TikTok, Reels &amp; Shorts — then let AI match
            the perfect sound type to your exact video idea.
          </p>
          <p className="mt-2 text-xs text-white/35">Browsing is free · AI sound match is {MATCH_CREDIT_COST} credit</p>
        </div>

        {/* ── BROWSE ─────────────────────────────────────────────────── */}
        <section className="relative mt-12">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <Music2 className="h-5 w-5 text-primary" aria-hidden="true" />
              Trending sounds
            </h2>
            <button
              onClick={() => setShowFavoritesOnly((v) => !v)}
              className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
                showFavoritesOnly
                  ? "bg-primary text-black"
                  : "border border-white/10 bg-white/[0.04] text-white/60 hover:border-primary/40 hover:text-white"
              }`}
            >
              <Heart className={`h-4 w-4 ${showFavoritesOnly ? "fill-black" : ""}`} aria-hidden="true" />
              Saved ({favorites.length})
            </button>
          </div>

          {/* filters */}
          <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" aria-hidden="true" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search sounds…"
                className="w-full rounded-xl border border-white/10 bg-black/60 py-3 pl-10 pr-4 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {NICHES.map((n) => (
                <button
                  key={n.key}
                  onClick={() => setNiche(n.key)}
                  className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                    niche === n.key
                      ? "bg-primary text-black"
                      : "border border-white/10 bg-white/[0.04] text-white/60 hover:border-primary/40 hover:text-white"
                  }`}
                >
                  {n.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {MOODS.map((m) => (
              <button
                key={m.key}
                onClick={() => setMood(m.key)}
                className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                  mood === m.key
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-white/10 bg-white/[0.03] text-white/50 hover:border-primary/40 hover:text-white"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* grid */}
          {browseLoading ? (
            <div className="mt-8 flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
            </div>
          ) : browseError ? (
            <p className="mx-auto mt-8 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-300">
              {browseError}
            </p>
          ) : visibleSounds.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-12 text-center">
              <AudioWaveform className="mx-auto mb-3 h-8 w-8 text-white/25" aria-hidden="true" />
              <p className="text-white/50">
                {showFavoritesOnly
                  ? "No saved sounds yet — tap the heart on any sound to save it."
                  : "No sounds match those filters — try widening them."}
              </p>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visibleSounds.map((s) => {
                const fav = favorites.includes(s.id);
                return (
                  <article
                    key={s.id}
                    className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#14100a] to-black p-5 transition hover:border-primary/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                          <AudioWaveform className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <div>
                          <h3 className="font-bold leading-tight">{s.title}</h3>
                          <p className="text-xs text-white/40">{s.artist}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => toggleFavorite(s.id)}
                        aria-label={fav ? `Remove ${s.title} from saved` : `Save ${s.title}`}
                        className={`rounded-full p-2 transition ${
                          fav ? "text-primary" : "text-white/30 hover:text-primary"
                        }`}
                      >
                        <Heart className={`h-5 w-5 ${fav ? "fill-current" : ""}`} aria-hidden="true" />
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {s.mood.map((m) => (
                        <span key={m} className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize ${moodColor(m)}`}>
                          {m}
                        </span>
                      ))}
                      {s.platforms.map((p) => (
                        <span key={p} className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-white/50">
                          <span className={`h-1.5 w-1.5 rounded-full ${platformDot[p] ?? "bg-white/40"}`} aria-hidden="true" />
                          {p === "youtube" ? "Shorts" : p === "instagram" ? "Reels" : "TikTok"}
                        </span>
                      ))}
                    </div>

                    <p className="mt-3 text-[13px] leading-relaxed text-white/60">{s.whyTrending}</p>

                    <div className="mt-3 space-y-1.5 text-[13px]">
                      <p className="flex items-start gap-1.5 text-white/70">
                        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                        <span><span className="font-semibold text-white/85">Best for: </span>{s.bestFor}</span>
                      </p>
                      <p className="flex items-start gap-1.5 text-white/70">
                        <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                        <span><span className="font-semibold text-white/85">Use: </span>{s.hookWindow}</span>
                      </p>
                    </div>

                    <div className="mt-4 flex gap-2">
                      <Link
                        href="/make-video"
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
                      >
                        <Clapperboard className="h-4 w-4" aria-hidden="true" />
                        Use this sound
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {disclaimer && !browseLoading && (
            <p className="mt-6 text-center text-xs italic text-white/30">{disclaimer}</p>
          )}
        </section>

        {/* ── AI SOUND MATCH ─────────────────────────────────────────────── */}
        <section className="relative mt-14 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-xl font-bold">AI Sound Match</h2>
              <p className="text-sm text-white/45">Describe your video — AI picks 3 sound types that fit it perfectly.</p>
            </div>
          </div>

          <p className="mt-8 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
            What's your video about?
          </p>
          <textarea
            value={videoIdea}
            onChange={(e) => setVideoIdea(e.target.value)}
            maxLength={600}
            rows={3}
            placeholder="e.g. Me walking into my new studio for the first time, big reveal moment, luxury vibes"
            className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40"
          />

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2.5 text-[11px] font-bold uppercase tracking-widest text-white/40">Niche</p>
              <div className="flex flex-wrap gap-2">
                {NICHES.filter((n) => n.key !== "all").map((n) => (
                  <button
                    key={n.key}
                    onClick={() => setMatchNiche(n.key)}
                    className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                      matchNiche === n.key
                        ? "bg-primary text-black"
                        : "border border-white/10 bg-white/[0.04] text-white/60 hover:border-primary/40 hover:text-white"
                    }`}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2.5 text-[11px] font-bold uppercase tracking-widest text-white/40">Platform</p>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setMatchPlatform(p.key)}
                    className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                      matchPlatform === p.key
                        ? "bg-primary text-black"
                        : "border border-white/10 bg-white/[0.04] text-white/60 hover:border-primary/40 hover:text-white"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-8 text-center">
            {user ? (
              <button
                onClick={runMatch}
                disabled={matchLoading}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
              >
                {matchLoading ? (
                  <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-6 w-6" aria-hidden="true" />
                )}
                {matchLoading ? "Matching sounds…" : "Match my sound"}
              </button>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
              >
                <Sparkles className="h-6 w-6" aria-hidden="true" />
                Sign in to match sounds
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
            )}
            <p className="mt-2.5 text-xs text-white/35">
              {MATCH_CREDIT_COST} credit per match · powered by GPT-6 · refunded if it fails
            </p>
            {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
            {matchError && !outOfCredits && (
              <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {matchError}
              </p>
            )}
          </div>

          {matches.length > 0 && (
            <div id="match-results" className="mt-8">
              <p className="mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Your 3 sound matches
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                {matches.map((m, i) => (
                  <div key={`match-${i}`} className="rounded-2xl border border-primary/25 bg-black/60 p-5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-black text-primary">
                        {i + 1}
                      </span>
                      <h3 className="font-bold leading-tight">{m.soundType}</h3>
                    </div>
                    <p className="mt-3 text-[13px] leading-relaxed text-white/65">{m.why}</p>
                    {m.searchTerms.length > 0 && (
                      <div className="mt-3">
                        <p className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-white/40">
                          <Search className="h-3 w-3" aria-hidden="true" /> Search these
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {m.searchTerms.map((t, j) => (
                            <span key={j} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                              “{t}”
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {m.timingTip && (
                      <p className="mt-3 flex items-start gap-1.5 text-[13px] text-white/60">
                        <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                        {m.timingTip}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {matchDisclaimer && (
                <p className="mt-4 text-center text-xs italic text-white/30">{matchDisclaimer}</p>
              )}
              {user && (
                <div className="mt-5 text-center">
                  <button
                    onClick={runMatch}
                    disabled={matchLoading}
                    className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-4 py-2 text-sm font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                    Re-roll ({MATCH_CREDIT_COST} credit)
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
