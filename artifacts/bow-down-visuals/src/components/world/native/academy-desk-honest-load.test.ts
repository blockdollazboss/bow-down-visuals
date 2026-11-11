/**
 * AcademyDesk — honest load standard (deep-pins tranche 4,
 * batch E). A guest never reaches the working desk — the gate
 * returns the sign-in pitch first. The three paid Academy calls
 * all funnel through readPaid: a cancelled confirm (null)
 * returns nothing, 402 is the named out-of-credits state, a
 * non-ok answer surfaces the server's error string (or the
 * section's failed line), an unparseable ok answer is the
 * failed line, and a value comes back only from a parse — so
 * the learning path, a generated lesson, and a coach answer are
 * set only from parsed answers (the question the member typed
 * is their own message and is the only thing appended before
 * the call). Every gate fires before the spend confirm: the
 * path's goal/platform gate, the coach's askReady gate, and the
 * lesson cache — a cached lesson is a free re-read that never
 * reaches the rail at all. The free shelves keep the ordering:
 * tutorials run load-error-with-retry → loading → honestly
 * empty; My Courses separates the rail's COURSES_NOT_LIVE
 * answer (its own on-the-way empty state) from a plain load
 * error with retry, then loading, then honestly-empty. The
 * Guides shelf is static catalog copy, pinned as such: the LLC
 * and Copyright cards carry the honest flow note instead of a
 * faked flow, and only the Academy card opens a shelf.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./AcademyDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the gate and readPaid — every paid call's shared endings", () => {
  it("a guest or signed-out walker gets the gate, never the working desk", () => {
    expect(src).toContain("if (isGuest || !user) return <GuestGate isLight={isLight} />;");
  });

  it("readPaid: null is the cancel, 402 is out-of-credits, non-ok and unparseable set the error, a value returns only from a parse", () => {
    const body = slice(src, "async function readPaid<T>(", "async function buildLearningPath() {");
    expect(body).toContain("if (res === null) return null; /* the member cancelled the confirm */");
    expect(body).toContain("if (res.status === 402) {");
    expect(body).toContain("setOutOfCredits(true);");
    expect(body.indexOf("if (res.status === 402) {")).toBeLessThan(body.indexOf("if (!res.ok) {"));
    expect(body).toContain("const parsed = parse(data);");
    expect(body).toContain("if (!parsed) {");
    expect(body.indexOf("return parsed;")).toBeGreaterThan(body.indexOf("if (!parsed) {"));
  });

  it("the learning path gate fires before the spend confirm is ever called", () => {
    const body = slice(src, "async function buildLearningPath() {", "async function openLesson(course: AcademyCourse, lessonId: string) {");
    expect(body).toContain("if (!learningPathReady({ goals, platforms })) {");
    expect(body.indexOf("if (!learningPathReady({ goals, platforms })) {")).toBeLessThan(
      body.indexOf("const res = await confirmedFetch(ACADEMY_LEARNING_PATH_PATH, {"),
    );
    expect(body.indexOf("if (parsed) setLearningPath(parsed);")).toBeGreaterThan(body.indexOf("readPaid(res, parseLearningPath"));
  });

  it("a cached lesson is a free re-read before any call; a declined lesson closes instead of pretending to open", () => {
    const body = slice(src, "async function openLesson(course: AcademyCourse, lessonId: string) {", "async function askCoach(course: AcademyCourse) {");
    expect(body).toContain("if (lessonCache[key]) return; /* already generated — free re-read, as on the page */");
    expect(body.indexOf("if (lessonCache[key]) return;")).toBeLessThan(
      body.indexOf("const res = await confirmedFetch(ACADEMY_LESSON_PATH, {"),
    );
    expect(body).toContain("if (res === null) { setActiveLessonKey(null); return; }");
    expect(body).toContain("if (parsed) setLessonCache((prev) => ({ ...prev, [key]: parsed }));");
    expect(body).toContain("else setActiveLessonKey(null);");
  });

  it("the coach gate fires first, and a coach answer is appended only from a parsed answer", () => {
    const body = slice(src, "async function askCoach(course: AcademyCourse) {", "const activeLesson: AcademyGeneratedLesson | null = activeLessonKey");
    expect(body).toContain("if (coachLoading || !askReady(coachInput)) {");
    expect(body.indexOf("if (coachLoading || !askReady(coachInput)) {")).toBeLessThan(
      body.indexOf("const res = await confirmedFetch(ACADEMY_ASK_PATH, {"),
    );
    expect(body).toContain("const answer = await readPaid(res, parseCoachAnswer, t(\"worldRemainder.acdCoachFailedRefund\"));");
    expect(body).toContain("if (answer) {");
    expect(body.indexOf("{ role: \"coach\" as const, text: answer }")).toBeGreaterThan(body.indexOf("if (answer) {"));
  });
});

describe("the free shelves — failed, loading and empty stay separate", () => {
  it("tutorials render load-error+retry → loading → honestly-empty, in that order", () => {
    const body = slice(src, "{loadError ? (\n        <NativeErrorState", "{visible.series.map((s) => (");
    expect(body).toContain("onRetry={() => setRetryNonce((n) => n + 1)}");
    expect(body.indexOf(") : !visible ? (")).toBeLessThan(
      body.indexOf(") : visible.series.length === 0 && visible.standalone.length === 0 ? ("),
    );
    expect(body).toContain("<NativeLoadingState");
    expect(body).toContain("<NativeEmptyState");
  });

  it("My Courses: COURSES_NOT_LIVE is its own state, distinct from a load error with retry", () => {
    const load = slice(src, "const load = useCallback(async () => {\n    if (!user) { setCourses([]); return; }", "useEffect(() => { void load(); }, [load]);");
    expect(load).toContain('if ((err as { code?: string }).code === "COURSES_NOT_LIVE") setNotLive(true);');
    expect(load).toContain("else setLoadError(true);");
    const body = slice(src, "{notLive ? (", "{courses.map((c) => (");
    expect(body.indexOf("{notLive ? (")).toBeLessThan(body.indexOf(") : loadError ? ("));
    expect(body.indexOf(") : loadError ? (")).toBeLessThan(body.indexOf(") : !courses ? ("));
    expect(body.indexOf(") : !courses ? (")).toBeLessThan(body.indexOf(") : courses.length === 0 ? ("));
    expect(body).toContain("onRetry={() => void load()}");
  });

  it("progress writes are best-effort by their own comments — a failed write never blocks the lesson", () => {
    expect(src).toContain("/* Progress is best-effort — a failed write never blocks the lesson. */");
    expect(src).toContain("/* progress is best-effort — a failed write never blocks the lesson */");
  });
});

describe("the Guides shelf — static copy, honestly labelled", () => {
  it("the guide cards render from the catalog keys; only Academy opens a shelf, LLC / Copyright carry the flow note", () => {
    const body = slice(src, "function GuidesShelf({", "/* ─── My Courses shelf (the courses tab) ───");
    expect(body).toContain("{ACADEMY_GUIDE_KEYS.map((key) => (");
    expect(body).toContain('data-testid="world-academy-guide-open-academy"');
    expect(body).toContain("onClick={onOpenAcademy}");
    expect(body).toContain('t("worldRemainder.acdGuideFlowNote", { kind: key === "llc" ? "LLC" : "copyright" })');
  });
});
