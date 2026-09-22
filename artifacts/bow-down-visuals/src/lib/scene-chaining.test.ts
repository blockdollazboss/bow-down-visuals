import { describe, it, expect } from "vitest";
import type { SceneData } from "@/lib/scene-parser";
import { getPreviousClipUrl } from "@/lib/scene-chaining";

function makeScene(id: string, demoClipUrl: string | null): SceneData {
  return {
    id,
    sceneNumber: 0,
    timestamp: "",
    section: "",
    lyricLine: "",
    location: "",
    action: "",
    cameraMovement: "",
    lighting: "",
    mood: "",
    aiVideoPrompt: "",
    negativePrompt: "",
    approved: false,
    demoClipUrl,
    thumbnailUrl: null,
    clipId: null,
    runwayJobId: null,
    provider: null,
    generationStatus: demoClipUrl ? "completed" : null,
    promptUsed: null,
    generatedAt: null,
  };
}

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

describe("getPreviousClipUrl", () => {
  it("resolves the previous scene's clip by visual position, not plan order", () => {
    const scenes = [
      makeScene("a", "clip-a.mp4"),
      makeScene("b", "clip-b.mp4"),
      makeScene("c", "clip-c.mp4"),
    ];
    expect(getPreviousClipUrl(scenes, 0)).toBeNull();
    expect(getPreviousClipUrl(scenes, 1)).toBe("clip-a.mp4");
    expect(getPreviousClipUrl(scenes, 2)).toBe("clip-b.mp4");
  });

  it("follows drag-reorder: the chain reference updates to the new predecessor", () => {
    const original = [
      makeScene("a", "clip-a.mp4"),
      makeScene("b", "clip-b.mp4"),
      makeScene("c", "clip-c.mp4"),
    ];
    // Drag scene "c" (index 2) to the front.
    const reordered = arrayMove(original, 2, 0);
    expect(reordered.map((s) => s.id)).toEqual(["c", "a", "b"]);

    // "c" is now first -> no previous clip.
    expect(getPreviousClipUrl(reordered, 0)).toBeNull();
    // "a" now follows "c" -> chains from c's clip, not from its original AI-plan predecessor.
    expect(getPreviousClipUrl(reordered, 1)).toBe("clip-c.mp4");
    // "b" now follows "a" -> unchanged relationship, but re-derived from new order.
    expect(getPreviousClipUrl(reordered, 2)).toBe("clip-a.mp4");
  });

  it("follows moveToStart/moveToEnd style splices", () => {
    const scenes = [
      makeScene("a", "clip-a.mp4"),
      makeScene("b", "clip-b.mp4"),
      makeScene("c", "clip-c.mp4"),
    ];
    // moveToEnd(0): move "a" to the end.
    const next = [...scenes];
    const [item] = next.splice(0, 1);
    next.push(item!);
    expect(next.map((s) => s.id)).toEqual(["b", "c", "a"]);

    expect(getPreviousClipUrl(next, 0)).toBeNull(); // "b" is now first
    expect(getPreviousClipUrl(next, 1)).toBe("clip-b.mp4"); // "c" follows "b"
    expect(getPreviousClipUrl(next, 2)).toBe("clip-c.mp4"); // "a" follows "c" now, not "none"
  });

  it("gives a duplicated scene's clip to whatever now sits after it", () => {
    const scenes = [
      makeScene("a", "clip-a.mp4"),
      makeScene("b", "clip-b.mp4"),
    ];
    // duplicate(0): insert a copy of "a" right after "a".
    const copy: SceneData = { ...scenes[0]!, id: "a-copy", approved: false };
    const next = [...scenes];
    next.splice(1, 0, copy);
    expect(next.map((s) => s.id)).toEqual(["a", "a-copy", "b"]);

    expect(getPreviousClipUrl(next, 1)).toBe("clip-a.mp4"); // duplicate chains from original "a"
    expect(getPreviousClipUrl(next, 2)).toBe("clip-a.mp4"); // "b" now chains from the duplicate's (copied) clip, not the original "a" position
  });

  it("closes the gap correctly when a chained scene is deleted", () => {
    const scenes = [
      makeScene("a", "clip-a.mp4"),
      makeScene("b", "clip-b.mp4"),
      makeScene("c", "clip-c.mp4"),
    ];
    // remove("b"): "b" is deleted.
    const next = scenes.filter((s) => s.id !== "b");
    expect(next.map((s) => s.id)).toEqual(["a", "c"]);

    // "c" now directly follows "a", not the deleted "b".
    expect(getPreviousClipUrl(next, 1)).toBe("clip-a.mp4");
  });

  it("returns null once the first scene's own clip is deleted (no earlier fallback)", () => {
    const scenes = [
      makeScene("a", "clip-a.mp4"),
      makeScene("b", "clip-b.mp4"),
    ];
    const next = scenes.filter((s) => s.id !== "a");
    expect(next.map((s) => s.id)).toEqual(["b"]);
    expect(getPreviousClipUrl(next, 0)).toBeNull();
  });

  it("treats an ungenerated predecessor (no demoClipUrl) as no chain available", () => {
    const scenes = [makeScene("a", null), makeScene("b", "clip-b.mp4")];
    expect(getPreviousClipUrl(scenes, 1)).toBeNull();
  });
});
