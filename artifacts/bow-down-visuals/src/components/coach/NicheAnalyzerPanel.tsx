import { useState } from "react";
import { Link } from "wouter";
import {
  Loader2, Sparkles, Crosshair, Users, Trophy, Flame, Layers,
  CalendarRange, ArrowRight, CheckCircle2, AlertTriangle,
  Lightbulb, CalendarDays,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

/* ─── Niche Analyzer panel (mounted INSIDE the /coach page as a tab) ─────
   Deep niche intelligence: audience profile, underserved content gaps,
   ranked monetization paths, competition score, 5 starter content pillars,
   and a 30-day angle roadmap. POSTs to /api/analyze-niche at 150 VB.
   Handoffs (coach workflow only, no new pages):
   - inline idea validator for this niche (POST /api/validate-idea)
   - deep-link into the existing /content-calendar with ?niche= prefilled. */

type Platform = "tiktok" | "instagram" | "youtube" | "x" | "all";
type ExperienceLevel = "beginner" | "intermediate" | "advanced";

const PLATFORM_OPTS: { id: Platform; label: string }[] = [
  { id: "all", label: "All platforms" },
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "youtube", label: "YouTube" },
  { id: "x", label: "X / Twitter" },
];

const EXPERIENCE_OPTS: { id: ExperienceLevel; label: string }[] = [
  { id: "beginner", label: "Beginner (0–10k)" },
  { id: "intermediate", label: "Intermediate (10k–100k)" },
  { id: "advanced", label: "Advanced (100k+)" },
];

const IDEA_VALIDATOR_COST = 75;

interface AudienceProfile { demographics: string; interests: string[] }
interface ContentGap { angle: string; whyUnderserved: string; opportunity: string }
interface MonetizationPath { path: string; fitScore: number; why: string; firstStep: string }
interface ContentPillar { name: string; description: string; exampleIdeas: string[] }
interface RoadmapWeek { week: number; focus: string; angles: string[] }

interface NicheAnalysis {
  niche: string;
  targetPlatform: Platform;
  experienceLevel: ExperienceLevel;
  audienceProfile: AudienceProfile;
  contentGaps: ContentGap[];
  monetizationPaths: MonetizationPath[];
  competitionLevel: { score: number; label: string };
  contentPillars: ContentPillar[];
  roadmap30Day: RoadmapWeek[];
  summary: string;
}

