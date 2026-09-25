import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  BarChart3, RefreshCw, Loader2, Sparkles, AlertTriangle, Link2,
  Users, FileVideo, Heart, MessageCircle, TrendingUp, Lightbulb,
  Clock, ChevronRight, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Analytics Command Center ────────────────────────────────────────────
   Your social stats in one place: live follower/post counts pulled from
   your connected Instagram, TikTok, and Facebook accounts (FREE — pure
   data integration), with an AI layer on top: AI Insights (1cr) reads your
   momentum in plain English, and AI Suggestions (1cr) tells you what to
   make next based on your top posts. */

type PlatformKey = "instagram" | "tiktok" | "facebook";

interface TopContentItem {
  id: string;
  caption: string;
  likes: number | null;
  comments: number | null;
  postedAt: string | null;
  url: string | null;
}

interface PlatformStats {
  followers: number | null;
  following: number | null;
  mediaCount: number | null;
  totalLikes: number | null;
}

interface PlatformOverview {
  platform: PlatformKey;
  accountId: string;
  username: string | null;
  pageName: string | null;
  status: "ok" | "not_connected" | "expired" | "error";
  message: string | null;
  stats: PlatformStats | null;
  topContent: TopContentItem[];
  fetchedAt: string | null;
}

interface Snapshot {
  platform: string;
  followers: number | null;
  recordedAt: string | null;
}

interface OverviewResponse {
  platforms: PlatformOverview[];
  snapshots: Snapshot[];
  fetchedAt: string;
  error?: string;
  message?: string;
}

interface Insights {
  headline: string;
  movers: { platform?: string; observation?: string; why?: string }[];
  bestWindow: string;
  recommendations: string[];
}

interface Suggestion {
  title: string;
  format: string;
  why: string;
  hook: string;
}

const PLATFORM_META: Record<PlatformKey, { label: string; icon: LucideIcon; connectBlurb: string }> = {
  instagram: { label: "Instagram", icon: Link2, connectBlurb: "Pull followers, posts, and top Reels." },
  tiktok: { label: "TikTok", icon: FileVideo, connectBlurb: "Pull followers, videos, and total likes." },
  facebook: { label: "Facebook", icon: Users, connectBlurb: "Pull Page followers and top posts." },
};

const ALL_PLATFORMS: PlatformKey[] = ["instagram", "tiktok", "facebook"];

