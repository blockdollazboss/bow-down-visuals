/**
 * movie-stage-truth — audit §3.7 pins (org/design tightening, rank 8).
 *
 * Verification notes (against base 34fdb87aa, git grep / git ls-files /
 * direct reads only):
 *  - No literal stage list showing "0%" with an OFF switch exists
 *    anywhere in the tree at this base, and neither does the copy the
 *    audit quotes ("auto subjects ON" / "caption in video" as read-only
 *    labels) — the same shape as §3.5, where the described My Videos
 *    stepper also did not exist in code (see project-truth lane).
 *  - What exists in substance: the movie editor's steps are manual and
 *    per-clip (clip generation per scene; lip sync per clip via
 *    settings.clips[id].lipSyncStatus; caption lines timed over scenes;
 *    subject reframe as a one-clip render in Export ▸ SubjectReframeCard
 *    that records NO per-clip state), and NO surface reported any
 *    stage's real state. deriveMovieStages is the fix's seam, and the
 *    Studio tab's stage card (StudioEditorSection) renders it.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { deriveMovieStages, type MovieStageInput } from "./movie-stage-truth";

const scene = (id: string, over: Partial<MovieStageInput["scenes"][number]> = {}) => ({
  id,
  timestamp: "0:00-0:05",
  demoClipUrl: null as string | null,
  ...over,
});
const withClip = (id: string) => scene(id, { demoClipUrl: `https://cdn.example/${id}.mp4` });

const byKey = (input: MovieStageInput) =>
  Object.fromEntries(deriveMovieStages(input).map((s) => [s.key, s]));

describe("deriveMovieStages — no clips: honest not-started, never a fake 0%", () => {
  it("an empty project reports every counted stage not-started with percent null", () => {
    const stages = byKey({ scenes: [] });
    for (const key of ["clips", "lip-sync", "captions"] as const) {
      expect(stages[key]!.total).toBe(0);
      expect(stages[key]!.done).toBe(0);
      expect(stages[key]!.percent).toBeNull();
      expect(stages[key]!.state).toBe("not-started");
    }
  });

  it("scenes with no clips yet are 0 of N done — a real count, state not-started", () => {
    const stages = byKey({ scenes: [scene("a"), scene("b"), scene("c")] });
    expect(stages["clips"]).toMatchObject({ done: 0, total: 3, percent: 0, state: "not-started" });
    expect(stages["lip-sync"]).toMatchObject({ done: 0, total: 3, state: "not-started" });
    expect(stages["captions"]).toMatchObject({ done: 0, total: 3, state: "not-started" });
  });
});

describe("deriveMovieStages — counts come only from real per-clip data", () => {
  it("clips: some clips done reads in-progress with the real done/total", () => {
    const stages = byKey({ scenes: [withClip("a"), scene("b"), withClip("c"), scene("d")] });
    expect(stages["clips"]).toMatchObject({ done: 2, total: 4, percent: 50, state: "in-progress" });
  });

  it("clips: all clips done reads done at 100", () => {
    const stages = byKey({ scenes: [withClip("a"), withClip("b")] });
    expect(stages["clips"]).toMatchObject({ done: 2, total: 2, percent: 100, state: "done" });
  });

  it("clips: a non-http clip URL does not count (the editor's own sceneHasClip test)", () => {
    const stages = byKey({ scenes: [scene("a", { demoClipUrl: "blob:local" }), withClip("b")] });
    expect(stages["clips"]!.done).toBe(1);
  });

  it("lip sync: counts only clips whose own job finished with a result URL", () => {
    const stages = byKey({
      scenes: [withClip("a"), withClip("b"), withClip("c")],
      clips: {
        a: { lipSyncStatus: "done", lipSyncUrl: "https://cdn.example/a-lip.mp4" },
        b: { lipSyncStatus: "processing", lipSyncUrl: null },
        c: { lipSyncStatus: "done", lipSyncUrl: null },
      },
    });
    expect(stages["lip-sync"]).toMatchObject({ done: 1, total: 3, state: "in-progress" });
  });

  it("lip sync: every clip synced reads done", () => {
    const stages = byKey({
      scenes: [withClip("a")],
      clips: { a: { lipSyncStatus: "done", lipSyncUrl: "https://cdn.example/a-lip.mp4" } },
    });
    expect(stages["lip-sync"]).toMatchObject({ done: 1, total: 1, percent: 100, state: "done" });
  });

  it("captions: a scene counts when a caption line overlaps its own window", () => {
    /* Three 5s scenes → windows 0-5, 5-10, 10-15. Lines cover scenes 1 and 3. */
    const stages = byKey({
      scenes: [withClip("a"), withClip("b"), withClip("c")],
      captionLines: [
        { startSec: 1, endSec: 3 },
        { startSec: 11, endSec: 14 },
      ],
    });
    expect(stages["captions"]).toMatchObject({ done: 2, total: 3, state: "in-progress" });
  });

  it("captions: lines outside every window, or with no length, cover nothing", () => {
    const stages = byKey({
      scenes: [withClip("a")],
      captionLines: [
        { startSec: 60, endSec: 65 },
        { startSec: 2, endSec: 2 },
      ],
    });
    expect(stages["captions"]).toMatchObject({ done: 0, total: 1, state: "not-started" });
  });

  it("captions: every scene covered reads done", () => {
    const stages = byKey({
      scenes: [withClip("a"), withClip("b")],
      captionLines: [{ startSec: 0, endSec: 10 }],
    });
    expect(stages["captions"]).toMatchObject({ done: 2, total: 2, percent: 100, state: "done" });
  });
});

