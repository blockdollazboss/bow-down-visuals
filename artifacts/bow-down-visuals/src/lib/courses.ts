/* ─── Creator Courses — client ──────────────────────────────────────────
   Mirrors the API DTOs from routes/courses.ts. A course is a store
   product (kind='course'): it sells on the storefront rail, and the
   completed order is the buyer's unlock. This lib is the read/write
   path for the three docked surfaces: the Course Builder (seller
   dashboard), the curriculum outline (storefront product page), and
   My Courses (Academy tab) with its tutorial-player-style playback.
   Prices here are always the creator's own — nothing in this file
   suggests, defaults, or invents a price. */

export type CourseAccess = "owner" | "purchased" | "locked";
export type LessonLockReason = "purchase" | "drip" | null;

export interface CourseProduct {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  free: boolean;
  isActive: boolean;
  profileId: string;
  creatorSlug: string | null;
  creatorName: string | null;
  productUrl: string;
  buyUrl: string;
}

export interface CourseLessonOutline {
  id: string;
  title: string;
  position: number;
  kind: "video" | "text";
  dripDayOffset: number;
  isPreview: boolean;
  hasVideo: boolean;
  durationSec: number | null;
}

export interface CourseSectionOutline {
  id: string;
  title: string;
  position: number;
  lessons: CourseLessonOutline[];
}

export interface CourseOutline {
  product: CourseProduct;
  access: CourseAccess;
  purchasedAt: string | null;
  lessonCount: number;
  sections: CourseSectionOutline[];
}

export interface CourseLesson extends CourseLessonOutline {
  locked: boolean;
  lockReason: LessonLockReason;
  unlockAt: string | null;
  body: string | null;
  video: { id: string; url: string; thumbnailUrl: string | null; durationSec: number } | null;
  attachment: { title: string; url: string } | null;
  progress: { status: string; lastPositionSec: number; completedAt: string | null } | null;
}

export interface CourseSection {
  id: string;
  title: string;
  position: number;
  lessons: CourseLesson[];
}

export interface CourseLearn {
  product: CourseProduct;
  access: CourseAccess;
  purchasedAt: string | null;
  lessonCount: number;
  sections: CourseSection[];
  completedLessons: number;
  progressPct: number;
}

export interface MyCourse {
  product: CourseProduct;
  access: CourseAccess;
  lessonCount: number;
  completedLessons: number;
  progressPct: number;
  purchasedAt: string | null;
}

export interface CurriculumLessonInput {
  title: string;
  kind?: "video" | "text";
  videoId?: string | null;
  body?: string;
  attachmentTitle?: string | null;
  attachmentUrl?: string | null;
  dripDayOffset?: number;
  isPreview?: boolean;
}
export interface CurriculumSectionInput {
  title: string;
  lessons: CurriculumLessonInput[];
}
export interface CreatedCurriculum {
  sections: Array<{
    id: string;
    title: string;
    position: number;
    lessons: Array<{
      id: string; title: string; position: number; kind: "video" | "text";
      videoId: string | null; body: string;
      attachmentTitle: string | null; attachmentUrl: string | null;
      dripDayOffset: number; isPreview: boolean;
    }>;
  }>;
}

/* ─── pure helpers (unit-tested in courses.test.ts) ──────────────────── */

/** Every lesson in curriculum order — the player walks this list. */
export function flattenLessons(course: Pick<CourseLearn, "sections">): CourseLesson[] {
  return course.sections.flatMap((s) => s.lessons);
}

/** The lesson the player opens first: the resume point — the first
    unlocked, not-yet-completed lesson; else the first unlocked one;
    else null (everything locked or finished-open). Mirrors the
    tutorial player's resume rule. */
export function resumeLesson(course: Pick<CourseLearn, "sections">): CourseLesson | null {
  const lessons = flattenLessons(course);
  const open = lessons.filter((l) => !l.locked);
  if (open.length === 0) return null;
  return open.find((l) => l.progress?.status !== "completed") ?? open[0] ?? null;
}

/** Completed / total as a whole percent (0 for an empty course). */
export function progressPct(total: number, completed: number): number {
  if (total <= 0) return 0;
  return Math.round((Math.min(completed, total) / total) * 100);
}

