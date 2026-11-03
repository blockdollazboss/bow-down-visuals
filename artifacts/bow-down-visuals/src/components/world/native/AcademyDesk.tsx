import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft, BookOpen, Check, CheckCircle2, Circle, Clapperboard,
  GraduationCap, Loader2, Lock, Play, RotateCcw, Search, Send,
  Sparkles, Target, Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { NativeCard } from "./NativeCard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import { deskInputCls } from "./CreateDeskLeaf";
import {
  ACADEMY_COURSES,
  getAcademyCourse,
  type AcademyCourse,
  type AcademyLevel,
} from "@/lib/academy-courses";
import {
  fetchTutorialCatalog,
  fetchTutorialDetail,
  fetchMyTutorialProgress,
  recordTutorialProgress,
  filterCatalog,
  inProgressCards,
  tutorialCardState,
  resumeChapter,
  resumeLabel,
  formatTimestamp,
  TUTORIAL_CATEGORY_LABELS,
  type TutorialCatalog,
  type TutorialCard,
  type TutorialDetail,
  type TutorialProgress,
  type ProgressBeat,
} from "@/lib/tutorials";
import {
  fetchMyCourses,
  fetchCourseLearn,
  recordLessonProgress,
  flattenLessons,
  resumeLesson,
  unlockLabel,
  type MyCourse,
  type CourseLearn,
  type CourseLesson,
} from "@/lib/courses";
import {
  ACADEMY_ASK_PATH,
  ACADEMY_CREDIT_COST_VISUAL_BUCS,
  ACADEMY_GUIDE_BULLETS,
  ACADEMY_GUIDE_KEYS,
  ACADEMY_LEARNING_PATH_PATH,
  ACADEMY_LESSON_CACHE_KEY,
  ACADEMY_LESSON_PATH,
  ACADEMY_LEVELS,
  ACADEMY_PLATFORMS,
  ACADEMY_PROGRESS_KEY,
  askReady,
  buildAskPayload,
  buildLearningPathPayload,
  buildLessonPayload,
  courseProgressCounts,
  learningPathReady,
  lessonCacheKey,
  loadAcademyLessonCache,
  loadAcademyProgress,
  parseCoachAnswer,
  parseGeneratedLesson,
  parseLearningPath,
  saveAcademyJson,
  withLessonDone,
  type AcademyCoachMessage,
  type AcademyGeneratedLesson,
  type AcademyLearningPath,
  type AcademyLessonCache,
  type AcademyProgressMap,
} from "@/lib/world/academy-desk";

/* ─── The Creator Academy, in-world (stack1400 world parity, wave
   #2 item 3) ───────────────────────────────────────────────────────
   Census features `academy`, `tab-guides`, `tab-tutorials` — all
   ABSENT in-World — native at the My Studio board, stacked under
   the Studio Board like the Hall's and Promote Room's stacked
   desks. (The World's own tutorial strip is the palace's
   walkthrough, NOT this library — the census says so plainly, and
   this desk is the library.)

   Four shelves, one desk, everything consumed right here — no
   page pull-up, no exit to /academy:
   - COURSES: the page's own catalog (free to browse), the AI
     learning path, AI lesson content read in the desk, Ask the
     Coach, and progress kept in the page's OWN localStorage store
     (academy-progress-v1 / academy-lessons-v1) so it carries
     between the website and the palace both ways.
   - HOW-TO VIDEOS: the tutorials tab on its own rails (lib/
     tutorials) — series shelves, search, in-desk video playback,
     chapters with server-side progress, resume. FREE.
   - GUIDES: the guides tab's own index — the three guide cards
     and the why-it-matters copy read in the desk from the same
     i18n keys. The LLC / Copyright full guided flows are separate
     census items and are NOT faked here; the Academy card opens
     this desk's own Courses shelf.
   - MY COURSES: the courses tab on its own rails (lib/courses) —
     the shelf of bought/taught courses and the player, with
     drip/purchase locks shown honestly. Buying stays on the
     store rail; no buy link walks out of the palace.

   CHARGES: the three Academy AI calls ride useConfirmedApi at
   100 VB each — the server constant's own default
   (ACADEMY_CREDIT_COST in routes/generate/academy.ts, the 2D
   page's CREDIT_COST) passed as an explicit overrideCost because
   lib/credit-costs.ts carries no /api/academy/* rows (named gap,
   pinned in the seam). The member confirms the exact price before
   anything is charged, exactly as on the website; failed
   generations are refunded by the rail itself. Everything else
   here is free, as on the website.

   GUEST BOUNDARY: /academy is a locked (sign-in) route on the
   website and this station is members-only — a guest never
   reaches the working desk; a signed-out walker who somehow lands
   here gets the sign-in pitch, never a dead button. */

type AcademyTab = "courses" | "tutorials" | "guides" | "mycourses";

const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target";

