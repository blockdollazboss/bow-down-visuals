import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Rocket, Loader2, Sparkles, ArrowRight, CheckCircle2, Circle,
  Disc3, Layers, Album, CalendarDays, ExternalLink, ListChecks,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { CheatCodeName } from "@/components/pixel-headline";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

/* ─── Release Checklist ─────────────────────────────────────────────────
   AI-powered song/album release planner. POSTs to /api/release-checklist
   at 2 credits per plan on GPT-6 Sol. The returned week-by-week task list
   is stored in localStorage so the artist can check items off over the
   coming weeks — task tracking itself is pure UI, so it's free.
   Tool hints from the model link out to real on-site tools. */

type ReleaseType = "single" | "ep" | "album";

interface ReleaseTypeOpt {
  key: ReleaseType;
  label: string;
  icon: LucideIcon;
  blurb: string;
}

const RELEASE_TYPE_OPTS: ReleaseTypeOpt[] = [
  { key: "single", label: "Single", icon: Disc3, blurb: "One track, one moment" },
  { key: "ep", label: "EP", icon: Layers, blurb: "3–6 tracks" },
  { key: "album", label: "Album", icon: Album, blurb: "7+ tracks, a era" },
];

const CREDIT_COST = 2;

interface PlanTask {
  title: string;
  detail: string;
  category: string;
  tool: string | null;
}

interface PlanWeek {
  label: string;
  tasks: PlanTask[];
}

interface ReleasePlan {
  weeks: PlanWeek[];
  summary: string;
  preSaveTip: string;
}

interface ReleaseResponse {
  plan?: ReleasePlan;
  creditsUsed?: number;
  creditsRemaining?: number;
  error?: string;
  message?: string;
}

/* Tool hint → on-site destination. Only known tools get links; anything
   else renders as plain text so a model hallucination never 404s. */
const TOOL_LINKS: Record<string, { path: string; label: string }> = {
  "playlist-pitcher": { path: "/playlist-pitch", label: "Open Playlist Pitcher" },
  "content-scheduler": { path: "/scheduler", label: "Open Content Scheduler" },
  "press-kit": { path: "/press-kit", label: "Open Press Kit Builder" },
  "cover-art": { path: "/cover-art", label: "Open Cover Art Generator" },
  "email-list": { path: "/email-list", label: "Open Email List Builder" },
};

const CATEGORY_STYLES: Record<string, string> = {
  distribution: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  playlist: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  social: "border-pink-500/40 bg-pink-500/10 text-pink-300",
  press: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  "pre-save": "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  email: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  creative: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300",
  "release-day": "border-primary/50 bg-primary/15 text-primary",
  "follow-up": "border-teal-500/40 bg-teal-500/10 text-teal-300",
};

function categoryBadge(category: string): string {
  return CATEGORY_STYLES[category] ?? "border-white/15 bg-white/[0.05] text-white/60";
}

/* localStorage: plans persist per release so check-offs survive reloads.
   Keyed by release type + title + date so different releases don't collide. */
function storageKey(releaseType: string, title: string, date: string): string {
  return `release-checklist:${releaseType}:${title.trim().toLowerCase().slice(0, 40)}:${date}`;
}

function defaultDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 28);
  return d.toISOString().slice(0, 10);
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

