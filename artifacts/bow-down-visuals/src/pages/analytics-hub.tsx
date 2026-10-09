import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { CostBadge } from "@/components/CostBadge";
import { useTranslation } from "react-i18next";
import { usePageTitle } from "@/hooks/use-page-title";
import ContentIntelligenceChain from "@/components/analytics-hub/ContentIntelligenceChain";
import RetentionDoctor from "@/components/analytics-hub/RetentionDoctor";
import MilestoneTracker from "@/components/analytics-hub/MilestoneTracker";
import ContentIdMonitor from "@/components/analytics-hub/ContentIdMonitor";
import ChannelAuditPanel from "@/components/analytics-hub/ChannelAuditPanel";
import ViralityCheckPanel from "@/components/analytics-hub/ViralityCheckPanel";
import FanDecoderSection from "@/components/analytics-hub/FanDecoderSection";
import {
  BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Loader2, Sparkles, TrendingUp, Users, Eye, ChevronDown, Upload, Link2,
  Target, Crown, BarChart3, Pencil, CheckCircle2, AlertTriangle,
  ArrowRight, Music2, Swords, ShieldCheck, Trophy, RefreshCw, FileVideo,
  Heart, MessageCircle, Lightbulb, Clock, ChevronRight, Zap,
  ClipboardCheck, Gauge, Ear, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* ─── Cross-Platform Analytics Hub ──────────────────────────────────────
   The social dashboard: TikTok, Instagram, YouTube, X in one place.
   (Complements /analytics, which covers site-internal connected-account stats.)
   Tracking is free — only the AI Growth Plan (via /api/analytics-hub/insights)
   and the Competitor Tracker (via /api/competitor-analysis) cost credits
   (charge-before-generation + refund on failure handled server-side).
   All numbers live in localStorage (analytics-hub-v1) and start EMPTY —
   no fake seeded data, ever.

   Tabs: "dashboard" holds the original hub sections; "competitor" holds the
   Competitor Tracker panel; "connected" holds the connected-account stats
   (live Instagram/TikTok/Facebook follower + post counts via
   /api/analytics/overview) and the AI Insights / What-to-make-next layer
   (via /api/analytics/insights and /api/analytics/suggestions) merged from
   the old /analytics page. "channelAudit" and "virality" hold the Channel
   Audit (/api/channel-audit, 3 credits) and Virality Pre-Flight Check
   (/api/virality-check, 2 credits) panels absorbed from /channel-audit and
   /virality-check. NO new page, NO new sidebar item — this file is
   the only home for competitor analysis and connected-account analytics. */

type PlatformKey = "tiktok" | "instagram" | "youtube" | "x";

interface PlatformStats {
  followers: number;
  views7d: number;
  views30d: number;
  engagementRate: number;
  topPostViews: number;
}

interface Snapshot {
  t: number;
  views30d: number;
}

interface PlatformData {
  stats: PlatformStats;
  history: Snapshot[];
}

type HubState = Record<PlatformKey, PlatformData>;

const STORAGE_KEY = "analytics-hub-v1";
const INSIGHT_COST = 2;
const COMPETITOR_COST = 200;
const COACH_COST = 100;
const MAX_COACH_POSTS = 8;
const MAX_HISTORY = 24;

const PLATFORM_KEYS: PlatformKey[] = ["tiktok", "instagram", "youtube", "x"];

const EMPTY_STATS: PlatformStats = {
  followers: 0, views7d: 0, views30d: 0, engagementRate: 0, topPostViews: 0,
};

function emptyState(): HubState {
  return {
    tiktok: { stats: { ...EMPTY_STATS }, history: [] },
    instagram: { stats: { ...EMPTY_STATS }, history: [] },
    youtube: { stats: { ...EMPTY_STATS }, history: [] },
    x: { stats: { ...EMPTY_STATS }, history: [] },
  };
}

/* Brand marks: lucide-react 1.x dropped brand icons, so these are minimal
   hand-drawn marks — brand colors used tastefully inside the gold/black theme. */
function TikTokMark({ className = "h-5 w-5" }: { className?: string }) {
  return <Music2 className={className} style={{ color: "#25F4EE" }} aria-hidden="true" />;
}
function InstagramMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#E1306C" strokeWidth="2" className={className} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1.3" fill="#E1306C" stroke="none" />
    </svg>
  );
}
function YouTubeMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#FF0000" strokeWidth="2" className={className} aria-hidden="true">
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="M10.5 9.8v4.4l4-2.2z" fill="#FF0000" stroke="none" />
    </svg>
  );
}
function XMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M5 4l14 16M19 4L5 20" />
    </svg>
  );
}

const PLATFORMS: Record<PlatformKey, { label: string; Mark: ComponentType<{ className?: string }>; accent: string; chip: string }> = {
  tiktok: { label: "TikTok", Mark: TikTokMark, accent: "#25F4EE", chip: "border-cyan-400/40 bg-cyan-400/10" },
  instagram: { label: "Instagram", Mark: InstagramMark, accent: "#E1306C", chip: "border-pink-500/40 bg-pink-500/10" },
  youtube: { label: "YouTube", Mark: YouTubeMark, accent: "#FF0000", chip: "border-red-500/40 bg-red-500/10" },
  x: { label: "X", Mark: XMark, accent: "#ffffff", chip: "border-white/25 bg-white/5" },
};