function fmt(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Minimal SVG sparkline for follower history. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 120;
  const h = 36;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - 4 - ((p - min) / span) * (h - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const up = points[points.length - 1] >= points[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="overflow-visible">
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={up ? "#34d399" : "#f87171"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {coords.map((c, i) => {
        const [x, y] = c.split(",");
        return <circle key={i} cx={x} cy={y} r="2" fill={up ? "#34d399" : "#f87171"} opacity={i === coords.length - 1 ? 1 : 0.35} />;
      })}
    </svg>
  );
}

const cardClass =
  "rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm";

export default function Analytics() {
  const { user, getAccessToken, refreshProfile } = useAuth();

  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [insights, setInsights] = useState<Insights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [niche, setNiche] = useState("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const authedFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAccessToken();
      const res = await fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init?.headers ?? {}),
        },
      });
      const data = (await res.json().catch(() => ({}))) as any;
      return { res, data };
    },
    [getAccessToken],
  );

  const loadOverview = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const { res, data } = await authedFetch("/api/analytics/overview");
      if (!res.ok) throw new Error(data.message || data.error || "Couldn't load your stats.");
      setOverview(data as OverviewResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your stats.");
    } finally {
      setLoading(false);
    }
  }, [user, authedFetch]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const platformMap = useMemo(() => {
    const map = new Map<PlatformKey, PlatformOverview>();
    overview?.platforms.forEach((p) => map.set(p.platform, p));
    return map;
  }, [overview]);

  const snapshotsByPlatform = useMemo(() => {
    const map = new Map<PlatformKey, number[]>();
    overview?.snapshots.forEach((s) => {
      if (s.followers === null) return;
      const key = s.platform as PlatformKey;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.unshift(s.followers);
    });
    return map;
  }, [overview]);

  const aiPayload = useCallback(() => {
    const platforms = (overview?.platforms ?? [])
      .filter((p) => p.status === "ok")
      .map((p) => ({
        platform: p.platform,
        username: p.username,
        pageName: p.pageName,
        stats: p.stats,
        topContent: p.topContent.slice(0, 5).map((t) => ({
          caption: t.caption,
          likes: t.likes,
          comments: t.comments,
        })),
      }));
    return { platforms, niche: niche.trim().slice(0, 80) };
  }, [overview, niche]);

  async function runInsights() {
    if (insightsLoading || !user) return;
    const payload = aiPayload();
    if (payload.platforms.length === 0) {
      setAiError("Connect at least one platform and refresh stats before asking the AI.");
      return;
    }
    setInsightsLoading(true);
    setAiError(null);
    setOutOfCredits(false);
    try {
      const { res, data } = await authedFetch("/api/analytics/insights", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.insights) throw new Error(data.message || "AI insights failed — try again.");
      setInsights(data.insights as Insights);
      refreshProfile();
      setTimeout(() => document.getElementById("ai-insights")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI insights failed — try again.");
    } finally {
      setInsightsLoading(false);
    }
  }

  async function runSuggestions() {
    if (suggestionsLoading || !user) return;
    const payload = aiPayload();
    if (payload.platforms.length === 0) {
      setAiError("Connect at least one platform and refresh stats before asking the AI.");
      return;
    }
    setSuggestionsLoading(true);
    setAiError(null);
    setOutOfCredits(false);
    try {
      const { res, data } = await authedFetch("/api/analytics/suggestions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.suggestions)) throw new Error(data.message || "AI suggestions failed — try again.");
      setSuggestions(data.suggestions as Suggestion[]);
      refreshProfile();
      setTimeout(() => document.getElementById("ai-suggestions")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI suggestions failed — try again.");
    } finally {
      setSuggestionsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      <main className="relative mx-auto max-w-5xl px-5 pb-24 pt-14 md:pt-20">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <BarChart3 className="h-3 w-3" aria-hidden="true" /> Command center
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            Analytics, <span className="text-primary">decoded</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            Your live stats from every connected platform — free. Then the AI
            reads the tea leaves: what's working, what to post next, and when.
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              onClick={loadOverview}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:border-primary/50 hover:text-white disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh stats
            </button>
            {overview?.fetchedAt && (
              <span className="text-xs text-white/35">Updated {timeAgo(overview.fetchedAt)}</span>
            )}
          </div>
        </div>

        {error && (
          <div className="relative mt-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* platform cards */}
        <section className="relative mt-10 grid gap-4 md:grid-cols-3">
          {ALL_PLATFORMS.map((key) => {
            const meta = PLATFORM_META[key];
            const Icon = meta.icon;
            const p = platformMap.get(key);
            const spark = snapshotsByPlatform.get(key) ?? [];

            if (!p || p.status === "not_connected") {
              return (
                <div key={key} className={cardClass}>
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <h3 className="font-display text-lg font-bold">{meta.label}</h3>
                  </div>
                  <p className="mt-3 text-sm text-white/50">{meta.connectBlurb}</p>
                  <Link
                    href="/settings"
                    className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                  >
                    Connect {meta.label} <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              );
            }

            if (p.status === "expired") {
              return (
                <div key={key} className={cardClass}>
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <h3 className="font-display text-lg font-bold">{meta.label}</h3>
                  </div>
                  <p className="mt-3 text-sm text-amber-200/80">
                    {p.message ?? "Your connection expired."}
                  </p>
                  <Link
                    href="/settings"
                    className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                  >
                    Reconnect <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              );
            }

            if (p.status === "error") {
              return (
                <div key={key} className={cardClass}>
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <h3 className="font-display text-lg font-bold">{meta.label}</h3>
                  </div>
                  <p className="mt-3 text-sm text-white/50">
                    {p.message ?? "Couldn't reach this platform right now."}
                  </p>
                  <button onClick={loadOverview} className="mt-4 text-sm font-semibold text-primary hover:underline">
                    Try again
                  </button>
                </div>
              );
            }

            const s = p.stats;
            const label = p.pageName ?? (p.username ? `@${p.username}` : meta.label);
            return (
              <div key={key} className={cardClass}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="font-display text-lg font-bold leading-tight">{meta.label}</h3>
                      <p className="max-w-[140px] truncate text-xs text-white/40">{label}</p>
                    </div>
                  </div>
                  {spark.length >= 2 && <Sparkline points={spark} />}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-black/40 p-3">
                    <p className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-white/40">
                      <Users className="h-3 w-3" /> Followers
                    </p>
                    <p className="mt-1 font-display text-2xl font-black text-primary">{fmt(s?.followers ?? null)}</p>
                  </div>
                  <div className="rounded-xl bg-black/40 p-3">
                    <p className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-white/40">
                      <FileVideo className="h-3 w-3" /> Posts
                    </p>
                    <p className="mt-1 font-display text-2xl font-black">{fmt(s?.mediaCount ?? null)}</p>
                  </div>
                  <div className="rounded-xl bg-black/40 p-3">
                    <p className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-white/40">
                      <Heart className="h-3 w-3" /> Total likes
                    </p>
                    <p className="mt-1 font-display text-2xl font-black">{fmt(s?.totalLikes ?? null)}</p>
                  </div>
                  <div className="rounded-xl bg-black/40 p-3">
                    <p className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-white/40">
                      <TrendingUp className="h-3 w-3" /> Following
                    </p>
                    <p className="mt-1 font-display text-2xl font-black">{fmt(s?.following ?? null)}</p>
                  </div>
                </div>

                {p.topContent.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-white/40">
                      Top posts
                    </p>
                    <ul className="space-y-2">
                      {p.topContent.slice(0, 3).map((t) => (
                        <li key={t.id} className="rounded-lg bg-black/30 px-3 py-2">
                          <p className="truncate text-[13px] text-white/75">{t.caption || "(no caption)"}</p>
                          <p className="mt-0.5 flex items-center gap-3 text-[11px] text-white/40">
                            <span className="inline-flex items-center gap-1"><Heart className="h-3 w-3" />{fmt(t.likes)}</span>
                            <span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" />{fmt(t.comments)}</span>
                            {t.postedAt && <span>{timeAgo(t.postedAt)}</span>}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="mt-3 text-[11px] text-white/30">
                  Live from {meta.label} · {p.fetchedAt ? timeAgo(p.fetchedAt) : "just now"}
                </p>
              </div>
            );
          })}
        </section>

        {/* AI layer */}
        <section className="relative mt-12">
          <div className="rounded-2xl border border-primary/30 bg-gradient-to-b from-primary/[0.08] to-transparent p-6 md:p-8">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 text-primary">
                <Sparkles className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-display text-2xl font-black">
                  AI Insights <span className="text-primary">Engine</span>
                </h2>
                <p className="text-sm text-white/50">
                  Stats are free. The brain costs <span className="font-semibold text-primary">1 credit</span> per run.
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <input
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="Your niche (e.g. Music, Gaming) — optional"
                maxLength={80}
                className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40 sm:max-w-xs"
              />
              <button
                onClick={runInsights}
                disabled={insightsLoading || loading}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
              >
                {insightsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Analyze my stats · 1 credit
              </button>
              <button
                onClick={runSuggestions}
                disabled={suggestionsLoading || loading}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-5 py-3 text-sm font-bold text-primary transition hover:bg-primary/20 disabled:opacity-50"
              >
                {suggestionsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}
                What should I make next? · 1 credit
              </button>
            </div>

            {aiError && (
              <div className="mt-4 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{aiError}</span>
              </div>
            )}

            {outOfCredits && (
              <div className="mt-4">
                <OutOfCredits />
              </div>
            )}

            {insights && (
              <div id="ai-insights" className="mt-6 space-y-4">
                <div className="rounded-xl border border-primary/25 bg-black/50 p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">The headline</p>
                  <p className="mt-2 text-lg font-semibold leading-relaxed">{insights.headline}</p>
                </div>
                {insights.movers.length > 0 && (
                  <div className="grid gap-3 md:grid-cols-2">
                    {insights.movers.map((m, i) => (
                      <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-4">
                        <p className="text-xs font-bold uppercase tracking-widest text-primary">{m.platform ?? "Platform"}</p>
                        <p className="mt-1.5 text-sm text-white/85">{m.observation}</p>
                        {m.why && <p className="mt-1 text-[13px] text-white/50">{m.why}</p>}
                      </div>
                    ))}
                  </div>
                )}
                {insights.bestWindow && (
                  <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/40 p-4">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-primary">Best posting window</p>
                      <p className="mt-1 text-sm text-white/80">{insights.bestWindow}</p>
                    </div>
                  </div>
                )}
                {insights.recommendations.length > 0 && (
                  <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                    <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">Your next 3 moves</p>
                    <ol className="space-y-2">
                      {insights.recommendations.map((r, i) => (
                        <li key={i} className="flex gap-3 text-sm text-white/80">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">{i + 1}</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}

            {suggestions && (
              <div id="ai-suggestions" className="mt-6">
                <p className="mb-3 text-xs font-bold uppercase tracking-widest text-primary">Make these next</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {suggestions.map((s, i) => (
                    <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-4">
                      <p className="font-display text-base font-bold">{s.title}</p>
                      <p className="mt-0.5 text-[11px] uppercase tracking-widest text-white/40">{s.format}</p>
                      <p className="mt-2 text-[13px] text-white/60">{s.why}</p>
                      <p className="mt-2 rounded-lg bg-primary/10 px-3 py-2 text-[13px] font-medium text-primary">
                        Hook: “{s.hook}”
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
