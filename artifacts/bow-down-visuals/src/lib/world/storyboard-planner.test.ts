/**
 * storyboard-planner — STACK-20 R2 #19 (2.3, planner half).
 *
 * Two layers, house style:
 * 1. The pure seam (lib/world/storyboard-planner): paths, payload
 *    builders, defensive normalizers, the one-step move math, the
 *    frame prompt, and the handoff — panels become the scenes of a
 *    make-video project in make-video's own performSave shape.
 * 2. Source pins on the planner component + its desk mount: the
 *    planner rides the server's storyboard rail and the site's
 *    artist-image rail (never a substitute), a notes-only panel is
 *    rendered as one (no stand-in image anywhere in the file), the
 *    handoff door to the website is an explicit link, and the desk
 *    it lives on stays members-only so guests get the pitch.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  STORYBOARDS_PATH,
  STORYBOARD_FRAME_RATIO,
  buildPanelMovePayload,
  buildPanelPayload,
  buildStoryboardPlannerProjectPayload,
  framePromptForPanel,
  movePanelLocal,
  normalizeStoryboard,
  normalizeStoryboardList,
  panelOfResponse,
  panelToScene,
  panelsToScenes,
  storyboardOfResponse,
  storyboardPanelMovePath,
  storyboardPanelPath,
  storyboardPanelsPath,
  storyboardPath,
  type StoryboardPanelDTO,
} from "./storyboard-planner";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const planner = read("../../components/world/native/StoryboardPlanner.tsx");
const desks = read("../../components/world/native/CreateDesks.tsx");
const stations = read("./stations.ts");

const panel = (over: Partial<StoryboardPanelDTO> = {}): StoryboardPanelDTO => ({
  id: "p1",
  title: "Cold open",
  notes: "Host walks into gold light.",
  imageUrl: null,
  imagePrompt: null,
  ...over,
});

describe("storyboard-planner seam — paths + payloads", () => {
  it("builds the rail's paths", () => {
    expect(STORYBOARDS_PATH).toBe("/api/storyboards");
    expect(storyboardPath("b 1")).toBe("/api/storyboards/b%201");
    expect(storyboardPanelsPath("b1")).toBe("/api/storyboards/b1/panels");
    expect(storyboardPanelPath("b1", "p 2")).toBe("/api/storyboards/b1/panels/p%202");
    expect(storyboardPanelMovePath("b1", "p2")).toBe("/api/storyboards/b1/panels/p2/move");
  });

  it("panel payloads carry only what was set (clearing a frame is explicit null)", () => {
    expect(buildPanelPayload({})).toEqual({});
    expect(buildPanelPayload({ title: "T" })).toEqual({ title: "T" });
    expect(buildPanelPayload({ imageUrl: null })).toEqual({ imageUrl: null });
    expect(buildPanelPayload({ imageUrl: "https://x/y.png", imagePrompt: "p" })).toEqual({
      imageUrl: "https://x/y.png",
      imagePrompt: "p",
    });
    expect(buildPanelMovePayload("up")).toEqual({ direction: "up" });
  });
});

describe("storyboard-planner seam — normalizers never invent", () => {
  it("round-trips a board and its panels in order", () => {
    const board = normalizeStoryboard({
      id: "b1",
      title: "Launch teaser",
      panels: [
        { id: "p1", title: "One", notes: "", imageUrl: null, imagePrompt: null },
        { id: "p2", title: "Two", notes: "n", imageUrl: "https://cdn/x.png", imagePrompt: "gold" },
      ],
      createdAt: "2026-10-19T00:00:00Z",
      updatedAt: "2026-10-19T01:00:00Z",
    });
    expect(board?.panels.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(board?.panelCount).toBe(2);
    expect(board?.panels[0]?.imageUrl).toBeNull();
    expect(board?.panels[1]?.imageUrl).toBe("https://cdn/x.png");
  });

  it("drops malformed panels and boards instead of dressing them up", () => {
    const board = normalizeStoryboard({
      id: "b1",
      title: "T",
      panels: [null, { title: "no id" }, { id: "ok", title: "Fine" }, "junk"],
    });
    expect(board?.panels.map((p) => p.id)).toEqual(["ok"]);
    expect(normalizeStoryboard(null)).toBeNull();
    expect(normalizeStoryboard({ title: "no id" })).toBeNull();
    expect(normalizeStoryboardList({ storyboards: [{ id: "a" }, null, { id: "b" }] }).map((b) => b.id)).toEqual(["a", "b"]);
    expect(normalizeStoryboardList({ nope: true })).toEqual([]);
    expect(storyboardOfResponse({ storyboard: { id: "z" } })?.id).toBe("z");
    expect(storyboardOfResponse({})).toBeNull();
    expect(panelOfResponse({ panel: { id: "p" } })?.id).toBe("p");
    expect(panelOfResponse({ panel: null })).toBeNull();
  });

  it("an empty-string imageUrl normalizes to null — a notes-only panel", () => {
    const b = normalizeStoryboard({ id: "b", panels: [{ id: "p", imageUrl: "" }] });
    expect(b?.panels).toHaveLength(1);
    expect(b?.panels[0]?.imageUrl).toBeNull();
  });
});

describe("storyboard-planner seam — move math mirrors the server swap", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("swaps one step each way", () => {
    expect(movePanelLocal(rows, "c", "up").map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(movePanelLocal(rows, "a", "down").map((r) => r.id)).toEqual(["b", "a", "c"]);
  });
  it("is a no-op at the ends and for unknown panels — nothing wraps or vanishes", () => {
    expect(movePanelLocal(rows, "a", "up").map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(movePanelLocal(rows, "c", "down").map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(movePanelLocal(rows, "ghost", "up")).toHaveLength(3);
  });
});

describe("storyboard-planner seam — frames + the handoff", () => {
  it("frames are wide and the prompt is the panel's own words", () => {
    expect(STORYBOARD_FRAME_RATIO).toBe("1920:1080");
    expect(framePromptForPanel(panel())).toBe("Cold open — Host walks into gold light.");
    expect(framePromptForPanel(panel({ notes: "" }))).toBe("Cold open");
    expect(framePromptForPanel(panel({ title: "", notes: "Just notes." }))).toBe("Just notes.");
    expect(framePromptForPanel(panel({ title: " ", notes: "" }))).toBe("");
  });

  it("a panel becomes a scene: words carry, frame rides as thumbnail, nothing pre-filmed", () => {
    const scene = panelToScene(panel({ imageUrl: "https://cdn/f.png", imagePrompt: "gold hall" }), 2);
    expect(scene.sceneNumber).toBe(3);
    expect(scene.action).toBe("Cold open — Host walks into gold light.");
    expect(scene.aiVideoPrompt).toBe("Cold open — Host walks into gold light.");
    expect(scene.thumbnailUrl).toBe("https://cdn/f.png");
    expect(scene.promptUsed).toBe("gold hall");
    expect(scene.demoClipUrl).toBeNull();
    expect(scene.approved).toBe(true);
    expect(scene.section).toBe("Storyboard");
  });

  it("a notes-only panel hands off with thumbnailUrl null — no invented frame", () => {
    const scene = panelToScene(panel(), 0);
    expect(scene.thumbnailUrl).toBeNull();
    expect(scene.generationStatus).toBeNull();
  });

  it("the project payload is make-video's performSave shape, scenes in panel order", () => {
    const payload = buildStoryboardPlannerProjectPayload({
      board: { id: "b9", title: "Teaser plan" },
      panels: [panel(), panel({ id: "p2", title: "Second" })],
    });
    expect(payload["projectType"]).toBe("Make a Music Video");
    expect(payload["title"]).toBe("Teaser plan");
    const input = payload["inputData"] as Record<string, unknown>;
    expect(input["source"]).toBe("storyboard-planner");
    expect(input["storyboardId"]).toBe("b9");
    const output = payload["outputData"] as { scenes: Array<{ sceneNumber: number }> };
    expect(output.scenes.map((s) => s.sceneNumber)).toEqual([1, 2]);
    expect(panelsToScenes([panel(), panel({ id: "p2" })])).toHaveLength(2);
  });
});

describe("storyboard-planner component — source pins", () => {
  it("rides the server storyboard rail via the seam, and the artist-image rail for frames", () => {
    expect(planner).toContain("STORYBOARDS_PATH");
    expect(planner).toContain("storyboardPanelsPath");
    expect(planner).toContain("storyboardPanelPath");
    expect(planner).toContain("storyboardPanelMovePath");
    expect(planner).toContain('fetch("/api/generate-artist-image"');
    expect(planner).toContain("buildArtistImagePayload");
    expect(planner).toContain("STORYBOARD_FRAME_RATIO");
    expect(planner).toContain("interpretTaskPoll");
    /* The frame price is on the button BEFORE the make runs. */
    expect(planner).toContain("artistImageCost(DEFAULT_ARTIST_IMAGE_MODEL)");
    expect(planner).toContain("Generate a frame");
  });

  it("a notes-only panel is rendered as one — and no placeholder image exists in the file", () => {
    expect(planner).toContain("No frame yet — a notes-only panel");
    expect(planner).not.toContain("placehold.co");
    expect(planner).not.toContain("via.placeholder");
    expect(planner).not.toContain("picsum");
    expect(planner).not.toContain("dummyimage");
    /* The only <img> is the panel's own landed frame. */
    expect(planner).toContain("src={panel.imageUrl}");
  });

  it("failure honesty: failed save keeps the words, failed frame leaves the panel unchanged", () => {
    expect(planner).toContain("Couldn't save — your words are still here");
    expect(planner).toContain('data-testid="world-storyboard-panel-frame-error"');
    expect(planner).toContain("Retry the frame");
    expect(planner).toContain('data-testid="world-storyboard-planner-retry"');
  });

  it("the handoff saves a project and names an explicit website door", () => {
    expect(planner).toContain('data-testid="world-storyboard-handoff"');
    expect(planner).toContain("buildStoryboardPlannerProjectPayload");
    expect(planner).toContain('fetch("/api/projects"');
    expect(planner).toContain('href="/my-projects"');
    expect(planner).toContain("Open your projects on the website ↗");
  });

  it("panel operations are all on the strip", () => {
    for (const id of [
      "world-storyboard-panel",
      "world-storyboard-panel-left",
      "world-storyboard-panel-right",
      "world-storyboard-panel-delete",
      "world-storyboard-panel-title",
      "world-storyboard-panel-notes",
      "world-storyboard-panel-frame",
      "world-storyboard-add-panel",
      "world-storyboard-planner-new",
      "world-storyboard-planner-delete",
    ]) {
      expect(planner, id).toContain(`data-testid="${id}"`);
    }
  });

  it("is mounted at the Video Desk, beside the storyboard bench", () => {
    expect(desks).toContain("<StoryboardPlanner");
    expect(desks).toContain("<StoryboardBench");
  });

  it("the Video Desk stays members-only — guests get the station pitch, never the planner", () => {
    const start = stations.indexOf('id: "video-desk"');
    expect(start).toBeGreaterThan(-1);
    const block = stations.slice(start, start + 400);
    expect(block).toContain("membersOnly: true");
  });
});