interface InsightsResult {
  summary?: string;
  recommendations?: string[];
  bestPlatform?: string;
  focusArea?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

interface CompetitorResult {
  competitorName?: string;
  niche?: string;
  contentPillars?: { pillar: string; whatTheyPost: string }[];
  postingCadence?: { assessment: string; estimatedPostsPerWeek: number | null };
  topFormats?: { format: string; whyItWorks: string }[];
  strengths?: string[];
  weaknesses?: string[];
  opportunities?: { gap: string; howToExploit: string }[];
  takeaways?: string[];
  disclaimer?: string;
  quickActions?: { label: string; href: string; hint: string }[];
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

/* ─── AI Coach ─────────────────────────────────────────────────────────
   POST /api/ai-coach: reads top posts + niche and explains WHY posts
   won/lost, with actionable next steps. { platform, posts:
   [{title, views, likes, comments, shares, watchTimeSec, postedAt}],
   niche } → { insights, patterns, mistakes, nextSteps }. Costs 100
   Visual Bucs, charged via the confirmedFetch confirmation dialog. */
interface CoachPost {
  title: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  watchTimeSec: number;
  postedAt: string;
}

interface CoachResult {
  insights?: string;
  patterns?: string[];
  mistakes?: string[];
  nextSteps?: string[];
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return `${Math.round(n)}`;
}

function parseNumber(value: string): number {
  const n = Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function loadState(): HubState {
  const base = emptyState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Record<PlatformKey, Partial<PlatformData>>>;
    for (const key of PLATFORM_KEYS) {
      const p = parsed[key];
      if (!p) continue;
      base[key].stats = { ...EMPTY_STATS, ...(p.stats ?? {}) };
      if (Array.isArray(p.history)) {
        base[key].history = p.history
          .filter((s) => s && typeof s.t === "number" && typeof s.views30d === "number")
          .slice(-MAX_HISTORY);
      }
    }
    return base;
  } catch {
    return base;
  }
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-3.5 py-2.5 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

/* Compact number field for the AI Coach post rows. */
function CoachNumberField({
  label,
  value,
  onChange,
  placeholder = "0",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/40">
        {label}
      </label>
      <input
        type="number"
        min={0}
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className={inputClass}
      />
    </div>
  );
}

const FIELD_LABELS: { key: keyof PlatformStats; labelKey: string; hintKey: string; isPercent?: boolean }[] = [
  { key: "followers", labelKey: "analyticsHub.fields.followers", hintKey: "analyticsHub.fieldHints.followers" },
  { key: "views7d", labelKey: "analyticsHub.fields.views7d", hintKey: "analyticsHub.fieldHints.views7d" },
  { key: "views30d", labelKey: "analyticsHub.fields.views30d", hintKey: "analyticsHub.fieldHints.views30d" },
  { key: "engagementRate", labelKey: "analyticsHub.fields.engagementRate", hintKey: "analyticsHub.fieldHints.engagementRate", isPercent: true },
  { key: "topPostViews", labelKey: "analyticsHub.fields.topPostViews", hintKey: "analyticsHub.fieldHints.topPostViews" },
];

/* ─── Connected Accounts tab (merged from the /analytics page) ─────────
   Live follower/post counts pulled from connected Instagram, TikTok, and
   Facebook accounts (FREE — pure data integration), with an AI layer on
   top: AI Insights (1cr) reads momentum in plain English, and AI
   Suggestions (1cr) tells the creator what to make next based on top
   posts. Endpoints: /api/analytics/overview, /api/analytics/insights,
   /api/analytics/suggestions. All identifiers are Conn-prefixed to avoid
   collisions with the hub's own PlatformKey/PlatformStats/Snapshot/fmt. */

type ConnPlatformKey = "instagram" | "tiktok" | "facebook";

interface ConnTopContentItem {
  id: string;
  caption: string;
  likes: number | null;
  comments: number | null;
  postedAt: string | null;
  url: string | null;
}

interface ConnPlatformStats {
  followers: number | null;
  following: number | null;
  mediaCount: number | null;
  totalLikes: number | null;
}

interface ConnPlatformOverview {
  platform: ConnPlatformKey;
  accountId: string;
  username: string | null;
  pageName: string | null;
  status: "ok" | "not_connected" | "expired" | "error";
  message: string | null;
  stats: ConnPlatformStats | null;
  topContent: ConnTopContentItem[];
  fetchedAt: string | null;
}

interface ConnSnapshot {
  platform: string;
  followers: number | null;
  recordedAt: string | null;
}

interface ConnOverviewResponse {
  platforms: ConnPlatformOverview[];
  snapshots: ConnSnapshot[];
  fetchedAt: string;
  error?: string;
  message?: string;
}

interface ConnInsights {
  headline: string;
  movers: { platform?: string; observation?: string; why?: string }[];
  bestWindow: string;
  recommendations: string[];
}

interface ConnSuggestion {
  title: string;
  format: string;
  why: string;
  hook: string;
}

const CONN_PLATFORM_META: Record<ConnPlatformKey, { label: string; icon: LucideIcon; blurbKey: string }> = {
  instagram: { label: "Instagram", icon: Link2, blurbKey: "analytics.connectBlurbs.instagram" },
  tiktok: { label: "TikTok", icon: FileVideo, blurbKey: "analytics.connectBlurbs.tiktok" },
  facebook: { label: "Facebook", icon: Users, blurbKey: "analytics.connectBlurbs.facebook" },
};

const CONN_ALL_PLATFORMS: ConnPlatformKey[] = ["instagram", "tiktok", "facebook"];

function connFmt(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function connTimeAgo(iso: string | null, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return t("analytics.justNow");
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return t("analytics.justNow");
  if (mins < 60) return t("analytics.minutesAgo", { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t("analytics.hoursAgo", { n: hrs });
  return t("analytics.daysAgo", { n: Math.floor(hrs / 24) });
}

/** Minimal SVG sparkline for follower history. */
function ConnSparkline({ points }: { points: number[] }) {
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

const connCardClass =
  "rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm";

function ConnectedAccountsTab() {
  const { t } = useTranslation();
  const { user, getAccessToken, refreshProfile } = useAuth();

  const [overview, setOverview] = useState<ConnOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [insights, setInsights] = useState<ConnInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<ConnSuggestion[] | null>(null);
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
      if (!res.ok) throw new Error(data.message || data.error || t("analytics.errorLoadStats"));
      setOverview(data as ConnOverviewResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("analytics.errorLoadStats"));
    } finally {
      setLoading(false);
    }
  }, [user, authedFetch]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const platformMap = useMemo(() => {
    const map = new Map<ConnPlatformKey, ConnPlatformOverview>();
    overview?.platforms.forEach((p) => map.set(p.platform, p));
    return map;
  }, [overview]);

  const snapshotsByPlatform = useMemo(() => {
    const map = new Map<ConnPlatformKey, number[]>();
    overview?.snapshots.forEach((s) => {
      if (s.followers === null) return;
      const key = s.platform as ConnPlatformKey;
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
        topContent: p.topContent.slice(0, 5).map((tc) => ({
          caption: tc.caption,
          likes: tc.likes,
          comments: tc.comments,
        })),
      }));
    return { platforms, niche: niche.trim().slice(0, 80) };
  }, [overview, niche]);

  async function runInsights() {
    if (insightsLoading || !user) return;
    const payload = aiPayload();
    if (payload.platforms.length === 0) {
      setAiError(t("analytics.errorNoPlatforms"));
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
      if (!res.ok || !data.insights) throw new Error(data.message || t("analytics.errorInsightsFailed"));
      setInsights(data.insights as ConnInsights);
      refreshProfile();
      setTimeout(() => document.getElementById("ai-insights")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : t("analytics.errorInsightsFailed"));
    } finally {
      setInsightsLoading(false);
    }
  }

  async function runSuggestions() {
    if (suggestionsLoading || !user) return;
    const payload = aiPayload();
    if (payload.platforms.length === 0) {
      setAiError(t("analytics.errorNoPlatforms"));
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
      if (!res.ok || !Array.isArray(data.suggestions)) throw new Error(data.message || t("analytics.errorSuggestionsFailed"));
      setSuggestions(data.suggestions as ConnSuggestion[]);
      refreshProfile();
      setTimeout(() => document.getElementById("ai-suggestions")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : t("analytics.errorSuggestionsFailed"));
    } finally {
      setSuggestionsLoading(false);
    }
  }

  return (
    <div className="relative">
      {/* header row */}
      <div className="relative mt-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-black">
            {t("analytics.heroTitleStart")} <span className="text-primary">{t("analytics.heroTitleAccent")}</span>
          </h2>
          <p className="mt-1 max-w-xl text-sm text-white/55">{t("analytics.heroSubtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadOverview}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:border-primary/50 hover:text-white disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t("analytics.refreshStats")}
          </button>
          {overview?.fetchedAt && (
            <span className="text-xs text-white/35">{t("analytics.updated", { time: connTimeAgo(overview.fetchedAt, t) })}</span>
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
      <section className="relative mt-8 grid gap-4 md:grid-cols-3">
        {CONN_ALL_PLATFORMS.map((key) => {
          const meta = CONN_PLATFORM_META[key];
          const Icon = meta.icon;
          const p = platformMap.get(key);
          const spark = snapshotsByPlatform.get(key) ?? [];

          if (!p || p.status === "not_connected") {
            return (
              <div key={key} className={connCardClass}>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <h3 className="font-display text-lg font-bold">{meta.label}</h3>
                </div>
                <p className="mt-3 text-sm text-white/50">{t(meta.blurbKey)}</p>
                <Link
                  href="/settings"
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                >
                  {t("analytics.connect", { platform: meta.label })} <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            );
          }

          if (p.status === "expired") {
            return (
              <div key={key} className={connCardClass}>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <h3 className="font-display text-lg font-bold">{meta.label}</h3>
                </div>
                <p className="mt-3 text-sm text-amber-200/80">
                  {p.message ?? t("analytics.connectionExpired")}
                </p>
                <Link
                  href="/settings"
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                >
                  {t("analytics.reconnect")} <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            );
          }

          if (p.status === "error") {
            return (
              <div key={key} className={connCardClass}>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <h3 className="font-display text-lg font-bold">{meta.label}</h3>
                </div>
                <p className="mt-3 text-sm text-white/50">
                  {p.message ?? t("analytics.platformUnreachable")}
                </p>
                <button onClick={loadOverview} className="mt-4 text-sm font-semibold text-primary hover:underline">
                  {t("analytics.tryAgain")}
                </button>
              </div>
            );
          }

          const s = p.stats;
          const label = p.pageName ?? (p.username ? `@${p.username}` : meta.label);
          return (
            <div key={key} className={connCardClass}>
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
                {spark.length >= 2 && <ConnSparkline points={spark} />}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-black/40 p-3">
                  <p className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-white/40">
                    <Users className="h-3 w-3" /> {t("analytics.statFollowers")}
                  </p>
                  <p className="mt-1 font-display text-2xl font-black text-primary">{connFmt(s?.followers ?? null)}</p>
                </div>
                <div className="rounded-xl bg-black/40 p-3">
                  <p className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-white/40">
                    <FileVideo className="h-3 w-3" /> {t("analytics.statPosts")}
                  </p>
                  <p className="mt-1 font-display text-2xl font-black">{connFmt(s?.mediaCount ?? null)}</p>
                </div>
                <div className="rounded-xl bg-black/40 p-3">
                  <p className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-white/40">
                    <Heart className="h-3 w-3" /> {t("analytics.statTotalLikes")}
                  </p>
                  <p className="mt-1 font-display text-2xl font-black">{connFmt(s?.totalLikes ?? null)}</p>
                </div>
                <div className="rounded-xl bg-black/40 p-3">
                  <p className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-white/40">
                    <TrendingUp className="h-3 w-3" /> {t("analytics.statFollowing")}
                  </p>
                  <p className="mt-1 font-display text-2xl font-black">{connFmt(s?.following ?? null)}</p>
                </div>
              </div>

              {p.topContent.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-white/40">
                    {t("analytics.topPosts")}
                  </p>
                  <ul className="space-y-2">
                    {p.topContent.slice(0, 3).map((item) => (
                      <li key={item.id} className="rounded-lg bg-black/30 px-3 py-2">
                        <p className="truncate text-[13px] text-white/75">{item.caption || t("analytics.noCaption")}</p>
                        <p className="mt-0.5 flex items-center gap-3 text-[11px] text-white/40">
                          <span className="inline-flex items-center gap-1"><Heart className="h-3 w-3" />{connFmt(item.likes)}</span>
                          <span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" />{connFmt(item.comments)}</span>
                          {item.postedAt && <span>{connTimeAgo(item.postedAt, t)}</span>}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-3 text-[11px] text-white/30">
                {t("analytics.liveFrom", { platform: meta.label, time: p.fetchedAt ? connTimeAgo(p.fetchedAt, t) : t("analytics.justNow") })}
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
                {t("analytics.aiInsightsTitle")} <span className="text-primary">{t("analytics.aiInsightsAccent")}</span>
              </h2>
              <p className="text-sm text-white/50">
                {t("analytics.aiCostPrefix")} <span className="font-semibold text-primary">{t("analytics.creditsPerRun", { credits: 100 })}</span> {t("analytics.aiCostSuffix")}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <input
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder={t("analytics.nichePlaceholder")}
              data-min-stars="3"
              maxLength={80}
              className="w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40 sm:max-w-xs"
            />
            <button
              onClick={runInsights}
              disabled={insightsLoading || loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
            >
              {insightsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {t("analytics.analyzeStats", { credits: 100 })}
            </button>
            <button
              onClick={runSuggestions}
              disabled={suggestionsLoading || loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-5 py-3 text-sm font-bold text-primary transition hover:bg-primary/20 disabled:opacity-50"
            >
              {suggestionsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}
              {t("analytics.whatToMakeNext", { credits: 100 })}
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
                <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">{t("analytics.headline")}</p>
                <p className="mt-2 text-lg font-semibold leading-relaxed">{insights.headline}</p>
              </div>
              {insights.movers.length > 0 && (
                <div className="grid gap-3 md:grid-cols-2">
                  {insights.movers.map((m, i) => (
                    <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-4">
                      <p className="text-xs font-bold uppercase tracking-widest text-primary">{m.platform ?? t("analytics.platformFallback")}</p>
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
                    <p className="text-xs font-bold uppercase tracking-widest text-primary">{t("analytics.bestWindow")}</p>
                    <p className="mt-1 text-sm text-white/80">{insights.bestWindow}</p>
                  </div>
                </div>
              )}
              {insights.recommendations.length > 0 && (
                <div className="rounded-xl border border-white/10 bg-black/40 p-4">
                  <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">{t("analytics.next3Moves")}</p>
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
              <p className="mb-3 text-xs font-bold uppercase tracking-widest text-primary">{t("analytics.makeTheseNext")}</p>
              <div className="grid gap-3 md:grid-cols-2">
                {suggestions.map((s, i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-black/40 p-4">
                    <p className="font-display text-base font-bold">{s.title}</p>
                    <p className="mt-0.5 text-[11px] uppercase tracking-widest text-white/40">{s.format}</p>
                    <p className="mt-2 text-[13px] text-white/60">{s.why}</p>
                    <p className="mt-2 rounded-lg bg-primary/10 px-3 py-2 text-[13px] font-medium text-primary">
                      {t("analytics.hookLabel", { hook: s.hook })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default function AnalyticsHub() {
  const { t } = useTranslation();
  usePageTitle(
    t("analyticsHub.pageTitle"),
    t("analyticsHub.pageDescription")
  );
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [hub, setHub] = useState<HubState>(() => emptyState());
  const [hydrated, setHydrated] = useState(false);
  const [openForm, setOpenForm] = useState<PlatformKey | null>(null);
  const [draft, setDraft] = useState<Record<PlatformKey, Record<keyof PlatformStats, string>> | null>(null);
  const [csvNote, setCsvNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [insights, setInsights] = useState<InsightsResult | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── Competitor Tracker tab state ─────────────────────────────── */
  const [hubTab, setHubTab] = useState<"dashboard" | "competitor" | "intelligence" | "contentid" | "milestones" | "connected" | "channelAudit" | "virality" | "fandecoder">("dashboard");
  /* Deep-link into the Content Intelligence chain: ?hook= drops a hook
     into Step 2 (from Hook Studio's "full intelligence check"). */
  const [intelInitialHook, setIntelInitialHook] = useState("");
  const [compName, setCompName] = useState("");
  const [compUrl, setCompUrl] = useState("");
  const [compNiche, setCompNiche] = useState("");
  const [compNotes, setCompNotes] = useState("");
  const [compResult, setCompResult] = useState<CompetitorResult | null>(null);
  const [compLoading, setCompLoading] = useState(false);
  const [compError, setCompError] = useState<string | null>(null);

  /* ── AI Coach section state ─────────────────────────────────────────
     Per-post rows the creator fills in (or imports from their hub stats);
     sent to POST /api/ai-coach via confirmedFetch. */
  const [coachPlatform, setCoachPlatform] = useState<PlatformKey>("tiktok");
  const [coachNiche, setCoachNiche] = useState("");
  const [coachPosts, setCoachPosts] = useState<CoachPost[]>([]);
  const [coachResult, setCoachResult] = useState<CoachResult | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);

  /* Load persisted data once (client-side; SSR-free). Also honors
     deep-links: ?tab=intelligence opens the Content Intelligence chain,
     ?hook= prefills its Step 2; ?tab=content-id opens the Content ID tab
     (from /distribute's "Protect with Content ID" — ?title/?artist/?releaseId
     prefill the opt-in form inside ContentIdMonitor). */
  useEffect(() => {
    setHub(loadState());
    setHydrated(true);
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("tab") === "intelligence") {
        setHubTab("intelligence");
        const hook = params.get("hook")?.trim().slice(0, 600);
        if (hook) setIntelInitialHook(hook);
      } else if (params.get("tab") === "content-id") {
        setHubTab("contentid");
      } else if (params.get("tab") === "milestones") {
        setHubTab("milestones");
      } else if (params.get("tab") === "connected") {
        setHubTab("connected");
      } else if (params.get("tab") === "channel-audit") {
        setHubTab("channelAudit");
      } else if (params.get("tab") === "virality") {
        setHubTab("virality");
      }
      else if (params.get("tab") === "fan-decoder") {
        setHubTab("fandecoder");
      }
    } catch {
      /* non-browser or malformed URL — ignore */
    }
  }, []);

  function persist(next: HubState) {
    setHub(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage full or blocked — keep in-memory state */
    }
  }

  const hasData = PLATFORM_KEYS.some(
    (k) => hub[k].stats.followers > 0 || hub[k].stats.views30d > 0 || hub[k].stats.views7d > 0
  );

  const totalFollowers = PLATFORM_KEYS.reduce((s, k) => s + hub[k].stats.followers, 0);
  const totalViews30d = PLATFORM_KEYS.reduce((s, k) => s + hub[k].stats.views30d, 0);

  const bestByEngagement = PLATFORM_KEYS
    .filter((k) => hub[k].stats.followers > 0)
    .sort((a, b) => hub[b].stats.engagementRate - hub[a].stats.engagementRate)[0];

  function startEditing(key: PlatformKey) {
    const stats = hub[key].stats;
    setDraft((prev) => ({
      ...(prev ?? Object.fromEntries(PLATFORM_KEYS.map((k) => [k, {}])) as Record<PlatformKey, Record<keyof PlatformStats, string>>),
      [key]: {
        followers: stats.followers ? String(stats.followers) : "",
        views7d: stats.views7d ? String(stats.views7d) : "",
        views30d: stats.views30d ? String(stats.views30d) : "",
        engagementRate: stats.engagementRate ? String(stats.engagementRate) : "",
        topPostViews: stats.topPostViews ? String(stats.topPostViews) : "",
      },
    }));
    setOpenForm(key);
    setCsvNote(null);
  }

  function savePlatform(key: PlatformKey) {
    if (!draft) return;
    const d = draft[key];
    const stats: PlatformStats = {
      followers: parseNumber(d.followers),
      views7d: parseNumber(d.views7d),
      views30d: parseNumber(d.views30d),
      engagementRate: Math.min(100, Math.max(0, Number(d.engagementRate) || 0)),
      topPostViews: parseNumber(d.topPostViews),
    };
    const next: HubState = {
      ...hub,
      [key]: {
        stats,
        history: [...hub[key].history, { t: Date.now(), views30d: stats.views30d }].slice(-MAX_HISTORY),
      },
    };
    persist(next);
    setOpenForm(null);
    setCsvNote({ ok: true, text: t("analyticsHub.platformUpdated", { platform: PLATFORMS[key].label }) });
  }

  /* CSV import: platform,followers,views7d,views30d,engagementRate,topPostViews
     (header optional). Bad rows are skipped and counted. */
  function handleCsvFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const rows = text.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
      if (rows.length === 0) {
        setCsvNote({ ok: false, text: t("analyticsHub.csvEmpty") });
        return;
      }
      const next = { ...hub };
      let imported = 0;
      let skipped = 0;
      rows.forEach((row, idx) => {
        const cols = row.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
        const first = (cols[0] ?? "").toLowerCase();
        const looksLikeHeader = idx === 0 && !PLATFORM_KEYS.includes(first as PlatformKey);
        if (looksLikeHeader || !PLATFORM_KEYS.includes(first as PlatformKey)) {
          skipped += 1;
          return;
        }
        const key = first as PlatformKey;
        if (cols.length < 6 || cols.slice(1, 6).some((c) => c === "" || Number.isNaN(Number(c)))) {
          skipped += 1;
          return;
        }
        const stats: PlatformStats = {
          followers: Math.max(0, Math.floor(Number(cols[1]))),
          views7d: Math.max(0, Math.floor(Number(cols[2]))),
          views30d: Math.max(0, Math.floor(Number(cols[3]))),
          engagementRate: Math.min(100, Math.max(0, Number(cols[4]))),
          topPostViews: Math.max(0, Math.floor(Number(cols[5]))),
        };
        next[key] = {
          stats,
          history: [...next[key].history, { t: Date.now(), views30d: stats.views30d }].slice(-MAX_HISTORY),
        };
        imported += 1;
      });
      persist(next);
      setCsvNote({
        ok: imported > 0,
        text:
          imported > 0
            ? skipped > 0
              ? t("analyticsHub.csvImportedSkipped", { count: imported, skipped })
              : t("analyticsHub.csvImported", { count: imported })
            : t("analyticsHub.csvNoValidRows", { skipped }),
      });
    };
    reader.readAsText(file);
  }

  async function authedPost(body: Record<string, unknown>) {
    const token = await getAccessToken();
    return confirmedFetch("/api/analytics-hub/insights", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  function handlePaidFailure(res: Response, data: { error?: string }): boolean {
    if (res.status === 402 || data.error === "out_of_credits") {
      setOutOfCredits(true);
      refreshProfile();
      return true;
    }
    return false;
  }

  async function getGrowthPlan() {
    if (insightsLoading || !user) return;
    if (!hasData) {
      setError(t("analyticsHub.errorNoData"));
      return;
    }
    setInsightsLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await authedPost({
        platforms: PLATFORM_KEYS.map((key) => ({ platform: key, ...hub[key].stats })),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as InsightsResult;
      if (handlePaidFailure(res, data)) return;
      if (!res.ok || !data.summary || !Array.isArray(data.recommendations) || data.recommendations.length === 0) {
        throw new Error(data.message || data.error || t("analyticsHub.errorGrowthPlanFailed"));
      }
      setInsights(data);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("insights-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("analyticsHub.errorGrowthPlanFailed"));
    } finally {
      setInsightsLoading(false);
    }
  }

  async function analyzeCompetitor() {
    if (compLoading || !user) return;
    if (compName.trim().length < 2 && compUrl.trim().length < 4) {
      setCompError(t("analyticsHub.competitor.needNameOrUrl"));
      return;
    }
    if (compNiche.trim().length < 2) {
      setCompError(t("analyticsHub.competitor.needNiche"));
      return;
    }
    setCompLoading(true);
    setCompError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/competitor-analysis", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          competitorName: compName.trim(),
          channelUrl: compUrl.trim(),
          niche: compNiche.trim(),
          notes: compNotes.trim(),
        }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as CompetitorResult;
      if (handlePaidFailure(res, data)) return;
      if (
        !res.ok ||
        !Array.isArray(data.takeaways) ||
        data.takeaways.length !== 3 ||
        !Array.isArray(data.opportunities) ||
        data.opportunities.length === 0
      ) {
        throw new Error(data.message || data.error || t("analyticsHub.competitor.errorFailed"));
      }
      setCompResult(data);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("competitor-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setCompError(err instanceof Error ? err.message : t("analyticsHub.competitor.errorFailed"));
    } finally {
      setCompLoading(false);
    }
  }

  /* ── AI Coach ─────────────────────────────────────────────────────── */
  function blankCoachPost(): CoachPost {
    return { title: "", views: 0, likes: 0, comments: 0, shares: 0, watchTimeSec: 0, postedAt: "" };
  }

  /** Prefills one post row from the hub's own top-post stat for the
      currently selected platform — "whatever summary data exists". */
  function importCoachPostFromStats() {
    const stats = hub[coachPlatform].stats;
    if (stats.topPostViews <= 0) return;
    setCoachPosts((prev) => [
      ...prev,
      {
        ...blankCoachPost(),
        title: `${PLATFORMS[coachPlatform].label} ${t("analyticsHub.aiCoach.topPostSuffix", { defaultValue: "top post" })}`,
        views: stats.topPostViews,
      },
    ]);
  }

  function updateCoachPost(idx: number, patch: Partial<CoachPost>) {
    setCoachPosts((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  async function askAiCoach() {
    if (coachLoading || !user) return;
    const posts = coachPosts
      .filter((p) => p.title.trim().length > 0)
      .map((p) => ({ ...p, title: p.title.trim() }));
    if (posts.length === 0) {
      setCoachError(
        t("analyticsHub.aiCoach.needPost", {
          defaultValue: "Add at least one post with a title first — that's what the coach breaks down.",
        })
      );
      return;
    }
    setCoachLoading(true);
    setCoachError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/ai-coach", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          platform: coachPlatform,
          posts,
          niche: coachNiche.trim().slice(0, 80),
        }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as CoachResult;
      if (handlePaidFailure(res, data)) return;
      if (!res.ok || (!data.insights && !Array.isArray(data.patterns))) {
        throw new Error(
          data.message ||
            data.error ||
            t("analyticsHub.aiCoach.errorFailed", {
              defaultValue: "The coach couldn't read your numbers. Try again.",
            })
        );
      }
      setCoachResult(data);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("ai-coach-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setCoachError(
        err instanceof Error
          ? err.message
          : t("analyticsHub.aiCoach.errorFailed", {
              defaultValue: "The coach couldn't read your numbers. Try again.",
            })
      );
    } finally {
      setCoachLoading(false);
    }
  }

  const barData = PLATFORM_KEYS.map((key) => ({
    name: PLATFORMS[key].label,
    views: hub[key].stats.views30d,
    fill: PLATFORMS[key].accent,
  }));

  function sparklineData(key: PlatformKey) {
    const hist = hub[key].history;
    if (hist.length === 0) return [{ label: "—", views: hub[key].stats.views30d }];
    return hist.map((s, i) => ({
      label: new Date(s.t).toLocaleDateString("en-US", { month: "short", day: "numeric" }) || `#${i + 1}`,
      views: s.views30d,
    }));
  }

  return (
    <div className="min-h-screen bg-black text-white">

      <main className="relative mx-auto max-w-6xl px-5 pb-24 pt-14 md:pt-20">
        {/* glow */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[640px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <BarChart3 className="h-3 w-3" aria-hidden="true" /> {t("analyticsHub.heroEyebrow")}
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-6xl">
            {t("analyticsHub.heroTitle")}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-white/55">
            {t("analyticsHub.heroSubtitle", { cost: INSIGHT_COST })}
          </p>
          {!hasData && hydrated && (
            <a
              href="#platform-cards"
              className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-6 py-3 text-sm font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              {t("analyticsHub.addNumbers")}
            </a>
          )}
        </div>

        {/* ── HUB TABS: My Dashboard | Competitor Tracker | Intelligence ── */}
        <div className="relative mt-8 flex justify-center" role="tablist" aria-label="Analytics Hub">
          <div className="inline-flex max-w-full overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-1.5">
            <button
              role="tab"
              aria-selected={hubTab === "dashboard"}
              onClick={() => setHubTab("dashboard")}
              className={`flex items-center gap-2 whitespace-nowrap shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                hubTab === "dashboard"
                  ? "bg-primary text-black shadow-[0_2px_16px_rgba(212,175,55,0.4)]"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              {t("analyticsHub.tabDashboard")}
            </button>
            <button
              role="tab"
              aria-selected={hubTab === "competitor"}
              onClick={() => setHubTab("competitor")}
              className={`flex items-center gap-2 whitespace-nowrap shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                hubTab === "competitor"
                  ? "bg-primary text-black shadow-[0_2px_16px_rgba(212,175,55,0.4)]"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <Swords className="h-4 w-4" aria-hidden="true" />
              {t("analyticsHub.tabCompetitor")}
            </button>
            <button
              role="tab"
              aria-selected={hubTab === "intelligence"}
              onClick={() => setHubTab("intelligence")}
              className={`flex items-center gap-2 whitespace-nowrap shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                hubTab === "intelligence"
                  ? "bg-primary text-black shadow-[0_2px_16px_rgba(212,175,55,0.4)]"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {t("analyticsHub.tabIntelligence")}
            </button>
            <button
              role="tab"
              aria-selected={hubTab === "contentid"}
              onClick={() => setHubTab("contentid")}
              className={`flex items-center gap-2 whitespace-nowrap shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                hubTab === "contentid"
                  ? "bg-primary text-black shadow-[0_2px_16px_rgba(212,175,55,0.4)]"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Content ID
            </button>
            <button
              role="tab"
              aria-selected={hubTab === "milestones"}
              onClick={() => setHubTab("milestones")}
              className={`flex items-center gap-2 whitespace-nowrap shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                hubTab === "milestones"
                  ? "bg-primary text-black shadow-[0_2px_16px_rgba(212,175,55,0.4)]"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <Trophy className="h-4 w-4" aria-hidden="true" />
              {t("analyticsHub.tabMilestones")}
            </button>
            <button
              role="tab"
              aria-selected={hubTab === "connected"}
              onClick={() => setHubTab("connected")}
              className={`flex items-center gap-2 whitespace-nowrap shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                hubTab === "connected"
                  ? "bg-primary text-black shadow-[0_2px_16px_rgba(212,175,55,0.4)]"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <Link2 className="h-4 w-4" aria-hidden="true" />
              {t("analyticsHub.tabConnected", { defaultValue: "Connected Accounts" })}
            </button>
            <button
              role="tab"
              aria-selected={hubTab === "channelAudit"}
              onClick={() => setHubTab("channelAudit")}
              className={`flex items-center gap-2 whitespace-nowrap shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                hubTab === "channelAudit"
                  ? "bg-primary text-black shadow-[0_2px_16px_rgba(212,175,55,0.4)]"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
              {t("analyticsHub.tabChannelAudit", { defaultValue: "Channel Audit" })}
            </button>
            <button
              role="tab"
              aria-selected={hubTab === "virality"}
              onClick={() => setHubTab("virality")}
              className={`flex items-center gap-2 whitespace-nowrap shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                hubTab === "virality"
                  ? "bg-primary text-black shadow-[0_2px_16px_rgba(212,175,55,0.4)]"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <Gauge className="h-4 w-4" aria-hidden="true" />
              {t("analyticsHub.tabVirality", { defaultValue: "Virality Check" })}
            </button>
            <button
              role="tab"
              aria-selected={hubTab === "fandecoder"}
              onClick={() => setHubTab("fandecoder")}
              className={`flex items-center gap-2 whitespace-nowrap shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                hubTab === "fandecoder"
                  ? "bg-primary text-black shadow-[0_2px_16px_rgba(212,175,55,0.4)]"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <Ear className="h-4 w-4" aria-hidden="true" />
              {t("analyticsHub.tabFanDecoder", { defaultValue: "Fan Decoder" })}
            </button>
          </div>
        </div>

        {hubTab === "dashboard" && (
        <>

        {csvNote && (
          <div
            className={`relative mx-auto mt-6 max-w-3xl rounded-xl border px-4 py-3 text-sm ${
              csvNote.ok
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-amber-500/30 bg-amber-500/10 text-amber-300"
            }`}
          >
            {csvNote.text}
          </div>
        )}

        {/* ── OVERVIEW ROW ─────────────────────────────────────────── */}
        <div className="relative mt-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-5">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
              <Users className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> {t("analyticsHub.totalFollowers")}
            </p>
            <p className="mt-2 font-display text-4xl font-black text-white">
              {hasData ? fmt(totalFollowers) : "—"}
            </p>
            <p className="mt-1 text-xs text-white/35">{t("analyticsHub.acrossPlatforms")}</p>
          </div>
          <div className="rounded-2xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-5">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
              <Eye className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> {t("analyticsHub.totalViews30d")}
            </p>
            <p className="mt-2 font-display text-4xl font-black text-white">
              {hasData ? fmt(totalViews30d) : "—"}
            </p>
            <p className="mt-1 text-xs text-white/35">{t("analyticsHub.last30Days")}</p>
          </div>
          <div className="rounded-2xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-5">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
              <Crown className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> {t("analyticsHub.bestEngagement")}
            </p>
            <p className="mt-2 font-display text-4xl font-black text-white">
              {bestByEngagement ? PLATFORMS[bestByEngagement].label : "—"}
            </p>
            <p className="mt-1 text-xs text-white/35">
              {bestByEngagement
                ? t("analyticsHub.engagementRateValue", { rate: hub[bestByEngagement].stats.engagementRate })
                : t("analyticsHub.addNumbersToFind")}
            </p>
          </div>
        </div>

        {/* ── GROWTH CHART ─────────────────────────────────────────── */}
        <div className="relative mt-6 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-bold">
                <TrendingUp className="h-5 w-5 text-primary" aria-hidden="true" />
                {t("analyticsHub.chartTitle")}
              </h2>
              <p className="mt-1 text-sm text-white/45">
                {hasData
                  ? t("analyticsHub.chartSubtitleData")
                  : t("analyticsHub.chartSubtitleEmpty")}
              </p>
            </div>
            {/* CSV import */}
            <div data-min-stars="5" className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleCsvFile(f);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-bold text-white/70 transition hover:border-primary/40 hover:text-white"
                title={t("analyticsHub.importCsvTitle")}
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                {t("analyticsHub.importCsv")}
              </button>
            </div>
          </div>

          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
                <XAxis dataKey="name" stroke="rgba(255,255,255,0.5)" tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 12 }} />
                <YAxis
                  stroke="rgba(255,255,255,0.5)"
                  tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 12 }}
                  tickFormatter={(v: number) => fmt(v)}
                />
                <Tooltip
                  contentStyle={{ background: "#0a0a0a", border: "1px solid rgba(212,175,55,0.35)", borderRadius: 12, color: "#fff" }}
                  formatter={(value) => [`${Number(value).toLocaleString("en-US")} ${t("analyticsHub.views")}`, t("analyticsHub.views30d")]}
                />
                <Bar dataKey="views" radius={[8, 8, 0, 0]}>
                  {barData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} fillOpacity={hasData ? 0.9 : 0.25} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── PLATFORM CARDS ───────────────────────────────────────── */}
        <div id="platform-cards" className="relative mt-6 scroll-mt-24">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {PLATFORM_KEYS.map((key) => {
              const { label, Mark, chip } = PLATFORMS[key];
              const data = hub[key];
              const editing = openForm === key;
              return (
                <div
                  key={key}
                  className="overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${chip}`}>
                        <Mark />
                      </span>
                      <div>
                        <h3 className="text-lg font-bold">{label}</h3>
                        <p className="text-xs text-white/40">
                          {data.history.length > 0
                            ? t("analyticsHub.snapshotsSaved", { count: data.history.length })
                            : t("analyticsHub.noDataYet")}
                        </p>
                      </div>
                    </div>
                    <button
                      disabled
                      title={t("analyticsHub.connectTitle")}
                      className="flex cursor-not-allowed items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs font-bold text-white/30"
                    >
                      <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("analyticsHub.connectComingSoon")}
                    </button>
                  </div>

                  {/* stats grid */}
                  <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                    {(
                      [
                        { label: t("analyticsHub.statFollowers"), value: fmt(data.stats.followers) },
                        { label: t("analyticsHub.statViews7d"), value: fmt(data.stats.views7d) },
                        { label: t("analyticsHub.statViews30d"), value: fmt(data.stats.views30d) },
                        { label: t("analyticsHub.statEngagement"), value: `${data.stats.engagementRate}%` },
                        { label: t("analyticsHub.statTopPost"), value: fmt(data.stats.topPostViews) },
                      ] as { label: string; value: string }[]
                    ).map((s) => (
                      <div key={s.label} className="rounded-xl border border-white/10 bg-black/50 px-3.5 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-white/35">{s.label}</p>
                        <p className="mt-1 font-display text-xl font-black text-white">{s.value}</p>
                      </div>
                    ))}
                    {/* sparkline tile */}
                    <div className="rounded-xl border border-white/10 bg-black/50 px-3.5 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/35">{t("analyticsHub.trendLabel")}</p>
                      <div className="mt-1 h-[42px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={sparklineData(key)} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                            <Line
                              type="monotone"
                              dataKey="views"
                              stroke="#d4af37"
                              strokeWidth={2}
                              dot={false}
                              isAnimationActive={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="mt-1 text-[10px] leading-tight text-white/30">
                        {data.history.length <= 1
                          ? t("analyticsHub.addMoreSnapshots")
                          : t("analyticsHub.snapshotCount", { count: data.history.length })}
                      </p>
                    </div>
                  </div>

                  {/* manual entry */}
                  <button
                    onClick={() => (editing ? setOpenForm(null) : startEditing(key))}
                    className="mt-4 flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-white/70 transition hover:border-primary/40 hover:text-white"
                  >
                    <span className="flex items-center gap-2">
                      <Pencil className="h-4 w-4 text-primary" aria-hidden="true" />
                      {t("analyticsHub.updateNumbers")}
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${editing ? "rotate-180" : ""}`}
                      aria-hidden="true"
                    />
                  </button>
                  {editing && draft && (
                    <div className="mt-3 rounded-2xl border border-primary/20 bg-black/50 p-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {FIELD_LABELS.map(({ key: field, labelKey, hintKey, isPercent }) => (
                          <div key={field}>
                            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                              {t(labelKey)}
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={isPercent ? 100 : undefined}
                              step={isPercent ? "0.1" : "1"}
                              value={draft[key][field]}
                              onChange={(e) =>
                                setDraft((prev) =>
                                  prev ? { ...prev, [key]: { ...prev[key], [field]: e.target.value } } : prev
                                )
                              }
                              placeholder={t(hintKey)}
                              className={inputClass}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 flex gap-2">
                        <button
                          onClick={() => savePlatform(key)}
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          {t("analyticsHub.saveSnapshot")}
                        </button>
                        <button
                          onClick={() => setOpenForm(null)}
                          className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/60 transition hover:border-white/30 hover:text-white"
                        >
                          {t("analyticsHub.cancel")}
                        </button>
                      </div>
                      <p className="mt-2.5 text-[11px] text-white/30">
                        {t("analyticsHub.snapshotHint")}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── AI INSIGHTS ──────────────────────────────────────────── */}
        <div className="relative mt-6 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-xl font-bold">{t("analyticsHub.growthPlanTitle")}</h2>
              <p className="text-sm text-white/45">
                {t("analyticsHub.growthPlanDescription")}
              </p>
            </div>
          </div>

          <div className="mt-8 text-center">
            {user ? (
              <button
                onClick={getGrowthPlan}
                disabled={insightsLoading || !hasData}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {insightsLoading ? (
                  <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                ) : (
                  <Target className="h-6 w-6" aria-hidden="true" />
                )}
                {insightsLoading ? t("analyticsHub.readingNumbers") : t("analyticsHub.getGrowthPlan")}
              </button>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
              >
                <Sparkles className="h-6 w-6" aria-hidden="true" />
                {t("analyticsHub.signInForPlan")}
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
            )}
            <p className="mt-2.5 text-xs text-white/35">
              {t("analyticsHub.planCostNote", { cost: INSIGHT_COST })}
            </p>
            {!hasData && (
              <p className="mx-auto mt-3 flex max-w-md items-center justify-center gap-1.5 text-sm text-amber-300/90">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                {t("analyticsHub.addNumbersFirst")}
              </p>
            )}
            {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
            {error && !outOfCredits && (
              <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </p>
            )}
          </div>

          {/* results */}
          {insights && insights.summary && (
            <div id="insights-results" className="mt-8">
              <div className="rounded-2xl border border-white/10 bg-black/60 p-6">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {t("analyticsHub.whereYouStand")}
                </p>
                <p className="text-[15px] leading-relaxed text-white/85">{insights.summary}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {insights.bestPlatform && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3.5 py-1.5 text-xs font-bold text-primary">
                      <Crown className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("analyticsHub.bestPlatform", { platform: PLATFORM_KEYS.includes(insights.bestPlatform as PlatformKey) ? PLATFORMS[insights.bestPlatform as PlatformKey].label : insights.bestPlatform })}
                    </span>
                  )}
                  {insights.focusArea && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3.5 py-1.5 text-xs font-bold text-white/75">
                      <Target className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      {t("analyticsHub.focus", { area: insights.focusArea })}
                    </span>
                  )}
                </div>
              </div>

              <p className="mb-3 mt-6 text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("analyticsHub.your3Moves")}
              </p>
              <div className="grid gap-3">
                {insights.recommendations!.map((rec, i) => (
                  <div
                    key={`rec-${i}`}
                    className="flex items-start gap-3.5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-primary/40"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-black text-primary">
                      {i + 1}
                    </span>
                    <p className="pt-1 text-[15px] leading-relaxed text-white/90">{rec}</p>
                  </div>
                ))}
              </div>

              {user && (
                <div className="mt-6 text-center">
                  <button
                    onClick={getGrowthPlan}
                    disabled={insightsLoading}
                    className="inline-flex items-center gap-2 rounded-full border border-primary/40 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
                  >
                    {insightsLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                    )}
                    {t("analyticsHub.rerunPlan", { cost: INSIGHT_COST })}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── AI COACH ───────────────────────────────────────────────
            Performance coach: the creator adds their top posts (or imports
            the top-post stat from their hub numbers), picks a platform +
            niche, and POST /api/ai-coach explains WHY posts won/lost with
            actionable next steps. 100 Visual Bucs via confirmedFetch. */}
        <div className="relative mt-6 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Lightbulb className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-xl font-bold">
                {t("analyticsHub.aiCoach.title", { defaultValue: "AI Performance Coach" })}
              </h2>
              <p className="text-sm text-white/45">
                {t("analyticsHub.aiCoach.subtitle", {
                  defaultValue: "Show the coach your top posts — it tells you why they won or flopped, and what to do next.",
                })}
              </p>
            </div>
          </div>

          {/* platform + niche */}
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("analyticsHub.aiCoach.platformLabel", { defaultValue: "Platform" })}
              </label>
              <div className="flex flex-wrap gap-2">
                {PLATFORM_KEYS.map((key) => {
                  const { label, Mark } = PLATFORMS[key];
                  const active = coachPlatform === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setCoachPlatform(key)}
                      aria-pressed={active}
                      className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-bold transition ${
                        active
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-white/15 bg-white/[0.04] text-white/60 hover:border-white/30 hover:text-white"
                      }`}
                    >
                      <Mark className="h-4 w-4" />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("analyticsHub.aiCoach.nicheLabel", { defaultValue: "Your niche" })}
              </label>
              <input
                type="text"
                value={coachNiche}
                onChange={(e) => setCoachNiche(e.target.value)}
                placeholder={t("analyticsHub.aiCoach.nichePlaceholder", { defaultValue: "e.g. fitness comedy, real-estate tips…" })}
                maxLength={80}
                className={inputClass}
              />
            </div>
          </div>

          {/* post rows */}
          <p className="mb-2 mt-6 text-[11px] font-bold uppercase tracking-widest text-white/40">
            {t("analyticsHub.aiCoach.postsLabel", { defaultValue: "Your top posts" })}
          </p>
          <div className="space-y-3">
            {coachPosts.map((post, i) => (
              <div key={i} className="rounded-2xl border border-white/10 bg-black/50 p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-black text-primary">
                    {i + 1}
                  </span>
                  <input
                    type="text"
                    value={post.title}
                    onChange={(e) => updateCoachPost(i, { title: e.target.value })}
                    placeholder={t("analyticsHub.aiCoach.postTitlePlaceholder", { defaultValue: "Post title or what it was about…" })}
                    maxLength={120}
                    className={`${inputClass} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={() => setCoachPosts((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={t("analyticsHub.aiCoach.removePost", { defaultValue: "Remove post" })}
                    className="shrink-0 rounded-xl border border-white/10 p-2.5 text-white/50 transition hover:border-red-500/50 hover:text-red-300"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  <CoachNumberField
                    label={t("analyticsHub.aiCoach.views", { defaultValue: "Views" })}
                    value={post.views}
                    onChange={(v) => updateCoachPost(i, { views: v })}
                  />
                  <CoachNumberField
                    label={t("analyticsHub.aiCoach.likes", { defaultValue: "Likes" })}
                    value={post.likes}
                    onChange={(v) => updateCoachPost(i, { likes: v })}
                  />
                  <CoachNumberField
                    label={t("analyticsHub.aiCoach.comments", { defaultValue: "Comments" })}
                    value={post.comments}
                    onChange={(v) => updateCoachPost(i, { comments: v })}
                  />
                  <CoachNumberField
                    label={t("analyticsHub.aiCoach.shares", { defaultValue: "Shares" })}
                    value={post.shares}
                    onChange={(v) => updateCoachPost(i, { shares: v })}
                  />
                  <CoachNumberField
                    label={t("analyticsHub.aiCoach.watchTime", { defaultValue: "Avg. watch (sec)" })}
                    value={post.watchTimeSec}
                    onChange={(v) => updateCoachPost(i, { watchTimeSec: v })}
                  />
                  <div>
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-white/40">
                      {t("analyticsHub.aiCoach.postedOn", { defaultValue: "Posted on" })}
                    </label>
                    <input
                      type="date"
                      value={post.postedAt}
                      onChange={(e) => updateCoachPost(i, { postedAt: e.target.value })}
                      className={`${inputClass} [color-scheme:dark]`}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCoachPosts((prev) => [...prev, blankCoachPost()])}
              disabled={coachPosts.length >= MAX_COACH_POSTS}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-bold text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {t("analyticsHub.aiCoach.addPost", { defaultValue: "Add a post" })}
            </button>
            <button
              type="button"
              onClick={importCoachPostFromStats}
              disabled={coachPosts.length >= MAX_COACH_POSTS || hub[coachPlatform].stats.topPostViews <= 0}
              title={t("analyticsHub.aiCoach.importHint", {
                defaultValue: "Pulls your top-post views from the numbers above",
              })}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-bold text-white/70 transition hover:border-primary/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <BarChart3 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              {t("analyticsHub.aiCoach.importFromStats", {
                defaultValue: "Import top post from my stats",
              })}
              {hub[coachPlatform].stats.topPostViews > 0 && (
                <span className="text-primary">({fmt(hub[coachPlatform].stats.topPostViews)} {t("analyticsHub.views", { defaultValue: "views" })})</span>
              )}
            </button>
          </div>
          {coachPosts.length === 0 && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-white/40">
              <AlertTriangle className="h-4 w-4 text-amber-300/80" aria-hidden="true" />
              {t("analyticsHub.aiCoach.emptyHint", {
                defaultValue: "Add your best and worst posts — the contrast is what the coach reads.",
              })}
            </p>
          )}

          {/* ask button */}
          <div className="mt-8 text-center">
            {user ? (
              <button
                onClick={askAiCoach}
                disabled={coachLoading || coachPosts.length === 0}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {coachLoading ? (
                  <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                ) : (
                  <Lightbulb className="h-6 w-6" aria-hidden="true" />
                )}
                {coachLoading
                  ? t("analyticsHub.aiCoach.coaching", { defaultValue: "Coaching…" })
                  : t("analyticsHub.aiCoach.ask", { defaultValue: "Ask AI Coach" })}
              </button>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
              >
                <Lightbulb className="h-6 w-6" aria-hidden="true" />
                {t("analyticsHub.aiCoach.signIn", { defaultValue: "Sign in to ask the coach" })}
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
            )}
            <p className="mt-2.5 text-xs text-white/35">
              {t("analyticsHub.aiCoach.costNote", {
                defaultValue: "Costs 100 Visual Bucs per run",
              })}
              <CostBadge cost={COACH_COST} className="ml-2" />
            </p>
            {outOfCredits && (
              <div className="mx-auto mt-4 max-w-md">
                <OutOfCredits />
              </div>
            )}
            {coachError && !outOfCredits && (
              <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {coachError}
              </p>
            )}
          </div>

          {/* results */}
          {coachResult && (
            <div id="ai-coach-results" className="mt-8">
              {coachResult.insights && (
                <div className="rounded-2xl border border-primary/30 bg-primary/[0.06] p-6">
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                    <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("analyticsHub.aiCoach.readout", { defaultValue: "The coach's read" })}
                  </p>
                  <p className="text-[15px] leading-relaxed text-white/85">{coachResult.insights}</p>
                </div>
              )}

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                {coachResult.patterns && coachResult.patterns.length > 0 && (
                  <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-5">
                    <p className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-400">
                      <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("analyticsHub.aiCoach.patterns", { defaultValue: "What worked" })}
                    </p>
                    <ul className="space-y-2.5">
                      {coachResult.patterns.map((p, i) => (
                        <li key={`pattern-${i}`} className="flex items-start gap-2.5 text-sm leading-relaxed text-white/80">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {coachResult.mistakes && coachResult.mistakes.length > 0 && (
                  <div className="rounded-2xl border border-red-500/25 bg-red-500/[0.06] p-5">
                    <p className="mb-3 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-red-400">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("analyticsHub.aiCoach.mistakes", { defaultValue: "What flopped" })}
                    </p>
                    <ul className="space-y-2.5">
                      {coachResult.mistakes.map((m, i) => (
                        <li key={`mistake-${i}`} className="flex items-start gap-2.5 text-sm leading-relaxed text-white/80">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
                          {m}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {coachResult.nextSteps && coachResult.nextSteps.length > 0 && (
                <>
                  <p className="mb-3 mt-6 text-[11px] font-bold uppercase tracking-widest text-white/40">
                    {t("analyticsHub.aiCoach.nextSteps", { defaultValue: "Your next moves" })}
                  </p>
                  <div className="grid gap-3">
                    {coachResult.nextSteps.map((step, i) => (
                      <div
                        key={`step-${i}`}
                        className="flex items-start gap-3.5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-primary/40"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-black text-primary">
                          {i + 1}
                        </span>
                        <p className="pt-1 text-[15px] leading-relaxed text-white/90">{step}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {user && (
                <div className="mt-6 text-center">
                  <button
                    onClick={askAiCoach}
                    disabled={coachLoading}
                    className="inline-flex items-center gap-2 rounded-full border border-primary/40 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
                  >
                    {coachLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Lightbulb className="h-4 w-4" aria-hidden="true" />
                    )}
                    {t("analyticsHub.aiCoach.rerun", { defaultValue: "Ask again" })}
                    <CostBadge cost={COACH_COST} className="ml-1" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* cross-link */}
        <p className="relative mt-8 text-center text-sm text-white/40">
          {t("analyticsHub.crossLinkPrefix")}{" "}
          <Link href="/hooks" className="font-semibold text-primary hover:underline">
            {t("analyticsHub.hookStudio")}
          </Link>{" "}
          {t("analyticsHub.crossLinkSuffix")}
        </p>

        </>
        )}

        {/* ── COMPETITOR TRACKER ─────────────────────────────────── */}
        {hubTab === "competitor" && (
        <div className="relative mt-6 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Swords className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-xl font-bold">{t("analyticsHub.competitor.title")}</h2>
              <p className="text-sm text-white/45">{t("analyticsHub.competitor.subtitle")}</p>
            </div>
          </div>

          {/* input form */}
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("analyticsHub.competitor.nameLabel")}
              </label>
              <input
                type="text"
                value={compName}
                onChange={(e) => setCompName(e.target.value)}
                placeholder={t("analyticsHub.competitor.namePlaceholder")}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("analyticsHub.competitor.urlLabel")}
              </label>
              <input
                type="text"
                value={compUrl}
                onChange={(e) => setCompUrl(e.target.value)}
                placeholder={t("analyticsHub.competitor.urlPlaceholder")}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("analyticsHub.competitor.nicheLabel")}
              </label>
              <input
                type="text"
                value={compNiche}
                onChange={(e) => setCompNiche(e.target.value)}
                placeholder={t("analyticsHub.competitor.nichePlaceholder")}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("analyticsHub.competitor.notesLabel")}
              </label>
              <input
                type="text"
                value={compNotes}
                onChange={(e) => setCompNotes(e.target.value)}
                placeholder={t("analyticsHub.competitor.notesPlaceholder")}
                className={inputClass}
              />
            </div>
          </div>

          <div className="mt-8 text-center">
            {user ? (
              <button
                onClick={analyzeCompetitor}
                disabled={compLoading}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {compLoading ? (
                  <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                ) : (
                  <Swords className="h-6 w-6" aria-hidden="true" />
                )}
                {compLoading ? t("analyticsHub.competitor.analyzing") : t("analyticsHub.competitor.analyze")}
              </button>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
              >
                <Swords className="h-6 w-6" aria-hidden="true" />
                {t("analyticsHub.competitor.signIn")}
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
            )}
            <p className="mt-2.5 text-xs text-white/35">
              {t("analyticsHub.competitor.costNote", { cost: COMPETITOR_COST })}
            </p>
            {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
            {compError && !outOfCredits && (
              <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {compError}
              </p>
            )}
          </div>

          {/* results */}
          {compResult && compResult.takeaways && (
            <div id="competitor-results" className="mt-8">
              <div className="rounded-2xl border border-white/10 bg-black/60 p-6">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                  <Swords className="h-3.5 w-3.5" aria-hidden="true" /> {t("analyticsHub.competitor.resultsTitle")}
                </p>
                <h3 className="font-display text-2xl font-black text-white">{compResult.competitorName}</h3>
                {compResult.niche && <p className="mt-1 text-sm text-white/45">{compResult.niche}</p>}

                {/* posting cadence */}
                {compResult.postingCadence?.assessment && (
                  <div className="mt-4 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-3">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-primary/80">
                      {t("analyticsHub.competitor.cadenceTitle")}
                      {compResult.postingCadence.estimatedPostsPerWeek !== null &&
                        compResult.postingCadence.estimatedPostsPerWeek !== undefined && (
                          <span className="ml-2 text-white/60">
                            {t("analyticsHub.competitor.postsPerWeek", {
                              count: compResult.postingCadence.estimatedPostsPerWeek,
                            })}
                          </span>
                        )}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-white/85">
                      {compResult.postingCadence.assessment}
                    </p>
                  </div>
                )}

                {/* pillars + formats */}
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  {compResult.contentPillars && compResult.contentPillars.length > 0 && (
                    <div>
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">
                        {t("analyticsHub.competitor.pillarsTitle")}
                      </p>
                      <div className="space-y-2">
                        {compResult.contentPillars.map((p, i) => (
                          <div key={`pillar-${i}`} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                            <p className="text-sm font-bold text-white">{p.pillar}</p>
                            <p className="mt-0.5 text-[13px] leading-relaxed text-white/55">{p.whatTheyPost}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {compResult.topFormats && compResult.topFormats.length > 0 && (
                    <div>
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">
                        {t("analyticsHub.competitor.formatsTitle")}
                      </p>
                      <div className="space-y-2">
                        {compResult.topFormats.map((f, i) => (
                          <div key={`format-${i}`} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                            <p className="text-sm font-bold text-white">{f.format}</p>
                            <p className="mt-0.5 text-[13px] leading-relaxed text-white/55">{f.whyItWorks}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* strengths vs weaknesses */}
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  {compResult.strengths && compResult.strengths.length > 0 && (
                    <div>
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-emerald-400/80">
                        {t("analyticsHub.competitor.strengthsTitle")}
                      </p>
                      <ul className="space-y-1.5">
                        {compResult.strengths.map((s, i) => (
                          <li key={`str-${i}`} className="flex items-start gap-2 text-sm leading-relaxed text-white/75">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {compResult.weaknesses && compResult.weaknesses.length > 0 && (
                    <div>
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-amber-400/80">
                        {t("analyticsHub.competitor.weaknessesTitle")}
                      </p>
                      <ul className="space-y-1.5">
                        {compResult.weaknesses.map((w, i) => (
                          <li key={`weak-${i}`} className="flex items-start gap-2 text-sm leading-relaxed text-white/75">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
                            {w}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* opportunities — the gaps */}
              {compResult.opportunities && compResult.opportunities.length > 0 && (
                <>
                  <p className="mb-3 mt-6 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                    <Target className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("analyticsHub.competitor.opportunitiesTitle")}
                  </p>
                  <div className="grid gap-3">
                    {compResult.opportunities.map((o, i) => (
                      <div
                        key={`opp-${i}`}
                        className="rounded-2xl border border-primary/30 bg-primary/[0.06] p-4 transition hover:border-primary/60"
                      >
                        <p className="text-sm font-bold text-white">{o.gap}</p>
                        <p className="mt-1 text-sm leading-relaxed text-white/70">{o.howToExploit}</p>
                        <Link
                          href={`/hooks?topic=${encodeURIComponent(o.gap)}`}
                          className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
                        >
                          {t("analyticsHub.competitor.exploit")}
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </Link>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* takeaways */}
              <p className="mb-3 mt-6 text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("analyticsHub.competitor.takeawaysTitle")}
              </p>
              <div className="grid gap-3">
                {compResult.takeaways.map((take, i) => (
                  <div
                    key={`take-${i}`}
                    className="flex items-start gap-3.5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-primary/40"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-black text-primary">
                      {i + 1}
                    </span>
                    <p className="pt-1 text-[15px] leading-relaxed text-white/90">{take}</p>
                  </div>
                ))}
              </div>

              {/* handoff chain → next steps */}
              <p className="mb-3 mt-6 text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("analyticsHub.competitor.nextStepsTitle")}
              </p>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {[
                  { label: t("analyticsHub.competitor.actionIdeas"), hint: t("analyticsHub.competitor.actionIdeasHint"), href: "/hooks" },
                  { label: t("analyticsHub.competitor.actionCaptions"), hint: t("analyticsHub.competitor.actionCaptionsHint"), href: "/hooks?tab=captions" },
                  { label: t("analyticsHub.competitor.actionPreflight"), hint: t("analyticsHub.competitor.actionPreflightHint"), href: "/hooks?tab=preflight" },
                ].map((a) => (
                  <Link
                    key={a.href + a.label}
                    href={a.href}
                    className="group rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-primary/50"
                  >
                    <p className="flex items-center justify-between text-sm font-bold text-white">
                      {a.label}
                      <ArrowRight className="h-4 w-4 text-primary transition group-hover:translate-x-0.5" aria-hidden="true" />
                    </p>
                    <p className="mt-1 text-xs text-white/45">{a.hint}</p>
                  </Link>
                ))}
              </div>

              {compResult.disclaimer && (
                <p className="mt-6 text-center text-[11px] leading-relaxed text-white/30">
                  {compResult.disclaimer}
                </p>
              )}

              {user && (
                <div className="mt-6 text-center">
                  <button
                    onClick={analyzeCompetitor}
                    disabled={compLoading}
                    className="inline-flex items-center gap-2 rounded-full border border-primary/40 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
                  >
                    {compLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Swords className="h-4 w-4" aria-hidden="true" />
                    )}
                    {t("analyticsHub.competitor.rerun", { cost: COMPETITOR_COST })}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        )}

        {/* ── CONTENT INTELLIGENCE CHAIN ───────────────────────────────
            The guided 5-step flow: Validate Idea → Hook Lab → Niche Check →
            Competitor Gaps → Content Calendar → plan review. No new page,
            no new sidebar item — this tab is its only home. */}
        {hubTab === "intelligence" && (
          <div className="relative mt-10">
            <ContentIntelligenceChain initialHook={intelInitialHook || undefined} />
            {/* ── AI RETENTION DOCTOR ────────────────────────────────────
                The next step after the content plan: paste timestamped
                drop-off points, get a diagnosis + prescription per drop-off,
                and hand each fix to the tool that solves it (Hook Studio /
                Script Writer / video editor) or to the content calendar. */}
            <div className="mt-8">
              <RetentionDoctor />
            </div>
          </div>
        )}

        {/* ── CONTENT ID MONITOR ─────────────────────────────────────────
            YouTube Content ID opt-in management (DistroKid parity). Real
            claiming requires a CMS partnership we don't have yet — the
            component states that up front and never fakes a claim.
            No new page, no new sidebar item — this tab is its only home. */}
        {hubTab === "contentid" && (
          <ContentIdMonitor />
        )}

        {/* ── MILESTONE TRACKER ────────────────────────────────────────────
            DistroKid RIAA-monitoring parity: user-logged / CSV-imported
            stream counts per track + platform, award badges along the
            ladder, progress bars to the next award. HONESTY: no live
            Spotify sync exists — the component says so and never fakes
            numbers. No new page, no new sidebar item — this tab is its
            only home. */}
        {hubTab === "milestones" && (
          <MilestoneTracker />
        )}

        {/* ── CONNECTED ACCOUNTS ─────────────────────────────────────────
            Live connected-account stats (Instagram / TikTok / Facebook via
            /api/analytics/overview) plus the AI Insights + What-to-make-next
            layer (1cr each via /api/analytics/insights and
            /api/analytics/suggestions). Merged from the old /analytics page —
            no new page, no new sidebar item; this tab is its only home. */}
        {hubTab === "connected" && (
          <ConnectedAccountsTab />
        )}

        {/* ── CHANNEL AUDIT ──────────────────────────────────────────────
            AI channel audit (POST /api/channel-audit, 3 credits): grades 6
            dimensions A–F with fixes, an overall grade, and a top-3 priority
            list. Absorbed from /channel-audit — no new page, no new sidebar
            item; this tab is its only home. */}
        {hubTab === "channelAudit" && (
          <ChannelAuditPanel />
        )}

        {/* ── VIRALITY PRE-FLIGHT CHECK ──────────────────────────────────
            Deeper standalone scorecard for a post's viral readiness
            (POST /api/virality-check, 2 credits). Absorbed from
            /virality-check — no new page, no new sidebar item; this tab is
            its only home. */}
        {hubTab === "virality" && (
          <ViralityCheckPanel />
        )}
        {hubTab === "fandecoder" && (
          <FanDecoderSection />
        )}
      </main>


    </div>
  );
}
