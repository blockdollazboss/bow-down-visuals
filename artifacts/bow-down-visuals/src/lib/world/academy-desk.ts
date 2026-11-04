import type { AcademyCourse, AcademyLevel } from "../academy-courses";

/* ─── Academy desk seam (stack1400 world parity, wave #2 item 3) ─────
   The Creator Academy (census: `academy`, `tab-guides`,
   `tab-tutorials` — all ABSENT in-World) native at the My Studio
   board, stacked under the Studio Board. The desk rides the 2D
   /academy page's own rails end to end:

   - Course catalog: the page's own static catalog lib
     (lib/academy-courses) — browsing is FREE, exactly as on the
     page. There is no catalog endpoint; the page imports the same
     data this desk imports.
   - AI learning path / AI lesson content / Ask-the-Coach:
     POST /api/academy/learning-path, /api/academy/lesson and
     /api/academy/ask — requireAuth, each charged by the server at
     ACADEMY_CREDIT_COST (routes/generate/academy.ts:
     `Number(process.env["ACADEMY_CREDIT_COST"]) || 100`). The desk
     passes that 100 as an explicit overrideCost to the confirmed
     rail — and the constant now READS the lib/credit-costs.ts
     registry (all three /api/academy/* rows landed with the
     stack1400 registry lane, closing the gap this desk's first
     version named), so the override carries the registry's own
     value and can never drift from it.
   - Progress + generated-lesson cache: the page's OWN localStorage
     keys (academy-progress-v1 / academy-lessons-v1), so a lesson
     marked done or generated on the website is done / re-readable
     for free in the palace, and vice versa. Same store, same shape.
   - How-To Videos (the tutorials tab): the page's own client lib
     (lib/tutorials) — GET /api/tutorials (public), GET
     /api/tutorials/:slug (public), GET /api/tutorials/mine/progress
     and POST /api/tutorials/:id/progress (members). FREE — the
     tutorials rails never touch credits.
   - My Courses (the courses tab): the page's own client lib
     (lib/courses) — GET /api/courses/mine, GET
     /api/courses/:id/learn, POST /api/courses/:id/lessons/:lessonId
     /progress. FREE to learn; buying is the store's rail, not the
     Academy's.
   - Guides (the guides tab): the page's own index copy — the three
     guide cards (LLC / Copyright / Academy) rendered from the same
     i18n keys components/courses/Guides.tsx renders. The tab itself carries no
     rail and no charge; the LLC and Copyright full guided flows
     are separate census items (next tier #23/#24), not this desk.

   Parsers are strict the house way: a broken or incomplete rail
   answer reads as a failed read (null), never painted-over content.
   ────────────────────────────────────────────────────────────────── */

import { getCreditCost } from "../credit-costs";

/** Registry cost for an endpoint; throws if unregistered so a desk
 *  can never silently show (or charge against) an invented price. */
function registryCost(endpoint: string): number {
  const entry = getCreditCost(endpoint);
  if (!entry) throw new Error(`No registered credit cost for ${endpoint}`);
  return entry.cost;
}

export const ACADEMY_LEARNING_PATH_PATH = "/api/academy/learning-path";
export const ACADEMY_LESSON_PATH = "/api/academy/lesson";
export const ACADEMY_ASK_PATH = "/api/academy/ask";

/** The registry row's cost — the registry lane verified it against
 *  the server constant's own default (routes/generate/academy.ts)
 *  and the 2D page's CREDIT_COST: one number, source pins in the
 *  tests. (All three academy rows carry the same 100; the desk's
 *  single constant reads the learning-path row.) */
export const ACADEMY_CREDIT_COST_VISUAL_BUCS = registryCost(ACADEMY_LEARNING_PATH_PATH);

export const ACADEMY_PROGRESS_KEY = "academy-progress-v1";
export const ACADEMY_LESSON_CACHE_KEY = "academy-lessons-v1";

export const ACADEMY_LEVELS: readonly AcademyLevel[] = [
  "beginner",
  "intermediate",
  "advanced",
] as const;

export const ACADEMY_PLATFORMS = [
  "youtube",
  "tiktok",
  "instagram",
  "twitch",
  "x",
] as const;
export type AcademyPlatform = (typeof ACADEMY_PLATFORMS)[number];

/** The guides tab's three cards, in the 2D page's own order — the
 *  desk renders their copy from the same `guides.*` i18n keys
 *  components/courses/Guides.tsx uses (name / tagline / description / badge /
 *  bullet1..4). */
export const ACADEMY_GUIDE_KEYS = ["llc", "copyright", "academy"] as const;
export type AcademyGuideKey = (typeof ACADEMY_GUIDE_KEYS)[number];
export const ACADEMY_GUIDE_BULLETS = [1, 2, 3, 4] as const;

/* ─── shapes (mirror pages/academy.tsx + the academy routes) ─────── */

export type AcademyProgressMap = Record<string, Record<string, boolean>>;

export interface AcademyPathItem {
  courseId: string;
  title: string;
  why: string;
  order: number;
}

export interface AcademyLearningPath {
  path: AcademyPathItem[];
  weeklyPlan: string[];
  firstStep: string;
  creditsRemaining?: number;
}

export interface AcademyLessonSection {
  heading: string;
  body: string;
}

