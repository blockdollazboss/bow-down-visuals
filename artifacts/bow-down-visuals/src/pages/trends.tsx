import { useState, useEffect } from "react";
import {
  TrendingUp, Loader2, Sparkles, Lightbulb, Bookmark, BookmarkCheck,
  Radar, AlertTriangle, ChevronRight, X, Eye,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { CheatCodeName } from "@/components/pixel-headline";

/* ─── Trend Predictor ────────────────────────────────────────────────────
   Get ahead of trends instead of chasing them. AI analyzes the creator's
   niche and predicts 5 upcoming viral trends with confidence scores and
   reasoning — plus early signals to watch. 2 credits per forecast on
   GPT-6 Sol; 10 content ideas per trend at 1 credit; the watchlist is
   free (pure UI state, localStorage).

   Honest framing: predictions are pattern analysis, not guarantees — the
   disclaimer ships with every forecast and is shown above the results. */

const NICHE_PRESETS = [
  "Music", "Gaming", "Comedy", "Fitness",
  "Beauty & Fashion", "Tech", "Education", "Lifestyle",
];

const PLATFORM_OPTS = [
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
] as const;
type PlatformKey = (typeof PLATFORM_OPTS)[number]["key"];

const AUDIENCE_OPTS = [
  { key: "starting", label: "Just starting", blurb: "0–1k followers" },
  { key: "growing", label: "Growing", blurb: "1k–50k followers" },
  { key: "established", label: "Established", blurb: "50k+ followers" },
] as const;
type AudienceKey = (typeof AUDIENCE_OPTS)[number]["key"];

const FORECAST_CREDITS = 2;
const IDEAS_CREDITS = 1;
const WATCHLIST_KEY = "bdv-trend-watchlist";

interface TrendItem {
  trend: string;
  confidence: number;
  timeframe: string;
  reasoning: string;
  earlySignals: string[];
}

interface ForecastResponse {
  trends?: TrendItem[];
  disclaimer?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

interface IdeasResponse {
  ideas?: string[];
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

interface TrackedTrend extends TrendItem {
  niche: string;
  trackedAt: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

function confidenceColor(c: number): string {
  if (c >= 70) return "text-emerald-400";
  if (c >= 50) return "text-amber-400";
  return "text-white/50";
}

function confidenceBar(c: number): string {
  if (c >= 70) return "from-emerald-500 to-emerald-300";
  if (c >= 50) return "from-amber-500 to-amber-300";
  return "from-white/40 to-white/20";
}

function loadWatchlist(): TrackedTrend[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

export default function TrendPredictor() {
  const { user, getAccessToken, refreshProfile } = useAuth();

  const [niche, setNiche] = useState("Music");
  const [customNiche, setCustomNiche] = useState("");
  const [platforms, setPlatforms] = useState<PlatformKey[]>(["tiktok"]);
  const [audience, setAudience] = useState<AudienceKey>("growing");

  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const [ideasFor, setIdeasFor] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<string[]>([]);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasError, setIdeasError] = useState<string | null>(null);

  const [watchlist, setWatchlist] = useState<TrackedTrend[]>([]);
  useEffect(() => {
    setWatchlist(loadWatchlist());
  }, []);

  function persistWatchlist(list: TrackedTrend[]) {
    setWatchlist(list);
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
    } catch {
      /* storage full/blocked — watchlist just won't persist */
    }
  }

  function isTracked(trend: string): boolean {
    return watchlist.some((t) => t.trend === trend);
  }

  function trackTrend(t: TrendItem, nicheName: string) {
    if (isTracked(t.trend)) return;
    persistWatchlist([
      { ...t, niche: nicheName, trackedAt: new Date().toISOString() },
      ...watchlist,
    ]);
  }

  function untrackTrend(trend: string) {
    persistWatchlist(watchlist.filter((t) => t.trend !== trend));
  }

  function togglePlatform(key: PlatformKey) {
    setPlatforms((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  }

  async function predictTrends() {
    if (loading || !user) return;
    const finalNiche = (customNiche.trim() || niche).slice(0, 120);
    if (!finalNiche) {
      setError("Tell the predictor your niche first — that's what the forecast runs on.");
      return;
    }
    if (platforms.length === 0) {
      setError("Pick at least one platform to forecast for.");
      return;
    }

    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setIdeasFor(null);
    setIdeas([]);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/trend-predictor/forecast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          niche: finalNiche,
          platforms,
          audienceSize: audience,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as ForecastResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.trends) || data.trends.length === 0) {
        throw new Error(data.message || data.error || "Forecast failed — try again.");
      }
      setForecast(data);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("trend-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Forecast failed — try again.");
    } finally {
      setLoading(false);
    }
  }

  async function fetchIdeas(trend: TrendItem) {
    if (ideasLoading) return;
    const finalNiche = (customNiche.trim() || niche).slice(0, 120);
    setIdeasFor(trend.trend);
    setIdeas([]);
    setIdeasError(null);
    setIdeasLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/trend-predictor/ideas", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          niche: finalNiche,
          trend: trend.trend,
          trendWhy: trend.reasoning,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as IdeasResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setIdeasError("Out of credits — top up to get content ideas.");
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.ideas) || data.ideas.length === 0) {
        throw new Error(data.message || data.error || "Ideas failed — try again.");
      }
      setIdeas(data.ideas);
      refreshProfile();
    } catch (err) {
      setIdeasError(err instanceof Error ? err.message : "Ideas failed — try again.");
    } finally {
      setIdeasLoading(false);
    }
  }

  const finalNiche = (customNiche.trim() || niche).slice(0, 120);

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      <main className="relative mx-auto max-w-4xl px-5 pb-24 pt-14 md:pt-20">
        {/* glow */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <Radar className="h-3 w-3" aria-hidden="true" /> <CheatCodeName possessive /> trend tools
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            Trend <span className="text-primary">Predictor</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            Stop chasing trends — get ahead of them. AI analyzes your niche and
            predicts 5 trends about to spike, with confidence scores, reasoning,
            and the early signals to watch.
          </p>
        </div>

        {/* ── INPUTS ─────────────────────────────────────────────────── */}
        <div className="relative mt-10 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          {/* niche */}
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
            Your niche
          </p>
          <div className="flex flex-wrap gap-2">
            {NICHE_PRESETS.map((n) => {
              const selected = !customNiche.trim() && niche === n;
              return (
                <button
                  key={n}
                  onClick={() => { setNiche(n); setCustomNiche(""); }}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    selected
                      ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
                      : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <input
            value={customNiche}
            onChange={(e) => setCustomNiche(e.target.value)}
            maxLength={120}
            placeholder="Or type your own niche…"
            className={`${inputClass} mt-3`}
          />

          {/* platforms */}
          <p className="mt-8 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
            Where do you post?
          </p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {PLATFORM_OPTS.map((p) => {
              const selected = platforms.includes(p.key);
              return (
                <button
                  key={p.key}
                  onClick={() => togglePlatform(p.key)}
                  className={`rounded-2xl border p-3.5 text-left transition ${
                    selected
                      ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                      : "border-white/10 bg-white/[0.02] hover:border-white/25"
                  }`}
                >
                  <span className="flex items-center justify-between">
                    <span className={`text-sm font-bold ${selected ? "text-white" : "text-white/60"}`}>
                      {p.label}
                    </span>
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                      selected ? "border-primary bg-primary text-black" : "border-white/20 text-transparent"
                    }`}>
                      <ChevronRight className="h-3 w-3" aria-hidden="true" />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* audience */}
          <p className="mt-8 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
            Audience size
          </p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {AUDIENCE_OPTS.map((a) => {
              const selected = audience === a.key;
              return (
                <button
                  key={a.key}
                  onClick={() => setAudience(a.key)}
                  className={`rounded-2xl border p-3.5 text-left transition ${
                    selected
                      ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                      : "border-white/10 bg-white/[0.02] hover:border-white/25"
                  }`}
                >
                  <span className={`block text-sm font-bold ${selected ? "text-white" : "text-white/60"}`}>
                    {a.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-white/40">{a.blurb}</span>
                </button>
              );
            })}
          </div>

          {/* CTA */}
          <div className="mt-8 text-center">
            <button
              onClick={predictTrends}
              disabled={loading || !user}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3.5 text-sm font-black uppercase tracking-widest text-black shadow-[0_0_24px_rgba(212,175,55,0.35)] transition hover:brightness-110 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Forecasting…
                </>
              ) : (
                <>
                  <TrendingUp className="h-4 w-4" aria-hidden="true" />
                  Predict my trends · {FORECAST_CREDITS} credits
                </>
              )}
            </button>
            {!user && (
              <p className="mt-3 text-xs text-white/40">Sign in to run a forecast.</p>
            )}
            {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
            {error && !outOfCredits && (
              <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </p>
            )}
          </div>
        </div>

        {/* ── RESULTS ────────────────────────────────────────────────── */}
        {forecast?.trends && forecast.trends.length > 0 && (
          <div id="trend-results" className="relative mt-10">
            {/* honest disclaimer — always visible above results */}
            <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
              <p className="text-[13px] leading-relaxed text-amber-200/80">
                {forecast.disclaimer ||
                  "Predictions based on pattern analysis — not guarantees. Trends shift fast; verify momentum before going all-in."}
              </p>
            </div>

            <div className="space-y-4">
              {forecast.trends.map((t, i) => (
                <div
                  key={`${t.trend}-${i}`}
                  className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#14100a] to-black p-6"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 font-display text-sm font-black text-primary">
                        {i + 1}
                      </span>
                      <div>
                        <h3 className="font-display text-lg font-black leading-snug">{t.trend}</h3>
                        <p className="mt-0.5 text-xs uppercase tracking-widest text-white/40">
                          {t.timeframe}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`font-display text-2xl font-black ${confidenceColor(t.confidence)}`}>
                        {t.confidence}%
                      </p>
                      <p className="text-[10px] uppercase tracking-widest text-white/35">confidence</p>
                    </div>
                  </div>

                  {/* confidence bar */}
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${confidenceBar(t.confidence)}`}
                      style={{ width: `${t.confidence}%` }}
                    />
                  </div>

                  {t.reasoning && (
                    <p className="mt-4 text-sm leading-relaxed text-white/65">{t.reasoning}</p>
                  )}

                  {t.earlySignals.length > 0 && (
                    <div className="mt-4">
                      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
                        <Eye className="h-3 w-3" aria-hidden="true" /> Early signals to watch
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {t.earlySignals.map((s, si) => (
                          <span
                            key={si}
                            className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-white/60"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* actions */}
                  <div className="mt-5 flex flex-wrap gap-2.5">
                    <button
                      onClick={() => fetchIdeas(t)}
                      disabled={ideasLoading}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-4 py-2 text-xs font-bold text-primary transition hover:bg-primary/20 disabled:opacity-50"
                    >
                      {ideasLoading && ideasFor === t.trend ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      10 content ideas · {IDEAS_CREDITS} credit
                    </button>
                    {isTracked(t.trend) ? (
                      <button
                        onClick={() => untrackTrend(t.trend)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/20"
                      >
                        <BookmarkCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        Tracked — remove
                      </button>
                    ) : (
                      <button
                        onClick={() => trackTrend(t, finalNiche)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.03] px-4 py-2 text-xs font-bold text-white/60 transition hover:border-primary/40 hover:text-white"
                      >
                        <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
                        Track trend · free
                      </button>
                    )}
                  </div>

                  {/* ideas panel */}
                  {ideasFor === t.trend && (
                    <div className="mt-5 rounded-2xl border border-primary/25 bg-black/50 p-5">
                      <div className="flex items-center justify-between">
                        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary">
                          <Sparkles className="h-3 w-3" aria-hidden="true" /> Content ideas
                        </p>
                        <button
                          onClick={() => { setIdeasFor(null); setIdeas([]); }}
                          className="text-white/40 transition hover:text-white"
                          aria-label="Close ideas"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                      {ideasLoading && (
                        <p className="mt-3 flex items-center gap-2 text-sm text-white/50">
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          Cooking up 10 ideas…
                        </p>
                      )}
                      {ideasError && (
                        <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                          {ideasError}
                        </p>
                      )}
                      {ideas.length > 0 && (
                        <ol className="mt-3 space-y-2.5">
                          {ideas.map((idea, ii) => (
                            <li key={ii} className="flex items-start gap-2.5 text-sm leading-relaxed text-white/70">
                              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-black text-primary">
                                {ii + 1}
                              </span>
                              {idea}
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── WATCHLIST ──────────────────────────────────────────────── */}
        {watchlist.length > 0 && (
          <div className="relative mt-12">
            <h2 className="flex items-center gap-2 font-display text-2xl font-black">
              <BookmarkCheck className="h-5 w-5 text-primary" aria-hidden="true" />
              Your watchlist
            </h2>
            <p className="mt-2 text-sm text-white/50">
              Trends you're tracking. Watch the early signals — when they start
              spiking, that's your window to post.
            </p>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {watchlist.map((t) => (
                <div
                  key={t.trend}
                  className="rounded-2xl border border-white/10 bg-white/[0.02] p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold leading-snug">{t.trend}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-widest text-white/35">
                        {t.niche} · {t.confidence}% confidence
                      </p>
                    </div>
                    <button
                      onClick={() => untrackTrend(t.trend)}
                      className="text-white/30 transition hover:text-white"
                      aria-label={`Stop tracking ${t.trend}`}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  {t.earlySignals.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {t.earlySignals.slice(0, 3).map((s, si) => (
                        <span
                          key={si}
                          className="rounded-full border border-white/10 bg-black/40 px-2.5 py-0.5 text-[11px] text-white/50"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
