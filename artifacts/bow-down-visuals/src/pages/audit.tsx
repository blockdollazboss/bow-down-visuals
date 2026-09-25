import { useState } from "react";
import { Link } from "wouter";
import {
  ClipboardCheck, Loader2, Sparkles, ArrowRight, Wrench, AlertTriangle,
  Trophy, Target, Megaphone, PenLine, Gauge,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Channel Audit ────────────────────────────────────────────────────────
   AI channel audit: creator shares niche, handle, bio, cadence + recent
   posts → GPT-6 Sol grades 6 dimensions A–F with specific fixes, an overall
   grade, and a top-3 priority list. Quick actions link into the Hook Studio.
   POST /api/channel-audit at 3 credits, charge-before-generate with
   auto-refund on failure. Honest framing: best-practices scoring, never a
   growth guarantee. */

const CREDIT_COST = 3;

const PLATFORMS = [
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
  { key: "multi", label: "Multiple" },
] as const;
type PlatformKey = (typeof PLATFORMS)[number]["key"];

interface AuditDimension {
  key: string;
  label: string;
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  finding: string;
  fix: string;
  gradeColor: string;
}

interface QuickAction {
  label: string;
  href: string;
  hint: string;
}

interface AuditResponse {
  overallGrade?: "A" | "B" | "C" | "D" | "F";
  overallScore?: number;
  verdict?: string;
  disclaimer?: string;
  dimensions?: AuditDimension[];
  topPriorities?: string[];
  quickActions?: QuickAction[];
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

function overallGradeColor(grade: string): string {
  switch (grade) {
    case "A":
      return "text-emerald-400";
    case "B":
      return "text-lime-300";
    case "C":
      return "text-amber-400";
    case "D":
      return "text-orange-400";
    default:
      return "text-red-400";
  }
}

function overallGradeRing(grade: string): string {
  switch (grade) {
    case "A":
      return "border-emerald-400/40 bg-emerald-400/10";
    case "B":
      return "border-lime-300/40 bg-lime-300/10";
    case "C":
      return "border-amber-400/40 bg-amber-400/10";
    case "D":
      return "border-orange-400/40 bg-orange-400/10";
    default:
      return "border-red-400/40 bg-red-400/10";
  }
}

function scoreBar(score: number): string {
  if (score >= 75) return "from-emerald-500 to-emerald-300";
  if (score >= 50) return "from-amber-500 to-amber-300";
  return "from-red-500 to-red-300";
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const labelClass =
  "mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40";

export default function ChannelAudit() {
  const { user, getAccessToken, refreshProfile } = useAuth();

  const [niche, setNiche] = useState("");
  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState<PlatformKey>("multi");
  const [bio, setBio] = useState("");
  const [postsPerWeek, setPostsPerWeek] = useState("");
  const [recentPosts, setRecentPosts] = useState("");

  const [result, setResult] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const canSubmit = niche.trim().length >= 2 && !loading;

  async function runAudit() {
    if (!canSubmit || !user) return;
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setResult(null);
    try {
      const token = await getAccessToken();
      const posts = recentPosts
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .slice(0, 10);
      const res = await fetch("/api/channel-audit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          niche: niche.trim(),
          handle: handle.trim(),
          platform,
          bio: bio.trim(),
          postsPerWeek: postsPerWeek.trim(),
          recentPosts: posts,
        }),
      });
      const data = (await res.json()) as AuditResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || data.error) {
        throw new Error(data.message || data.error || "The audit failed — try again.");
      }
      setResult(data);
      refreshProfile();
      requestAnimationFrame(() => {
        document.getElementById("audit-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The audit failed — try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      <main className="mx-auto max-w-5xl px-5 pb-24 pt-12 md:px-8 md:pt-16">
        {/* ── Hero ── */}
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-primary">
            <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Channel Audit
          </span>
          <h1 className="mt-5 text-4xl font-black tracking-tight md:text-5xl">
            Get Your Channel <span className="text-primary">Graded</span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-white/55">
            AI grades your content on 6 dimensions — hooks, branding, captions, CTAs,
            consistency, and your bio — then hands you the exact fixes to level up.
          </p>
        </div>

        {/* ── Input form ── */}
        <div className="mt-10 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <p className={labelClass}>Your niche *</p>
              <input
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="e.g. luxury hip-hop, fitness coaching"
                className={inputClass}
              />
            </div>
            <div>
              <p className={labelClass}>Handle <span className="normal-case font-normal text-white/30">(optional)</span></p>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@yourhandle"
                className={inputClass}
              />
            </div>
          </div>

          <div className="mt-5">
            <p className={labelClass}>Primary platform</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PLATFORMS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPlatform(p.key)}
                  className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                    platform === p.key
                      ? "bg-primary text-black"
                      : "border border-white/10 bg-white/[0.04] text-white/60 hover:border-primary/40 hover:text-white"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <p className={labelClass}>Your bio <span className="normal-case font-normal text-white/30">(optional — paste it)</span></p>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Paste your current profile bio…"
              rows={2}
              className={inputClass}
            />
          </div>

          <div className="mt-5">
            <p className={labelClass}>Posting cadence <span className="normal-case font-normal text-white/30">(optional)</span></p>
            <input
              value={postsPerWeek}
              onChange={(e) => setPostsPerWeek(e.target.value)}
              placeholder="e.g. 3x per week, daily, whenever I feel like it"
              className={inputClass}
            />
          </div>

          <div className="mt-5">
            <p className={labelClass}>
              Recent posts <span className="normal-case font-normal text-white/30">(optional — up to 10, one per line: URL or paste the caption)</span>
            </p>
            <textarea
              value={recentPosts}
              onChange={(e) => setRecentPosts(e.target.value)}
              placeholder={"https://tiktok.com/@you/video/123…\nMy new single just dropped — link in bio 🔥"}
              rows={4}
              className={inputClass}
            />
          </div>

          {!user && (
            <p className="mt-6 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
              <AlertTriangle className="mr-1.5 inline h-4 w-4" aria-hidden="true" />
              <Link href="/login" className="font-semibold underline">Sign in</Link> to run an audit — it costs {CREDIT_COST} credits.
            </p>
          )}

          <button
            onClick={runAudit}
            disabled={!canSubmit || !user}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <><Loader2 className="h-5 w-5 animate-spin" /> Auditing your channel…</>
            ) : (
              <><Sparkles className="h-5 w-5" /> Run my audit — {CREDIT_COST} credits</>
            )}
          </button>

          {error && (
            <p className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          )}
          {outOfCredits && (
            <div className="mt-4">
              <OutOfCredits />
            </div>
          )}
        </div>

        {/* ── Results ── */}
        {result && (
          <div id="audit-results" className="mt-10 space-y-8">
            {/* Overall grade */}
            <div className={`overflow-hidden rounded-3xl border p-6 md:p-10 ${overallGradeRing(result.overallGrade ?? "C")}`}>
              <div className="flex flex-col items-center gap-6 md:flex-row md:gap-10">
                <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-full border-4 border-current bg-black/50">
                  <span className={`text-6xl font-black ${overallGradeColor(result.overallGrade ?? "C")}`}>
                    {result.overallGrade}
                  </span>
                </div>
                <div className="text-center md:text-left">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                    Overall channel grade · {result.overallScore}/100
                  </p>
                  <p className="mt-2 text-lg font-semibold leading-relaxed text-white/90">
                    “{result.verdict}”
                  </p>
                  <p className="mt-3 text-xs italic text-white/35">{result.disclaimer}</p>
                </div>
              </div>
            </div>

            {/* Dimension scorecards */}
            <div>
              <h2 className="flex items-center gap-2 text-xl font-bold">
                <Gauge className="h-5 w-5 text-primary" aria-hidden="true" />
                The Report Card
              </h2>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                {result.dimensions?.map((d) => (
                  <div
                    key={d.key}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-primary/40"
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold uppercase tracking-wider text-white/70">{d.label}</p>
                      <span className={`text-3xl font-black ${d.gradeColor}`}>{d.grade}</span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${scoreBar(d.score)} transition-all`}
                        style={{ width: `${d.score}%` }}
                      />
                    </div>
                    <p className="mt-3 text-sm text-white/70">{d.finding}</p>
                    <p className="mt-2 flex items-start gap-1.5 text-sm text-white/90">
                      <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span><span className="font-semibold text-primary">Fix: </span>{d.fix}</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Top priorities */}
            <div className="rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
              <h2 className="flex items-center gap-2 text-xl font-bold">
                <Target className="h-5 w-5 text-primary" aria-hidden="true" />
                Your Top 3 Priorities
              </h2>
              <div className="mt-5 space-y-4">
                {result.topPriorities?.map((p, i) => (
                  <div
                    key={`priority-${i}`}
                    className="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-base font-black text-primary">
                      {i + 1}
                    </span>
                    <p className="pt-1.5 text-[15px] leading-relaxed text-white/90">{p}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick actions */}
            <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8">
              <h2 className="flex items-center gap-2 text-xl font-bold">
                <Trophy className="h-5 w-5 text-primary" aria-hidden="true" />
                Fix It Now
              </h2>
              <p className="mt-1 text-sm text-white/45">Jump straight into the tools that fix what the audit found.</p>
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {result.quickActions?.map((a) => (
                  <Link
                    key={a.href}
                    href={a.href}
                    className="group flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-primary/50 hover:bg-primary/5"
                  >
                    <div>
                      <p className="font-bold text-white group-hover:text-primary">{a.label}</p>
                      <p className="mt-0.5 text-xs text-white/40">{a.hint}</p>
                    </div>
                    <ArrowRight className="h-5 w-5 shrink-0 text-white/30 transition group-hover:translate-x-1 group-hover:text-primary" aria-hidden="true" />
                  </Link>
                ))}
              </div>
              <p className="mt-5 flex items-center justify-center gap-2 text-xs text-white/30">
                <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />
                Want hooks rewritten for you? The Hook Studio does 5 scroll-stoppers per credit.
              </p>
            </div>
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
