/**
 * academy-desk-components — stack1400 world parity wave #2 item 3
 * source-contract pins. The Academy family (academy, tab-guides,
 * tab-tutorials — the census's ABSENT ×3) must exist as ONE native
 * desk at the My Studio board:
 * - the desk rides the 2D page's rails end to end through the seam
 *   (the three /api/academy AI calls, the tutorials lib, the
 *   courses lib, the guides i18n index), never a website pull-up
 *   of /academy;
 * - the paid AI calls go through the confirmed rail with the
 *   seam's explicit override cost (100 VB) shown on the buttons;
 * - tutorials + my-courses play video IN the desk and save
 *   progress on their own rails;
 * - the desk is hung in the StationPanel's my-studio composition,
 *   stacked with the Studio Board like its neighbors;
 * - guests get the pitch/sign-in gate, never the working desk.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/AcademyDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");
const seam = read("./academy-desk.ts");

describe("the desk rides the family's rails end to end", () => {
  it("the three Academy AI calls ride the confirmed rail at the seam's price", () => {
    expect(desk).toContain("confirmedFetch(ACADEMY_LEARNING_PATH_PATH");
    expect(desk).toContain("confirmedFetch(ACADEMY_LESSON_PATH");
    expect(desk).toContain("confirmedFetch(ACADEMY_ASK_PATH");
    expect(desk).toContain("overrideCost: ACADEMY_CREDIT_COST_VISUAL_BUCS");
    expect(desk).toContain('overrideFeature: "Academy Learning Path"');
    expect(desk).toContain('overrideFeature: "Academy Lesson"');
    expect(desk).toContain('overrideFeature: "Academy Ask the Coach"');
    expect(desk).toContain('data-testid="world-academy-learning-path"');
    expect(desk).toContain('data-testid="world-academy-ask-coach"');
    expect(desk).toContain("buildLearningPathPayload");
    expect(desk).toContain("buildLessonPayload");
    expect(desk).toContain("buildAskPayload");
    expect(desk).toContain("parseLearningPath");
    expect(desk).toContain("parseGeneratedLesson");
    expect(desk).toContain("parseCoachAnswer");
  });

  it("the catalog + progress ride the page's own catalog lib and localStorage store", () => {
    expect(desk).toContain("ACADEMY_COURSES");
    expect(desk).toContain("getAcademyCourse");
    expect(desk).toContain("loadAcademyProgress()");
    expect(desk).toContain("loadAcademyLessonCache()");
    expect(desk).toContain("saveAcademyJson(ACADEMY_PROGRESS_KEY, progress)");
    expect(desk).toContain("saveAcademyJson(ACADEMY_LESSON_CACHE_KEY, lessonCache)");
    expect(desk).toContain("withLessonDone");
    expect(desk).toContain('data-testid="world-academy-lesson-content"');
  });

  it("the how-to shelf rides the tutorials lib's own rails (catalog, detail, progress)", () => {
    for (const needle of [
      "fetchTutorialCatalog()",
      "fetchTutorialDetail(selectedSlug)",
      "fetchMyTutorialProgress(getAccessToken)",
      "recordTutorialProgress(getAccessToken, tutorialId, b)",
      "filterCatalog(catalog, query)",
      "inProgressCards(catalog, progressById)",
      "resumeChapter(detail, progress)",
      'data-testid="world-academy-tutorial-video"',
    ]) {
      expect(desk, needle).toContain(needle);
    }
    const tutLib = read("../tutorials.ts");
    expect(tutLib).toContain("/api/tutorials");
    expect(tutLib).toContain("/api/tutorials/mine/progress");
  });

  it("the my-courses shelf rides the courses lib's own rails (mine, learn, progress)", () => {
    for (const needle of [
      "fetchMyCourses(getAccessToken)",
      "fetchCourseLearn(getAccessToken, productId)",
      "recordLessonProgress(getAccessToken, productId, lessonId, b)",
      "flattenLessons(course)",
      "resumeLesson(course)",
      'data-testid="world-academy-course-video"',
      "COURSES_NOT_LIVE",
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("the guides shelf renders the guides page's own i18n copy, and its Academy card stays in the desk", () => {
    expect(desk).toContain("ACADEMY_GUIDE_KEYS");
    expect(desk).toContain('t("guides.heroSub")');
    expect(desk).toContain('t("guides.whyTitle")');
    expect(desk).toContain('t("guides.disclaimer")');
    expect(desk).toContain('data-testid="world-academy-guide-open-academy"');
    expect(desk).toContain("onClick={onOpenAcademy}");
    expect(desk).toContain("onOpenAcademy={() => setTab(\"courses\")}");
  });
});

describe("world law: everything completes in-world", () => {
  it("no pull-up, no walk-out to the 2D academy / guides / tutorial pages", () => {
    expect(desk).not.toContain('href="/academy"');
    expect(desk).not.toContain('href="/guides"');
    expect(desk).not.toContain('href="/llc-guide"');
    expect(desk).not.toContain('href="/copyright"');
    expect(desk).not.toContain("setLocation");
    expect(desk).not.toContain("window.location");
    expect(desk).not.toContain("window.open");
    /* the tutorials' walk-me / try-it doors navigate to 2D tool
       pages — the desk must not reproduce them as exits */
    expect(desk).not.toContain("guideRoute");
    expect(desk).not.toContain("tryRoute");
    expect(desk).not.toContain("startGuideOnArrival");
    /* a bought course's buy link is a store-page exit — not used */
    expect(desk).not.toContain("buyUrl");
    /* the only Link is the guest gate's sign-in door, the house shape */
    expect(desk).toContain('<Link href="/login"');
  });

  it("the four shelves are the desk's own tabs", () => {
    expect(desk).toContain("data-testid={`world-academy-tab-${tb.key}`}");
    for (const tab of ["courses", "tutorials", "guides", "mycourses"]) {
      expect(desk, tab).toContain(`{ key: "${tab}"`);
    }
    expect(desk).toContain('data-testid="world-academy-desk"');
  });

  it("guests get the gate, members get the desk", () => {
    expect(desk).toContain("if (isGuest || !user) return <GuestGate isLight={isLight} />");
    expect(seam).not.toContain("window.open");
  });
});

describe("station composition", () => {
  it("the desk is hung in the my-studio composition, stacked with the Studio Board", () => {
    expect(panel).toContain('station.id === "my-studio"');
    expect(panel).toContain("<StudioBoard");
    expect(panel).toContain("<AcademyDesk isLight={isLight} />");
    expect(panel).toContain('import("@/components/world/native/AcademyDesk")');
    /* the my-studio station itself is unchanged: board pattern in
       the Create Wing, members-only, transfer target /dashboard
       (stations.test pins the full table separately) */
    const stations = read("./stations.ts");
    const studio = stations.slice(stations.indexOf('id: "my-studio"'));
    expect(studio.slice(0, 700)).toContain('websitePath: "/dashboard"');
    expect(studio.slice(0, 700)).toContain("membersOnly: true");
  });
});
