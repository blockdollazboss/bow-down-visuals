import { useState } from "react";
import { Link } from "wouter";
import {
  DollarSign, Loader2, Sparkles, Handshake, FileDown,
  BadgeDollarSign, Package, ShieldCheck, Lightbulb, AlertTriangle,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Brand Deal Calculator ─────────────────────────────────────────────
   Know what to charge brands: AI-calculated fair rate ranges, per-post
   pricing, package deals, usage-rights guidance, and negotiation tips.
   POSTs to /api/brand-calculator/calculate at 2 credits per calculation
   on GPT-6 Sol. The printable rate card is pure client-side rendering —
   free with every calculation.
   Platform keys / content types must stay in sync with the backend route. */

type PlatformKey = "youtube" | "tiktok" | "instagram" | "twitch" | "x";
type ContentTypeKey =
  | "sponsored_post"
  | "video_integration"
  | "dedicated_video"
  | "story_set"
  | "livestream"
  | "ambassadorship";

const PLATFORM_OPTS: { key: PlatformKey; label: string; blurb: string }[] = [
  { key: "tiktok", label: "TikTok", blurb: "Short-form video" },
  { key: "instagram", label: "Instagram", blurb: "Reels & feed" },
  { key: "youtube", label: "YouTube", blurb: "Long-form & Shorts" },
  { key: "twitch", label: "Twitch", blurb: "Livestream" },
  { key: "x", label: "X (Twitter)", blurb: "Posts & video" },
];

const CONTENT_TYPE_OPTS: { key: ContentTypeKey; label: string; blurb: string }[] = [
  { key: "sponsored_post", label: "Sponsored post", blurb: "Single branded post" },
  { key: "video_integration", label: "Video integration", blurb: "60–90s brand segment" },
  { key: "dedicated_video", label: "Dedicated video", blurb: "Whole video about the brand" },
  { key: "story_set", label: "Story set", blurb: "3 story frames" },
  { key: "livestream", label: "Livestream segment", blurb: "Live brand shoutout" },
  { key: "ambassadorship", label: "Ambassadorship", blurb: "Monthly partnership" },
];

const NICHE_PRESETS = [
  "Music", "Gaming", "Comedy", "Fitness",
  "Beauty & Fashion", "Tech", "Education", "Lifestyle",
];

const CREDIT_COST = 2;

interface RateBreakdownItem {
  deliverable: string;
  low: number;
  high: number;
}

interface UsageRight {
  term: string;
  surcharge: string;
}

interface CalcResult {
  rateRange: { low: number; high: number; currency: string };
  perPost: number;
  package3: number;
  breakdown: RateBreakdownItem[];
  usageRights: UsageRight[];
  negotiationTips: string[];
  disclaimer: string;
}

interface CalcResponse {
  result?: CalcResult;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function fmtRange(low: number, high: number): string {
  return `${fmtMoney(low)} – ${fmtMoney(high)}`;
}

export default function BrandDealCalculator() {
  const { user, getAccessToken, refreshProfile } = useAuth();

  const [platform, setPlatform] = useState<PlatformKey>("tiktok");
  const [followers, setFollowers] = useState("");
  const [avgViews, setAvgViews] = useState("");
  const [engagementRate, setEngagementRate] = useState("");
  const [contentType, setContentType] = useState<ContentTypeKey>("dedicated_video");
  const [niche, setNiche] = useState("Music");
  const [customNiche, setCustomNiche] = useState("");

  const [result, setResult] = useState<CalcResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const digitsOnly = (v: string) => v.replace(/[^0-9]/g, "").slice(0, 10);

  async function calculate() {
    if (loading || !user) return;
    const followersNum = parseInt(followers || "0", 10) || 0;
    if (followersNum < 100) {
      setError("Enter at least 100 followers so the rates have something to run on.");
      return;
    }
    const finalNiche = (customNiche.trim() || niche).slice(0, 120);
    if (!finalNiche) {
      setError("Tell the calculator your niche first — that's what the rate math runs on.");
      return;
    }
    const avgViewsNum = parseInt(avgViews || "0", 10) || 0;
    const engagementNum = Math.max(0, Math.min(100, parseFloat(engagementRate) || 0));

    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/brand-calculator/calculate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          platform,
          followers: followersNum,
          avgViews: avgViewsNum,
          engagementRate: engagementNum,
          contentType,
          niche: finalNiche,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as CalcResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.result) {
        setError(data.error || data.message || "The calculator hiccupped — try again.");
        return;
      }
      setResult(data.result);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("rate-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch {
      setError("Network hiccup — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  /* Printable rate card — pure client-side window.print() with print CSS,
     the same honest pattern as the press-kit PDF. No server cost. */
  function downloadRateCard() {
    window.print();
  }

  const platformLabel = PLATFORM_OPTS.find((p) => p.key === platform)?.label ?? platform;
  const contentLabel = CONTENT_TYPE_OPTS.find((c) => c.key === contentType)?.label ?? contentType;

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <div className="mx-auto max-w-5xl px-5 pb-24 pt-12 md:px-8 md:pt-16">
        <Link href="/dashboard" className="mb-8 inline-flex items-center gap-2 text-sm text-white/40 transition hover:text-white">
          ← Back to Dashboard
        </Link>

        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-primary">
          <Handshake className="h-4 w-4" aria-hidden="true" />
          {CREDIT_COST} credits per calculation
        </div>
        <h1 className="text-4xl font-black tracking-tight md:text-5xl">
          Brand Deal <span className="bg-gradient-to-r from-[#f5d67b] to-primary bg-clip-text text-transparent">Calculator</span>
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-white/50">
          Stop guessing what to charge. Get a fair rate range, per-post pricing,
          package deals, and negotiation tips — built from industry benchmarks
          for your exact audience.
        </p>

        {/* ── INPUTS ─────────────────────────────────────────────────── */}
        <div className="relative mt-10 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          {/* platform */}
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
            Platform
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            {PLATFORM_OPTS.map((p) => {
              const selected = platform === p.key;
              return (
                <button
                  key={p.key}
                  onClick={() => setPlatform(p.key)}
                  className={`rounded-2xl border p-3 text-left transition ${
                    selected
                      ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                      : "border-white/10 bg-white/[0.03] hover:border-primary/40"
                  }`}
                >
                  <span className={`block text-sm font-bold ${selected ? "text-white" : "text-white/70"}`}>
                    {p.label}
                  </span>
                  <span className="block text-[11px] text-white/35">{p.blurb}</span>
                </button>
              );
            })}
          </div>

          {/* stats */}
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-3">
            <div>
              <label htmlFor="followers" className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                Followers
              </label>
              <input
                id="followers"
                value={followers}
                onChange={(e) => setFollowers(digitsOnly(e.target.value))}
                inputMode="numeric"
                placeholder="e.g. 50000"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="avgviews" className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                Avg views per post
              </label>
              <input
                id="avgviews"
                value={avgViews}
                onChange={(e) => setAvgViews(digitsOnly(e.target.value))}
                inputMode="numeric"
                placeholder="e.g. 25000"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="engagement" className="mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40">
                Engagement rate %
              </label>
              <input
                id="engagement"
                value={engagementRate}
                onChange={(e) => setEngagementRate(e.target.value.replace(/[^0-9.]/g, "").slice(0, 5))}
                inputMode="decimal"
                placeholder="e.g. 4.2"
                className={inputClass}
              />
            </div>
          </div>

          {/* content type */}
          <p className="mb-3 mt-8 text-[11px] font-bold uppercase tracking-widest text-white/40">
            Content type
          </p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {CONTENT_TYPE_OPTS.map((c) => {
              const selected = contentType === c.key;
              return (
                <button
                  key={c.key}
                  onClick={() => setContentType(c.key)}
                  className={`rounded-2xl border p-3.5 text-left transition ${
                    selected
                      ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                      : "border-white/10 bg-white/[0.03] hover:border-primary/40"
                  }`}
                >
                  <span className={`block text-sm font-bold ${selected ? "text-white" : "text-white/70"}`}>
                    {c.label}
                  </span>
                  <span className="block text-[11px] text-white/35">{c.blurb}</span>
                </button>
              );
            })}
          </div>

          {/* niche */}
          <p className="mb-3 mt-8 text-[11px] font-bold uppercase tracking-widest text-white/40">
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

          {/* CTA */}
          <div className="mt-8 text-center">
            {user ? (
              <button
                onClick={calculate}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                ) : (
                  <DollarSign className="h-6 w-6" aria-hidden="true" />
                )}
                {loading ? "Pricing your deal…" : "Calculate my rates"}
              </button>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
              >
                <Sparkles className="h-5 w-5" aria-hidden="true" />
                Sign in to calculate ({CREDIT_COST} credits)
              </Link>
            )}
          </div>
        </div>

        {outOfCredits && <div className="mt-6"><OutOfCredits /></div>}
        {error && (
          <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
            <p className="text-sm font-semibold text-red-300">{error}</p>
          </div>
        )}

        {/* ── RESULT ─────────────────────────────────────────────────── */}
        {result && (
          <div id="rate-result" className="mt-10">
            {/* rate card */}
            <div className="rate-card-print overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-b from-[#171207] to-black">
              <div className="border-b border-primary/20 p-6 md:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
                      Your rate card
                    </p>
                    <h2 className="mt-2 text-3xl font-black md:text-4xl">
                      {fmtRange(result.rateRange.low, result.rateRange.high)}
                    </h2>
                    <p className="mt-1 text-sm text-white/50">
                      {platformLabel} · {contentLabel} · {(customNiche.trim() || niche)}
                    </p>
                  </div>
                  <button
                    onClick={downloadRateCard}
                    className="no-print inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-5 py-3 text-sm font-bold text-primary transition hover:bg-primary hover:text-black"
                  >
                    <FileDown className="h-4 w-4" aria-hidden="true" />
                    Print / save rate card
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2 md:p-8">
                {/* per-post + package */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <BadgeDollarSign className="h-5 w-5 text-primary" aria-hidden="true" />
                    <h3 className="font-bold">Per-post pricing</h3>
                  </div>
                  <p className="text-2xl font-black text-primary">{fmtMoney(result.perPost)}</p>
                  <p className="mt-1 text-xs text-white/40">Recommended ask for 1× {contentLabel.toLowerCase()}</p>
                  <div className="mt-5 border-t border-white/10 pt-4">
                    <div className="mb-2 flex items-center gap-2">
                      <Package className="h-5 w-5 text-primary" aria-hidden="true" />
                      <h3 className="font-bold">3-post package</h3>
                    </div>
                    <p className="text-2xl font-black text-primary">{fmtMoney(result.package3)}</p>
                    <p className="mt-1 text-xs text-white/40">Bundle deal — volume discount baked in</p>
                  </div>
                </div>

                {/* breakdown */}
                {result.breakdown.length > 0 && (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <h3 className="mb-4 font-bold">Deliverable breakdown</h3>
                    <div className="space-y-3">
                      {result.breakdown.map((b, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 border-b border-white/5 pb-3 last:border-0 last:pb-0">
                          <span className="text-sm text-white/70">{b.deliverable}</span>
                          <span className="text-sm font-bold text-white">{fmtRange(b.low, b.high)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* usage rights */}
                {result.usageRights.length > 0 && (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="mb-4 flex items-center gap-2">
                      <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
                      <h3 className="font-bold">Usage rights</h3>
                    </div>
                    <div className="space-y-3">
                      {result.usageRights.map((u, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 border-b border-white/5 pb-3 last:border-0 last:pb-0">
                          <span className="text-sm text-white/70">{u.term}</span>
                          <span className="text-sm font-bold text-primary">{u.surcharge}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* negotiation tips */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-primary" aria-hidden="true" />
                    <h3 className="font-bold">Negotiation tips</h3>
                  </div>
                  <ul className="space-y-3">
                    {result.negotiationTips.map((t, i) => (
                      <li key={i} className="flex gap-2.5 text-sm text-white/70">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-black text-primary">
                          {i + 1}
                        </span>
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="flex gap-2.5 border-t border-primary/20 bg-primary/[0.04] p-5 md:px-8">
                <AlertTriangle className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <p className="text-xs leading-relaxed text-white/50">{result.disclaimer}</p>
              </div>
            </div>

            <div className="no-print mt-6 text-center">
              <button
                onClick={() => { setResult(null); }}
                className="text-sm font-semibold text-white/40 underline-offset-4 transition hover:text-white hover:underline"
              >
                Run a new calculation ({CREDIT_COST} credits)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Print CSS: only the rate card prints, no nav/footer/buttons. */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .rate-card-print, .rate-card-print * { visibility: visible; }
          .rate-card-print { position: absolute; left: 0; top: 0; width: 100%; border: none; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print">
        <SiteFooter />
      </div>
    </div>
  );
}
