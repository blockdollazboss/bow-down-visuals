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
 *
 * The freeze-fix pins (Oct 21, 2026) are in their own describe at
 * the bottom: raw-first start order, the "none" default, the
 * engine-init timeout, and the inference failure cap. Sequencing
 * note for every engine test: start() now resolves on the CAMERA
 * (raw-first) — the engine script appears after a flush, and the
 * engine settles a flush after its script's onload fires.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rnnoiseUrls, RNNOISE_LOCAL_BASE, RNNOISE_ORIGIN_BASE } from "./voice-isolator";
import { SEGMENTATION_LOCAL_BASE, SEGMENTATION_ORIGIN_BASE, SEGMENTATION_CDN_BASE } from "./background-changer";

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
  /** When true, send() rejects — a permanently failing inference. */
  static failSend = false;
  locateFile: (f: string) => string;
  resultsCb: ((results: unknown) => void) | null = null;
  sendCount = 0;
  closed = false;
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
    if (FakeSegmenter.failSend) throw new Error("inference send failed");
  }
  async close(): Promise<void> {
    this.closed = true;
  }
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
  FakeSegmenter.failSend = false;
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
    // quality:'standard' pins the balanced refinement step; the
    // default 'auto' loads the same one engine — covered below.
    const changer = new BackgroundChanger({ mode: "green", quality: "standard" });
    const started = changer.start();
    await flush(); // camera first (raw-first); the engine load follows
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe(`${SEGMENTATION_LOCAL_BASE}/selfie_segmentation.js`);
    win.SelfieSegmentation = FakeSegmenter;
    scripts[0].onload?.();
    const { stream } = await started;
    await flush(); // the engine settles in the background
    expect(stream).toBeTruthy();
    expect(changer.segmentationAvailable).toBe(true);
    expect(changer.engineError).toBeNull();
    const seg = FakeSegmenter.instances[0];
    expect(seg.locateFile("selfie_segmentation.tflite")).toBe(
      `${SEGMENTATION_LOCAL_BASE}/selfie_segmentation.tflite`,
    );
    await changer.stop();
  });

  it("falls back R2 → shipped same-origin copy → CDN build, in that order (S27-18)", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({ mode: "green", quality: "standard" });
    const started = changer.start();
    await flush();
    expect(scripts[0].src).toContain(SEGMENTATION_LOCAL_BASE);
    /* The origin step is the TRUE same-origin base off BASE_URL. */
    expect(SEGMENTATION_ORIGIN_BASE).toBe(
      `${import.meta.env.BASE_URL}engines/selfie-segmentation`,
    );
    scripts[0].onerror?.();
    await flush();
    expect(scripts).toHaveLength(2);
    expect(scripts[1].src).toBe(`${SEGMENTATION_ORIGIN_BASE}/selfie_segmentation.js`);
    scripts[1].onerror?.();
    await flush();
    expect(scripts).toHaveLength(3);
    expect(scripts[2].src).toBe(`${SEGMENTATION_CDN_BASE}/selfie_segmentation.js`);
    win.SelfieSegmentation = FakeSegmenter;
    scripts[2].onload?.();
    await started;
    await flush();
    expect(changer.segmentationAvailable).toBe(true);
    const seg = FakeSegmenter.instances[0];
    expect(seg.locateFile("selfie_segmentation.binarypb")).toBe(
      `${SEGMENTATION_CDN_BASE}/selfie_segmentation.binarypb`,
    );
    await changer.stop();
  });

  it("NEVER holds the camera hostage: total engine failure still starts, running raw", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({ mode: "green", quality: "standard" });
    const started = changer.start();
    await flush();
    scripts[0].onerror?.();
    await flush();
    expect(scripts).toHaveLength(2);
    expect(scripts[1].src).toBe(`${SEGMENTATION_ORIGIN_BASE}/selfie_segmentation.js`);
    scripts[1].onerror?.();
    await flush();
    expect(scripts).toHaveLength(3);
    scripts[2].onerror?.();
    const { stream } = await started; // resolves — does not throw
    await flush(); // the engine failure settles in the background
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

describe("one light engine — quality is refinement, not an engine choice", () => {
  it("auto (the default) loads ONLY the vendored MediaPipe script — the ONNX global is never even read", async () => {
    const BackgroundChanger = await loadChanger();
    // Booby-trap: anything in the studio path that so much as READS
    // the heavy engine's runtime global fails this test loudly.
    Object.defineProperty(win, "ort", {
      configurable: true,
      get() {
        throw new Error("the studio must never touch the ONNX runtime");
      },
    });
    const statuses: string[] = [];
    const changer = new BackgroundChanger({ mode: "green", onEngineStatus: (k) => statuses.push(k) });
    const started = changer.start();
    try {
      await flush();
      expect(scripts).toHaveLength(1);
      expect(scripts[0].src).toBe(`${SEGMENTATION_LOCAL_BASE}/selfie_segmentation.js`);
      win.SelfieSegmentation = FakeSegmenter;
      scripts[0].onload?.();
      const { stream } = await started;
      await flush();
      expect(stream).toBeTruthy();
      expect(changer.getEngineKind()).toBe("standard");
      expect(changer.segmentationAvailable).toBe(true);
      expect(changer.engineError).toBeNull();
      expect(statuses).toEqual(["standard"]);
      // Auto starts at the sharpest refinement step.
      expect(changer.getRefinementStep()).toBe(0);
    } finally {
      await changer.stop();
      delete win.ort;
    }
  });

  it("'pro' quality runs the SAME light engine — it pins the sharpest refinement, not a heavier engine", async () => {
    const BackgroundChanger = await loadChanger();
    const statuses: string[] = [];
    const changer = new BackgroundChanger({ mode: "green", quality: "pro", onEngineStatus: (k) => statuses.push(k) });
    const started = changer.start();
    await flush();
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe(`${SEGMENTATION_LOCAL_BASE}/selfie_segmentation.js`);
    win.SelfieSegmentation = FakeSegmenter;
    scripts[0].onload?.();
    await started;
    await flush();
    expect(changer.getEngineKind()).toBe("standard");
    expect(changer.segmentationAvailable).toBe(true);
    expect(changer.engineError).toBeNull();
    expect(statuses).toEqual(["standard"]);
    expect(changer.getRefinementStep()).toBe(0);
    await changer.stop();
  });

  it("'standard' quality pins the balanced refinement step", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({ mode: "green", quality: "standard" });
    const started = changer.start();
    await flush();
    win.SelfieSegmentation = FakeSegmenter;
    scripts[0].onload?.();
    await started;
    await flush();
    expect(changer.getEngineKind()).toBe("standard");
    expect(changer.getRefinementStep()).toBe(1);
    await changer.stop();
  });

  it("the engine pairs send→results and composites the matte", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({ mode: "green", quality: "standard" });
    const started = changer.start();
    await flush();
    win.SelfieSegmentation = FakeSegmenter;
    scripts[0].onload?.();
    await started;
    await flush();
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

  it("auto steps the refinement DOWN when the engine runs slow — and stops at the floor (no second engine exists)", async () => {
    const BackgroundChanger = await loadChanger();
    const statuses: string[] = [];
    const changer = new BackgroundChanger({ mode: "green", onEngineStatus: (k) => statuses.push(k) });
    const started = changer.start();
    await flush();
    win.SelfieSegmentation = FakeSegmenter;
    scripts[0].onload?.();
    await started;
    await flush();
    expect(changer.getEngineKind()).toBe("standard");
    expect(changer.getRefinementStep()).toBe(0);
    // Every performance.now() call jumps 100ms, so each send→results
    // round trip reads as ~100ms — far over the ladder's slow line.
    let t = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => (t += 100));
    try {
      const seg = FakeSegmenter.instances[0];
      const mask = new FakeCanvas();
      mask.width = 256;
      mask.height = 144;
      const stepFrame = async () => {
        rafCallbacks[rafCallbacks.length - 1]?.();
        await flush();
        seg.resultsCb?.({ image: null, segmentationMask: mask });
        await flush();
      };
      // Warmup (12 samples) + one eval window (24): the ladder sheds
      // one refinement step.
      for (let i = 0; i < 60 && changer.getRefinementStep() === 0; i++) await stepFrame();
      expect(changer.getRefinementStep()).toBe(1);
      // Sustained slowness walks to the lightest step — and STAYS:
      // the floor is an honest stay, never an engine swap or a
      // dropout, and the status never re-reports.
      for (let i = 0; i < 120 && changer.getRefinementStep() === 1; i++) await stepFrame();
      expect(changer.getRefinementStep()).toBe(2);
      for (let i = 0; i < 80; i++) await stepFrame();
      expect(changer.getRefinementStep()).toBe(2);
      expect(changer.getEngineKind()).toBe("standard");
      expect(changer.segmentationAvailable).toBe(true);
      expect(statuses).toEqual(["standard"]);
    } finally {
      nowSpy.mockRestore();
      await changer.stop();
    }
  }, 30000);

  it("setQuality re-runs selection live and re-pins the refinement (standard → pro)", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({ mode: "green", quality: "standard" });
    const started = changer.start();
    await flush();
    win.SelfieSegmentation = FakeSegmenter;
    scripts[0].onload?.();
    await started;
    await flush();
    expect(changer.getEngineKind()).toBe("standard");
    expect(changer.getRefinementStep()).toBe(1);
    await changer.setQuality("pro");
    expect(changer.getQuality()).toBe("pro");
    expect(changer.getEngineKind()).toBe("standard"); // the same one engine
    expect(changer.getRefinementStep()).toBe(0);
    // No new script was fetched for the "pro" switch.
    expect(scripts).toHaveLength(1);
    await changer.stop();
  });
});

