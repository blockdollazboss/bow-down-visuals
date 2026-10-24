import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  GraduationCap, Loader2, ArrowLeft, Play, FileText, Lock, CheckCircle2,
  RotateCcw, Download, Link2, ShoppingBag,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
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

/* ─── My Courses — the Academy's course shelf + player ─────────────────
   Lives inside the Academy page as its own tab (never a top-level
   page). The shelf lists every course the fan owns (bought or
   created) with honest progress; the player follows the Academy
   tutorial player's pattern exactly: video on top with the resume
   point restored, an ordered lesson list with per-lesson completion,
   position beats saved server-side as you watch, drip locks shown
   with their unlock date. Lesson content arrives only for lessons
   the server has opened for this fan. */

export default function MyCoursesPanel() {
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const [courses, setCourses] = useState<MyCourse[] | null>(null);
  const [notLive, setNotLive] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const card = isLight
    ? "rounded-2xl border border-[#C9A84C]/50 bg-[#F7ECD2]"
    : "rounded-2xl border border-primary/25 bg-zinc-950";
  const sub = isLight ? "text-zinc-600" : "text-zinc-400";
  const head = isLight ? "text-zinc-900" : "text-white";

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
      <CoursePlayer
        productId={selectedId}
        onBack={() => { setSelectedId(null); void load(); }}
        card={card} sub={sub} head={head}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-8 md:px-6">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 border border-primary/25">
          <GraduationCap className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h2 className={`text-2xl font-black md:text-3xl ${head}`}>My Courses</h2>
          <p className={`mt-1 max-w-xl text-sm ${sub}`}>
            The courses you've bought (and the ones you teach) — pick up exactly where you left off. Your place is saved as you go.
          </p>
        </div>
      </div>

      {!user ? (
        <div className={`${card} mt-8 p-6 text-center`}>
          <p className={`text-sm font-semibold ${head}`}>
            <Link href="/login" className="font-bold text-primary hover:underline">Sign in</Link>
            <span className={sub}> to see your courses.</span>
          </p>
        </div>
      ) : notLive ? (
        <div className={`${card} mt-8 p-6 text-center`}>
          <GraduationCap className="mx-auto h-8 w-8 text-primary" />
          <p className={`mt-3 text-sm font-semibold ${head}`}>Courses are on their way.</p>
          <p className={`mt-1 text-sm ${sub}`}>Creator courses launch with the next update — when they land, everything you buy shows up right here.</p>
        </div>
      ) : loadError ? (
        <div className={`${card} mt-8 p-6 text-center`}>
          <p className={`text-sm font-semibold ${head}`}>Your courses wouldn't load.</p>
          <button type="button" onClick={() => void load()} className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black">
            <RotateCcw className="h-4 w-4" /> Retry
          </button>
        </div>
      ) : !courses ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : courses.length === 0 ? (
        <div className={`${card} mt-8 p-6 text-center`}>
          <ShoppingBag className="mx-auto h-8 w-8 text-primary" />
          <p className={`mt-3 text-sm font-semibold ${head}`}>No courses yet.</p>
          <p className={`mt-1 text-sm ${sub}`}>When you buy a creator's course in their store, it lands here — yours to learn from forever.</p>
        </div>
      ) : (
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {courses.map((c) => (
            <button key={c.product.id} type="button" onClick={() => setSelectedId(c.product.id)} className={`${card} p-4 text-left transition hover:border-primary/60`}>
              <div className="flex items-start justify-between gap-3">
                <p className={`text-base font-bold leading-snug ${head}`}>{c.product.title}</p>
                {c.access === "owner" && (
                  <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold text-primary">You teach this</span>
                )}
              </div>
              {c.product.creatorName && c.access !== "owner" && (
                <p className={`mt-0.5 text-xs ${sub}`}>by {c.product.creatorName}</p>
              )}
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-primary" style={{ width: `${c.progressPct}%` }} />
              </div>
              <p className={`mt-2 text-xs font-semibold ${sub}`}>
                {c.lessonCount === 0
                  ? "Curriculum coming soon"
                  : `${c.completedLessons} of ${c.lessonCount} lessons done · ${c.progressPct}%`}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── the player ─────────────────────────────────────────────────────── */

function CoursePlayer({ productId, onBack, card, sub, head }: {
  productId: string;
  onBack: () => void;
  card: string; sub: string; head: string;
}) {
  const { getAccessToken } = useAuth();
  const [course, setCourse] = useState<CourseLearn | null>(null);
  const [error, setError] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastReportedRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const c = await fetchCourseLearn(getAccessToken, productId);
      setCourse(c);
      setActiveId((prev) => prev ?? resumeLesson(c)?.id ?? null);
    } catch { setError(true); }
  }, [getAccessToken, productId]);

  useEffect(() => { void load(); }, [load]);

  const beat = useCallback(async (lessonId: string, b: { positionSec?: number; complete?: boolean; uncomplete?: boolean; markCompleted?: boolean }) => {
    try {
      await recordLessonProgress(getAccessToken, productId, lessonId, b);
      /* Refresh progress from the server's derived state. */
      const c = await fetchCourseLearn(getAccessToken, productId);
      setCourse(c);
    } catch { /* progress is best-effort — a failed write never blocks the lesson */ }
  }, [getAccessToken, productId]);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8">
        <BackButton onBack={onBack} sub={sub} />
        <div className={`${card} mt-6 p-6 text-center`}><p className={`text-sm font-semibold ${head}`}>This course wouldn't load.</p></div>
      </div>
    );
  }
  if (!course) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const lessons = flattenLessons(course);
  const active: CourseLesson | null = lessons.find((l) => l.id === activeId) ?? null;
  const resume = resumeLesson(course);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8 md:px-6">
      <BackButton onBack={onBack} sub={sub} />
      <h2 className={`mt-4 text-2xl font-black md:text-3xl ${head}`}>{course.product.title}</h2>
      {course.product.creatorName && (
        <p className={`mt-1 text-sm ${sub}`}>by {course.product.creatorName}</p>
      )}
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-primary" style={{ width: `${course.progressPct}%` }} />
      </div>
      <p className={`mt-2 text-xs font-semibold ${sub}`}>{course.completedLessons} of {course.lessonCount} lessons done · {course.progressPct}%</p>

      {/* resume banner — the tutorial player's rule */}
      {resume && active?.id !== resume.id && (
        <div className={`${card} mt-5 flex flex-wrap items-center gap-3 p-4`}>
          <RotateCcw className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-bold ${head}`}>Pick up where you left off</p>
            <p className={`text-sm ${sub}`}>{resume.title}</p>
          </div>
          <button type="button" onClick={() => setActiveId(resume.id)} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black">Resume</button>
        </div>
      )}

      {/* active lesson */}
      {active && !active.locked && (
        <div className="mt-6">
          {active.video ? (
            <video
              key={active.id}
              ref={videoRef}
              controls
              preload="metadata"
              poster={active.video.thumbnailUrl ?? undefined}
              src={active.video.url}
              className="w-full rounded-2xl border border-primary/25 bg-black"
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
            <div className={`${card} p-6 text-center`}>
              <p className={`text-sm font-semibold ${head}`}>This lesson's video is still in production.</p>
              <p className={`mt-1 text-sm ${sub}`}>The lesson notes below carry the teaching until it lands.</p>
            </div>
          ) : null}
          <h3 className={`mt-4 text-lg font-black ${head}`}>{active.title}</h3>
          {active.body && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/70">{active.body}</p>}
          {active.attachment && (
            <a href={active.attachment.url} target={active.attachment.url.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-bold text-white/80 hover:border-primary/60">
              {active.attachment.url.includes("download") ? <Download className="h-3.5 w-3.5 text-primary" /> : <Link2 className="h-3.5 w-3.5 text-primary" />} {active.attachment.title}
            </a>
          )}
          <div className="mt-4">
            {active.progress?.status === "completed" ? (
              <button type="button" onClick={() => void beat(active.id, { uncomplete: true })} className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 px-4 py-2.5 text-sm font-bold text-emerald-400">
                <CheckCircle2 className="h-4 w-4" /> Completed — tap to reopen
              </button>
            ) : (
              <button type="button" onClick={() => void beat(active.id, { complete: true })} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black">
                <CheckCircle2 className="h-4 w-4" /> Mark lesson complete
              </button>
            )}
          </div>
        </div>
      )}

      {/* lesson list */}
      <div className="mt-8 space-y-6">
        {course.sections.map((section) => (
          <section key={section.id}>
            <h3 className={`text-sm font-black uppercase tracking-widest ${sub}`}>{section.title}</h3>
            <div className="mt-3 space-y-2">
              {section.lessons.map((lesson) => {
                const done = lesson.progress?.status === "completed";
                const isActive = active?.id === lesson.id;
                return (
                  <button
                    key={lesson.id}
                    type="button"
                    disabled={lesson.locked}
                    onClick={() => { setActiveId(lesson.id); window.scrollTo({ top: 0 }); }}
                    className={`${card} flex w-full items-center gap-3 p-3.5 text-left ${isActive ? "ring-1 ring-primary" : ""} ${lesson.locked ? "opacity-60" : "transition hover:border-primary/60"}`}
                  >
                    {lesson.locked
                      ? <Lock className="h-5 w-5 shrink-0 text-white/30" />
                      : done
                        ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                        : lesson.kind === "video"
                          ? <Play className="h-5 w-5 shrink-0 text-primary" />
                          : <FileText className="h-5 w-5 shrink-0 text-primary" />}
                    <span className={`min-w-0 flex-1 truncate text-sm font-bold ${head}`}>{lesson.title}</span>
                    {lesson.isPreview && <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold text-primary">Preview</span>}
                    {lesson.locked && lesson.lockReason === "drip" && (
                      <span className="shrink-0 text-[11px] font-bold text-white/50">{unlockLabel(lesson.unlockAt) ?? "Locked"}</span>
                    )}
                    {lesson.locked && lesson.lockReason === "purchase" && (
                      <span className="shrink-0 text-[11px] font-bold text-white/50">Locked</span>
                    )}
                    {!lesson.locked && lesson.progress?.status === "in_progress" && (
                      <span className="shrink-0 text-[11px] font-bold text-primary">In progress</span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {course.access === "locked" && (
        <div className={`${card} mt-8 p-5 text-center`}>
          <p className={`text-sm font-semibold ${head}`}>Enjoying the preview?</p>
          <p className={`mt-1 text-sm ${sub}`}>The full course unlocks the moment you buy it — every lesson, forever.</p>
          <Link href={course.product.buyUrl} className="mt-3 inline-flex rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black">Get the full course</Link>
        </div>
      )}
    </div>
  );
}

function BackButton({ onBack, sub }: { onBack: () => void; sub: string }) {
  return (
    <button type="button" onClick={onBack} className={`inline-flex items-center gap-1.5 text-sm font-bold ${sub} hover:text-primary`}>
      <ArrowLeft className="h-4 w-4" /> All my courses
    </button>
  );
}