export default function ReleaseChecklist() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [releaseType, setReleaseType] = useState<ReleaseType>("single");
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [releaseDate, setReleaseDate] = useState(defaultDate);

  const [plan, setPlan] = useState<ReleasePlan | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const planKey = useMemo(
    () => (plan ? storageKey(releaseType, title, releaseDate) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan]
  );

  /* Restore a previously generated plan + check-offs on mount (same inputs). */
  useEffect(() => {
    if (!plan) return;
    try {
      const saved = localStorage.getItem(`${planKey}:plan`);
      if (saved) setPlan(JSON.parse(saved) as ReleasePlan);
      const done = localStorage.getItem(`${planKey}:done`);
      if (done) setChecked(JSON.parse(done) as Record<string, boolean>);
    } catch {
      /* corrupted storage — start fresh */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function persistPlan(nextPlan: ReleasePlan) {
    const key = storageKey(releaseType, title, releaseDate);
    try {
      localStorage.setItem(`${key}:plan`, JSON.stringify(nextPlan));
      localStorage.setItem(`${key}:done`, JSON.stringify({}));
    } catch {
      /* storage full/blocked — plan still works for this session */
    }
  }

  function toggleTask(weekIdx: number, taskIdx: number) {
    const id = `${weekIdx}:${taskIdx}`;
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (planKey) {
        try {
          localStorage.setItem(`${planKey}:done`, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }

  const totalTasks = plan?.weeks.reduce((n, w) => n + w.tasks.length, 0) ?? 0;
  const doneCount = Object.values(checked).filter(Boolean).length;
  const progress = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;

  async function buildPlan() {
    if (loading || !user) return;
    const finalTitle = title.trim().slice(0, 200);
    if (!finalTitle) {
      setError("Give your release a title first — the plan is built around it.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
      setError("Pick a release date so the checklist can count backwards from it.");
      return;
    }
    const ts = new Date(`${releaseDate}T00:00:00Z`).getTime();
    if (!Number.isFinite(ts) || ts <= Date.now()) {
      setError("Release date must be in the future — a checklist for the past helps nobody.");
      return;
    }

    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/release-checklist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        overrideCost: CREDIT_COST, // registry is stale at 1; backend + UI agree on 2
        overrideFeature: "Release Checklist AI",
        body: JSON.stringify({
          releaseType,
          title: finalTitle,
          genre: genre.trim().slice(0, 120),
          releaseDate,
        }),
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = (await res.json().catch(() => ({}))) as ReleaseResponse;
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !data.plan || !Array.isArray(data.plan.weeks) || data.plan.weeks.length === 0) {
        throw new Error(data.message || data.error || "Release plan failed — try again.");
      }
      setPlan(data.plan);
      setChecked({});
      persistPlan(data.plan);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("release-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Release plan failed — try again.");
    } finally {
      setLoading(false);
    }
  }

  function toolLink(tool: string | null): { path: string; label: string } | null {
    if (!tool) return null;
    const key = tool.trim().toLowerCase().replace(/^\/+/, "");
    return TOOL_LINKS[key] ?? null;
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
            <Rocket className="h-3 w-3" aria-hidden="true" /> <CheatCodeName possessive /> release tools
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            Release <span className="text-primary">Checklist</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            Drop day is won in the weeks before it. AI builds your
            week-by-week battle plan — distribution, playlists, teasers,
            press, pre-saves — then you check it off as you execute.
          </p>
        </div>

        {/* ── INPUTS ─────────────────────────────────────────────────── */}
        <div className="relative mt-10 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          {/* release type */}
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40">
            What are you dropping?
          </p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {RELEASE_TYPE_OPTS.map((opt) => {
              const Icon = opt.icon;
              const selected = releaseType === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => setReleaseType(opt.key)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    selected
                      ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                      : "border-white/10 bg-white/[0.03] hover:border-primary/40"
                  }`}
                >
                  <Icon className={`h-6 w-6 ${selected ? "text-primary" : "text-white/50"}`} aria-hidden="true" />
                  <span className={`mt-2 block text-sm font-bold ${selected ? "text-white" : "text-white/70"}`}>
                    {opt.label}
                  </span>
                  <span className="block text-[11px] text-white/35">{opt.blurb}</span>
                </button>
              );
            })}
          </div>

          {/* title + genre + date */}
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">
                Release title
              </p>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder="e.g. Bow Down Anthem"
                className={inputClass}
              />
            </div>
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">
                Genre / vibe <span className="font-normal normal-case text-white/30">(optional)</span>
              </p>
              <input
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                maxLength={120}
                placeholder="e.g. hip-hop, R&B…"
                className={inputClass}
              />
            </div>
          </div>
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">
              Release date
            </p>
            <input
              type="date"
              value={releaseDate}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setReleaseDate(e.target.value)}
              className={`${inputClass} max-w-[220px] [color-scheme:dark]`}
            />
          </div>

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
                  <ListChecks className="h-6 w-6" aria-hidden="true" />
                )}
                {loading ? "Building your battle plan…" : "Build my release plan"}
              </button>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
              >
                <ListChecks className="h-6 w-6" aria-hidden="true" />
                Sign in to build your release plan
                <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
            )}
            <p className="mt-2.5 text-xs text-white/35">
              {CREDIT_COST} credits per AI plan · checking off tasks is free · powered by GPT-6
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
        {plan && plan.weeks.length > 0 && (
          <div id="release-results" className="relative mt-8">
            {plan.summary && (
              <p className="mx-auto max-w-2xl text-center text-[15px] leading-relaxed text-white/70">
                {plan.summary}
              </p>
            )}

            {/* progress */}
            <div className="mt-6 rounded-2xl border border-primary/25 bg-primary/[0.06] p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-white">
                  {doneCount} of {totalTasks} tasks done
                </p>
                <p className="font-display text-2xl font-black text-primary">{progress}%</p>
              </div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#8a6d1f] via-primary to-[#f5d67b] transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* weeks */}
            {plan.weeks.map((week, wi) => {
              const weekDone = week.tasks.filter((_, ti) => checked[`${wi}:${ti}`]).length;
              return (
                <div key={`week-${wi}`} className="mt-8">
                  <p className="mb-3 flex items-center justify-between text-[11px] font-bold uppercase tracking-widest text-primary/80">
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                      {week.label}
                    </span>
                    <span className="text-white/35">
                      {weekDone}/{week.tasks.length}
                    </span>
                  </p>
                  <div className="grid gap-2.5">
                    {week.tasks.map((task, ti) => {
                      const id = `${wi}:${ti}`;
                      const done = !!checked[id];
                      const link = toolLink(task.tool);
                      return (
                        <div
                          key={id}
                          className={`rounded-2xl border p-4 transition ${
                            done
                              ? "border-emerald-500/25 bg-emerald-500/[0.05]"
                              : "border-white/10 bg-white/[0.03]"
                          }`}
                        >
                          <button
                            onClick={() => toggleTask(wi, ti)}
                            className="flex w-full items-start gap-3 text-left"
                          >
                            {done ? (
                              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" aria-hidden="true" />
                            ) : (
                              <Circle className="mt-0.5 h-5 w-5 shrink-0 text-white/25" aria-hidden="true" />
                            )}
                            <span className="flex-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className={`text-[15px] font-bold ${done ? "text-white/45 line-through" : "text-white"}`}>
                                  {task.title}
                                </span>
                                <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${categoryBadge(task.category)}`}>
                                  {task.category}
                                </span>
                              </span>
                              <span className={`mt-1 block text-sm leading-relaxed ${done ? "text-white/30" : "text-white/60"}`}>
                                {task.detail}
                              </span>
                            </span>
                          </button>
                          {link && !done && (
                            <Link
                              href={link.path}
                              className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3.5 py-1.5 text-xs font-bold text-primary transition hover:bg-primary hover:text-black"
                            >
                              {link.label}
                              <ExternalLink className="h-3 w-3" aria-hidden="true" />
                            </Link>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* pre-save tip */}
            {plan.preSaveTip && (
              <div className="mt-8 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-5">
                <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-300">
                  Pre-save power move
                </p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-white/85">{plan.preSaveTip}</p>
              </div>
            )}

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
                  Rebuild plan ({CREDIT_COST} credits)
                </button>
              </div>
            )}
          </div>
        )}

        {/* cross-links */}
        <p className="relative mt-8 text-center text-sm text-white/40">
          Executing your plan? Pitch playlists with the{" "}
          <Link href="/playlist-pitch" className="font-semibold text-primary hover:underline">
            Playlist Pitcher
          </Link>
          {" "}and schedule your teasers with the{" "}
          <Link href="/scheduler" className="font-semibold text-primary hover:underline">
            Content Scheduler
          </Link>
          .
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