describe("matte refinement steps (the light way to cleaner edges)", () => {
  it("run sharpest → lightest: mask reads strictly descend, ladder index matches the table", async () => {
    const { MATTE_REFINEMENT_STEPS, MATTE_MAX_STEP } = await import("./background-changer");
    expect(MATTE_REFINEMENT_STEPS.length).toBeGreaterThanOrEqual(3);
    expect(MATTE_MAX_STEP).toBe(MATTE_REFINEMENT_STEPS.length - 1);
    for (let i = 1; i < MATTE_REFINEMENT_STEPS.length; i++) {
      expect(MATTE_REFINEMENT_STEPS[i].maskCap).toBeLessThan(MATTE_REFINEMENT_STEPS[i - 1].maskCap);
    }
  });

  it("the balanced step IS the behaviour that shipped before refinement steps existed", async () => {
    const { MATTE_REFINEMENT_STEPS } = await import("./background-changer");
    // 480px mask read (the old hard-coded cap) + the MattePostProcessor
    // shipping defaults — 'standard' quality must not move the picture.
    expect(MATTE_REFINEMENT_STEPS[1]).toEqual({
      maskCap: 480,
      emaWeight: 0.55,
      choke: 0.05,
      curveLo: 0.06,
      curveHi: 0.94,
      featherPasses: 1,
    });
  });

  it("the sharpest step opens the edge work up: finer read, calmer blend, gentler curve, fuller feather", async () => {
    const { MATTE_REFINEMENT_STEPS } = await import("./background-changer");
    const [sharp, balanced] = MATTE_REFINEMENT_STEPS;
    expect(sharp.maskCap).toBeGreaterThan(balanced.maskCap);
    expect(sharp.emaWeight).toBeLessThan(balanced.emaWeight); // more history = less flicker
    expect(sharp.curveHi).toBeLessThan(balanced.curveHi); // semi-transparent hair survives sooner
    expect(sharp.featherPasses).toBeGreaterThan(balanced.featherPasses);
  });
});

