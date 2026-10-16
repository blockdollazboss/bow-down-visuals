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
  getImageData(_x: number, _y: number, w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
    this.calls.push("getImageData");
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
  putImageData(): void {
    this.calls.push("putImageData");
  }
  createImageData(w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
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
  resultsCb: ((results: unknown) => void) | null = null;
  sendCount = 0;
  constructor(opts: { locateFile: (f: string) => string }) {
    this.locateFile = opts.locateFile;
    FakeSegmenter.instances.push(this);
  }
  setOptions(): void {}
  onResults(cb: (results: unknown) => void): void {
    this.resultsCb = cb;
  }
  async send(): Promise<void> {
    this.sendCount++;
  }
  async close(): Promise<void> {}
}

/* A minimal fake ONNX Runtime Web global: enough for RvmEngine to
   build a session and run frames. `failCreate` simulates the Pro
   engine being unloadable; run() echoes the recurrent states back
   and returns a mostly-opaque matte sized from the src feed. */
class FakeTensor {
  type: string;
  data: Float32Array;
  dims: number[];
  constructor(type: string, data: Float32Array, dims: number[]) {
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}
function makeFakeOrt(opts: { failCreate?: boolean } = {}) {
  return {
    env: { wasm: {} as Record<string, unknown>, logLevel: "" },
    Tensor: FakeTensor,
    InferenceSession: {
      create: async () => {
        if (opts.failCreate) throw new Error("no session for you");
        return {
          run: async (feeds: Record<string, FakeTensor>) => {
            const h = feeds.src.dims[2];
            const w = feeds.src.dims[3];
            return {
              fgr: new FakeTensor("float32", new Float32Array(3 * w * h), [1, 3, h, w]),
              pha: new FakeTensor("float32", new Float32Array(w * h).fill(0.9), [1, 1, h, w]),
              r1o: feeds.r1i,
              r2o: feeds.r2i,
              r3o: feeds.r3i,
              r4o: feeds.r4i,
            };
          },
          release: async () => undefined,
        };
      },
    },
  };
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
    // quality:'standard' isolates the MediaPipe path (the default
    // 'auto' tries the Pro engine first — covered separately below).
    const changer = new BackgroundChanger({ quality: "standard" });
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
    const changer = new BackgroundChanger({ quality: "standard" });
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
    const changer = new BackgroundChanger({ quality: "standard" });
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

describe("pro engine + quality ladder", () => {
  it("auto quality runs the Pro engine when it loads, and says so", async () => {
    const BackgroundChanger = await loadChanger();
    win.ort = makeFakeOrt();
    const statuses: string[] = [];
    const changer = new BackgroundChanger({ onEngineStatus: (k) => statuses.push(k) });
    const { stream } = await changer.start();
    expect(stream).toBeTruthy();
    expect(changer.getEngineKind()).toBe("pro");
    expect(changer.segmentationAvailable).toBe(true);
    expect(changer.engineError).toBeNull();
    expect(statuses).toEqual(["pro"]);
    // No MediaPipe script was ever requested — Pro carried it alone.
    expect(scripts).toHaveLength(0);
    // A stepped frame runs an inference and composites a cutout.
    const canvas = changer.canvas as unknown as FakeCanvas;
    await flush();
    const drew = canvas.ctx.calls.filter((c) => c === "drawImage").length;
    expect(drew).toBeGreaterThan(0);
    await changer.stop();
    delete win.ort;
  });

  it("auto quality falls back to the Standard engine when Pro cannot load", async () => {
    const BackgroundChanger = await loadChanger();
    win.ort = makeFakeOrt({ failCreate: true });
    const statuses: string[] = [];
    const changer = new BackgroundChanger({ onEngineStatus: (k) => statuses.push(k) });
    const started = changer.start();
    await flush();
    // Pro failed inside start(); the ladder moved on to the
    // vendored MediaPipe script.
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe(`${SEGMENTATION_LOCAL_BASE}/selfie_segmentation.js`);
    win.SelfieSegmentation = FakeSegmenter;
    scripts[0].onload?.();
    await started;
    expect(changer.getEngineKind()).toBe("standard");
    expect(changer.segmentationAvailable).toBe(true);
    expect(statuses).toEqual(["standard"]);
    await changer.stop();
    delete win.ort;
  });

  it("forced Pro NEVER silently downgrades: load failure means raw + honest error", async () => {
    const BackgroundChanger = await loadChanger();
    win.ort = makeFakeOrt({ failCreate: true });
    const statuses: string[] = [];
    const changer = new BackgroundChanger({ quality: "pro", onEngineStatus: (k) => statuses.push(k) });
    const { stream } = await changer.start(); // still resolves — camera runs raw
    expect(stream).toBeTruthy();
    expect(changer.getEngineKind()).toBe("off");
    expect(changer.segmentationAvailable).toBe(false);
    expect(changer.engineError?.code).toBe("CDN_LOAD_FAILED");
    expect(statuses).toEqual(["off"]);
    // The Standard engine was never even attempted.
    expect(scripts).toHaveLength(0);
    await changer.stop();
    delete win.ort;
  });

  it("the Standard engine pairs send→results and composites the matte", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({ quality: "standard" });
    const started = changer.start();
    win.SelfieSegmentation = FakeSegmenter;
    scripts[0].onload?.();
    await started;
    expect(changer.getEngineKind()).toBe("standard");
    // Step the loop: one send goes out and pends on results.
    rafCallbacks[rafCallbacks.length - 1]?.();
    await flush();
    const seg = FakeSegmenter.instances[0];
    expect(seg.sendCount).toBe(1);
    // Deliver results with a small mask canvas; the matte path runs.
    const mask = new FakeCanvas();
    mask.width = 256;
    mask.height = 144;
    const canvas = changer.canvas as unknown as FakeCanvas;
    const before = canvas.ctx.calls.filter((c) => c === "drawImage").length;
    seg.resultsCb?.({ image: null, segmentationMask: mask });
    await flush();
    const after = canvas.ctx.calls.filter((c) => c === "drawImage").length;
    expect(after).toBeGreaterThan(before);
    await changer.stop();
  });

  it("a too-slow Pro engine degrades to Standard in auto mode", async () => {
    const BackgroundChanger = await loadChanger();
    win.ort = makeFakeOrt();
    const statuses: string[] = [];
    const changer = new BackgroundChanger({ onEngineStatus: (k) => statuses.push(k) });
    // Every performance.now() call jumps 100ms, so each measured
    // inference reads as 100ms — far over the ladder's slow line.
    let t = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => (t += 100));
    try {
      await changer.start();
      expect(changer.getEngineKind()).toBe("pro");
      // Step frames until the ladder gives up on Pro and the
      // Standard engine's script load begins (or we run out of road).
      for (let i = 0; i < 400 && changer.getEngineKind() === "pro" && scripts.length === 0; i++) {
        rafCallbacks[rafCallbacks.length - 1]?.();
        await flush();
      }
      expect(scripts).toHaveLength(1);
      expect(scripts[0].src).toBe(`${SEGMENTATION_LOCAL_BASE}/selfie_segmentation.js`);
      win.SelfieSegmentation = FakeSegmenter;
      scripts[0].onload?.();
      await flush();
      await flush();
      expect(changer.getEngineKind()).toBe("standard");
      expect(statuses).toEqual(["pro", "standard"]);
    } finally {
      nowSpy.mockRestore();
      await changer.stop();
      delete win.ort;
    }
  }, 30000);

  it("setQuality re-runs selection live (standard → pro)", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({ quality: "standard" });
    const started = changer.start();
    win.SelfieSegmentation = FakeSegmenter;
    scripts[0].onload?.();
    await started;
    expect(changer.getEngineKind()).toBe("standard");
    win.ort = makeFakeOrt();
    await changer.setQuality("pro");
    expect(changer.getEngineKind()).toBe("pro");
    expect(changer.getQuality()).toBe("pro");
    await changer.stop();
    delete win.ort;
  });
});

describe("rvm asset urls", () => {
  it("are vendored-first for both the runtime and the model", async () => {
    const { ortScriptUrls, rvmModelUrls, ORT_LOCAL_BASE, RVM_LOCAL_BASE } = await import("./rvm-engine");
    expect(ortScriptUrls()[0]).toBe(`${ORT_LOCAL_BASE}/ort.all.min.js`);
    expect(rvmModelUrls()[0]).toBe(`${RVM_LOCAL_BASE}/rvm_mobilenetv3_fp32.onnx`);
    expect(ortScriptUrls()).toHaveLength(2);
    expect(rvmModelUrls()).toHaveLength(2);
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