const chipBtn = (isLight: boolean, active = false) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target disabled:opacity-50 ${
    active
      ? "border-[#d4af37] bg-[#d4af37] text-black"
      : isLight
        ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
        : "border-white/15 text-white/75 hover:text-white"
  }`;

function muted(isLight: boolean) {
  return isLight ? "text-[#6B5B36]" : "text-white/55";
}
function strong(isLight: boolean) {
  return isLight ? "text-[#2a1e07]" : "text-white";
}

function GuestGate({ isLight }: { isLight: boolean }) {
  return (
    <NativeCard isLight={isLight} title="Creator Academy — courses, guides & how-to videos">
      <p className={`text-sm ${muted(isLight)}`}>
        The Academy works on your own progress, your own lessons and your own course
        shelf — guests can look around the palace, but this desk only opens for
        members.{" "}
        <Link href="/login" className="font-bold text-[#d4af37] underline underline-offset-2">
          Sign in
        </Link>{" "}
        and the desk is yours, right here in the room.
      </p>
    </NativeCard>
  );
}

export function AcademyDesk({ isLight, isGuest }: { isLight: boolean; isGuest?: boolean }) {
  const { user } = useAuth();
  const [tab, setTab] = useState<AcademyTab>("courses");

  if (isGuest || !user) return <GuestGate isLight={isLight} />;

  const TABS: Array<{ key: AcademyTab; label: string }> = [
    { key: "courses", label: "Courses" },
    { key: "tutorials", label: "How-To Videos" },
    { key: "guides", label: "Guides" },
    { key: "mycourses", label: "My Courses" },
  ];

  return (
    <div data-testid="world-academy-desk" className="flex flex-col gap-4">
      <NativeCard isLight={isLight} title="Creator Academy — learn the game, master the craft">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Academy shelves">
          {TABS.map((tb) => (
            <button
              key={tb.key}
              type="button"
              role="tab"
              aria-selected={tab === tb.key}
              data-testid={`world-academy-tab-${tb.key}`}
              onClick={() => setTab(tb.key)}
              className={chipBtn(isLight, tab === tb.key)}
            >
              {tb.label}
            </button>
          ))}
        </div>
        <p className={`mt-2 text-xs ${muted(isLight)}`}>
          Browse everything free. The Academy's AI — a learning path, a generated
          lesson, a coach answer — costs {ACADEMY_CREDIT_COST_VISUAL_BUCS} Visual Bucs
          a call, confirmed before it is charged, exactly as on the website.
        </p>
      </NativeCard>
      {tab === "courses" ? (
        <CoursesShelf isLight={isLight} />
      ) : tab === "tutorials" ? (
        <TutorialsShelf isLight={isLight} />
      ) : tab === "guides" ? (
        <GuidesShelf isLight={isLight} onOpenAcademy={() => setTab("courses")} />
      ) : (
        <MyCoursesShelf isLight={isLight} />
      )}
    </div>
  );
}

/* ─── Courses shelf (the academy tab) ────────────────────────────── */

function CoursesShelf({ isLight }: { isLight: boolean }) {
  const { confirmedFetch } = useConfirmedApi();
  const { refreshProfile } = useAuth();

  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const selectedCourse = selectedCourseId ? getAcademyCourse(selectedCourseId) ?? null : null;

  const [progress, setProgress] = useState<AcademyProgressMap>(() => loadAcademyProgress());
  const [lessonCache, setLessonCache] = useState<AcademyLessonCache>(() => loadAcademyLessonCache());
  useEffect(() => { saveAcademyJson(ACADEMY_PROGRESS_KEY, progress); }, [progress]);
  useEffect(() => { saveAcademyJson(ACADEMY_LESSON_CACHE_KEY, lessonCache); }, [lessonCache]);

  /* learning path */
  const [goals, setGoals] = useState("");
  const [niche, setNiche] = useState("Music");
  const [level, setLevel] = useState<AcademyLevel>("beginner");
  const [platforms, setPlatforms] = useState<string[]>(["tiktok", "youtube"]);
  const [hours, setHours] = useState("5");
  const [learningPath, setLearningPath] = useState<AcademyLearningPath | null>(null);
  const [pathLoading, setPathLoading] = useState(false);

  /* lessons */
  const [activeLessonKey, setActiveLessonKey] = useState<string | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);

  /* coach */
  const [coachThreads, setCoachThreads] = useState<Record<string, AcademyCoachMessage[]>>({});
  const [coachInput, setCoachInput] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  const counts = useMemo(() => courseProgressCounts(ACADEMY_COURSES, progress), [progress]);

  async function readPaid<T>(
    res: Response | null,
    parse: (data: unknown) => T | null,
    failedMessage: string,
  ): Promise<T | null> {
    if (res === null) return null; /* the member cancelled the confirm */
    if (res.status === 402) {
      setOutOfCredits(true);
      refreshProfile();
      return null;
    }
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
          ? String((data as { error: string }).error)
          : failedMessage;
      setError(msg);
      return null;
    }
    const parsed = parse(data);
    if (!parsed) {
      setError(failedMessage);
      return null;
    }
    refreshProfile();
    return parsed;
  }

  async function buildLearningPath() {
    if (pathLoading) return;
    if (!learningPathReady({ goals, platforms })) {
      setError(
        goals.trim().length < 4
          ? "Tell the Academy your goal first — a few words is enough."
          : "Pick at least one platform.",
      );
      return;
    }
    setPathLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await confirmedFetch(ACADEMY_LEARNING_PATH_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildLearningPathPayload({ goals, niche, level, platforms, hours })),
        overrideCost: ACADEMY_CREDIT_COST_VISUAL_BUCS,
        overrideFeature: "Academy Learning Path",
      });
      const parsed = await readPaid(res, parseLearningPath, "The Academy couldn't build that path — if you were charged, the rail refunds it. Try again.");
      if (parsed) setLearningPath(parsed);
    } catch {
      setError("The Academy couldn't build that path — try again.");
    } finally {
      setPathLoading(false);
    }
  }

  async function openLesson(course: AcademyCourse, lessonId: string) {
    const key = lessonCacheKey(course.id, lessonId);
    setActiveLessonKey(key);
    setError(null);
    setOutOfCredits(false);
    if (lessonCache[key]) return; /* already generated — free re-read, as on the page */
    setLessonLoading(true);
    try {
      const res = await confirmedFetch(ACADEMY_LESSON_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildLessonPayload(course.id, lessonId)),
        overrideCost: ACADEMY_CREDIT_COST_VISUAL_BUCS,
        overrideFeature: "Academy Lesson",
      });
      if (res === null) { setActiveLessonKey(null); return; }
      const parsed = await readPaid(res, parseGeneratedLesson, "That lesson didn't generate — if you were charged, the rail refunds it. Try again.");
      if (parsed) setLessonCache((prev) => ({ ...prev, [key]: parsed }));
      else setActiveLessonKey(null);
    } catch {
      setError("That lesson didn't generate — try again.");
      setActiveLessonKey(null);
    } finally {
      setLessonLoading(false);
    }
  }

  async function askCoach(course: AcademyCourse) {
    if (coachLoading || !askReady(coachInput)) {
      if (!askReady(coachInput)) setError("Ask a real question — a few words at least.");
      return;
    }
    const question = coachInput.trim();
    setCoachLoading(true);
    setError(null);
    setOutOfCredits(false);
    setCoachThreads((prev) => ({
      ...prev,
      [course.id]: [...(prev[course.id] ?? []), { role: "user" as const, text: question }],
    }));
    setCoachInput("");
    try {
      const res = await confirmedFetch(ACADEMY_ASK_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAskPayload(course.id, question)),
        overrideCost: ACADEMY_CREDIT_COST_VISUAL_BUCS,
        overrideFeature: "Academy Ask the Coach",
      });
      const answer = await readPaid(res, parseCoachAnswer, "The coach couldn't answer that — if you were charged, the rail refunds it. Try again.");
      if (answer) {
        setCoachThreads((prev) => ({
          ...prev,
          [course.id]: [...(prev[course.id] ?? []), { role: "coach" as const, text: answer }],
        }));
      }
    } catch {
      setError("The coach couldn't answer that — try again.");
    } finally {
      setCoachLoading(false);
    }
  }

  const activeLesson: AcademyGeneratedLesson | null = activeLessonKey
    ? lessonCache[activeLessonKey] ?? null
    : null;

  if (selectedCourse) {
    return (
      <CourseDetail
        isLight={isLight}
        course={selectedCourse}
        progress={progress[selectedCourse.id] ?? {}}
        lessonCache={lessonCache}
        activeLesson={activeLesson}
        activeLessonKey={activeLessonKey}
        lessonLoading={lessonLoading}
        coachThreads={coachThreads[selectedCourse.id] ?? []}
        coachInput={coachInput}
        coachLoading={coachLoading}
        error={error}
        outOfCredits={outOfCredits}
        onBack={() => { setSelectedCourseId(null); setActiveLessonKey(null); setError(null); }}
        onOpenLesson={(lessonId) => void openLesson(selectedCourse, lessonId)}
        onCloseLesson={() => setActiveLessonKey(null)}
        onToggleDone={(lessonId, done) =>
          setProgress((prev) => withLessonDone(prev, selectedCourse.id, lessonId, done))
        }
        onCoachInput={setCoachInput}
        onAskCoach={() => void askCoach(selectedCourse)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── AI learning path ── */}
      <NativeCard isLight={isLight} title={`Build my learning path — ${ACADEMY_CREDIT_COST_VISUAL_BUCS} Visual Bucs`}>
        <label className="block">
          <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted(isLight)}`}>
            Your goal
          </span>
          <input
            aria-label="Your goal"
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            maxLength={500}
            placeholder="Grow my music channel to 10k followers"
            className={deskInputCls(isLight)}
          />
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted(isLight)}`}>
              Your niche
            </span>
            <input
              aria-label="Your niche"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              maxLength={120}
              className={deskInputCls(isLight)}
            />
          </label>
          <label className="block">
            <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${muted(isLight)}`}>
              Hours a week
            </span>
            <input
              aria-label="Hours a week"
              value={hours}
              onChange={(e) => setHours(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
              inputMode="numeric"
              className={deskInputCls(isLight)}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Your level">
          {ACADEMY_LEVELS.map((l) => (
            <button key={l} type="button" onClick={() => setLevel(l)} className={chipBtn(isLight, level === l)}>
              {l}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Your platforms">
          {ACADEMY_PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() =>
                setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
              }
              className={chipBtn(isLight, platforms.includes(p))}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="mt-4">
          <button
            type="button"
            data-testid="world-academy-learning-path"
            onClick={() => void buildLearningPath()}
            disabled={pathLoading}
            className={goldBtn}
          >
            {pathLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {pathLoading ? "Building your path…" : `Build my path · ${ACADEMY_CREDIT_COST_VISUAL_BUCS} VB`}
          </button>
        </div>
        {outOfCredits && (
          <p className="mt-3 text-sm font-semibold text-[#d4af37]">
            You're out of Visual Bucs — top up at the Treasury's packs desk and come back.
          </p>
        )}
        {error && !outOfCredits && (
          <p className="mt-3 text-sm font-semibold text-red-400">{error}</p>
        )}
        {learningPath && (
          <div data-testid="world-academy-path-result" className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-4">
            <p className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest ${muted(isLight)}`}>
              <Target className="h-3.5 w-3.5 text-[#d4af37]" /> Your path
            </p>
            {learningPath.path.map((item) => (
              <button
                key={item.courseId}
                type="button"
                onClick={() => { setSelectedCourseId(item.courseId); setActiveLessonKey(null); setError(null); }}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition bdv-touch-target ${
                  isLight ? "border-[#C9A84C]/40 hover:border-[#d4af37]" : "border-white/10 hover:border-[#d4af37]/60"
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#d4af37]/15 text-sm font-black text-[#d4af37]">
                  {item.order}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm font-bold ${strong(isLight)}`}>{item.title}</span>
                  <span className={`block truncate text-xs ${muted(isLight)}`}>{item.why}</span>
                </span>
              </button>
            ))}
            {learningPath.weeklyPlan.length > 0 && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {learningPath.weeklyPlan.map((w, i) => (
                  <div key={i} className={`rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`}>
                    <p className={`text-[11px] font-bold uppercase tracking-widest ${muted(isLight)}`}>Week {i + 1}</p>
                    <p className={`mt-1 text-sm ${strong(isLight)}`}>{w}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 rounded-xl border border-[#d4af37]/40 bg-[#d4af37]/[0.08] p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#d4af37]">
                <Zap className="h-3.5 w-3.5" /> First step
              </p>
              <p className={`mt-1 text-sm font-semibold ${strong(isLight)}`}>{learningPath.firstStep}</p>
            </div>
          </div>
        )}
      </NativeCard>

      {/* ── the catalog ── */}
      <NativeCard isLight={isLight} title="The course catalog — free to browse">
        <div className="grid gap-3 sm:grid-cols-2">
          {ACADEMY_COURSES.map((course) => {
            const prog = counts[course.id] ?? { done: 0, total: course.lessons.length };
            const pct = prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;
            return (
              <button
                key={course.id}
                type="button"
                data-testid={`world-academy-course-${course.id}`}
                onClick={() => { setSelectedCourseId(course.id); setActiveLessonKey(null); setError(null); }}
                className={`rounded-xl border p-4 text-left transition bdv-touch-target ${
                  isLight ? "border-[#C9A84C]/40 hover:border-[#d4af37]" : "border-white/10 hover:border-[#d4af37]/60"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[11px] font-bold uppercase tracking-widest ${muted(isLight)}`}>
                    {course.level} · {course.duration}
                  </span>
                  {prog.done > 0 && (
                    <span className="text-[11px] font-bold text-[#d4af37]">
                      {prog.done}/{prog.total} lessons
                    </span>
                  )}
                </div>
                <p className={`mt-1 text-base font-black ${strong(isLight)}`}>{course.title}</p>
                <p className="mt-0.5 text-sm font-semibold text-[#d4af37]/90">{course.tagline}</p>
                <p className={`mt-1 line-clamp-2 text-sm ${muted(isLight)}`}>{course.description}</p>
                {prog.done > 0 && (
                  <div className={`mt-3 h-1.5 overflow-hidden rounded-full ${isLight ? "bg-[#C9A84C]/25" : "bg-white/10"}`}>
                    <div className="h-full rounded-full bg-[#d4af37]" style={{ width: `${pct}%` }} />
                  </div>
                )}
                <p className="mt-3 text-sm font-bold text-[#d4af37]">
                  {prog.done > 0 ? "Continue course" : "Start course"}
                </p>
              </button>
            );
          })}
        </div>
      </NativeCard>
    </div>
  );
}

/* ─── one course, in the desk ────────────────────────────────────── */

function CourseDetail(props: {
  isLight: boolean;
  course: AcademyCourse;
  progress: Record<string, boolean>;
  lessonCache: AcademyLessonCache;
  activeLesson: AcademyGeneratedLesson | null;
  activeLessonKey: string | null;
  lessonLoading: boolean;
  coachThreads: AcademyCoachMessage[];
  coachInput: string;
  coachLoading: boolean;
  error: string | null;
  outOfCredits: boolean;
  onBack: () => void;
  onOpenLesson: (lessonId: string) => void;
  onCloseLesson: () => void;
  onToggleDone: (lessonId: string, done: boolean) => void;
  onCoachInput: (v: string) => void;
  onAskCoach: () => void;
}) {
  const {
    isLight, course, progress, lessonCache, activeLesson, activeLessonKey,
    lessonLoading, coachThreads, coachInput, coachLoading, error,
    outOfCredits, onBack, onOpenLesson, onCloseLesson, onToggleDone,
    onCoachInput, onAskCoach,
  } = props;
  const doneCount = course.lessons.filter((l) => progress[l.id]).length;

  return (
    <div className="flex flex-col gap-4">
      <NativeCard isLight={isLight} title={course.title}>
        <button type="button" onClick={onBack} className={`inline-flex items-center gap-1.5 text-sm font-bold ${muted(isLight)} hover:text-[#d4af37] bdv-touch-target`}>
          <ArrowLeft className="h-4 w-4" /> All courses
        </button>
        <p className={`mt-2 text-xs font-bold uppercase tracking-widest ${muted(isLight)}`}>
          {course.level} · {course.duration}
          {doneCount > 0 ? ` · ${doneCount} of ${course.lessons.length} complete` : ""}
        </p>
        <p className={`mt-2 text-sm leading-relaxed ${muted(isLight)}`}>{course.description}</p>
        {outOfCredits && (
          <p className="mt-3 text-sm font-semibold text-[#d4af37]">
            You're out of Visual Bucs — top up at the Treasury's packs desk and come back.
          </p>
        )}
        {error && !outOfCredits && <p className="mt-3 text-sm font-semibold text-red-400">{error}</p>}

        <div className="mt-4 flex flex-col gap-2">
          {course.lessons.map((lesson, i) => {
            const key = lessonCacheKey(course.id, lesson.id);
            const done = !!progress[lesson.id];
            const isActive = activeLessonKey === key;
            const cached = !!lessonCache[key];
            return (
              <div key={lesson.id} className={`rounded-xl border ${isActive ? "border-[#d4af37]" : isLight ? "border-[#C9A84C]/30" : "border-white/10"}`}>
                <div className="flex items-center gap-3 p-3">
                  <button
                    type="button"
                    aria-label={done ? `Mark ${lesson.title} not complete` : `Mark ${lesson.title} complete`}
                    onClick={() => onToggleDone(lesson.id, !done)}
                    className="shrink-0 bdv-touch-target"
                  >
                    {done
                      ? <CheckCircle2 className="h-6 w-6 text-[#d4af37]" />
                      : <Circle className={`h-6 w-6 ${muted(isLight)}`} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-bold ${strong(isLight)}`}>
                      <span className={muted(isLight)}>{String(i + 1).padStart(2, "0")} </span>
                      {lesson.title}
                    </p>
                    <p className={`truncate text-xs ${muted(isLight)}`}>{lesson.summary}</p>
                  </div>
                  <span className={`hidden shrink-0 text-[11px] ${muted(isLight)} sm:block`}>{lesson.minutes} min</span>
                  <button
                    type="button"
                    data-testid={`world-academy-lesson-${course.id}-${lesson.id}`}
                    onClick={() => onOpenLesson(lesson.id)}
                    className={cached ? chipBtn(isLight) : goldBtn}
                  >
                    {cached ? "Read lesson" : `Learn · ${ACADEMY_CREDIT_COST_VISUAL_BUCS} VB`}
                  </button>
                </div>
                {isActive && (
                  <div className="border-t border-white/10 p-4">
                    {lessonLoading && !activeLesson ? (
                      <p className={`inline-flex items-center gap-2 text-sm ${muted(isLight)}`}>
                        <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> Preparing your lesson…
                      </p>
                    ) : activeLesson ? (
                      <div data-testid="world-academy-lesson-content">
                        {activeLesson.sections.map((s, si) => (
                          <div key={si} className={si > 0 ? "mt-4" : ""}>
                            <h4 className={`font-display text-base font-black ${strong(isLight)}`}>{s.heading}</h4>
                            <p className={`mt-1 text-sm leading-relaxed ${muted(isLight)}`}>{s.body}</p>
                          </div>
                        ))}
                        {activeLesson.takeaways.length > 0 && (
                          <ul className="mt-4 space-y-1.5">
                            {activeLesson.takeaways.map((take, ti) => (
                              <li key={ti} className={`flex items-start gap-2 text-sm ${muted(isLight)}`}>
                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d4af37]" />
                                {take}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-4 rounded-xl border border-[#d4af37]/40 bg-[#d4af37]/[0.08] p-3">
                          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#d4af37]">
                            <Zap className="h-3.5 w-3.5" /> Do it today
                          </p>
                          <p className={`mt-1 text-sm font-semibold ${strong(isLight)}`}>{activeLesson.actionStep}</p>
                        </div>
                        <div className="mt-4 flex items-center justify-between">
                          <button type="button" onClick={onCloseLesson} className={`text-sm font-semibold ${muted(isLight)} hover:text-[#d4af37] bdv-touch-target`}>
                            Close lesson
                          </button>
                          {!done && (
                            <button type="button" onClick={() => onToggleDone(lesson.id, true)} className={goldBtn}>
                              <Check className="h-4 w-4" /> Mark complete
                            </button>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </NativeCard>

      {/* ── Ask the Coach ── */}
      <NativeCard isLight={isLight} title={`Ask the Coach — ${ACADEMY_CREDIT_COST_VISUAL_BUCS} Visual Bucs an answer`}>
        <p className={`text-sm ${muted(isLight)}`}>
          Stuck on {course.title}? Ask — the coach answers from this course's lessons.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {coachThreads.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                m.role === "user"
                  ? "ml-auto bg-[#d4af37]/15"
                  : isLight
                    ? "border border-[#C9A84C]/30"
                    : "border border-white/10"
              } ${strong(isLight)}`}
            >
              {m.role === "coach" && (
                <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-[#d4af37]">Coach</p>
              )}
              <p className="whitespace-pre-wrap">{m.text}</p>
            </div>
          ))}
          {coachLoading && (
            <p className={`inline-flex items-center gap-2 text-sm ${muted(isLight)}`}>
              <Loader2 className="h-4 w-4 animate-spin text-[#d4af37]" /> The coach is thinking…
            </p>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            aria-label={`Ask about ${course.title}`}
            value={coachInput}
            onChange={(e) => onCoachInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onAskCoach(); }}
            maxLength={1000}
            placeholder="Ask the coach…"
            disabled={coachLoading}
            className={deskInputCls(isLight)}
          />
          <button
            type="button"
            data-testid="world-academy-ask-coach"
            onClick={onAskCoach}
            disabled={coachLoading || !coachInput.trim()}
            aria-label="Ask the coach"
            className={`${goldBtn} shrink-0 px-3`}
          >
            {coachLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
      </NativeCard>
    </div>
  );
}

/* ─── How-To Videos shelf (the tutorials tab) ────────────────────── */

function TutorialsShelf({ isLight }: { isLight: boolean }) {
  const { user, getAccessToken } = useAuth();
  const [catalog, setCatalog] = useState<TutorialCatalog | null>(null);
  const [progressById, setProgressById] = useState<Map<string, TutorialProgress>>(new Map());
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<TutorialDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    (async () => {
      try {
        const [cat, progress] = await Promise.all([
          fetchTutorialCatalog(),
          user ? fetchMyTutorialProgress(getAccessToken).catch(() => new Map()) : Promise.resolve(new Map()),
        ]);
        if (!cancelled) {
          setCatalog(cat);
          setProgressById(progress as Map<string, TutorialProgress>);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user, getAccessToken, retryNonce]);

  useEffect(() => {
    if (!selectedSlug) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(false);
    (async () => {
      try {
        const d = await fetchTutorialDetail(selectedSlug);
        if (!cancelled) setDetail(d);
      } catch {
        if (!cancelled) setDetailError(true);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedSlug]);

  const beat = useCallback(
    async (tutorialId: string, b: ProgressBeat) => {
      if (!user) return;
      try {
        const p = await recordTutorialProgress(getAccessToken, tutorialId, b);
        setProgressById((prev) => new Map(prev).set(tutorialId, p));
      } catch {
        /* Progress is best-effort — a failed write never blocks the lesson. */
      }
    },
    [user, getAccessToken],
  );

  const startedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (detail && user && !startedRef.current.has(detail.id)) {
      startedRef.current.add(detail.id);
      void beat(detail.id, {});
    }
  }, [detail, user, beat]);

  const visible = useMemo(() => (catalog ? filterCatalog(catalog, query) : null), [catalog, query]);
  const resumeCards = useMemo(
    () => (catalog && !query ? inProgressCards(catalog, progressById) : []),
    [catalog, progressById],
  );

  if (selectedSlug) {
    return (
      <TutorialDetailView
        isLight={isLight}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        progress={detail ? progressById.get(detail.id) : undefined}
        onBack={() => setSelectedSlug(null)}
        onOpen={(slug) => setSelectedSlug(slug)}
        onBeat={beat}
      />
    );
  }

  return (
    <NativeCard isLight={isLight} title="How-To Videos — free to watch">
      <p className={`text-sm ${muted(isLight)}`}>
        Free video walkthroughs from Bow Down Visuals and the creators here — watch
        right here, follow the written chapters, and your place is saved as you go.
        The tutorial's other two doors on the website (the page walk-through and
        Try-it) belong to each tool's own station in the palace; everything the
        video teaches is here.
      </p>
      <div className={`mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/60" : "border-white/10 bg-white/5"}`}>
        <Search className={`h-4 w-4 shrink-0 ${muted(isLight)}`} />
        <input
          aria-label="Search tutorials"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="How do I…? (try “get paid” or “make a song”)"
          className={`w-full bg-transparent text-sm outline-none ${strong(isLight)}`}
        />
      </div>

      {loadError ? (
        <NativeErrorState
          isLight={isLight}
          title="The tutorials wouldn't load"
          message="The how-to shelf didn't answer — your place in every tutorial is saved on the rail, not lost."
          onRetry={() => setRetryNonce((n) => n + 1)}
        />
      ) : !visible ? (
        <NativeLoadingState isLight={isLight} message="Opening the how-to shelf…" />
      ) : visible.series.length === 0 && visible.standalone.length === 0 ? (
        <NativeEmptyState
          isLight={isLight}
          message={query ? "Nothing matches that yet." : "The first how-to videos are in production."}
          detail="When a tutorial lands, it shows up here — free to watch, with the walkthrough written out step by step."
        />
      ) : (
        <div className="mt-4 flex flex-col gap-5">
          {resumeCards.length > 0 && (
            <section>
              <p className={`text-[11px] font-bold uppercase tracking-widest ${muted(isLight)}`}>
                Continue where you left off
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {resumeCards.map((c) => (
                  <TutorialCardView key={c.id} isLight={isLight} cardData={c} progress={progressById.get(c.id)} onOpen={() => setSelectedSlug(c.slug)} resume />
                ))}
              </div>
            </section>
          )}
          {visible.series.map((s) => (
            <section key={s.id}>
              <p className={`text-sm font-black ${strong(isLight)}`}>
                {s.title}
                {s.isOfficial && <span className="ml-2 text-[11px] font-bold uppercase tracking-widest text-[#d4af37]">Bow Down Visuals</span>}
              </p>
              {s.description && <p className={`mt-0.5 text-sm ${muted(isLight)}`}>{s.description}</p>}
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {s.tutorials.map((c) => (
                  <TutorialCardView key={c.id} isLight={isLight} cardData={c} progress={progressById.get(c.id)} onOpen={() => setSelectedSlug(c.slug)} />
                ))}
              </div>
            </section>
          ))}
          {visible.standalone.length > 0 && (
            <section>
              <p className={`text-sm font-black ${strong(isLight)}`}>More tutorials</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {visible.standalone.map((c) => (
                  <TutorialCardView key={c.id} isLight={isLight} cardData={c} progress={progressById.get(c.id)} onOpen={() => setSelectedSlug(c.slug)} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </NativeCard>
  );
}

function TutorialCardView({
  isLight, cardData, progress, onOpen, resume = false,
}: {
  isLight: boolean;
  cardData: TutorialCard;
  progress?: TutorialProgress;
  onOpen: () => void;
  resume?: boolean;
}) {
  const state = tutorialCardState(progress);
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`world-academy-tutorial-${cardData.slug}`}
      className={`rounded-xl border p-3 text-left transition bdv-touch-target ${isLight ? "border-[#C9A84C]/40 hover:border-[#d4af37]" : "border-white/10 hover:border-[#d4af37]/60"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={`text-sm font-bold leading-snug ${strong(isLight)}`}>{cardData.title}</p>
        {state === "completed" ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-emerald-500">
            <CheckCircle2 className="h-4 w-4" /> Completed
          </span>
        ) : state === "in_progress" ? (
          <span className="shrink-0 text-xs font-bold text-[#d4af37]">In progress</span>
        ) : null}
      </div>
      {cardData.description && <p className={`mt-1 line-clamp-2 text-sm ${muted(isLight)}`}>{cardData.description}</p>}
      <div className={`mt-2 flex flex-wrap items-center gap-2 text-xs ${muted(isLight)}`}>
        <span>{cardData.chapterCount === 1 ? "1 chapter" : `${cardData.chapterCount} chapters`}</span>
        {cardData.hasVideo ? (
          <span><Play className="mr-1 inline h-3 w-3" />{cardData.videoDurationSec ? formatTimestamp(cardData.videoDurationSec) : "Video"}</span>
        ) : (
          <span className="font-semibold text-amber-500">Video in production — walkthrough ready</span>
        )}
        {resume && <span className="ml-auto font-bold text-[#d4af37]">Resume</span>}
      </div>
    </button>
  );
}

function TutorialDetailView({
  isLight, detail, loading, error, progress, onBack, onOpen, onBeat,
}: {
  isLight: boolean;
  detail: TutorialDetail | null;
  loading: boolean;
  error: boolean;
  progress?: TutorialProgress;
  onBack: () => void;
  onOpen: (slug: string) => void;
  onBeat: (tutorialId: string, beat: ProgressBeat) => Promise<void>;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastReportedRef = useRef(0);

  const seekToChapter = (startSec: number | null, chapterId: string) => {
    const video = videoRef.current;
    if (detail?.video && video && startSec !== null) {
      video.currentTime = startSec;
      void video.play().catch(() => {});
      void onBeat(detail.id, { chapterId, positionSec: startSec });
    } else if (detail) {
      void onBeat(detail.id, { chapterId });
    }
  };

  if (loading || (!detail && !error)) {
    return (
      <NativeCard isLight={isLight} title="How-To Videos">
        <NativeLoadingState isLight={isLight} message="Opening the tutorial…" />
      </NativeCard>
    );
  }
  if (error || !detail) {
    return (
      <NativeCard isLight={isLight} title="How-To Videos">
        <button type="button" onClick={onBack} className={`inline-flex items-center gap-1.5 text-sm font-bold ${muted(isLight)} hover:text-[#d4af37] bdv-touch-target`}>
          <ArrowLeft className="h-4 w-4" /> All tutorials
        </button>
        <NativeEmptyState isLight={isLight} message="That tutorial wouldn't load." detail="Head back to the shelf and try again." />
      </NativeCard>
    );
  }

  const resume = resumeChapter(detail, progress);
  const resumeText = resumeLabel(detail, progress);
  const doneSet = new Set(progress?.completedChapterIds ?? []);
  const levelResources = detail.resources.filter((r) => !r.chapterId);

  return (
    <NativeCard isLight={isLight} title={detail.title}>
      <button type="button" onClick={onBack} className={`inline-flex items-center gap-1.5 text-sm font-bold ${muted(isLight)} hover:text-[#d4af37] bdv-touch-target`}>
        <ArrowLeft className="h-4 w-4" /> All tutorials
      </button>
      <div className={`mt-2 flex flex-wrap items-center gap-2 text-xs ${muted(isLight)}`}>
        <span>{TUTORIAL_CATEGORY_LABELS[detail.category]}</span>
        {detail.isOfficial && <span className="font-bold uppercase tracking-widest text-[#d4af37]">Bow Down Visuals</span>}
        {!detail.isOfficial && detail.creator && <span>by {detail.creator.displayName}</span>}
        {progress?.status === "completed" && (
          <span className="inline-flex items-center gap-1 font-bold text-emerald-500">
            <CheckCircle2 className="h-4 w-4" /> Completed
          </span>
        )}
      </div>
      {detail.description && <p className={`mt-2 text-sm leading-relaxed ${muted(isLight)}`}>{detail.description}</p>}

      {resume && resumeText && (
        <div className={`mt-4 flex flex-wrap items-center gap-3 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
          <RotateCcw className="h-5 w-5 shrink-0 text-[#d4af37]" />
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-bold ${strong(isLight)}`}>Pick up where you left off</p>
            <p className={`text-sm ${muted(isLight)}`}>{resumeText}</p>
          </div>
          <button type="button" onClick={() => seekToChapter(resume.startSec, resume.id)} className={goldBtn}>
            Resume
          </button>
        </div>
      )}

      <div className="mt-4">
        {detail.video ? (
          <video
            ref={videoRef}
            controls
            preload="metadata"
            poster={detail.video.thumbnailUrl ?? undefined}
            src={detail.video.url}
            data-testid="world-academy-tutorial-video"
            className="w-full rounded-xl border border-[#d4af37]/25 bg-black"
            onLoadedMetadata={(e) => {
              if (progress && progress.lastPositionSec > 5 && progress.status !== "completed") {
                e.currentTarget.currentTime = progress.lastPositionSec;
              }
            }}
            onTimeUpdate={(e) => {
              const now = Math.floor(e.currentTarget.currentTime);
              if (Math.abs(now - lastReportedRef.current) >= 10) {
                lastReportedRef.current = now;
                const chapter = [...detail.chapters].reverse().find((c) => c.startSec !== null && c.startSec <= now);
                void onBeat(detail.id, { positionSec: now, chapterId: chapter?.id ?? null });
              }
            }}
            onPause={(e) => { void onBeat(detail.id, { positionSec: Math.floor(e.currentTarget.currentTime) }); }}
            onEnded={() => { void onBeat(detail.id, { markCompleted: true }); }}
          />
        ) : (
          <div className={`rounded-xl border p-4 text-center ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
            <Clapperboard className="mx-auto h-8 w-8 text-[#d4af37]" />
            <p className={`mt-2 text-sm font-bold ${strong(isLight)}`}>This tutorial's video is in production.</p>
            <p className={`mx-auto mt-1 max-w-md text-sm ${muted(isLight)}`}>
              The full walkthrough is written out below — every step, in order. When the video lands, it will play right here.
            </p>
          </div>
        )}
      </div>

      {detail.chapters.length > 0 && (
        <section className="mt-5">
          <p className={`text-[11px] font-bold uppercase tracking-widest ${muted(isLight)}`}>Chapters</p>
          <div className="mt-2 flex flex-col gap-2">
            {detail.chapters.map((chapter) => {
              const done = doneSet.has(chapter.id);
              const isResume = resume?.id === chapter.id;
              const chapterResources = detail.resources.filter((r) => r.chapterId === chapter.id);
              return (
                <article key={chapter.id} className={`rounded-xl border p-3 ${isResume ? "border-[#d4af37]" : isLight ? "border-[#C9A84C]/30" : "border-white/10"}`}>
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => void onBeat(detail.id, done ? { uncompleteChapterId: chapter.id } : { completeChapterId: chapter.id })}
                      className="mt-0.5 shrink-0 bdv-touch-target"
                      aria-label={done ? "Mark chapter not done" : "Mark chapter done"}
                    >
                      {done ? <CheckCircle2 className="h-6 w-6 text-emerald-500" /> : <Circle className={`h-6 w-6 ${muted(isLight)}`} />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={`text-sm font-bold ${strong(isLight)}`}>{chapter.position}. {chapter.title}</p>
                        {chapter.startSec !== null && (
                          <button type="button" onClick={() => seekToChapter(chapter.startSec, chapter.id)} className="rounded-full bg-[#d4af37]/15 px-2 py-0.5 text-[11px] font-bold text-[#d4af37] bdv-touch-target">
                            {formatTimestamp(chapter.startSec)}
                          </button>
                        )}
                      </div>
                      {chapter.body && <p className={`mt-1 text-sm leading-relaxed ${muted(isLight)}`}>{chapter.body}</p>}
                      {chapterResources.length > 0 && (
                        <p className={`mt-2 text-xs ${muted(isLight)}`}>
                          With this chapter: {chapterResources.map((r) => r.title).join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {detail.chapters.length === 0 && progress?.status !== "completed" && (
        <button type="button" onClick={() => void onBeat(detail.id, { markCompleted: true })} className={`${goldBtn} mt-5`}>
          <CheckCircle2 className="h-4 w-4" /> Mark as complete
        </button>
      )}

      {levelResources.length > 0 && (
        <p className={`mt-5 text-xs ${muted(isLight)}`}>
          Downloads & links with this tutorial: {levelResources.map((r) => r.title).join(" · ")}
        </p>
      )}

      {detail.transcript && (
        <details className={`mt-5 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`}>
          <summary className={`cursor-pointer text-sm font-bold ${strong(isLight)}`}>Transcript</summary>
          <pre className={`mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed ${muted(isLight)}`}>{detail.transcript}</pre>
        </details>
      )}

      {detail.next && (
        <button
          type="button"
          onClick={() => onOpen(detail.next!.slug)}
          className={`mt-5 flex w-full items-center gap-3 rounded-xl border p-3 text-left transition bdv-touch-target ${isLight ? "border-[#C9A84C]/40 hover:border-[#d4af37]" : "border-white/10 hover:border-[#d4af37]/60"}`}
        >
          <div className="min-w-0 flex-1">
            <p className={`text-[11px] font-bold uppercase tracking-widest ${muted(isLight)}`}>Next up</p>
            <p className={`mt-0.5 truncate text-sm font-bold ${strong(isLight)}`}>{detail.next.title}</p>
          </div>
          <Play className="h-5 w-5 shrink-0 text-[#d4af37]" />
        </button>
      )}
    </NativeCard>
  );
}

/* ─── Guides shelf (the guides tab) ──────────────────────────────── */

function GuidesShelf({ isLight, onOpenAcademy }: { isLight: boolean; onOpenAcademy: () => void }) {
  const { t } = useTranslation();
  return (
    <NativeCard isLight={isLight} title="Guides & Services — the business side of being a creator">
      <p className={`text-sm leading-relaxed ${muted(isLight)}`}>{t("guides.heroSub")}</p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {ACADEMY_GUIDE_KEYS.map((key) => (
          <div key={key} className={`flex flex-col rounded-xl border p-4 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
            <span className="text-[11px] font-bold uppercase tracking-widest text-[#d4af37]">
              {t(`guides.${key}.badge`)}
            </span>
            <p className={`mt-2 text-[11px] font-bold uppercase tracking-[0.2em] ${muted(isLight)}`}>
              {t(`guides.${key}.tagline`)}
            </p>
            <p className={`mt-1 text-base font-bold ${strong(isLight)}`}>{t(`guides.${key}.name`)}</p>
            <p className={`mt-1 text-sm leading-relaxed ${muted(isLight)}`}>{t(`guides.${key}.description`)}</p>
            <ul className="mt-3 flex-1 space-y-1.5">
              {ACADEMY_GUIDE_BULLETS.map((i) => (
                <li key={i} className={`flex items-start gap-2 text-sm ${muted(isLight)}`}>
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
                  {t(`guides.${key}.bullet${i}`)}
                </li>
              ))}
            </ul>
            {key === "academy" ? (
              <button type="button" data-testid="world-academy-guide-open-academy" onClick={onOpenAcademy} className={`${goldBtn} mt-4 self-start`}>
                <GraduationCap className="h-4 w-4" /> Open the Academy shelf
              </button>
            ) : (
              <p className={`mt-4 text-xs leading-relaxed ${muted(isLight)}`}>
                The full guided {key === "llc" ? "LLC" : "copyright"} flow is its own
                surface — this card is the guide's own summary, read right here; the
                desk does not fake the flow.
              </p>
            )}
          </div>
        ))}
      </div>
      <div className={`mt-5 rounded-xl border p-4 ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`}>
        <p className={`text-sm font-bold ${strong(isLight)}`}>{t("guides.whyTitle")}</p>
        <div className="mt-2 grid gap-4 text-sm leading-relaxed md:grid-cols-3">
          <div>
            <p className={`font-bold ${strong(isLight)}`}>{t("guides.whyBrandTitle")}</p>
            <p className={muted(isLight)}>{t("guides.whyBrandBody")}</p>
          </div>
          <div>
            <p className={`font-bold ${strong(isLight)}`}>{t("guides.whyRegTitle")}</p>
            <p className={muted(isLight)}>{t("guides.whyRegBody")}</p>
          </div>
          <div>
            <p className={`font-bold ${strong(isLight)}`}>{t("guides.whySkillTitle")}</p>
            <p className={muted(isLight)}>{t("guides.whySkillBody")}</p>
          </div>
        </div>
      </div>
      <p className={`mt-4 text-center text-xs ${muted(isLight)}`}>{t("guides.disclaimer")}</p>
    </NativeCard>
  );
}

/* ─── My Courses shelf (the courses tab) ─────────────────────────── */

function MyCoursesShelf({ isLight }: { isLight: boolean }) {
  const { user, getAccessToken } = useAuth();
  const [courses, setCourses] = useState<MyCourse[] | null>(null);
  const [notLive, setNotLive] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) { setCourses([]); return; }
    setLoadError(false);
    try {
      setCourses(await fetchMyCourses(getAccessToken));
    } catch (err) {
      if ((err as { code?: string }).code === "COURSES_NOT_LIVE") setNotLive(true);
      else setLoadError(true);
    }
  }, [user, getAccessToken]);

  useEffect(() => { void load(); }, [load]);

  if (selectedId) {
    return (
      <MyCoursePlayer
        isLight={isLight}
        productId={selectedId}
        onBack={() => { setSelectedId(null); void load(); }}
      />
    );
  }

  return (
    <NativeCard isLight={isLight} title="My Courses — yours to learn from forever">
      <p className={`text-sm ${muted(isLight)}`}>
        The courses you've bought (and the ones you teach) — pick up exactly where
        you left off. Your place is saved as you go.
      </p>
      {notLive ? (
        <NativeEmptyState
          isLight={isLight}
          message="Courses are on their way."
          detail="Creator courses launch with the next update — when they land, everything you buy shows up right here."
        />
      ) : loadError ? (
        <NativeErrorState
          isLight={isLight}
          title="Your courses wouldn't load"
          message="The shelf didn't answer — your progress is saved on the rail, not lost."
          onRetry={() => void load()}
        />
      ) : !courses ? (
        <NativeLoadingState isLight={isLight} message="Opening your course shelf…" />
      ) : courses.length === 0 ? (
        <NativeEmptyState
          isLight={isLight}
          message="No courses yet."
          detail="When you buy a creator's course in their store, it lands here — buying happens at the Marketplace stand, learning happens here."
        />
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {courses.map((c) => (
            <button
              key={c.product.id}
              type="button"
              data-testid={`world-academy-my-course-${c.product.id}`}
              onClick={() => setSelectedId(c.product.id)}
              className={`rounded-xl border p-3 text-left transition bdv-touch-target ${isLight ? "border-[#C9A84C]/40 hover:border-[#d4af37]" : "border-white/10 hover:border-[#d4af37]/60"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className={`text-sm font-bold leading-snug ${strong(isLight)}`}>{c.product.title}</p>
                {c.access === "owner" && (
                  <span className="shrink-0 rounded-full bg-[#d4af37]/15 px-2 py-0.5 text-[11px] font-bold text-[#d4af37]">You teach this</span>
                )}
              </div>
              {c.product.creatorName && c.access !== "owner" && (
                <p className={`mt-0.5 text-xs ${muted(isLight)}`}>by {c.product.creatorName}</p>
              )}
              <div className={`mt-3 h-2 overflow-hidden rounded-full ${isLight ? "bg-[#C9A84C]/25" : "bg-white/10"}`}>
                <div className="h-full rounded-full bg-[#d4af37]" style={{ width: `${c.progressPct}%` }} />
              </div>
              <p className={`mt-2 text-xs font-semibold ${muted(isLight)}`}>
                {c.lessonCount === 0
                  ? "Curriculum coming soon"
                  : `${c.completedLessons} of ${c.lessonCount} lessons done · ${c.progressPct}%`}
              </p>
            </button>
          ))}
        </div>
      )}
    </NativeCard>
  );
}

function MyCoursePlayer({
  isLight, productId, onBack,
}: {
  isLight: boolean;
  productId: string;
  onBack: () => void;
}) {
  const { getAccessToken } = useAuth();
  const [course, setCourse] = useState<CourseLearn | null>(null);
  const [error, setError] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const lastReportedRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const c = await fetchCourseLearn(getAccessToken, productId);
      setCourse(c);
      setActiveId((prev) => prev ?? resumeLesson(c)?.id ?? null);
    } catch { setError(true); }
  }, [getAccessToken, productId]);

  useEffect(() => { void load(); }, [load]);

  const beat = useCallback(
    async (lessonId: string, b: { positionSec?: number; complete?: boolean; uncomplete?: boolean; markCompleted?: boolean }) => {
      try {
        await recordLessonProgress(getAccessToken, productId, lessonId, b);
        const c = await fetchCourseLearn(getAccessToken, productId);
        setCourse(c);
      } catch { /* progress is best-effort — a failed write never blocks the lesson */ }
    },
    [getAccessToken, productId],
  );

  if (error) {
    return (
      <NativeCard isLight={isLight} title="My Courses">
        <button type="button" onClick={onBack} className={`inline-flex items-center gap-1.5 text-sm font-bold ${muted(isLight)} hover:text-[#d4af37] bdv-touch-target`}>
          <ArrowLeft className="h-4 w-4" /> All my courses
        </button>
        <NativeEmptyState isLight={isLight} message="This course wouldn't load." detail="Head back to the shelf and try again." />
      </NativeCard>
    );
  }
  if (!course) {
    return (
      <NativeCard isLight={isLight} title="My Courses">
        <NativeLoadingState isLight={isLight} message="Opening the course…" />
      </NativeCard>
    );
  }

  const lessons = flattenLessons(course);
  const active: CourseLesson | null = lessons.find((l) => l.id === activeId) ?? null;
  const resume = resumeLesson(course);

  return (
    <NativeCard isLight={isLight} title={course.product.title}>
      <button type="button" onClick={onBack} className={`inline-flex items-center gap-1.5 text-sm font-bold ${muted(isLight)} hover:text-[#d4af37] bdv-touch-target`}>
        <ArrowLeft className="h-4 w-4" /> All my courses
      </button>
      {course.product.creatorName && <p className={`mt-1 text-sm ${muted(isLight)}`}>by {course.product.creatorName}</p>}
      <div className={`mt-3 h-2 overflow-hidden rounded-full ${isLight ? "bg-[#C9A84C]/25" : "bg-white/10"}`}>
        <div className="h-full rounded-full bg-[#d4af37]" style={{ width: `${course.progressPct}%` }} />
      </div>
      <p className={`mt-2 text-xs font-semibold ${muted(isLight)}`}>
        {course.completedLessons} of {course.lessonCount} lessons done · {course.progressPct}%
      </p>

      {resume && active?.id !== resume.id && (
        <div className={`mt-4 flex flex-wrap items-center gap-3 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
          <RotateCcw className="h-5 w-5 shrink-0 text-[#d4af37]" />
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-bold ${strong(isLight)}`}>Pick up where you left off</p>
            <p className={`text-sm ${muted(isLight)}`}>{resume.title}</p>
          </div>
          <button type="button" onClick={() => setActiveId(resume.id)} className={goldBtn}>Resume</button>
        </div>
      )}

      {active && !active.locked && (
        <div className="mt-5">
          {active.video ? (
            <video
              key={active.id}
              controls
              preload="metadata"
              poster={active.video.thumbnailUrl ?? undefined}
              src={active.video.url}
              data-testid="world-academy-course-video"
              className="w-full rounded-xl border border-[#d4af37]/25 bg-black"
              onLoadedMetadata={(e) => {
                const pos = active.progress?.lastPositionSec ?? 0;
                if (pos > 5 && active.progress?.status !== "completed") e.currentTarget.currentTime = pos;
              }}
              onTimeUpdate={(e) => {
                const now = Math.floor(e.currentTarget.currentTime);
                if (Math.abs(now - lastReportedRef.current) >= 10) {
                  lastReportedRef.current = now;
                  void beat(active.id, { positionSec: now });
                }
              }}
              onPause={(e) => { void beat(active.id, { positionSec: Math.floor(e.currentTarget.currentTime) }); }}
              onEnded={() => { void beat(active.id, { markCompleted: true }); }}
            />
          ) : active.kind === "video" ? (
            <div className={`rounded-xl border p-4 text-center ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
              <p className={`text-sm font-semibold ${strong(isLight)}`}>This lesson's video is still in production.</p>
              <p className={`mt-1 text-sm ${muted(isLight)}`}>The lesson notes below carry the teaching until it lands.</p>
            </div>
          ) : null}
          <p className={`mt-3 text-base font-black ${strong(isLight)}`}>{active.title}</p>
          {active.body && <p className={`mt-2 whitespace-pre-wrap text-sm leading-relaxed ${muted(isLight)}`}>{active.body}</p>}
          {active.attachment && (
            <p className={`mt-3 text-xs ${muted(isLight)}`}>
              Attachment with this lesson: {active.attachment.title}
            </p>
          )}
          <div className="mt-4">
            {active.progress?.status === "completed" ? (
              <button type="button" onClick={() => void beat(active.id, { uncomplete: true })} className={chipBtn(isLight)}>
                <CheckCircle2 className="h-4 w-4" /> Completed — tap to reopen
              </button>
            ) : (
              <button type="button" onClick={() => void beat(active.id, { complete: true })} className={goldBtn}>
                <CheckCircle2 className="h-4 w-4" /> Mark lesson complete
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-5">
        {course.sections.map((section) => (
          <section key={section.id}>
            <p className={`text-[11px] font-bold uppercase tracking-widest ${muted(isLight)}`}>{section.title}</p>
            <div className="mt-2 flex flex-col gap-2">
              {section.lessons.map((lesson) => {
                const done = lesson.progress?.status === "completed";
                const isActive = active?.id === lesson.id;
                return (
                  <button
                    key={lesson.id}
                    type="button"
                    disabled={lesson.locked}
                    onClick={() => setActiveId(lesson.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left bdv-touch-target ${isActive ? "border-[#d4af37]" : isLight ? "border-[#C9A84C]/30" : "border-white/10"} ${lesson.locked ? "opacity-60" : ""}`}
                  >
                    {lesson.locked
                      ? <Lock className="h-5 w-5 shrink-0 text-white/30" />
                      : done
                        ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                        : lesson.kind === "video"
                          ? <Play className="h-5 w-5 shrink-0 text-[#d4af37]" />
                          : <BookOpen className="h-5 w-5 shrink-0 text-[#d4af37]" />}
                    <span className={`min-w-0 flex-1 truncate text-sm font-bold ${strong(isLight)}`}>{lesson.title}</span>
                    {lesson.isPreview && <span className="shrink-0 rounded-full bg-[#d4af37]/15 px-2 py-0.5 text-[11px] font-bold text-[#d4af37]">Preview</span>}
                    {lesson.locked && lesson.lockReason === "drip" && (
                      <span className={`shrink-0 text-[11px] font-bold ${muted(isLight)}`}>{unlockLabel(lesson.unlockAt) ?? "Locked"}</span>
                    )}
                    {lesson.locked && lesson.lockReason === "purchase" && (
                      <span className={`shrink-0 text-[11px] font-bold ${muted(isLight)}`}>Locked</span>
                    )}
                    {!lesson.locked && lesson.progress?.status === "in_progress" && (
                      <span className="shrink-0 text-[11px] font-bold text-[#d4af37]">In progress</span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {course.access === "locked" && (
        <div className={`mt-6 rounded-xl border p-4 text-center ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
          <p className={`text-sm font-semibold ${strong(isLight)}`}>Enjoying the preview?</p>
          <p className={`mt-1 text-sm ${muted(isLight)}`}>
            The full course unlocks the moment you buy it — buying happens at the
            creator's store stand in the Marketplace, and the course lands right
            back here. This desk never walks you out to a checkout page.
          </p>
        </div>
      )}
    </NativeCard>
  );
}