describe("one-engine truth (source contract)", () => {
  const src = readFileSync(new URL("./background-changer.ts", import.meta.url), "utf8");

  it("the heavy engine is never constructed, stepped, or degraded to in the studio path", () => {
    expect(src).not.toContain("new RvmEngine");
    expect(src).not.toContain("RVM_MAX_STEP");
    expect(src).not.toContain("RvmEngineError");
    expect(src).not.toContain("_degradeToStandard");
  });

  it("the shared matting contract is imported type-only (erased at runtime)", () => {
    expect(src).toContain('import type { EngineMatte, MattingEngine } from "./rvm-engine";');
  });
});

describe("rnnoise asset urls", () => {
  it("point at the real package files (index.js — no CDN-only .min.js)", () => {
    const urls = rnnoiseUrls(RNNOISE_LOCAL_BASE);
    expect(urls.index).toBe(`${RNNOISE_LOCAL_BASE}/index.js`);
    expect(urls.wasm).toBe(`${RNNOISE_LOCAL_BASE}/rnnoise.wasm`);
    expect(urls.wasmSimd).toBe(`${RNNOISE_LOCAL_BASE}/rnnoise_simd.wasm`);
    expect(urls.worklet).toBe(`${RNNOISE_LOCAL_BASE}/rnnoise/workletProcessor.js`);
  });

  it("the fallback chain's middle base is the shipped same-origin copy (S27-18)", () => {
    /* RNNOISE_BASES itself is module-private; its order (R2 → origin →
       CDN) is exercised end-to-end by the VoiceIsolator load loop.
       Pin the origin base's identity here: the TRUE origin base off
       BASE_URL, composing the same asset file names as the R2 base. */
    expect(RNNOISE_ORIGIN_BASE).toBe(`${import.meta.env.BASE_URL}engines/rnnoise`);
    expect(RNNOISE_ORIGIN_BASE.startsWith("http")).toBe(false);
    const originUrls = rnnoiseUrls(RNNOISE_ORIGIN_BASE);
    expect(originUrls.index).toBe(`${RNNOISE_ORIGIN_BASE}/index.js`);
    expect(originUrls.wasm).toBe(`${RNNOISE_ORIGIN_BASE}/rnnoise.wasm`);
    expect(originUrls.worklet).toBe(`${RNNOISE_ORIGIN_BASE}/rnnoise/workletProcessor.js`);
    /* And the source's load chain names it between local and CDN. */
    const src = readFileSync(new URL("./voice-isolator.ts", import.meta.url), "utf8");
    expect(src).toContain(
      "const RNNOISE_BASES = [RNNOISE_LOCAL_BASE, RNNOISE_ORIGIN_BASE, RNNOISE_CDN_BASE] as const;",
    );
  });
});

