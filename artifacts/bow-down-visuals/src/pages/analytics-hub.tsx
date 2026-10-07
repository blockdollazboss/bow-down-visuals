import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useTranslation } from "react-i18next";
import { usePageTitle } from "@/hooks/use-page-title";
import ContentIntelligenceChain from "@/components/analytics-hub/ContentIntelligenceChain";
import {
  BarChart, Bar, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Loader2, Sparkles, TrendingUp, Users, Eye, ChevronDown, Upload, Link2,
  Target, Crown, BarChart3, Pencil, CheckCircle2, AlertTriangle,
  ArrowRight, Music2, Swords,
} from "lucide-react";

/* ─── Cross-Platform Analytics Hub ──────────────────────────────────────
   The social dashboard: TikTok, Instagram, YouTube, X in one place.
   (Complements /analytics, which covers site-internal connected-account stats.)
   Tracking is free — only the AI Growth Plan (via /api/analytics-hub/insights)
   and the Competitor Tracker (via /api/competitor-analysis) cost credits
   (charge-before-generation + refund on failure handled server-side).
   All numbers live in localStorage (analytics-hub-v1) and start EMPTY —
   no fake seeded data, ever.

   Tabs: "dashboard" holds the original hub sections; "competitor" holds the
   Competitor Tracker panel. NO new page, NO new sidebar item — this file is
   the only home for competitor analysis. */

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

const FIELD_LABELS: { key: keyof PlatformStats; labelKey: string; hintKey: string; isPercent?: boolean }[] = [
  { key: "followers", labelKey: "analyticsHub.fields.followers", hintKey: "analyticsHub.fieldHints.followers" },
  { key: "views7d", labelKey: "analyticsHub.fields.views7d", hintKey: "analyticsHub.fieldHints.views7d" },
  { key: "views30d", labelKey: "analyticsHub.fields.views30d", hintKey: "analyticsHub.fieldHints.views30d" },
  { key: "engagementRate", labelKey: "analyticsHub.fields.engagementRate", hintKey: "analyticsHub.fieldHints.engagementRate", isPercent: true },
  { key: "topPostViews", labelKey: "analyticsHub.fields.topPostViews", hintKey: "analyticsHub.fieldHints.topPostViews" },
];

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
  const [hubTab, setHubTab] = useState<"dashboard" | "competitor" | "intelligence">("dashboard");
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

  /* Load persisted data once (client-side; SSR-free). Also honors
     deep-links: ?tab=intelligence opens the Content Intelligence chain,
     ?hook= prefills its Step 2. */
  useEffect(() => {
    setHub(loadState());
    setHydrated(true);
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("tab") === "intelligence") {
        setHubTab("intelligence");
        const hook = params.get("hook")?.trim().slice(0, 600);
        if (hook) setIntelInitialHook(hook);
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
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition ${
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
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition ${
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
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                hubTab === "intelligence"
                  ? "bg-primary text-black shadow-[0_2px_16px_rgba(212,175,55,0.4)]"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {t("analyticsHub.tabIntelligence")}
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
          </div>
        )}
      </main>


    </div>
  );
}
