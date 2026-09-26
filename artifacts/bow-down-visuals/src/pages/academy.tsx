import { useEffect, useMemo, useState } from "react";
import { PixelShark } from "@/components/PixelShark";
import { Link } from "wouter";
import {
  GraduationCap, Sparkles, Loader2, ArrowRight, ArrowLeft, Clock,
  CheckCircle2, Circle, Play, MessageCircleQuestion, Send, Lightbulb,
  CalendarDays, Target, BookOpen, ChevronRight, Zap,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  ACADEMY_COURSES,
  getAcademyCourse,
  type AcademyCourse,
  type AcademyLevel,
} from "@/lib/academy-courses";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── Creator Academy ─────────────────────────────────────────────────────
   The education hub for creators: a free-to-browse course catalog with
   AI-powered learning (every AI call costs 1 credit):
   - AI learning path generator (goals/niche/level → personalized path)
   - AI-generated lesson content on demand (1 credit/lesson)
   - "Ask the coach" Q&A per course (1 credit/answer)
   Progress is tracked in localStorage for v1. */

const CREDIT_COST = 1;
const PROGRESS_KEY = "academy-progress-v1";
const LESSON_CACHE_KEY = "academy-lessons-v1";

type ProgressMap = Record<string, Record<string, boolean>>;
type LessonCache = Record<string, GeneratedLesson>;

interface PathItem {
  courseId: string;
  title: string;
  why: string;
  order: number;
}

interface LearningPath {
  path: PathItem[];
  weeklyPlan: string[];
  firstStep: string;
  creditsRemaining?: number;
}

interface LessonSection {
  heading: string;
  body: string;
}

interface GeneratedLesson {
  courseId: string;
  courseTitle: string;
  lessonId: string;
  title: string;
  minutes: number;
  sections: LessonSection[];
  takeaways: string[];
  actionStep: string;
}

interface CoachMessage {
  role: "user" | "coach";
  text: string;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — progress just won't persist */
  }
}

