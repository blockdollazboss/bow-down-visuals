import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Gauge, Loader2, Sparkles, ArrowRight, Clock, Hash, Type, Quote,
  Copy, Check, Zap, ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { PixelHeadline, PixelDivider, PixelSprite, CheatCodeName } from "@/components/pixel-headline";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── Virality Pre-Flight Check (/virality-check) ───────────────────────────
   Dedicated, deeper standalone scorecard for a post's viral READINESS —
   hook strength, caption, hashtags, and best posting time for the chosen
   platform. Honest framing: this is a readiness scorecard, never a virality
   guarantee — no AI can predict what actually blows up.
   POSTs to /api/virality-check at 2 credits per check on GPT-6 Sol. */

type PlatformKey = "tiktok" | "instagram" | "youtube" | "x";

const PLATFORMS: { key: PlatformKey; label: string }[] = [
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
  { key: "x", label: "X" },
];

const CREDIT_COST = 2;

interface ScoreBlock {
  score: number;
  feedback: string;
}

interface ViralityCheckResponse {
  overallScore?: number;
  hookStrength?: ScoreBlock;
  captionScore?: ScoreBlock;
  hashtagAnalysis?: ScoreBlock & { suggestedHashtags?: string[] };
  postingTime?: { bestTime: string; reason: string };
  fixes?: string[];
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

function scoreColor(score: number): string {
  if (score >= 75) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-red-400";
}

function scoreBar(score: number): string {
  if (score >= 75) return "from-emerald-500 to-emerald-300";
  if (score >= 50) return "from-amber-500 to-amber-300";
  return "from-red-500 to-red-300";
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

/* Animated SVG arc gauge: 0-100 score as a gold gradient semicircle. */
function GaugeArc({ score }: { score: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const duration = 1200;
    let frame: number;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(score * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [score]);

  const radius = 84;
  const circumference = Math.PI * radius; // semicircle
  const offset = circumference * (1 - display / 100);
  const color = display >= 75 ? "#34d399" : display >= 50 ? "#fbbf24" : "#f87171";

  return (
    <div className="relative mx-auto w-[240px]" aria-label={`Overall score: ${score} out of 100`}>
      <svg viewBox="0 0 200 116" className="w-full">
        <defs>
          <linearGradient id="virality-gauge-gold" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8a6d1f" />
            <stop offset="50%" stopColor="#d4af37" />
            <stop offset="100%" stopColor="#f5d67b" />
          </linearGradient>
        </defs>
        {/* track */}
        <path
          d="M 16 104 A 84 84 0 0 1 184 104"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        {/* value */}
        <path
          d="M 16 104 A 84 84 0 0 1 184 104"
          fill="none"
          stroke="url(#virality-gauge-gold)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.05s linear" }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <p className="font-display text-5xl font-black" style={{ color }}>
          {display}
          <span className="text-xl text-white/30">/100</span>
        </p>
        <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-white/40">
          Viral readiness
        </p>
      </div>
    </div>
  );
}

function ScoreCard({
  icon: Icon,
  label,
  block,
}: {
  icon: LucideIcon;
  label: string;
  block: ScoreBlock | undefined;
}) {
  if (!block) return null;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-bold text-white/90">
          <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
          {label}
        </p>
        <p className={`font-display text-2xl font-black ${scoreColor(block.score)}`}>
          {block.score}
        </p>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${scoreBar(block.score)}`}
          style={{ width: `${block.score}%` }}
        />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-white/60">{block.feedback}</p>
    </div>
  );
}

function CopyChip({ tag }: { tag: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`#${tag}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };
  return (
    <button
      onClick={copy}
      className="group flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary transition hover:bg-primary hover:text-black"
    >
      #{tag}
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
      )}
    </button>
  );
}

