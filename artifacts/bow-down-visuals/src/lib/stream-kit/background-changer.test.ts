/**
 * BackgroundChanger engine-loading tests (background-changer.ts).
 *
 * The studio defect these pin (Oct 16, 2026): "Start camera" died with
 * CDN_LOAD_FAILED because the engine script was pinned to a MediaPipe
 * version that does not exist in the npm registry, and start() treated
 * engine failure as fatal. Now: the engine is vendored same-origin
 * (CDN only as fallback), and a failed engine NEVER holds the camera
 * hostage — start() resolves, the camera runs raw, and only the AI
 * backdrop modes are unavailable.
 *
 * DOM is faked by hand (the kit suite runs in a node environment):
 * script elements are captured so each test decides whether a load
 * succeeds or fails, in order.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rnnoiseUrls, RNNOISE_LOCAL_BASE } from "./voice-isolator";
import { SEGMENTATION_LOCAL_BASE, SEGMENTATION_CDN_BASE } from "./background-changer";

/* ---------------------------------------------------------------- fakes */

class FakeCtx {
  calls: string[] = [];
  filter = "";
  fillStyle: unknown = "";
  strokeStyle: unknown = "";
  lineWidth = 1;
  lineCap = "";
  save(): void {}
  restore(): void {}
  translate(): void {}
  scale(): void {}
  beginPath(): void {}
  stroke(): void {}
  moveTo(): void {}
  lineTo(): void {}
  rect(): void {}
  roundRect(): void {}
  fillRect(): void {
    this.calls.push("fillRect");
  }
  clearRect(): void {
    this.calls.push("clearRect");
  }
  drawImage(): void {
    this.calls.push("drawImage");
  }
  createRadialGradient(): { addColorStop: () => void } {
    return { addColorStop: () => undefined };
  }
}

class FakeTrack {
  kind: string;
  stopped = false;
  constructor(kind: string) {
    this.kind = kind;
  }
  stop(): void {
    this.stopped = true;
  }
}

class FakeMediaStream {
  tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = tracks;
  }
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === "video");
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  addTrack(t: FakeTrack): void {
    this.tracks.push(t);
  }
  removeTrack(t: FakeTrack): void {
    this.tracks = this.tracks.filter((x) => x !== t);
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  ctx = new FakeCtx();
  getContext(): FakeCtx {
    return this.ctx;
  }
  captureStream(): FakeMediaStream {
    return new FakeMediaStream();
  }
}

class FakeVideo {
  srcObject: unknown = null;
  readyState = 2;
  videoWidth = 1280;
  videoHeight = 720;
  async play(): Promise<void> {}
}

class FakeScript {
  src = "";
  async = false;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  remove(): void {}
}

class FakeSegmenter {
  static instances: FakeSegmenter[] = [];
  locateFile: (f: string) => string;
  constructor(opts: { locateFile: (f: string) => string }) {
    this.locateFile = opts.locateFile;
    FakeSegmenter.instances.push(this);
  }
  setOptions(): void {}
  onResults(): void {}
  async send(): Promise<void> {}
  async close(): Promise<void> {}
}

/* ------------------------------------------------------------- test rig */

const scripts: FakeScript[] = [];
const rafCallbacks: Array<() => void> = [];
const win: Record<string, unknown> = {};

const flush = () => new Promise((r) => setTimeout(r, 0));

async function loadChanger() {
  vi.resetModules();
  const mod = await import("./background-changer");
  return mod.BackgroundChanger;
}

beforeEach(() => {
  scripts.length = 0;
  rafCallbacks.length = 0;
  FakeSegmenter.instances = [];
  delete win.SelfieSegmentation;

  vi.stubGlobal("window", win);
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag === "script") {
        const s = new FakeScript();
        scripts.push(s);
        return s;
      }
      if (tag === "video") return new FakeVideo();
      return new FakeCanvas();
    },
    head: { appendChild: () => undefined },
  });
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () => new FakeMediaStream([new FakeTrack("video")]),
    },
  });
  vi.stubGlobal("HTMLCanvasElement", FakeCanvas);
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ---------------------------------------------------------------- tests */

describe("segmentation engine loading", () => {
  it("loads the vendored same-origin copy first and resolves assets locally", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({});
    const started = changer.start();
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe(`${SEGMENTATION_LOCAL_BASE}/selfie_segmentation.js`);
    win.SelfieSegmentation = FakeSegmenter;
    scripts[0].onload?.();
    const { stream } = await started;
    expect(stream).toBeTruthy();
    expect(changer.segmentationAvailable).toBe(true);
    expect(changer.engineError).toBeNull();
    const seg = FakeSegmenter.instances[0];
    expect(seg.locateFile("selfie_segmentation.tflite")).toBe(
      `${SEGMENTATION_LOCAL_BASE}/selfie_segmentation.tflite`,
    );
    await changer.stop();
  });

  it("falls back to the CDN build when the local copy fails", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({});
    const started = changer.start();
    expect(scripts[0].src).toContain(SEGMENTATION_LOCAL_BASE);
    scripts[0].onerror?.();
    await flush();
    expect(scripts).toHaveLength(2);
    expect(scripts[1].src).toBe(`${SEGMENTATION_CDN_BASE}/selfie_segmentation.js`);
    win.SelfieSegmentation = FakeSegmenter;
    scripts[1].onload?.();
    await started;
    expect(changer.segmentationAvailable).toBe(true);
    const seg = FakeSegmenter.instances[0];
    expect(seg.locateFile("selfie_segmentation.binarypb")).toBe(
      `${SEGMENTATION_CDN_BASE}/selfie_segmentation.binarypb`,
    );
    await changer.stop();
  });

  it("NEVER holds the camera hostage: total engine failure still starts, running raw", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({});
    const started = changer.start();
    scripts[0].onerror?.();
    await flush();
    expect(scripts).toHaveLength(2);
    scripts[1].onerror?.();
    const { stream } = await started; // resolves — does not throw
    expect(stream).toBeTruthy();
    expect(changer.running).toBe(true);
    expect(changer.segmentationAvailable).toBe(false);
    expect(changer.engineError?.code).toBe("CDN_LOAD_FAILED");
    /* A stepped frame draws the raw camera picture (no segmenter). */
    const canvas = changer.canvas as unknown as FakeCanvas;
    const before = canvas.ctx.calls.filter((c) => c === "drawImage").length;
    rafCallbacks[rafCallbacks.length - 1]?.();
    const after = canvas.ctx.calls.filter((c) => c === "drawImage").length;
    expect(after).toBeGreaterThan(before);
    await changer.stop();
  });
});

describe("rnnoise asset urls", () => {
  it("point at the real package files (index.js — no CDN-only .min.js)", () => {
    const urls = rnnoiseUrls(RNNOISE_LOCAL_BASE);
    expect(urls.index).toBe("/engines/rnnoise/index.js");
    expect(urls.wasm).toBe("/engines/rnnoise/rnnoise.wasm");
    expect(urls.wasmSimd).toBe("/engines/rnnoise/rnnoise_simd.wasm");
    expect(urls.worklet).toBe("/engines/rnnoise/rnnoise/workletProcessor.js");
  });
});