describe("deriveMovieStages — the subjects stage never invents a count", () => {
  it("subject reframe reports done/percent null and state manual, whatever the clips look like", () => {
    for (const input of [
      { scenes: [] },
      { scenes: [scene("a")] },
      { scenes: [withClip("a"), withClip("b")] },
    ] as MovieStageInput[]) {
      const subjects = byKey(input)["subjects"]!;
      expect(subjects.done).toBeNull();
      expect(subjects.percent).toBeNull();
      expect(subjects.state).toBe("manual");
      expect(subjects.total).toBe(input.scenes.length);
    }
  });
});

describe("deriveMovieStages — copy claims no automation", () => {
  it("every stage is labelled manual and its note names the manual step", () => {
    for (const s of deriveMovieStages({ scenes: [withClip("a")] })) {
      expect(s.manual).toBe(true);
      expect(s.note).toMatch(/^Manual step —/);
    }
  });

  it("no stage note claims anything happens automatically or is ON", () => {
    for (const s of deriveMovieStages({ scenes: [withClip("a")] })) {
      expect(s.note.toLowerCase()).not.toContain("auto subjects on");
      expect(s.note.toLowerCase()).not.toMatch(/automatically brings|auto-bring/);
    }
    const captions = byKey({ scenes: [withClip("a")] })["captions"]!;
    expect(captions.note).toContain("not in the video automatically");
    const subjects = byKey({ scenes: [withClip("a")] })["subjects"]!;
    expect(subjects.note).toContain("not brought in automatically");
  });
});

describe("wiring — the Studio tab renders the derived stages, honestly", () => {
  const section = readFileSync(
    new URL("../components/editor/sections/StudioEditorSection.tsx", import.meta.url),
    "utf8",
  );
  const card = readFileSync(
    new URL("../components/editor/MovieStageTruthCard.tsx", import.meta.url),
    "utf8",
  );

  it("StudioEditorSection renders the stage card from deriveMovieStages", () => {
    expect(section).toContain("MovieStageTruthCard");
    expect(card).toContain("deriveMovieStages");
    expect(card).toContain('data-testid="movie-stage-truth"');
  });

  it("the card shows real done/total counts, not a bare percentage", () => {
    expect(card).toContain("stage.done");
    expect(card).toContain("stage.total");
    expect(card).toContain("Manual step");
  });

  it("the card carries no switch and no auto-bring copy", () => {
    expect(card).not.toContain('role="switch"');
    expect(card).not.toContain("Switch");
    expect(card.toLowerCase()).not.toContain("auto subjects on");
    expect(card.toLowerCase()).not.toContain("auto-bring");
  });
});