export default function ViralityCheck() {
  usePageTitle(
    "Virality Pre-Flight Check",
    "Score your post's viral readiness before you ship it — hook strength, caption, hashtags, and best posting time."
  );
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [platform, setPlatform] = useState<PlatformKey>("tiktok");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [hookLine, setHookLine] = useState("");
  const [result, setResult] = useState<ViralityCheckResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  async function authedPost(body: Record<string, unknown>) {
    const token = await getAccessToken();
    return confirmedFetch("/api/virality-check", {
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

  async function runCheck() {
    if (loading || !user) return;
    if (!caption.trim()) {
      setError("Drop in your caption first — that's the heart of the pre-flight.");
      return;
    }
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await authedPost({
        caption: caption.trim(),
        hashtags: hashtags.trim(),
        hookLine: hookLine.trim(),
        platform,
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = (await res.json().catch(() => ({}))) as ViralityCheckResponse;
      if (handlePaidFailure(res, data)) return;
      if (!res.ok || typeof data.overallScore !== "number" || !Array.isArray(data.fixes)) {
        throw new Error(data.message || data.error || "The check failed — try again.");
      }
      setResult(data);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("virality-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The check failed — try again.");
    } finally {
      setLoading(false);
    }
  }

  const hookScore = result?.hookStrength?.score ?? 100;

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
            <Gauge className="h-3 w-3" aria-hidden="true" /> <CheatCodeName possessive /> money tools
          </p>
          <div className="flex justify-center mb-5">
            <PixelSprite name="bolt" pixel={6} />
          </div>
          <PixelHeadline size="page" align="center">
            Virality Pre-Flight Check
          </PixelHeadline>
          <PixelDivider align="center" className="mt-5" />
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            A brutally honest readiness scorecard for your post — before you ship
            it. Not a virality guarantee: no AI can predict what blows up.
          </p>
        </div>

        {/* form card */}
        <div className="relative mt-10 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Gauge className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-xl font-bold">Pre-Flight Inspection</h2>
              <p className="text-sm text-white/45">Feed us your post packaging — get scored like a strategist would.</p>
            </div>
          </div>

          {/* platform picker */}
          <p className="mt-8 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
            Platform
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" role="radiogroup" aria-label="Platform">
            {PLATFORMS.map((p) => {
              const selected = p.key === platform;
              return (
                <button
                  key={p.key}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setPlatform(p.key)}
                  className={`rounded-xl border px-4 py-3 text-sm font-bold capitalize transition ${
                    selected
                      ? "border-primary bg-primary/15 text-primary shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                      : "border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* hook line */}
          <p className="mt-6 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
            Hook / first line <span className="normal-case tracking-normal text-white/25">(what viewers see or hear first)</span>
          </p>
          <input
            value={hookLine}
            onChange={(e) => setHookLine(e.target.value)}
            maxLength={300}
            placeholder={'e.g. "I spent $0 on promo and hit 1M views \u2014 here\u2019s how"'}
            className={inputClass}
          />

          {/* caption */}
          <p className="mt-6 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
            Caption
          </p>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="Paste the full caption you're about to post…"
            className={`${inputClass} resize-none`}
          />

          {/* hashtags */}
          <p className="mt-6 mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
            Hashtags <span className="normal-case tracking-normal text-white/25">(optional)</span>
          </p>
          <input
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            maxLength={500}
            placeholder="#newmusic #independentartist …"
            className={inputClass}
          />

          {/* submit */}
          <div className="mt-8 text-center">
            {user ? (
              <button
                onClick={runCheck}
                disabled={loading || !caption.trim()}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                ) : (
                  <Gauge className="h-6 w-6" aria-hidden="true" />
                )}
                {loading ? "Running pre-flight…" : `Run Pre-Flight Check (${CREDIT_COST} credits)`}
              </button>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
              >
                <Gauge className="h-6 w-6" aria-hidden="true" />
                Sign in to run the pre-flight
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
            )}
            <p className="mt-2.5 text-xs text-white/35">
              {CREDIT_COST} credits per scorecard · powered by GPT-6
            </p>
            {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
            {error && !outOfCredits && (
              <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </p>
            )}
          </div>

          {/* results */}
          {result && typeof result.overallScore === "number" && (
            <div id="virality-results" className="mt-10">
              {/* gauge */}
              <div className="rounded-2xl border border-white/10 bg-black/60 p-6 md:p-8">
                <GaugeArc score={result.overallScore} />
                <p className="mx-auto mt-6 max-w-md text-center text-xs italic text-white/30">
                  A readiness score, not a virality guarantee — no AI can predict what blows up.
                </p>
              </div>

              {/* score cards */}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <ScoreCard icon={Quote} label="Hook Strength" block={result.hookStrength} />
                <ScoreCard icon={Type} label="Caption" block={result.captionScore} />
                <ScoreCard icon={Hash} label="Hashtags" block={result.hashtagAnalysis} />
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                  <p className="flex items-center gap-2 text-sm font-bold text-white/90">
                    <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
                    Best Posting Time
                  </p>
                  <p className="mt-3 font-display text-2xl font-black text-primary">
                    {result.postingTime?.bestTime}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-white/60">
                    {result.postingTime?.reason}
                  </p>
                </div>
              </div>

              {/* suggested hashtags */}
              {result.hashtagAnalysis?.suggestedHashtags &&
                result.hashtagAnalysis.suggestedHashtags.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                        Suggested hashtags — tap to copy
                      </p>
                      <button
                        onClick={() =>
                          navigator.clipboard.writeText(
                            (result.hashtagAnalysis?.suggestedHashtags ?? [])
                              .map((t) => `#${t}`)
                              .join(" ")
                          )
                        }
                        className="text-xs font-semibold text-primary hover:underline"
                      >
                        Copy all
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {result.hashtagAnalysis.suggestedHashtags.map((tag, i) => (
                        <CopyChip key={`tag-${i}`} tag={tag} />
                      ))}
                    </div>
                  </div>
                )}

              {/* 3 fixes */}
              <div className="mt-4 rounded-2xl border border-primary/25 bg-primary/[0.05] p-5 md:p-6">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  3 fixes to boost your score
                </p>
                <ol className="mt-4 space-y-3">
                  {(result.fixes ?? []).map((fix, i) => (
                    <li key={`fix-${i}`} className="flex items-start gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-sm font-black text-primary">
                        {i + 1}
                      </span>
                      <p className="pt-1 text-[15px] leading-relaxed text-white/85">{fix}</p>
                    </li>
                  ))}
                </ol>
              </div>

              {/* send to Hook Studio when hook is weak */}
              {hookScore < 70 && (
                <Link
                  href="/hooks"
                  className="mt-4 flex items-center justify-between rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/15 to-transparent p-5 transition hover:border-primary/60"
                >
                  <div>
                    <p className="flex items-center gap-1.5 text-sm font-bold text-primary">
                      <Zap className="h-4 w-4" aria-hidden="true" />
                      Hook scored {hookScore}/100 — strengthen it
                    </p>
                    <p className="mt-1 text-sm text-white/55">
                      Send it to the Hook Studio generator to fix the weakest part of your post.
                    </p>
                  </div>
                  <ChevronRight className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
                </Link>
              )}

              {/* re-run */}
              {user && (
                <div className="mt-6 text-center">
                  <button
                    onClick={runCheck}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50"
                  >
                    <Gauge className="h-4 w-4" aria-hidden="true" />
                    Re-run check ({CREDIT_COST} credits)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* cross-link */}
        <p className="relative mt-8 text-center text-sm text-white/40">
          Need fresh hooks first? Ask{" "}
          <CheatCodeName /> 🦈{" "}
          in the chat bubble — or open{" "}
          <Link href="/hooks" className="font-semibold text-primary hover:underline">
            Hook Studio
          </Link>
          .
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