/** "Unlocks Oct 31" for a drip-locked lesson (buyer-local date). */
export function unlockLabel(unlockAt: string | null): string | null {
  if (!unlockAt) return null;
  const d = new Date(unlockAt);
  if (Number.isNaN(d.getTime())) return null;
  return `Unlocks ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** The outline's one-line curriculum summary: "3 sections · 12 lessons". */
export function curriculumSummary(sections: CourseSectionOutline[]): string {
  const lessons = sections.reduce((n, s) => n + s.lessons.length, 0);
  const sWord = sections.length === 1 ? "section" : "sections";
  const lWord = lessons === 1 ? "lesson" : "lessons";
  return `${sections.length} ${sWord} · ${lessons} ${lWord}`;
}

/** Real-money formatting for a creator-set price (never Visual Bucs). */
export function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/* ─── HTTP ───────────────────────────────────────────────────────────── */

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string; code?: string };
    const err = new Error(body.message || body.error || `Request failed (${res.status})`) as Error & { code?: string };
    err.code = body.code;
    throw err;
  }
  return res.json() as Promise<T>;
}

type TokenGetter = () => Promise<string | null>;

async function authHeaders(getAccessToken?: TokenGetter): Promise<Record<string, string>> {
  if (!getAccessToken) return {};
  const token = await getAccessToken().catch(() => null);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchCourseOutline(productId: string, getAccessToken?: TokenGetter): Promise<CourseOutline> {
  const res = await fetch(`/api/courses/${productId}`, { headers: await authHeaders(getAccessToken) });
  const data = await json<{ course: CourseOutline }>(res);
  return data.course;
}

export async function fetchCourseLearn(getAccessToken: TokenGetter, productId: string): Promise<CourseLearn> {
  const res = await fetch(`/api/courses/${productId}/learn`, { headers: await authHeaders(getAccessToken) });
  const data = await json<{ course: CourseLearn }>(res);
  return data.course;
}

export async function fetchMyCourses(getAccessToken: TokenGetter): Promise<MyCourse[]> {
  const res = await fetch(`/api/courses/mine`, { headers: await authHeaders(getAccessToken) });
  const data = await json<{ courses: MyCourse[] }>(res);
  return data.courses;
}

export async function recordLessonProgress(
  getAccessToken: TokenGetter,
  productId: string,
  lessonId: string,
  beat: { positionSec?: number; complete?: boolean; uncomplete?: boolean; markCompleted?: boolean },
): Promise<void> {
  const res = await fetch(`/api/courses/${productId}/lessons/${lessonId}/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders(getAccessToken)) },
    body: JSON.stringify(beat),
  });
  await json(res);
}

/* ─── creator side ───────────────────────────────────────────────────── */

export async function fetchCreatedCourses(getAccessToken: TokenGetter): Promise<CourseProduct[]> {
  const res = await fetch(`/api/courses/mine/created`, { headers: await authHeaders(getAccessToken) });
  const data = await json<{ courses: CourseProduct[] }>(res);
  return data.courses;
}

export async function createCourse(
  getAccessToken: TokenGetter,
  input: { title: string; description?: string; priceCents: number },
): Promise<CourseProduct> {
  const res = await fetch(`/api/courses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders(getAccessToken)) },
    body: JSON.stringify(input),
  });
  const data = await json<{ product: CourseProduct }>(res);
  return data.product;
}

export async function updateCourse(
  getAccessToken: TokenGetter,
  productId: string,
  patch: { title?: string; description?: string; priceCents?: number; isActive?: boolean },
): Promise<CourseProduct> {
  const res = await fetch(`/api/courses/${productId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeaders(getAccessToken)) },
    body: JSON.stringify(patch),
  });
  const data = await json<{ product: CourseProduct }>(res);
  return data.product;
}

export async function fetchCreatedCurriculum(
  getAccessToken: TokenGetter,
  productId: string,
): Promise<CreatedCurriculum> {
  const res = await fetch(`/api/courses/${productId}/curriculum`, { headers: await authHeaders(getAccessToken) });
  const data = await json<{ curriculum: CreatedCurriculum }>(res);
  return data.curriculum;
}

export async function replaceCurriculum(
  getAccessToken: TokenGetter,
  productId: string,
  sections: CurriculumSectionInput[],
): Promise<CreatedCurriculum> {
  const res = await fetch(`/api/courses/${productId}/curriculum`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders(getAccessToken)) },
    body: JSON.stringify({ sections }),
  });
  const data = await json<{ curriculum: CreatedCurriculum }>(res);
  return data.curriculum;
}
