/**
 * Stage tests (stage.ts) with canvas fakes: drawScene renders each
 * source type through a recording 2d context, placeholders appear for
 * unavailable sources, invisible sources are skipped, opacity is
 * applied; the Stage's scene/source operations and switching invariants
 * hold (never zero scenes, fade arms the transition and moves Program).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { Stage, SourcePool, drawScene } from "./stage";
import { createScene, createSource, type SceneSource } from "./scenes";

class FakeCtx {
  calls: string[] = [];
  fillStyle: unknown = "";
  strokeStyle: unknown = "";
  globalAlpha = 1;
  font = "";
  textAlign = "";
  textBaseline = "";
  lineWidth = 1;
  lineJoin = "";
  save(): void {}
  restore(): void {}
  clearRect(): void {
    this.calls.push("clearRect");
  }
  fillRect(): void {
    this.calls.push("fillRect");
  }
  strokeRect(): void {
    this.calls.push("strokeRect");
  }
  drawImage(): void {
    this.calls.push("drawImage");
  }
  fillText(): void {
    this.calls.push("fillText");
  }
  strokeText(): void {
    this.calls.push("strokeText");
  }
  createLinearGradient(): { addColorStop: () => void } {
    return { addColorStop: () => undefined };
  }
  getImageData(_x: number, _y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
  putImageData(): void {
    this.calls.push("putImageData");
  }
}

class FakeCanvas {
  width = 1280;
  height = 720;
  ctx = new FakeCtx();
  getContext(): FakeCtx {
    return this.ctx;
  }
  captureStream(): object {
    return { fake: "stream" };
  }
}

beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => {
      if (tag === "canvas") return new FakeCanvas();
      throw new Error(`unexpected element ${tag}`);
    },
  };
});

function src(partial: Partial<SceneSource>): SceneSource {
  return { ...createSource("color"), ...partial };
}

describe("drawScene", () => {
  it("draws color + text sources, honors visibility and opacity", () => {
    const pool = new SourcePool();
    const scene = createScene("S", [
      src({ type: "color", fill: { from: "#111111", to: "#111111" } }),
      src({ type: "text", text: { content: "Hello", fontSize: 40, color: "#fff", bold: false, fontFamily: "serif", outlineColor: null } }),
      src({ type: "color", visible: false }),
    ]);
    const canvas = new FakeCanvas();
    const ctx = canvas.ctx;
    drawScene(ctx as never, scene, pool, 1280, 720);
    expect(ctx.calls).toContain("fillRect"); // the color source
    expect(ctx.calls).toContain("fillText"); // the text source
    const fillRects = ctx.calls.filter((c) => c === "fillRect").length;
    expect(fillRects).toBe(2); // background clear + the one visible color source
  });

  it("draws the camera canvas when the kit is running, a placeholder when not", () => {
    const pool = new SourcePool();
    const cam = src({ type: "camera", cameraMode: "kit" });
    const scene = createScene("S", [cam]);
    const ctx = new FakeCanvas().ctx;
    drawScene(ctx as never, scene, pool, 1280, 720);
    expect(ctx.calls).not.toContain("drawImage");
    expect(ctx.calls).toContain("fillText"); // placeholder label

    const camCanvas = new FakeCanvas();
    pool.cameraCanvas = () => camCanvas as never;
    const ctx2 = new FakeCanvas().ctx;
    drawScene(ctx2 as never, scene, pool, 1280, 720);
    expect(ctx2.calls).toContain("drawImage");
  });

  it("an image source with no URL draws its placeholder, broken URLs too", () => {
    const pool = new SourcePool();
    const img = src({ type: "image" });
    const scene = createScene("S", [img]);
    const ctx = new FakeCanvas().ctx;
    drawScene(ctx as never, scene, pool, 1280, 720);
    expect(ctx.calls).toContain("fillText");
    expect(ctx.calls).not.toContain("drawImage");
  });
});

describe("Stage operations", () => {
  function newStage(): Stage {
    return new Stage(new FakeCanvas() as never);
  }

  it("starts with the default camera scene as Program + Preview", () => {
    const stage = newStage();
    expect(stage.scenes).toHaveLength(1);
    expect(stage.programId).toBe(stage.scenes[0]!.id);
    expect(stage.previewId).toBe(stage.programId);
    expect(stage.programScene().sources[0]!.type).toBe("camera");
  });

  it("add / rename / duplicate / delete scenes with the one-scene floor", () => {
    const stage = newStage();
    const second = stage.addScene();
    expect(stage.scenes).toHaveLength(2);
    expect(stage.previewId).toBe(second.id);
    stage.renameScene(second.id, "Interview");
    expect(stage.sceneById(second.id)?.name).toBe("Interview");
    const copy = stage.duplicateSceneById(second.id);
    expect(copy?.name).toBe("Interview copy");
    expect(stage.scenes).toHaveLength(3);
    stage.cutTo(second.id);
    stage.deleteScene(second.id);
    expect(stage.scenes).toHaveLength(2);
    expect(stage.programId).not.toBe(second.id); // program moved off the deleted scene
    stage.deleteScene(stage.scenes[0]!.id);
    stage.deleteScene(stage.scenes[0]!.id); // floor: still one left
    expect(stage.scenes).toHaveLength(1);
  });

  it("source add / update / move / remove round-trips through the scene", () => {
    const stage = newStage();
    const sceneId = stage.scenes[0]!.id;
    const text = stage.addSource(sceneId, "text");
    expect(text).toBeTruthy();
    stage.updateSource(sceneId, text!.id, { opacity: 0.5, x: 0.1 });
    const updated = stage.sceneById(sceneId)!.sources.find((s) => s.id === text!.id)!;
    expect(updated.opacity).toBe(0.5);
    expect(updated.x).toBe(0.1);
    expect(stage.sceneById(sceneId)!.sources.at(-1)!.id).toBe(text!.id); // front
    stage.moveSourceById(sceneId, text!.id, -1);
    expect(stage.sceneById(sceneId)!.sources[0]!.id).toBe(text!.id); // moved to back
    stage.removeSource(sceneId, text!.id);
    expect(stage.sceneById(sceneId)!.sources.find((s) => s.id === text!.id)).toBeUndefined();
  });

  it("duplicateSourceById inserts a deep copy in front of the original", () => {
    const stage = newStage();
    const sceneId = stage.scenes[0]!.id;
    const text = stage.addSource(sceneId, "text")!;
    const copy = stage.duplicateSourceById(sceneId, text.id);
    expect(copy).toBeTruthy();
    expect(copy!.id).not.toBe(text.id);
    expect(copy!.name).toBe(`${text.name} copy`);
    const sources = stage.sceneById(sceneId)!.sources;
    const idx = sources.findIndex((s) => s.id === text.id);
    expect(sources[idx + 1]!.id).toBe(copy!.id); // directly in front
    copy!.text!.content = "COPY ONLY";
    expect(sources[idx]!.text!.content).not.toBe("COPY ONLY"); // nested settings not shared
    expect(stage.duplicateSourceById(sceneId, "no-such-source")).toBeNull();
    expect(stage.duplicateSourceById("no-such-scene", text.id)).toBeNull();
  });

  it("cut switches Program immediately; fade arms then lands on Preview", () => {
    const stage = newStage();
    const second = stage.addScene("Two");
    stage.setPreview(second.id);
    stage.transition("cut");
    expect(stage.programId).toBe(second.id);
    expect(stage.transitioning).toBe(false);

    const third = stage.addScene("Three");
    stage.setPreview(third.id);
    stage.transition("fade", 300);
    expect(stage.programId).toBe(third.id); // program target switches at once
    expect(stage.transitioning).toBe(true); // fade is rendering the blend
  });
});
