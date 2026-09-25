import { useState } from "react";
import { Link } from "wouter";
import {
  DollarSign, TrendingUp, Loader2, Sparkles, ArrowRight, Target,
  Wallet, CalendarCheck, CheckCircle2, AlertTriangle,
  Play, Camera, Music2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── Thy Cheat Code's Monetization Coach ─────────────────────────────────
   The money end of the creator loop: eligibility tracking for each
   platform's monetization program, niche/platform earnings guidance, and
   3 prioritized money moves for the next 30 days. POSTs to
   /api/monetization-coach at 1 credit per plan on GPT-6 Sol.
   Platform keys must stay in sync with the backend route's PLATFORMS enum. */

type PlatformKey = "youtube" | "tiktok" | "instagram";

interface PlatformOpt {
  key: PlatformKey;
  label: string;
  icon: LucideIcon;
  blurb: string;
}

const PLATFORM_OPTS: PlatformOpt[] = [
  { key: "youtube", label: "YouTube", icon: Play, blurb: "Partner Program" },
  { key: "tiktok", label: "TikTok", icon: Music2, blurb: "Creator Rewards" },
  { key: "instagram", label: "Instagram", icon: Camera, blurb: "Bonuses & gifts" },
];

const NICHE_PRESETS = [
  "Music", "Gaming", "Comedy", "Fitness",
  "Beauty & Fashion", "Tech", "Education", "Lifestyle",
];

const CREDIT_COST = 1;

interface EligibilityItem {
  platform: string;
  program: string;
  threshold: string;
  progress: number;
  status: "eligible" | "close" | "building";
  nextStep: string;
}

interface Earnings {
  rpmNotes: string;
  bestFormat: string;
  bestCadence: string;
}

interface CoachResponse {
  eligibility?: EligibilityItem[];
  earnings?: Earnings;
  moneyMoves?: string[];
  note?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

function progressColor(p: number): string {
  if (p >= 90) return "text-emerald-400";
  if (p >= 40) return "text-amber-400";
  return "text-red-400";
}

function progressBar(p: number): string {
  if (p >= 90) return "from-emerald-500 to-emerald-300";
  if (p >= 40) return "from-amber-500 to-amber-300";
  return "from-red-500 to-red-300";
}

function statusBadge(status: EligibilityItem["status"]): { label: string; cls: string } {
  switch (status) {
    case "eligible":
      return { label: "Eligible", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" };
    case "close":
      return { label: "Almost there", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" };
    default:
      return { label: "Building", cls: "border-white/15 bg-white/[0.04] text-white/50" };
  }
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

export default function MonetizationCoach() {
  usePageTitle("Money Coach", "AI monetization coach — turn your content into revenue with a personalized money plan.");
  const { user, getAccessToken, refreshProfile } = useAuth();

  const [niche, setNiche] = useState("Music");
  const [customNiche, setCustomNiche] = useState("");
  const [platforms, setPlatforms] = useState<PlatformKey[]>(["youtube", "tiktok"]);
  const [followers, setFollowers] = useState<Record<PlatformKey, string>>({
    youtube: "",
    tiktok: "",
    instagram: "",
  });
  const [cadence, setCadence] = useState("3");

  const [plan, setPlan] = useState<CoachResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  function togglePlatform(key: PlatformKey) {
    setPlatforms((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    );
  }

  function setFollowerCount(key: PlatformKey, value: string) {
    const digits = value.replace(/[^0-9]/g, "").slice(0, 10);
    setFollowers((prev) => ({ ...prev, [key]: digits }));
  }

  async function buildPlan() {
    if (loading || !user) return;
    const finalNiche = (customNiche.trim() || niche).slice(0, 120);
    if (!finalNiche) {
      setError("Tell the coach your niche first — that's what the money math runs on.");
      return;
    }
    if (platforms.length === 0) {
      setError("Pick at least one platform to check eligibility for.");
      return;
    }
    const cadenceNum = Math.max(0, Math.min(100, parseInt(cadence, 10) || 0));

    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/monetization-coach", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          niche: finalNiche,
          platforms,
          followers: {
            youtube: parseInt(followers.youtube || "0", 10) || 0,
            tiktok: parseInt(followers.tiktok || "0", 10) || 0,
            instagram: parseInt(followers.instagram || "0", 10) || 0,
          },
          cadence: cadenceNum,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as CoachResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.eligibility) || data.eligibility.length === 0 || !Array.isArray(data.moneyMoves) || data.moneyMoves.length === 0) {
        throw new Error(data.message || data.error || "Money plan failed — try again.");
      }
      setPlan(data);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("coach-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Money plan failed — try again.");
    } finally {
      setLoading(false);
    }
  }

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
            <DollarSign className="h-3 w-3" aria-hidden="true" /> Thy Cheat Code's money tools
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            Monetization <span className="text-primary">Coach</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            The money end of the creator loop: where you stand on every
            monetization program, what your niche actually pays, and your
            next 3 money moves.
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
              const Icon = p.icon;
              const selected = platforms.includes(p.key);
              return (
                <div
                  key={p.key}
                  className={`rounded-2xl border p-3.5 transition ${
                    selected
                      ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                      : "border-white/10 bg-white/[0.03]"
                  }`}
                >
                  <button
                    onClick={() => togglePlatform(p.key)}
                    className="flex w-full items-center gap-2.5 text-left"
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-md border transition ${
                        selected ? "border-primary bg-primary text-black" : "border-white/25 text-transparent"
                      }`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <Icon className={`h-5 w-5 ${selected ? "text-primary" : "text-white/50"}`} aria-hidden="true" />
                    <span>
                      <span className={`block text-sm font-bold ${selected ? "text-white" : "text-white/70"}`}>
                        {p.label}
                      </span>
                      <span className="block text-[11px] text-white/35">{p.blurb}</span>
                    </span>
                  </button>
                  {selected && (
                    <input
                      value={followers[p.key]}
                      onChange={(e) => setFollowerCount(p.key, e.target.value)}
                      inputMode="numeric"
                      placeholder={p.key === "youtube" ? "Subscribers" : "Followers"}
                      aria-label={`${p.label} follower count`}
                      className={`${inputClass} mt-3 !py-2.5`}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* cadence */}
          <p className="mt-8 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
            Videos per week
          </p>
          <input
            value={cadence}
            onChange={(e) => setCadence(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
            inputMode="numeric"
            placeholder="3"
            aria-label="Videos per week"
            className={`${inputClass} max-w-[180px]`}
          />

          {/* CTA */}
          <div className="mt-8 text-center">
            {user ? (
              <button
                onClick={buildPlan}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                ) : (
                  <TrendingUp className="h-6 w-6" aria-hidden="true" />
                )}
                {loading ? "Crunching the numbers…" : "Build my money plan"}
              </button>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
              >
                <TrendingUp className="h-6 w-6" aria-hidden="true" />
                Sign in to build your money plan
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
            )}
            <p className="mt-2.5 text-xs text-white/35">
              {CREDIT_COST} credit per plan · powered by GPT-6
            </p>
            {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
            {error && !outOfCredits && (
              <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </p>
            )}
          </div>
        </div>

        {/* ── RESULTS ────────────────────────────────────────────────── */}
        {plan && plan.eligibility && plan.eligibility.length > 0 && (
          <div id="coach-results" className="relative mt-8">
            {/* eligibility */}
            <p className="mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
              <Target className="h-3.5 w-3.5" aria-hidden="true" /> Monetization eligibility
            </p>
            <div className="grid gap-3">
              {plan.eligibility.map((item, i) => {
                const badge = statusBadge(item.status);
                return (
                  <div
                    key={`elig-${i}`}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-base font-black text-white">{item.platform}</p>
                      <span className={`rounded-full border px-3 py-1 text-[11px] font-bold ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-white/55">{item.program}</p>
                    <p className="mt-1 text-xs text-white/40">Threshold: {item.threshold}</p>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`h-full rounded-full bg-gradient-to-r ${progressBar(item.progress)}`}
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      <p className={`font-display text-lg font-black ${progressColor(item.progress)}`}>
                        {item.progress}%
                      </p>
                    </div>
                    {item.nextStep && (
                      <p className="mt-3 text-sm leading-relaxed text-white/70">
                        <span className="font-semibold text-primary/90">Next: </span>
                        {item.nextStep}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* earnings */}
            {plan.earnings && (plan.earnings.rpmNotes || plan.earnings.bestFormat || plan.earnings.bestCadence) && (
              <>
                <p className="mb-4 mt-8 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                  <Wallet className="h-3.5 w-3.5" aria-hidden="true" /> What your niche pays
                </p>
                <div className="grid gap-3">
                  {plan.earnings.bestFormat && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">Earns most</p>
                      <p className="mt-1.5 text-[15px] leading-relaxed text-white/90">{plan.earnings.bestFormat}</p>
                    </div>
                  )}
                  {plan.earnings.rpmNotes && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">RPM ranges (estimates)</p>
                      <p className="mt-1.5 text-[15px] leading-relaxed text-white/90">{plan.earnings.rpmNotes}</p>
                    </div>
                  )}
                  {plan.earnings.bestCadence && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">Cadence</p>
                      <p className="mt-1.5 text-[15px] leading-relaxed text-white/90">{plan.earnings.bestCadence}</p>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* money moves */}
            {plan.moneyMoves && plan.moneyMoves.length > 0 && (
              <>
                <p className="mb-4 mt-8 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                  <CalendarCheck className="h-3.5 w-3.5" aria-hidden="true" /> Your next 3 money moves · 30 days
                </p>
                <div className="grid gap-3">
                  {plan.moneyMoves.map((move, i) => (
                    <div
                      key={`move-${i}`}
                      className="flex items-start gap-3.5 rounded-2xl border border-primary/25 bg-primary/[0.06] p-4 text-left"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-black text-primary">
                        {i + 1}
                      </span>
                      <p className="pt-1 text-[15px] leading-relaxed text-white/90">{move}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            <p className="mt-4 flex items-start justify-center gap-1.5 text-center text-xs italic text-white/30">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {plan.note || "Thresholds and RPMs are estimates as of 2026 — verify current program terms."}
            </p>

            {user && (
              <div className="mt-6 text-center">
                <button
                  onClick={buildPlan}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                  )}
                  Rebuild plan ({CREDIT_COST} credit)
                </button>
              </div>
            )}
          </div>
        )}

        {/* cross-link */}
        <p className="relative mt-8 text-center text-sm text-white/40">
          Plan in hand? Ask{" "}
          <span className="font-semibold text-primary">Thy Cheat Code 🦈</span>{" "}
          in the chat bubble to turn your money moves into this week's content.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