describe("raw mode pays nothing for the engine (Lane F Flag E-1)", () => {
  it("start() in mode 'none' loads NO engine; the first backdrop mode loads it lazily", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({ quality: "standard", mode: "none" });
    const { stream } = await changer.start();
    expect(stream).toBeTruthy();
    expect(scripts).toHaveLength(0); // no segmentation script was ever requested
    expect(FakeSegmenter.instances).toHaveLength(0);
    expect(changer.getEngineKind()).toBe("off");
    expect(changer.segmentationAvailable).toBe(false);

    // First backdrop mode of the session: the engine loads now.
    changer.setMode("green");
    await flush();
    expect(scripts).toHaveLength(1);
    win.SelfieSegmentation = FakeSegmenter;
    scripts[0]!.onload?.();
    await flush();
    await flush();
    expect(changer.segmentationAvailable).toBe(true);
    await changer.stop();
  });

  it("switching to 'none' mid-session stands the engine down — as a choice, not a failure", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({ mode: "green", quality: "standard" });
    const started = changer.start();
    await flush();
    win.SelfieSegmentation = FakeSegmenter;
    scripts[0]!.onload?.();
    await started;
    await flush();
    expect(changer.segmentationAvailable).toBe(true);

    changer.setMode("none");
    await flush();
    expect(changer.getEngineKind()).toBe("off");
    expect(changer.segmentationAvailable).toBe(false);
    expect(changer.engineError).toBeNull();
    await changer.stop();
  });
});

