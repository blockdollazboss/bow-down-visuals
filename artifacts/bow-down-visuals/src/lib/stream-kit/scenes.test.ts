/**
 * Unit tests for the scene model (scenes.ts): source/scene factories,
 * duplicate/move semantics, fit math, and the chroma keyer (alpha curve
 * + despill) — all pure, no DOM.
 */
import { describe, it, expect } from "vitest";
import {
  createSource,
  createScene,
  createDefaultScene,
  duplicateScene,
  moveSource,
  fitRects,
  hexToRgb,
  chromaAlpha,
  applyChromaKey,
  type Scene,
} from "./scenes";

describe("factories", () => {
  it("createSource gives each type its working defaults", () => {
    const cam = createSource("camera");
    expect(cam.cameraMode).toBe("kit");
    expect(cam.chroma?.color).toBe("#00FF00");
    expect(cam).toMatchObject({ x: 0, y: 0, w: 1, h: 1, visible: true, opacity: 1, fit: "cover" });

    const text = createSource("text");
    expect(text.text?.content).toBeTruthy();
    expect(text.y).toBeGreaterThan(0.7); // lower-third by default

    const color = createSource("color");
    expect(color.fill?.from).toBeTruthy();

    const ids = new Set([cam.id, text.id, color.id, createSource("image").id]);
    expect(ids.size).toBe(4); // unique ids
  });

  it("createDefaultScene is one fullscreen camera scene", () => {
    const scene = createDefaultScene();
    expect(scene.name).toBe("Main");
    expect(scene.sources).toHaveLength(1);
    expect(scene.sources[0]!.type).toBe("camera");
  });

  it("duplicateScene deep-copies with fresh ids", () => {
    const scene = createScene("Show", [createSource("camera"), createSource("text")]);
    const copy = duplicateScene(scene);
    expect(copy.id).not.toBe(scene.id);
    expect(copy.name).toBe("Show copy");
    expect(copy.sources.map((s) => s.id)).not.toEqual(scene.sources.map((s) => s.id));
    copy.sources[0]!.chroma!.similarity = 0.99;
    expect(scene.sources[0]!.chroma!.similarity).not.toBe(0.99);
  });
});

describe("moveSource (render order: index 0 = back)", () => {
  function scene3(): Scene {
    return createScene("S", [createSource("color"), createSource("image"), createSource("text")]);
  }
  it("moves toward the front and back, clamped at the ends", () => {
    const s = scene3();
    const back = s.sources[0]!;
    const moved = moveSource(s, back.id, 1);
    expect(moved.sources[1]!.id).toBe(back.id);
    const front = moved.sources[2]!;
    expect(moveSource(moved, front.id, 1).sources[2]!.id).toBe(front.id); // already front
    expect(moveSource(moved, back.id, -1).sources[0]!.id).toBe(back.id);
    expect(moveSource(moved, "missing", 1)).toBe(moved);
  });
});

describe("fitRects", () => {
  const dest = { x: 0, y: 0, w: 1280, h: 720 };
  it("cover crops the source to fill the rect (16:9 into 4:3)", () => {
    const r = fitRects(1280, 720, { x: 0, y: 0, w: 640, h: 480 }, "cover");
    // scale = max(640/1280, 480/720) = 2/3 → sw = 960, sh = 720
    expect(r.sw).toBeCloseTo(960);
    expect(r.sh).toBeCloseTo(720);
    expect(r.sx).toBeCloseTo(160);
    expect(r.dw).toBe(640);
    expect(r.dh).toBe(480);
  });
  it("contain letterboxes inside the rect", () => {
    const r = fitRects(1280, 720, { x: 0, y: 0, w: 640, h: 480 }, "contain");
    expect(r.dw).toBeCloseTo(640);
    expect(r.dh).toBeCloseTo(360);
    expect(r.dy).toBeCloseTo(60);
    expect(r.sw).toBe(1280);
  });
  it("stretch maps the whole source to the whole rect", () => {
    const r = fitRects(100, 50, dest, "stretch");
    expect(r).toMatchObject({ sx: 0, sy: 0, sw: 100, sh: 50, dx: 0, dy: 0, dw: 1280, dh: 720 });
  });
  it("survives a zero-size source", () => {
    const r = fitRects(0, 0, dest, "cover");
    expect(Number.isFinite(r.dw)).toBe(true);
  });
});

describe("chroma key", () => {
  it("hexToRgb parses and defaults to green on garbage", () => {
    expect(hexToRgb("#00FF00")).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb("#0a1428")).toEqual({ r: 10, g: 20, b: 40 });
    expect(hexToRgb("nope")).toEqual({ r: 0, g: 255, b: 0 });
  });

  const green = { r: 0, g: 255, b: 0 };
  it("alpha: the key color is fully keyed, distant colors fully kept", () => {
    expect(chromaAlpha(0, 255, 0, green, 0.3, 0.1)).toBe(0);
    expect(chromaAlpha(200, 30, 30, green, 0.3, 0.1)).toBe(1);
  });

  it("alpha feathers across the smoothness band", () => {
    // A color whose distance sits mid-band → mid alpha.
    // dist((0,200,0) vs green) = (55/255)/sqrt(3) ≈ 0.1246
    const mid = chromaAlpha(0, 200, 0, green, 0.05, 0.15);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
  });

  it("zero smoothness is a hard cut at similarity", () => {
    expect(chromaAlpha(0, 200, 0, green, 0.05, 0)).toBe(1);
    expect(chromaAlpha(0, 254, 0, green, 0.05, 0)).toBe(0);
  });

  it("applyChromaKey keys the backdrop, keeps the subject, despills green fringe", () => {
    // 2x1: pure green backdrop + a greenish subject pixel.
    const data = new Uint8ClampedArray([0, 255, 0, 255, 60, 180, 60, 255]);
    const img = { data, width: 2, height: 1 } as ImageData;
    applyChromaKey(img, { color: "#00FF00", similarity: 0.1, smoothness: 0.4 });
    expect(data[3]).toBe(0); // backdrop fully transparent
    expect(data[7]).toBeGreaterThan(0); // subject partially/fully kept
    // Despill: surviving green is pulled toward the red/blue average (60).
    expect(data[5]).toBeLessThan(180);
  });
});