interface AnalyzeResponse {
  analysis?: NicheAnalysis;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

interface ValidateResponse {
  verdict?: {
    verdict: "go" | "pivot" | "no-go";
    overallScore: number;
    summary: string;
  };
  error?: string;
  message?: string;
}

function competitionColor(score: number): string {
  if (score <= 25) return "text-emerald-400";
  if (score <= 45) return "text-lime-400";
  if (score <= 70) return "text-amber-400";
  return "text-red-400";
}

function competitionBar(score: number): string {
  if (score <= 25) return "from-emerald-500 to-emerald-300";
  if (score <= 45) return "from-lime-500 to-lime-300";
  if (score <= 70) return "from-amber-500 to-amber-300";
  return "from-red-500 to-red-300";
}

function verdictBadge(verdict: "go" | "pivot" | "no-go"): string {
  if (verdict === "go") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (verdict === "pivot") return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return "border-red-500/40 bg-red-500/10 text-red-300";
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const sectionTitle =
  "mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80";

export default function NicheAnalyzerPanel() {
  const { user, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [niche, setNiche] = useState("");
  const [platform, setPlatform] = useState<Platform>("all");
  const [experience, setExperience] = useState<ExperienceLevel>("beginner");

  const [analysis, setAnalysis] = useState<NicheAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  // inline idea-validator handoff
  const [idea, setIdea] = useState("");
  const [ideaPlatform, setIdeaPlatform] = useState<"tiktok" | "instagram" | "youtube" | "x">("tiktok");
  const [validating, setValidating] = useState(false);
  const [verdict, setVerdict] = useState<ValidateResponse["verdict"] | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);

  async function analyze() {
    if (loading || !user) return;
    const finalNiche = niche.trim().slice(0, 120);
    if (finalNiche.length < 2) {
      setError("Enter a niche first — e.g. fitness, indie music production, skincare.");
      return;
    }
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setVerdict(null);
    try {
      const res = await confirmedFetch("/api/analyze-niche", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: finalNiche,
          targetPlatform: platform,
          experienceLevel: experience,
        }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as AnalyzeResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.analysis || !data.analysis.contentPillars?.length) {
        throw new Error(data.message || data.error || "Niche analysis failed. Try again.");
      }
      setAnalysis(data.analysis);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("niche-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Niche analysis failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function validateIdea() {
    if (validating || !user || !analysis) return;
    const finalIdea = idea.trim().slice(0, 500);
    if (finalIdea.length < 5) {
      setValidateError("Describe the idea in at least 5 characters.");
      return;
    }
    setValidating(true);
    setValidateError(null);
    try {
      const res = await confirmedFetch("/api/validate-idea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea: finalIdea,
          niche: analysis.niche,
          platform: ideaPlatform,
          targetAudience: "",
        }),
        overrideCost: IDEA_VALIDATOR_COST,
        overrideFeature: "Idea Validator",
      });
      if (!res) return;
      const data = (await res.json().catch(() => ({}))) as ValidateResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.verdict) {
        throw new Error(data.message || data.error || "Idea validation failed. Try again.");
      }
      setVerdict(data.verdict);
      refreshProfile();
    } catch (err) {
      setValidateError(err instanceof Error ? err.message : "Idea validation failed. Try again.");
    } finally {
      setValidating(false);
    }
  }

  return (
    <div className="relative mt-10 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
      {/* inputs */}
      <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
        The niche to dissect
      </p>
      <input
        value={niche}
        onChange={(e) => setNiche(e.target.value)}
        maxLength={120}
        placeholder="e.g. fitness, indie music production, skincare, true crime…"
        className={inputClass}
      />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">
            Target platform
          </p>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as Platform)}
            className={`${inputClass} appearance-none`}
          >
            {PLATFORM_OPTS.map((o) => (
              <option key={o.id} value={o.id} className="bg-black">{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">
            Experience level
          </p>
          <select
            value={experience}
            onChange={(e) => setExperience(e.target.value as ExperienceLevel)}
            className={`${inputClass} appearance-none`}
          >
            {EXPERIENCE_OPTS.map((o) => (
              <option key={o.id} value={o.id} className="bg-black">{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-8 text-center">
        {user ? (
          <button
            onClick={analyze}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
            ) : (
              <Crosshair className="h-6 w-6" aria-hidden="true" />
            )}
            {loading ? "Dissecting your niche…" : "Analyze My Niche"}
          </button>
        ) : (
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
          >
            <Crosshair className="h-6 w-6" aria-hidden="true" />
            Sign in to analyze
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </Link>
        )}
        <p className="mt-2.5 text-xs text-white/35">150 Visual Bucs per analysis</p>
        {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
        {error && !outOfCredits && (
          <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        )}
      </div>

      {/* results */}
      {analysis && (
        <div id="niche-results" className="mt-10">
          <p className="text-center text-xl font-black text-white">
            {analysis.niche}
          </p>
          <p className="mx-auto mt-2 max-w-2xl text-center text-[15px] leading-relaxed text-white/70">
            {analysis.summary}
          </p>

          {/* audience + competition */}
          <div className="mt-8 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className={`${sectionTitle} !mb-2`}>
                <Users className="h-3.5 w-3.5" aria-hidden="true" /> Audience profile
              </p>
              <p className="text-[15px] leading-relaxed text-white/85">{analysis.audienceProfile.demographics}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {analysis.audienceProfile.interests.map((interest, i) => (
                  <span
                    key={i}
                    className="rounded-full border border-primary/30 bg-primary/[0.08] px-3 py-1 text-xs font-semibold text-primary"
                  >
                    {interest}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <p className={`${sectionTitle} !mb-2`}>
                <Trophy className="h-3.5 w-3.5" aria-hidden="true" /> Competition level
              </p>
              <div className="mt-4 flex items-center gap-3">
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${competitionBar(analysis.competitionLevel.score)}`}
                    style={{ width: `${analysis.competitionLevel.score}%` }}
                  />
                </div>
                <p className={`font-display text-2xl font-black ${competitionColor(analysis.competitionLevel.score)}`}>
                  {analysis.competitionLevel.score}
                </p>
              </div>
              <p className="mt-2 text-sm font-bold text-white/70">
                {analysis.competitionLevel.label}
                <span className="ml-2 font-normal text-white/40">— lower = more room to win</span>
              </p>
            </div>
          </div>

          {/* content gaps */}
          <p className={`${sectionTitle} mt-8`}>
            <Flame className="h-3.5 w-3.5" aria-hidden="true" /> Content gaps — underserved angles
          </p>
          <div className="grid gap-3">
            {analysis.contentGaps.map((gap, i) => (
              <div key={`gap-${i}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <p className="text-[15px] font-black text-white">{gap.angle}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-white/55">
                  <span className="font-semibold text-white/70">Why it&apos;s underserved: </span>
                  {gap.whyUnderserved}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-white/55">
                  <span className="font-semibold text-primary/90">Your opening: </span>
                  {gap.opportunity}
                </p>
              </div>
            ))}
          </div>

          {/* monetization paths */}
          <p className={`${sectionTitle} mt-8`}>
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Monetization paths — ranked by fit
          </p>
          <div className="grid gap-3">
            {analysis.monetizationPaths.map((path, i) => (
              <div key={`path-${i}`} className="flex items-start gap-3.5 rounded-2xl border border-primary/25 bg-primary/[0.06] p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-black text-primary">
                  {i + 1}
                </span>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[15px] font-black text-white">{path.path}</p>
                    <span className={`font-display text-lg font-black ${competitionColor(100 - path.fitScore)}`}>
                      {path.fitScore}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-white/55">{path.why}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/70">
                    <span className="font-semibold text-primary/90">First step: </span>
                    {path.firstStep}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* content pillars */}
          <p className={`${sectionTitle} mt-8`}>
            <Layers className="h-3.5 w-3.5" aria-hidden="true" /> 5 starter content pillars
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {analysis.contentPillars.map((pillar, i) => (
              <div key={`pillar-${i}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <p className="text-[15px] font-black text-white">
                  <span className="mr-2 text-primary">{i + 1}.</span>
                  {pillar.name}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-white/55">{pillar.description}</p>
                {pillar.exampleIdeas.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {pillar.exampleIdeas.map((ideaItem, j) => (
                      <li key={j} className="flex items-start gap-1.5 text-[13px] text-white/65">
                        <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-primary/70" aria-hidden="true" />
                        {ideaItem}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {/* 30-day roadmap */}
          <p className={`${sectionTitle} mt-8`}>
            <CalendarRange className="h-3.5 w-3.5" aria-hidden="true" /> 30-day angle roadmap
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {analysis.roadmap30Day.map((week) => (
              <div key={`week-${week.week}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                  Week {week.week}
                </p>
                <p className="mt-1 text-[15px] font-black text-white">{week.focus}</p>
                <ul className="mt-2 space-y-1.5">
                  {week.angles.map((angle, j) => (
                    <li key={j} className="flex items-start gap-1.5 text-sm text-white/65">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden="true" />
                      {angle}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* handoffs — coach workflow only, no new pages */}
          <p className={`${sectionTitle} mt-10`}>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /> Next moves
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {/* idea validator handoff */}
            <div className="rounded-2xl border border-primary/25 bg-primary/[0.06] p-5">
              <p className="flex items-center gap-1.5 text-[15px] font-black text-white">
                <Lightbulb className="h-4 w-4 text-primary" aria-hidden="true" />
                Validate an idea in this niche
              </p>
              <p className="mt-1 text-xs text-white/45">
                Niche locked to “{analysis.niche}” — 75 Visual Bucs per check
              </p>
              <input
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                maxLength={500}
                placeholder="Your raw idea — e.g. ranking my beats from worst to best"
                className={`${inputClass} mt-3`}
              />
              <div className="mt-3 flex items-center gap-2">
                <select
                  value={ideaPlatform}
                  onChange={(e) => setIdeaPlatform(e.target.value as typeof ideaPlatform)}
                  className="rounded-xl border border-white/10 bg-black/60 px-3 py-2.5 text-sm text-white outline-none focus:border-primary/60"
                  aria-label="Platform for idea validation"
                >
                  <option value="tiktok" className="bg-black">TikTok</option>
                  <option value="instagram" className="bg-black">Instagram</option>
                  <option value="youtube" className="bg-black">YouTube</option>
                  <option value="x" className="bg-black">X / Twitter</option>
                </select>
                <button
                  onClick={validateIdea}
                  disabled={validating}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50"
                >
                  {validating ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  {validating ? "Validating…" : "Validate idea"}
                </button>
              </div>
              {validateError && (
                <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
                  {validateError}
                </p>
              )}
              {verdict && (
                <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-widest ${verdictBadge(verdict.verdict)}`}>
                      {verdict.verdict}
                    </span>
                    <span className="font-display text-xl font-black text-white">{verdict.overallScore}</span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-white/70">{verdict.summary}</p>
                </div>
              )}
            </div>

            {/* content calendar handoff */}
            <div className="flex flex-col rounded-2xl border border-primary/25 bg-primary/[0.06] p-5">
              <p className="flex items-center gap-1.5 text-[15px] font-black text-white">
                <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
                Build a content calendar
              </p>
              <p className="mt-2 text-sm leading-relaxed text-white/55">
                Turn the pillars and the 30-day roadmap above into a day-by-day posting
                calendar with concepts, hooks, and best posting times — the niche
                carries over automatically.
              </p>
              <div className="mt-auto pt-4">
                <Link
                  href={`/content-calendar?niche=${encodeURIComponent(analysis.niche)}`}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-3 text-sm font-black text-black transition hover:brightness-110"
                >
                  Build my calendar
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>

          <p className="mt-4 flex items-start justify-center gap-1.5 text-center text-xs italic text-white/30">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            AI-generated market read — directional, not a guarantee. Test angles with real posts before investing heavy production.
          </p>
        </div>
      )}
    </div>
  );
}