const LEVEL_META: Record<AcademyLevel, { label: string; cls: string }> = {
  beginner: { label: "Beginner", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  intermediate: { label: "Intermediate", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  advanced: { label: "Advanced", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
};

const PLATFORM_OPTS = [
  { key: "youtube", label: "YouTube" },
  { key: "tiktok", label: "TikTok" },
  { key: "instagram", label: "Instagram" },
  { key: "twitch", label: "Twitch" },
  { key: "x", label: "X" },
];

const LEVEL_OPTS: { key: AcademyLevel; label: string; blurb: string }[] = [
  { key: "beginner", label: "Beginner", blurb: "Just starting out" },
  { key: "intermediate", label: "Intermediate", blurb: "Posting already, want growth" },
  { key: "advanced", label: "Advanced", blurb: "Scaling like a studio" },
];

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

async function postAcademy<T>(path: string, body: unknown, token: string | null): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (res.status === 402 || data.error === "out_of_credits") {
    throw new Error("__OUT_OF_CREDITS__");
  }
  if (!res.ok) {
    throw new Error(data.message || data.error || "Request failed — try again.");
  }
  return data;
}

export default function CreatorAcademy() {
  usePageTitle("Creator Academy", "Free courses and tutorials to grow as a content creator — video, music, and branding masterclasses.");
  const { user, getAccessToken, refreshProfile } = useAuth();

  /* navigation: catalog → course detail */
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const selectedCourse = selectedCourseId ? getAcademyCourse(selectedCourseId) ?? null : null;

  /* progress + cached lessons */
  const [progress, setProgress] = useState<ProgressMap>(() => loadJson(PROGRESS_KEY, {}));
  const [lessonCache, setLessonCache] = useState<LessonCache>(() => loadJson(LESSON_CACHE_KEY, {}));

  useEffect(() => { saveJson(PROGRESS_KEY, progress); }, [progress]);
  useEffect(() => { saveJson(LESSON_CACHE_KEY, lessonCache); }, [lessonCache]);

  /* learning path generator */
  const [goals, setGoals] = useState("");
  const [niche, setNiche] = useState("Music");
  const [level, setLevel] = useState<AcademyLevel>("beginner");
  const [platforms, setPlatforms] = useState<string[]>(["tiktok", "youtube"]);
  const [hours, setHours] = useState("5");
  const [learningPath, setLearningPath] = useState<LearningPath | null>(null);
  const [pathLoading, setPathLoading] = useState(false);

  /* lesson generation */
  const [activeLessonKey, setActiveLessonKey] = useState<string | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);

  /* ask the coach */
  const [coachThreads, setCoachThreads] = useState<Record<string, CoachMessage[]>>({});
  const [coachInput, setCoachInput] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);

  /* shared */
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  function handleOutOfCredits() {
    setOutOfCredits(true);
    refreshProfile();
  }

  function handleError(err: unknown) {
    if (err instanceof Error && err.message === "__OUT_OF_CREDITS__") {
      handleOutOfCredits();
    } else {
      setError(err instanceof Error ? err.message : "Something went wrong — try again.");
    }
  }

  function togglePlatform(key: string) {
    setPlatforms((prev) => (prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]));
  }

  /* ── AI learning path ─────────────────────────────────────────────── */
  async function buildLearningPath() {
    if (pathLoading || !user) return;
    if (goals.trim().length < 4) {
      setError("Tell the academy your goal first — that's what your path is built on.");
      return;
    }
    if (platforms.length === 0) {
      setError("Pick at least one platform.");
      return;
    }
    setPathLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const token = await getAccessToken();
      const data = await postAcademy<LearningPath>("/api/academy/learning-path", {
        goals: goals.trim().slice(0, 500),
        niche: niche.trim().slice(0, 120) || "General",
        level,
        platforms,
        hoursPerWeek: Math.max(1, Math.min(80, parseInt(hours, 10) || 5)),
      }, token);
      if (!data.path || data.path.length === 0 || !data.firstStep) {
        throw new Error("Learning path came back empty — try again.");
      }
      setLearningPath(data);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("learning-path-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      handleError(err);
    } finally {
      setPathLoading(false);
    }
  }

  /* ── AI lesson content ────────────────────────────────────────────── */
  async function openLesson(course: AcademyCourse, lessonId: string) {
    const key = `${course.id}:${lessonId}`;
    setActiveLessonKey(key);
    setError(null);
    setOutOfCredits(false);
    if (lessonCache[key]) return; /* already generated — free re-read */
    if (!user) return;
    setLessonLoading(true);
    try {
      const token = await getAccessToken();
      const data = await postAcademy<{ lesson: GeneratedLesson }>("/api/academy/lesson", {
        courseId: course.id,
        lessonId,
      }, token);
      if (!data.lesson || !data.lesson.sections?.length) {
        throw new Error("Lesson came back empty — try again.");
      }
      setLessonCache((prev) => ({ ...prev, [key]: data.lesson }));
      refreshProfile();
    } catch (err) {
      handleError(err);
    } finally {
      setLessonLoading(false);
    }
  }

  function markLessonDone(courseId: string, lessonId: string, done: boolean) {
    setProgress((prev) => ({
      ...prev,
      [courseId]: { ...(prev[courseId] ?? {}), [lessonId]: done },
    }));
  }

  /* ── Ask the coach ────────────────────────────────────────────────── */
  async function askCoach(course: AcademyCourse) {
    if (coachLoading || !user) return;
    const question = coachInput.trim();
    if (question.length < 4) {
      setError("Ask a real question — the coach needs something to work with.");
      return;
    }
    setCoachLoading(true);
    setError(null);
    setOutOfCredits(false);
    const thread = coachThreads[course.id] ?? [];
    setCoachThreads((prev) => ({ ...prev, [course.id]: [...thread, { role: "user", text: question }] }));
    setCoachInput("");
    try {
      const token = await getAccessToken();
      const data = await postAcademy<{ answer: string }>("/api/academy/ask", {
        courseId: course.id,
        question: question.slice(0, 1000),
      }, token);
      if (!data.answer) throw new Error("The coach came back empty — try again.");
      setCoachThreads((prev) => ({
        ...prev,
        [course.id]: [...(prev[course.id] ?? []), { role: "coach", text: data.answer }],
      }));
      refreshProfile();
    } catch (err) {
      handleError(err);
    } finally {
      setCoachLoading(false);
    }
  }

  const activeLesson: GeneratedLesson | null = activeLessonKey ? lessonCache[activeLessonKey] ?? null : null;

  const courseProgress = useMemo(() => {
    const out: Record<string, { done: number; total: number }> = {};
    for (const c of ACADEMY_COURSES) {
      const done = c.lessons.filter((l) => progress[c.id]?.[l.id]).length;
      out[c.id] = { done, total: c.lessons.length };
    }
    return out;
  }, [progress]);

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      <main className="relative mx-auto max-w-5xl px-5 pb-24 pt-14 md:pt-20">
        {/* glow */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {selectedCourse ? (
          <CourseDetail
            course={selectedCourse}
            progress={progress[selectedCourse.id] ?? {}}
            lessonCache={lessonCache}
            activeLesson={activeLesson}
            activeLessonKey={activeLessonKey}
            lessonLoading={lessonLoading}
            coachThreads={coachThreads[selectedCourse.id] ?? []}
            coachInput={coachInput}
            coachLoading={coachLoading}
            user={user}
            error={error}
            outOfCredits={outOfCredits}
            onBack={() => { setSelectedCourseId(null); setActiveLessonKey(null); setError(null); }}
            onOpenLesson={(lessonId) => openLesson(selectedCourse, lessonId)}
            onCloseLesson={() => setActiveLessonKey(null)}
            onToggleDone={(lessonId, done) => markLessonDone(selectedCourse.id, lessonId, done)}
            onCoachInput={setCoachInput}
            onAskCoach={() => askCoach(selectedCourse)}
          />
        ) : (
          <>
            {/* hero */}
            <div className="relative text-center">
              <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
                <GraduationCap className="h-3 w-3" aria-hidden="true" /> The creator education hub
              </p>
              <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
                Creator <span className="text-primary">Academy</span>
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
                Courses on production, growth, monetization, and branding —
                taught by AI, personalized to your goals. Browse free,
                learn for 1 credit a lesson.
              </p>
            </div>

            {/* ── AI LEARNING PATH ─────────────────────────────────── */}
            <div className="relative mt-10 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> AI learning path · {CREDIT_COST} credit
              </p>
              <h2 className="mt-2 font-display text-2xl font-black">Your personalized course path</h2>
              <p className="mt-1.5 text-sm text-white/50">
                Tell the academy where you're headed — it builds your curriculum from the catalog.
              </p>

              <p className="mb-2 mt-6 text-[11px] font-bold uppercase tracking-widest text-white/40">Your goal</p>
              <input
                value={goals}
                onChange={(e) => setGoals(e.target.value)}
                maxLength={500}
                placeholder="e.g. Grow my music channel to 100k subscribers this year"
                className={inputClass}
              />

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">Niche</p>
                  <input
                    value={niche}
                    onChange={(e) => setNiche(e.target.value)}
                    maxLength={120}
                    placeholder="Music"
                    className={inputClass}
                  />
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-white/40">Hours per week</p>
                  <input
                    value={hours}
                    onChange={(e) => setHours(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                    inputMode="numeric"
                    placeholder="5"
                    className={inputClass}
                  />
                </div>
              </div>

              <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-widest text-white/40">Your level</p>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {LEVEL_OPTS.map((l) => {
                  const selected = level === l.key;
                  return (
                    <button
                      key={l.key}
                      onClick={() => setLevel(l.key)}
                      className={`rounded-2xl border p-3.5 text-left transition ${
                        selected
                          ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                          : "border-white/10 bg-white/[0.03] hover:border-primary/40"
                      }`}
                    >
                      <span className={`block text-sm font-bold ${selected ? "text-white" : "text-white/70"}`}>{l.label}</span>
                      <span className="block text-[11px] text-white/35">{l.blurb}</span>
                    </button>
                  );
                })}
              </div>

              <p className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-widest text-white/40">Platforms</p>
              <div className="flex flex-wrap gap-2">
                {PLATFORM_OPTS.map((p) => {
                  const selected = platforms.includes(p.key);
                  return (
                    <button
                      key={p.key}
                      onClick={() => togglePlatform(p.key)}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                        selected
                          ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
                          : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>

              <div className="mt-7 text-center">
                {user ? (
                  <button
                    onClick={buildLearningPath}
                    disabled={pathLoading}
                    className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-lg font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
                  >
                    {pathLoading ? (
                      <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                    ) : (
                      <Sparkles className="h-6 w-6" aria-hidden="true" />
                    )}
                    {pathLoading ? "Building your path…" : "Build my learning path"}
                  </button>
                ) : (
                  <Link
                    href="/login"
                    className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-4 text-lg font-bold text-primary transition hover:bg-primary hover:text-black"
                  >
                    <Sparkles className="h-6 w-6" aria-hidden="true" />
                    Sign in to build your path
                    <ArrowRight className="h-5 w-5" aria-hidden="true" />
                  </Link>
                )}
                <p className="mt-2.5 text-xs text-white/35">{CREDIT_COST} credit per path · powered by GPT-6</p>
              </div>

              {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
              {error && !outOfCredits && (
                <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </p>
              )}

              {/* path results */}
              {learningPath && (
                <div id="learning-path-results" className="mt-8 border-t border-white/10 pt-8">
                  <p className="mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                    <Target className="h-3.5 w-3.5" aria-hidden="true" /> Your path
                  </p>
                  <div className="grid gap-3">
                    {learningPath.path.map((item) => (
                      <button
                        key={item.courseId}
                        onClick={() => setSelectedCourseId(item.courseId)}
                        className="flex items-center gap-4 rounded-2xl border border-primary/25 bg-primary/[0.06] p-4 text-left transition hover:border-primary/60"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-black text-primary">
                          {item.order}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[15px] font-bold text-white">{item.title}</span>
                          <span className="block truncate text-sm text-white/50">{item.why}</span>
                        </span>
                        <ChevronRight className="h-5 w-5 shrink-0 text-primary/60" aria-hidden="true" />
                      </button>
                    ))}
                  </div>

                  {learningPath.weeklyPlan.length > 0 && (
                    <>
                      <p className="mb-3 mt-7 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                        <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> Your next 4 weeks
                      </p>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {learningPath.weeklyPlan.map((w, i) => (
                          <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                            <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">Week {i + 1}</p>
                            <p className="mt-1 text-sm leading-relaxed text-white/85">{w}</p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <div className="mt-6 rounded-2xl border border-primary/40 bg-primary/[0.08] p-5">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary">
                      <Zap className="h-3.5 w-3.5" aria-hidden="true" /> Your first step
                    </p>
                    <p className="mt-2 text-[15px] font-semibold leading-relaxed text-white">{learningPath.firstStep}</p>
                  </div>
                </div>
              )}
            </div>

            {/* ── COURSE CATALOG ───────────────────────────────────── */}
            <div className="relative mt-12">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" /> Course catalog · free to browse
              </p>
              <h2 className="font-display text-2xl font-black">Pick your course</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {ACADEMY_COURSES.map((course) => {
                  const prog = courseProgress[course.id] ?? { done: 0, total: course.lessons.length };
                  const pct = prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;
                  const badge = LEVEL_META[course.level];
                  return (
                    <button
                      key={course.id}
                      onClick={() => { setSelectedCourseId(course.id); setActiveLessonKey(null); setError(null); window.scrollTo({ top: 0 }); }}
                      className="group rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-left transition hover:border-primary/50 hover:bg-primary/[0.05]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className={`rounded-full border px-3 py-1 text-[11px] font-bold ${badge.cls}`}>
                          {badge.label}
                        </span>
                        <span className="flex items-center gap-1 text-[11px] text-white/35">
                          <Clock className="h-3 w-3" aria-hidden="true" /> {course.duration}
                        </span>
                      </div>
                      <h3 className="mt-3 font-display text-xl font-black text-white group-hover:text-primary">
                        {course.title}
                      </h3>
                      <p className="mt-1 text-sm font-semibold text-primary/70">{course.tagline}</p>
                      <p className="mt-2 text-sm leading-relaxed text-white/50">{course.description}</p>
                      {prog.done > 0 && (
                        <div className="mt-4">
                          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-primary to-[#f5d67b]"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <p className="mt-1.5 text-[11px] text-white/40">
                            {prog.done}/{prog.total} lessons complete
                          </p>
                        </div>
                      )}
                      <p className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-primary">
                        {prog.done > 0 ? "Continue" : "Start course"}
                        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" aria-hidden="true" />
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

/* ─── Course detail view ──────────────────────────────────────────────── */

interface CourseDetailProps {
  course: AcademyCourse;
  progress: Record<string, boolean>;
  lessonCache: LessonCache;
  activeLesson: GeneratedLesson | null;
  activeLessonKey: string | null;
  lessonLoading: boolean;
  coachThreads: CoachMessage[];
  coachInput: string;
  coachLoading: boolean;
  user: unknown;
  error: string | null;
  outOfCredits: boolean;
  onBack: () => void;
  onOpenLesson: (lessonId: string) => void;
  onCloseLesson: () => void;
  onToggleDone: (lessonId: string, done: boolean) => void;
  onCoachInput: (v: string) => void;
  onAskCoach: () => void;
}

function CourseDetail(props: CourseDetailProps) {
  const {
    course, progress, lessonCache, activeLesson, activeLessonKey, lessonLoading,
    coachThreads, coachInput, coachLoading, user, error, outOfCredits,
    onBack, onOpenLesson, onCloseLesson, onToggleDone, onCoachInput, onAskCoach,
  } = props;
  const badge = LEVEL_META[course.level];
  const doneCount = course.lessons.filter((l) => progress[l.id]).length;

  return (
    <div className="relative">
      <button
        onClick={onBack}
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-white/50 transition hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All courses
      </button>

      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full border px-3 py-1 text-[11px] font-bold ${badge.cls}`}>{badge.label}</span>
        <span className="flex items-center gap-1 text-xs text-white/35">
          <Clock className="h-3 w-3" aria-hidden="true" /> {course.duration}
        </span>
        {doneCount > 0 && (
          <span className="text-xs font-semibold text-primary">
            {doneCount}/{course.lessons.length} complete
          </span>
        )}
      </div>
      <h1 className="mt-3 font-display text-3xl font-black tracking-tight md:text-4xl">
        {course.title}
      </h1>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-white/55">{course.description}</p>

      {outOfCredits && <div className="mx-auto mt-4 max-w-md"><OutOfCredits /></div>}
      {error && !outOfCredits && (
        <p className="mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* lessons */}
      <p className="mb-4 mt-10 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
        <Play className="h-3.5 w-3.5" aria-hidden="true" /> Lessons · AI-taught, {CREDIT_COST} credit each
      </p>
      <div className="grid gap-3">
        {course.lessons.map((lesson, i) => {
          const key = `${course.id}:${lesson.id}`;
          const done = !!progress[lesson.id];
          const isActive = activeLessonKey === key;
          const cached = !!lessonCache[key];
          return (
            <div
              key={lesson.id}
              className={`overflow-hidden rounded-2xl border transition ${
                isActive ? "border-primary/60 bg-primary/[0.05]" : "border-white/10 bg-white/[0.03]"
              }`}
            >
              <div className="flex items-center gap-3.5 p-4">
                <button
                  onClick={() => onToggleDone(lesson.id, !done)}
                  aria-label={done ? `Mark ${lesson.title} incomplete` : `Mark ${lesson.title} complete`}
                  className="shrink-0"
                >
                  {done
                    ? <CheckCircle2 className="h-6 w-6 text-primary" aria-hidden="true" />
                    : <Circle className="h-6 w-6 text-white/25 transition hover:text-primary/70" aria-hidden="true" />}
                </button>
                <button onClick={() => onOpenLesson(lesson.id)} className="min-w-0 flex-1 text-left">
                  <p className="flex items-center gap-2 text-[15px] font-bold text-white">
                    <span className="text-white/30">{String(i + 1).padStart(2, "0")}</span>
                    {lesson.title}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-white/45">{lesson.summary}</p>
                </button>
                <span className="hidden shrink-0 text-[11px] text-white/35 sm:block">{lesson.minutes} min</span>
                <button
                  onClick={() => onOpenLesson(lesson.id)}
                  className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition ${
                    cached
                      ? "border border-primary/40 text-primary hover:bg-primary hover:text-black"
                      : "bg-primary text-black hover:brightness-110"
                  }`}
                >
                  {cached ? "Read" : `Learn · ${CREDIT_COST}cr`}
                </button>
              </div>

              {isActive && (
                <div className="border-t border-white/10 p-5 md:p-6">
                  {lessonLoading && !activeLesson ? (
                    <p className="flex items-center gap-2 text-sm text-white/50">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      The instructor is preparing your lesson…
                    </p>
                  ) : activeLesson ? (
                    <div>
                      {activeLesson.sections.map((s, si) => (
                        <div key={si} className={si > 0 ? "mt-5" : ""}>
                          <h4 className="font-display text-lg font-black text-primary">{s.heading}</h4>
                          <p className="mt-1.5 text-[15px] leading-relaxed text-white/80">{s.body}</p>
                        </div>
                      ))}
                      {activeLesson.takeaways.length > 0 && (
                        <div className="mt-6 rounded-2xl border border-white/10 bg-black/40 p-4">
                          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
                            <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> Key takeaways
                          </p>
                          <ul className="mt-2.5 space-y-1.5">
                            {activeLesson.takeaways.map((t, ti) => (
                              <li key={ti} className="flex items-start gap-2 text-sm text-white/75">
                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                                {t}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="mt-4 rounded-2xl border border-primary/40 bg-primary/[0.08] p-4">
                        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary">
                          <Zap className="h-3.5 w-3.5" aria-hidden="true" /> Do it today
                        </p>
                        <p className="mt-1.5 text-[15px] font-semibold leading-relaxed text-white">
                          {activeLesson.actionStep}
                        </p>
                      </div>
                      <div className="mt-5 flex items-center justify-between">
                        <button
                          onClick={onCloseLesson}
                          className="text-sm font-semibold text-white/40 transition hover:text-white"
                        >
                          Close lesson
                        </button>
                        {!done && (
                          <button
                            onClick={() => onToggleDone(lesson.id, true)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
                          >
                            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                            Mark complete
                          </button>
                        )}
                      </div>
                    </div>
                  ) : !user ? (
                    <p className="text-sm text-white/50">
                      <Link href="/login" className="font-semibold text-primary hover:underline">Sign in</Link>
                      {" "}to generate this AI lesson ({CREDIT_COST} credit).
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ask the coach */}
      <div className="mt-12 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
          <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden="true" /> Ask the coach · {CREDIT_COST} credit per answer
        </p>
        <h3 className="mt-2 font-display text-xl font-black">Stuck on {course.title}?</h3>
        <p className="mt-1 text-sm text-white/50">
          Ask anything about this course — the AI instructor answers in plain, practical terms.
        </p>

        <div className="mt-5 space-y-3">
          {coachThreads.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                m.role === "user"
                  ? "ml-auto bg-primary/15 text-white"
                  : "border border-white/10 bg-white/[0.04] text-white/85"
              }`}
            >
              {m.role === "coach" && (
                <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-primary/70">Coach <PixelShark size={12} /></p>
              )}
              <p className="whitespace-pre-wrap">{m.text}</p>
            </div>
          ))}
          {coachLoading && (
            <p className="flex items-center gap-2 text-sm text-white/40">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> The coach is thinking…
            </p>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <input
            value={coachInput}
            onChange={(e) => onCoachInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onAskCoach(); }}
            maxLength={1000}
            placeholder={`Ask about ${course.title.toLowerCase()}…`}
            disabled={coachLoading}
            className={inputClass}
          />
          <button
            onClick={onAskCoach}
            disabled={coachLoading || !coachInput.trim()}
            aria-label="Ask the coach"
            className="flex shrink-0 items-center justify-center rounded-xl bg-primary px-5 text-black transition hover:brightness-110 disabled:opacity-40"
          >
            {coachLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>
        {!user && (
          <p className="mt-3 text-sm text-white/40">
            <Link href="/login" className="font-semibold text-primary hover:underline">Sign in</Link>
            {" "}to ask the coach.
          </p>
        )}
      </div>
    </div>
  );
}
