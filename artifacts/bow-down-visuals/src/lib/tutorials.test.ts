import { describe, it, expect } from "vitest";
import {
  tutorialCardState,
  formatTimestamp,
  resumeChapter,
  resumeLabel,
  filterCatalog,
  inProgressCards,
  type TutorialCard,
  type TutorialCatalog,
  type TutorialDetail,
  type TutorialProgress,
} from "./tutorials";

/* Tutorials V1 — the pure helpers the Academy tab + profile shelf
   render from. The pins: a fan's progress state is honest
   (no row = not started), the resume point is the recorded chapter
   (falling back to the first unfinished one), completion clears the
   resume, and search covers chapter titles — the plain-language
   promise ("How do I get paid?" finds the money tutorial). */

function card(partial: Partial<TutorialCard> = {}): TutorialCard {
  return {
    id: "t1",
    slug: "make-a-song",
    title: "Make Your First Song",
    description: "Turn an idea into a finished song.",
    category: "create",
    isOfficial: true,
    access: "free",
    position: 1,
    seriesId: "s1",
    creatorSlug: "thy-cheat-code",
    creatorName: "Thy Cheat Code",
    hasVideo: false,
    videoDurationSec: null,
    chapterCount: 2,
    chapterTitles: ["Describe the vibe", "Get the lyrics right"],
    ...partial,
  };
}

function progress(partial: Partial<TutorialProgress> = {}): TutorialProgress {
  return {
    tutorialId: "t1",
    status: "in_progress",
    completedChapterIds: [],
    lastChapterId: null,
    lastPositionSec: 0,
    completedAt: null,
    ...partial,
  };
}

const detail: Pick<TutorialDetail, "chapters"> = {
  chapters: [
    { id: "c1", position: 1, title: "Describe the vibe", startSec: 0, body: "" },
    { id: "c2", position: 2, title: "Get the lyrics right", startSec: 30, body: "" },
    { id: "c3", position: 3, title: "Produce the track", startSec: 52, body: "" },
  ],
};

describe("tutorialCardState", () => {
  it("no progress row = not started; a row's status stands", () => {
    expect(tutorialCardState(undefined)).toBe("not_started");
    expect(tutorialCardState(progress({ status: "started" }))).toBe("started");
    expect(tutorialCardState(progress({ status: "in_progress" }))).toBe("in_progress");
    expect(tutorialCardState(progress({ status: "completed" }))).toBe("completed");
  });
});

describe("formatTimestamp", () => {
  it("renders m:ss with zero-padded seconds", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(8)).toBe("0:08");
    expect(formatTimestamp(84)).toBe("1:24");
    expect(formatTimestamp(600)).toBe("10:00");
  });
});

describe("resumeChapter / resumeLabel", () => {
  it("resumes at the recorded chapter", () => {
    const p = progress({ completedChapterIds: ["c1"], lastChapterId: "c2" });
    expect(resumeChapter(detail, p)?.id).toBe("c2");
    expect(resumeLabel(detail, p)).toBe("Chapter 2 of 3: Get the lyrics right");
  });

  it("falls back to the first unfinished chapter when the recorded one is gone", () => {
    const p = progress({ completedChapterIds: ["c1"], lastChapterId: "deleted-chapter" });
    expect(resumeChapter(detail, p)?.id).toBe("c2");
  });

  it("no resume for the unstarted or the finished", () => {
    expect(resumeChapter(detail, undefined)).toBeNull();
    expect(resumeChapter(detail, progress({ status: "completed" }))).toBeNull();
    expect(resumeLabel(detail, undefined)).toBeNull();
  });
});

describe("filterCatalog", () => {
  const catalog: TutorialCatalog = {
    series: [
      {
        id: "s1", slug: "create", title: "Create", description: "", category: "create",
        isOfficial: true, position: 2, tutorials: [card()],
      },
      {
        id: "s2", slug: "money", title: "Money", description: "", category: "money",
        isOfficial: true, position: 5,
        tutorials: [card({ id: "t2", slug: "get-paid", title: "Read Your Earnings & Get Paid", chapterTitles: ["Open your earnings"] })],
      },
    ],
    standalone: [card({ id: "t3", slug: "vocal-chain", title: "Vocal Chain Basics", seriesId: null, isOfficial: false, creatorName: "Nova Reign" })],
  };

  it("an empty query returns the catalog untouched", () => {
    expect(filterCatalog(catalog, "  ")).toBe(catalog);
  });

  it("matches by title, drops empty series", () => {
    const out = filterCatalog(catalog, "get paid");
    expect(out.series.map((s) => s.slug)).toEqual(["money"]);
    expect(out.standalone).toEqual([]);
  });

  it("matches by chapter title — the plain-language promise", () => {
    const out = filterCatalog(catalog, "lyrics");
    expect(out.series).toHaveLength(1);
    expect(out.series[0].tutorials[0].slug).toBe("make-a-song");
  });

  it("matches by creator name", () => {
    const out = filterCatalog(catalog, "nova");
    expect(out.standalone.map((c) => c.slug)).toEqual(["vocal-chain"]);
  });
});

describe("inProgressCards", () => {
  it("only begun-but-unfinished tutorials ride the Continue strip", () => {
    const catalog: TutorialCatalog = {
      series: [],
      standalone: [
        card({ id: "a", slug: "a" }),
        card({ id: "b", slug: "b" }),
        card({ id: "c", slug: "c" }),
      ],
    };
    const byId = new Map<string, TutorialProgress>([
      ["a", progress({ tutorialId: "a", status: "in_progress" })],
      ["b", progress({ tutorialId: "b", status: "completed" })],
    ]);
    expect(inProgressCards(catalog, byId).map((c) => c.id)).toEqual(["a"]);
  });
});
