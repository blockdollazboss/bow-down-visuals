import { useEffect, useState } from "react";
import { Link } from "wouter";
import { GraduationCap, Lock, Play, FileText, Eye, Loader2, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchCourseOutline,
  fetchCourseLearn,
  curriculumSummary,
  type CourseOutline as CourseOutlineDto,
  type CourseLesson,
} from "@/lib/courses";

/* ─── Course curriculum outline — docked on the storefront product
   page when the product is a course. This is the sales page: buyers
   see the full curriculum STRUCTURE (sections, lesson titles, drip
   schedule, the free preview) and never the lesson content — content
   is enforced server-side; this component only ever receives content
   for preview lessons, through the learn read, when signed in. ──── */

export default function CourseOutline({ productId }: { productId: string }) {
  const { user, getAccessToken } = useAuth();
  const [outline, setOutline] = useState<CourseOutlineDto | null>(null);
  const [notLive, setNotLive] = useState(false);
  const [previewLesson, setPreviewLesson] = useState<CourseLesson | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const o = await fetchCourseOutline(productId, getAccessToken);
        if (alive) setOutline(o);
      } catch (err) {
        if (alive && (err as { code?: string }).code === "COURSES_NOT_LIVE") setNotLive(true);
        /* A non-course product (or a load failure) renders nothing —
           the product page already shows its own state. */
      }
    })();
    return () => { alive = false; };
  }, [productId, getAccessToken]);

  if (notLive || !outline) return null;

  async function openPreview(lessonId: string) {
    if (!user) return;
    setPreviewLoading(true);
    try {
      const learn = await fetchCourseLearn(getAccessToken, productId);
      const found = learn.sections.flatMap((s) => s.lessons).find((l) => l.id === lessonId);
      if (found && !found.locked) setPreviewLesson(found);
    } catch { /* preview is a garnish — the outline already sold the course */ }
    setPreviewLoading(false);
  }

  return (
    <section className="mt-8 rounded-2xl border border-primary/25 bg-white/[0.03] p-5">
      <h2 className="flex items-center gap-2 text-base font-black text-white">
        <GraduationCap className="h-5 w-5 text-primary" /> Course curriculum
      </h2>
      <p className="mt-1 text-sm text-white/50">
        {curriculumSummary(outline.sections)}
        {outline.access === "purchased" || outline.access === "owner"
          ? " · You own this course — it's waiting in My Courses."
          : " · Buy once, learn forever. Lessons unlock on the schedule shown."}
      </p>

      <div className="mt-4 space-y-5">
        {outline.sections.map((section) => (
          <div key={section.id}>
            <h3 className="text-sm font-bold text-white/85">{section.title}</h3>
            <ul className="mt-2 space-y-1.5">
              {section.lessons.map((lesson) => (
                <li key={lesson.id} className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] px-3 py-2 text-sm">
                  {lesson.kind === "video"
                    ? <Play className="h-4 w-4 shrink-0 text-primary" />
                    : <FileText className="h-4 w-4 shrink-0 text-primary" />}
                  <span className="min-w-0 flex-1 truncate text-white/80">{lesson.title}</span>
                  {lesson.isPreview ? (
                    user ? (
                      <button
                        type="button"
                        onClick={() => void openPreview(lesson.id)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-bold text-primary hover:bg-primary/25"
                      >
                        {previewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} Free preview
                      </button>
                    ) : (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-bold text-primary">
                        <Eye className="h-3 w-3" /> Free preview
                      </span>
                    )
                  ) : (
                    <Lock className="h-3.5 w-3.5 shrink-0 text-white/30" />
                  )}
                  {lesson.dripDayOffset > 0 && (
                    <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[11px] font-semibold text-white/50">
                      Day {lesson.dripDayOffset}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {previewLesson && (
        <div className="mt-5 rounded-xl border border-primary/30 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <CheckCircle2 className="h-4 w-4 text-primary" /> Preview: {previewLesson.title}
            <button type="button" onClick={() => setPreviewLesson(null)} className="ml-auto text-xs font-semibold text-white/40 hover:text-white">Close</button>
          </p>
          {previewLesson.video && (
            <video controls preload="metadata" poster={previewLesson.video.thumbnailUrl ?? undefined} src={previewLesson.video.url} className="mt-3 w-full rounded-xl bg-black" />
          )}
          {previewLesson.body && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-white/70">{previewLesson.body}</p>}
        </div>
      )}

      {(outline.access === "purchased" || outline.access === "owner") && (
        <Link href="/academy?tab=courses" className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-black">
          <GraduationCap className="h-4 w-4" /> Go to My Courses
        </Link>
      )}
      {!user && (
        <p className="mt-3 text-xs text-white/40">
          <Link href="/login" className="font-semibold text-primary hover:underline">Sign in</Link> to watch the free preview lesson.
        </p>
      )}
    </section>
  );
}