describe("freeze fix (Oct 21, 2026) — raw-first, opt-in effects, init timeout, failure cap", () => {
  it("start() acquires the camera and paints raw BEFORE the engine is even requested", async () => {
    const BackgroundChanger = await loadChanger();
    const order: string[] = [];
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => {
          order.push("camera");
          return new FakeMediaStream([new FakeTrack("video")]);
        },
      },
    });
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        if (tag === "script") {
          order.push("script");
          const s = new FakeScript();
          scripts.push(s);
          return s;
        }
        if (tag === "video") return new FakeVideo();
        return new FakeCanvas();
      },
      head: { appendChild: () => undefined },
    });
    const changer = new BackgroundChanger({ mode: "green", quality: "standard" });
    const started = changer.start();
    await flush();
    /* The camera was acquired first; the engine script came after. */
    expect(order).toEqual(["camera", "script"]);
    /* start() resolved on the camera alone — the engine is still
       warming, which is neither a failure nor a block. */
    await started;
    expect(changer.running).toBe(true);
    expect(changer.segmentationAvailable).toBe(false);
    expect(changer.engineError).toBeNull();
    /* The raw frame paints while the engine warms. */
    const canvas = changer.canvas as unknown as FakeCanvas;
    const before = canvas.ctx.calls.filter((c) => c === "drawImage").length;
    rafCallbacks[rafCallbacks.length - 1]?.();
    const after = canvas.ctx.calls.filter((c) => c === "drawImage").length;
    expect(after).toBeGreaterThan(before);
    /* The engine arrives — only now does the effect take over. */
    win.SelfieSegmentation = FakeSegmenter;
    scripts[0].onload?.();
    await flush();
    await flush();
    expect(changer.segmentationAvailable).toBe(true);
    expect(changer.getEngineKind()).toBe("standard");
    await changer.stop();
  });

  it("a fresh session defaults to Original (mode 'none') — no engine is requested until a backdrop is picked", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({});
    expect(changer.mode).toBe("none");
    const { stream } = await changer.start();
    expect(stream).toBeTruthy();
    expect(scripts).toHaveLength(0);
    expect(FakeSegmenter.instances).toHaveLength(0);
    expect(changer.getEngineKind()).toBe("off");
    expect(changer.engineError).toBeNull();
    await changer.stop();
  });

  it("engine init is capped: a load that never answers lands raw with an honest timeout — and a late load is disposed, not adopted", async () => {
    const BackgroundChanger = await loadChanger();
    const statuses: string[] = [];
    const changer = new BackgroundChanger({
      mode: "green",
      quality: "standard",
      engineInitTimeoutMs: 40,
      onEngineStatus: (k) => statuses.push(k),
    });
    const { stream } = await changer.start(); // resolves on the camera
    expect(stream).toBeTruthy();
    await flush();
    expect(scripts).toHaveLength(1);
    /* Never fire onload — the load hangs. The timeout must land it. */
    await new Promise((r) => setTimeout(r, 150));
    expect(changer.running).toBe(true);
    expect(changer.segmentationAvailable).toBe(false);
    expect(changer.getEngineKind()).toBe("off");
    expect(changer.engineError?.code).toBe("CDN_LOAD_FAILED");
    expect(changer.engineError?.message).toContain("took too long");
    expect(statuses).toEqual(["off"]);
    /* A late load completes the orphaned init — the engine is
       disposed, never adopted behind the timeout's back. */
    win.SelfieSegmentation = FakeSegmenter;
    scripts[0].onload?.();
    await flush();
    await flush();
    expect(FakeSegmenter.instances).toHaveLength(1);
    expect(FakeSegmenter.instances[0].closed).toBe(true);
    expect(changer.segmentationAvailable).toBe(false);
    await changer.stop();
  });

  it("an engine whose inferences keep failing parks itself for the rest of the session", async () => {
    const { MAX_CONSECUTIVE_INFERENCE_FAILURES } = await import("./background-changer");
    const BackgroundChanger = await loadChanger();
    const statuses: string[] = [];
    const changer = new BackgroundChanger({ mode: "green", quality: "standard", onEngineStatus: (k) => statuses.push(k) });
    const started = changer.start();
    await flush();
    win.SelfieSegmentation = FakeSegmenter;
    scripts[0].onload?.();
    await started;
    await flush();
    await flush();
    expect(changer.segmentationAvailable).toBe(true);
    const seg = FakeSegmenter.instances[0];
    FakeSegmenter.failSend = true;
    const stepFrame = async () => {
      rafCallbacks[rafCallbacks.length - 1]?.();
      await flush();
    };
    for (let i = 0; i < MAX_CONSECUTIVE_INFERENCE_FAILURES; i++) await stepFrame();
    await flush();
    expect(seg.sendCount).toBe(MAX_CONSECUTIVE_INFERENCE_FAILURES);
    expect(changer.segmentationAvailable).toBe(false);
    expect(changer.engineError?.code).toBe("SEGMENTATION_FAILED");
    expect(changer.engineError?.message).toContain("stopped working");
    expect(statuses[statuses.length - 1]).toBe("off");
    /* Parked: further frames attempt nothing at all. */
    await stepFrame();
    await stepFrame();
    expect(seg.sendCount).toBe(MAX_CONSECUTIVE_INFERENCE_FAILURES);
    /* Re-picking a backdrop mode does not revive it this session. */
    changer.setMode("blur");
    await flush();
    await flush();
    expect(changer.segmentationAvailable).toBe(false);
    expect(changer.engineError?.code).toBe("SEGMENTATION_FAILED");
    await changer.stop();
    /* A fresh session clears the park — the engine is adopted again. */
    FakeSegmenter.failSend = false;
    await changer.start();
    await flush();
    await flush();
    expect(changer.segmentationAvailable).toBe(true);
    await changer.stop();
  }, 30000);

  it("a landed matte resets the failure run — intermittent failures never park the engine", async () => {
    const { MAX_CONSECUTIVE_INFERENCE_FAILURES } = await import("./background-changer");
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({ mode: "green", quality: "standard" });
    const started = changer.start();
    await flush();
    win.SelfieSegmentation = FakeSegmenter;
    scripts[0].onload?.();
    await started;
    await flush();
    await flush();
    expect(changer.segmentationAvailable).toBe(true);
    const seg = FakeSegmenter.instances[0];
    const mask = new FakeCanvas();
    mask.width = 256;
    mask.height = 144;
    const stepFrame = async (deliver: boolean) => {
      rafCallbacks[rafCallbacks.length - 1]?.();
      await flush();
      if (deliver) {
        seg.resultsCb?.({ image: null, segmentationMask: mask });
        await flush();
      }
    };
    FakeSegmenter.failSend = true;
    for (let i = 0; i < MAX_CONSECUTIVE_INFERENCE_FAILURES - 1; i++) await stepFrame(false);
    FakeSegmenter.failSend = false;
    await stepFrame(true); // one good matte lands — the run resets
    FakeSegmenter.failSend = true;
    for (let i = 0; i < MAX_CONSECUTIVE_INFERENCE_FAILURES - 1; i++) await stepFrame(false);
    await flush();
    expect(changer.segmentationAvailable).toBe(true);
    expect(changer.engineError).toBeNull();
    await changer.stop();
  }, 30000);
});