export interface AcademyGeneratedLesson {
  courseId: string;
  courseTitle: string;
  lessonId: string;
  title: string;
  minutes: number;
  sections: AcademyLessonSection[];
  takeaways: string[];
  actionStep: string;
}

export type AcademyLessonCache = Record<string, AcademyGeneratedLesson>;

export interface AcademyCoachMessage {
  role: "user" | "coach";
  text: string;
}

/* ─── payload builders (the page's own field names + trims) ──────── */

export function buildLearningPathPayload(input: {
  goals: string;
  niche: string;
  level: AcademyLevel;
  platforms: readonly string[];
  hours: string;
}): {
  goals: string;
  niche: string;
  level: AcademyLevel;
  platforms: string[];
  hoursPerWeek: number;
} {
  return {
    goals: input.goals.trim().slice(0, 500),
    niche: input.niche.trim().slice(0, 120) || "General",
    level: input.level,
    platforms: [...input.platforms],
    hoursPerWeek: Math.max(1, Math.min(80, parseInt(input.hours, 10) || 5)),
  };
}

/** The page's own gates, in its own order: a real goal first, then
 *  at least one platform. */
export function learningPathReady(input: {
  goals: string;
  platforms: readonly string[];
}): boolean {
  return input.goals.trim().length >= 4 && input.platforms.length > 0;
}

export function buildLessonPayload(courseId: string, lessonId: string) {
  return { courseId, lessonId };
}

export function buildAskPayload(courseId: string, question: string) {
  return { courseId, question: question.trim().slice(0, 1000) };
}

export function askReady(question: string): boolean {
  return question.trim().length >= 4;
}

/* ─── parsers (strict: incomplete ⇒ null, a failed read) ─────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strList(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, cap);
}

export function parseLearningPath(data: unknown): AcademyLearningPath | null {
  if (!isRecord(data)) return null;
  if (!Array.isArray(data.path)) return null;
  const path: AcademyPathItem[] = [];
  data.path.forEach((raw, i) => {
    if (!isRecord(raw)) return;
    const courseId = str(raw.courseId);
    const title = str(raw.title);
    const why = str(raw.why);
    if (!courseId || !title || !why) return;
    path.push({
      courseId,
      title,
      why,
      order: typeof raw.order === "number" ? Math.round(raw.order) : i + 1,
    });
  });
  const firstStep = str(data.firstStep);
  if (path.length === 0 || !firstStep) return null;
  return {
    path,
    weeklyPlan: strList(data.weeklyPlan, 8),
    firstStep,
    creditsRemaining:
      typeof data.creditsRemaining === "number" ? data.creditsRemaining : undefined,
  };
}

export function parseGeneratedLesson(data: unknown): AcademyGeneratedLesson | null {
  if (!isRecord(data) || !isRecord(data.lesson)) return null;
  const l = data.lesson;
  if (!Array.isArray(l.sections)) return null;
  const sections: AcademyLessonSection[] = [];
  for (const raw of l.sections) {
    if (!isRecord(raw)) continue;
    const heading = str(raw.heading);
    const body = str(raw.body);
    if (heading && body) sections.push({ heading, body });
  }
  const actionStep = str(l.actionStep);
  const courseId = str(l.courseId);
  const lessonId = str(l.lessonId);
  const title = str(l.title);
  if (sections.length === 0 || !actionStep || !courseId || !lessonId || !title) {
    return null;
  }
  return {
    courseId,
    courseTitle: str(l.courseTitle),
    lessonId,
    title,
    minutes: typeof l.minutes === "number" ? l.minutes : 0,
    sections: sections.slice(0, 6),
    takeaways: strList(l.takeaways, 5),
    actionStep,
  };
}

export function parseCoachAnswer(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const answer = str(data.answer);
  return answer ? answer : null;
}

/* ─── progress + lesson cache (the page's own localStorage store) ── */

export function loadAcademyJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveAcademyJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable — progress just won't persist,
       exactly the page's own failure mode */
  }
}

export function loadAcademyProgress(): AcademyProgressMap {
  const raw = loadAcademyJson<unknown>(ACADEMY_PROGRESS_KEY, {});
  return isRecord(raw) ? (raw as AcademyProgressMap) : {};
}

export function loadAcademyLessonCache(): AcademyLessonCache {
  const raw = loadAcademyJson<unknown>(ACADEMY_LESSON_CACHE_KEY, {});
  return isRecord(raw) ? (raw as AcademyLessonCache) : {};
}

export function lessonCacheKey(courseId: string, lessonId: string): string {
  return `${courseId}:${lessonId}`;
}

/** Mark / unmark one lesson done — a NEW map, the page's own update
 *  shape, so React state and the saved store never diverge. */
export function withLessonDone(
  progress: AcademyProgressMap,
  courseId: string,
  lessonId: string,
  done: boolean,
): AcademyProgressMap {
  return {
    ...progress,
    [courseId]: { ...(progress[courseId] ?? {}), [lessonId]: done },
  };
}

/** Per-course done/total over the real catalog — the shelf's
 *  progress bars read from this one count. */
export function courseProgressCounts(
  courses: readonly AcademyCourse[],
  progress: AcademyProgressMap,
): Record<string, { done: number; total: number }> {
  const out: Record<string, { done: number; total: number }> = {};
  for (const c of courses) {
    const done = c.lessons.filter((l) => progress[c.id]?.[l.id]).length;
    out[c.id] = { done, total: c.lessons.length };
  }
  return out;
}
