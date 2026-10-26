/**
 * BackgroundChanger engine tests (background-changer.ts).
 *
 * The studio defect these originally pinned (Oct 16, 2026):
 * "Start camera" died with CDN_LOAD_FAILED because the engine
 * script was pinned to a MediaPipe version that does not exist
 * in the npm registry, and start() treated engine failure as
 * fatal. The standing law ever since: a failed engine NEVER
 * holds the camera hostage — start() resolves, the camera runs
 * raw, and only the AI backdrop modes are unavailable.
 *
 * ONE-ENGINE BUILD (Oct 25, 2026 — greenscreen-matting-scope-
 * 2026-10-25.md): the live path used to degrade SILENTLY from
 * the Pro engine (RVM) to the 2023 legacy Selfie Segmentation
 * build whenever Pro's round trips crossed a line every phone
 * crosses — and the per-frame legacy engine is what erased the
 * creator under motion (the owner's live verdict). That whole
 * arrangement is deleted: each quality names exactly ONE engine
 * ('auto'/'pro' → the Pro engine; 'tasks' → the MediaPipe Tasks
 * engine), an engine that cannot start or parks leaves the
 * camera RAW with the reason on the status detail, and the
 * legacy script loader is out of the studio path entirely (the
 * video editor's own background feature keeps its own copy).
 * These tests pin the new doctrine.
 *
 * DOM is faked by hand (the kit suite runs in a node
 * environment): the Pro engine is driven through a fake Worker
 * (its real client runs), and the Tasks engine is faked at the
 * module boundary (vi.mock below — its real client is pinned in
 * tasks-segmenter-engine.test.ts).
 *
 * The freeze-fix pins (Oct 21, 2026) live in their own describe:
 * raw-first start order, the "none" default, the engine-init
 * timeout, and the inference failure cap. Sequencing note for
 * every engine test: start() resolves on the CAMERA (raw-first)
 * — the engine settles a flush or two later in the background.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rnnoiseUrls, RNNOISE_LOCAL_BASE, RNNOISE_ORIGIN_BASE } from "./voice-isolator";

/* ------------------------------------------------- Tasks engine fake */

/**
 * The Tasks engine, faked at the module boundary: the changer
 * constructs the real class name, but this suite steers it via
 * statics (the FakeProWorker pattern). Behaviours: 'instant'
 * (every frame lands a matte at `processMs`), 'manual' (each
 * process() promise parks until deliver()), 'fail' (every frame
 * throws), 'null' (every frame resolves no matte). failInit /
 * hangInit steer init(). The class registers itself on
 * globalThis so tests can reach the CURRENT module graph's copy
 * (loadChanger resets modules per test).
 */
vi.mock("./tasks-segmenter-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tasks-segmenter-engine")>();
  class FakeTasksEngine {
    static instances: FakeTasksEngine[] = [];
    static failInit = false;
    static hangInit = false;
    static behavior: "instant" | "manual" | "fail" | "null" = "instant";
    static processMs = 42;
    readonly kind = "tasks" as const;
    lastMs: number | null = null;
    delegate: "GPU" | "CPU" | null = "GPU";
    step = 0;
    disposed = false;
    processCalls = 0;
    private _initGate: Array<() => void> = [];
    private _pending: Array<(m: unknown) => void> = [];
    constructor() {
      FakeTasksEngine.instances.push(this);
      (globalThis as { __tasksOrder?: string[] }).__tasksOrder?.push("engine");
    }
    async init(): Promise<void> {
      if (FakeTasksEngine.failInit) {
        throw new actual.TasksSegmenterError("LOAD_FAILED", "fake tasks load failure");
      }
      if (FakeTasksEngine.hangInit) {
        await new Promise<void>((res) => this._initGate.push(res));
      }
    }
    releaseInit(): void {
      for (const res of this._initGate.splice(0)) res();
    }
    setStep(step: number): void {
      this.step = step;
    }
    reset(): void {}
    async process(): Promise<unknown> {
      this.processCalls++;
      if (FakeTasksEngine.behavior === "fail") {
        throw new actual.TasksSegmenterError("INFERENCE_FAILED", "fake tasks frame failure");
      }
      if (FakeTasksEngine.behavior === "null") return null;
      if (FakeTasksEngine.behavior === "manual") {
        return new Promise((res) => this._pending.push(res));
      }
      this.lastMs = FakeTasksEngine.processMs;
      return { alpha: new Float32Array(8).fill(0.9), width: 4, height: 2 };
    }
    deliver(): void {
      const res = this._pending.shift();
      if (!res) return;
      this.lastMs = FakeTasksEngine.processMs;
      res({ alpha: new Float32Array(8).fill(0.9), width: 4, height: 2 });
    }
    pendingCount(): number {
      return this._pending.length;
    }
    async dispose(): Promise<void> {
      this.disposed = true;
    }
  }
  (globalThis as { __FakeTasksEngine?: unknown }).__FakeTasksEngine = FakeTasksEngine;
  return { ...actual, TasksSegmenterEngine: FakeTasksEngine };
});

interface FakeTasksHandle {
  instances: Array<{
    processCalls: number;
    disposed: boolean;
    step: number;
    deliver(): void;
    releaseInit(): void;
    pendingCount(): number;
  }>;
  failInit: boolean;
  hangInit: boolean;
  behavior: "instant" | "manual" | "fail" | "null";
  processMs: number;
}

function fakeTasks(): FakeTasksHandle {
  return (globalThis as { __FakeTasksEngine?: unknown }).__FakeTasksEngine as FakeTasksHandle;
}

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
  (globalThis as { __tasksOrder?: string[] }).__tasksOrder = undefined;
  const ft = (globalThis as { __FakeTasksEngine?: FakeTasksHandle }).__FakeTasksEngine;
  if (ft) {
    ft.instances = [];
    ft.failInit = false;
    ft.hangInit = false;
    ft.behavior = "instant";
    ft.processMs = 42;
  }

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

describe("tasks engine loading (one-engine build, Oct 25, 2026)", () => {
  it("'tasks' quality constructs the Tasks engine — no script is fetched, no worker spawned", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({ mode: "green", quality: "tasks" });
    const { stream } = await changer.start();
    await flush();
    await flush();
    expect(stream).toBeTruthy();
    expect(scripts).toHaveLength(0); // the legacy script loader is gone from the live path
    expect(fakeTasks().instances).toHaveLength(1);
    expect(changer.getEngineKind()).toBe("tasks");
    expect(changer.segmentationAvailable).toBe(true);
    expect(changer.engineError).toBeNull();
    expect(changer.getEngineStatusDetail()).toEqual({ kind: "tasks", fellBack: false, reason: null });
    await changer.stop();
    expect(fakeTasks().instances[0].disposed).toBe(true);
  });

  it("NEVER holds the camera hostage: a Tasks engine that cannot start still starts, running raw — with the reason on the detail", async () => {
    const BackgroundChanger = await loadChanger();
    fakeTasks().failInit = true;
    const changer = new BackgroundChanger({ mode: "green", quality: "tasks" });
    const { stream } = await changer.start(); // resolves — does not throw
    await flush();
    await flush();
    expect(stream).toBeTruthy();
    expect(changer.running).toBe(true);
    expect(changer.segmentationAvailable).toBe(false);
    expect(changer.getEngineKind()).toBe("off");
    expect(changer.engineError?.code).toBe("CDN_LOAD_FAILED");
    /* The exit is VISIBLE with its real reason — and NO other
       engine was dressed up as the effect in its place. */
    expect(changer.getEngineStatusDetail()).toEqual({
      kind: "off",
      fellBack: true,
      reason: "tasks-init-failed",
    });
    /* A stepped frame draws the raw camera picture (no engine). */
    const canvas = changer.canvas as unknown as FakeCanvas;
    const before = canvas.ctx.calls.filter((c) => c === "drawImage").length;
    rafCallbacks[rafCallbacks.length - 1]?.();
    const after = canvas.ctx.calls.filter((c) => c === "drawImage").length;
    expect(after).toBeGreaterThan(before);
    await changer.stop();
  });
});

describe("one engine per quality — the creator's pick IS the engine (Oct 25, 2026)", () => {
  it("auto (the default) names the Pro engine — with no Worker in this browser it lands RAW, never on a substitute engine", async () => {
    const BackgroundChanger = await loadChanger();
    // Booby-trap: the PAGE must never touch the ONNX runtime, even
    // while selecting the Pro engine — ORT loads inside the Pro
    // engine's worker, never here. (This environment has no Worker
    // at all, so the Pro attempt fails fast and honestly.)
    Object.defineProperty(win, "ort", {
      configurable: true,
      get() {
        throw new Error("the page must never touch the ONNX runtime — it lives in the Pro engine's worker");
      },
    });
    const statuses: string[] = [];
    const changer = new BackgroundChanger({ mode: "green", onEngineStatus: (k) => statuses.push(k) });
    try {
      const { stream } = await changer.start();
      await flush();
      await flush();
      expect(stream).toBeTruthy();
      /* One-engine doctrine: Pro could not start, so the camera
         is plain — the Tasks engine is a creator's PICK, never a
         silent understudy. */
      expect(changer.getEngineKind()).toBe("off");
      expect(changer.segmentationAvailable).toBe(false);
      expect(changer.engineError?.code).toBe("CDN_LOAD_FAILED");
      expect(changer.getEngineStatusDetail()).toEqual({
        kind: "off",
        fellBack: true,
        reason: "pro-init-failed",
      });
      expect(statuses).toEqual(["off"]);
      expect(fakeTasks().instances).toHaveLength(0);
    } finally {
      await changer.stop();
      delete win.ort;
    }
  });

  it("'pro' quality names the Pro engine too — unavailable here, it lands raw the same way", async () => {
    const BackgroundChanger = await loadChanger();
    const statuses: string[] = [];
    const changer = new BackgroundChanger({ mode: "green", quality: "pro", onEngineStatus: (k) => statuses.push(k) });
    const { stream } = await changer.start();
    await flush();
    await flush();
    expect(stream).toBeTruthy();
    expect(changer.getEngineKind()).toBe("off");
    expect(changer.segmentationAvailable).toBe(false);
    expect(changer.getEngineStatusDetail()).toEqual({
      kind: "off",
      fellBack: true,
      reason: "pro-init-failed",
    });
    expect(statuses).toEqual(["off"]);
    expect(fakeTasks().instances).toHaveLength(0);
    await changer.stop();
  });

  it("the engine pairs frame→matte and composites it (Tasks path)", async () => {
    const BackgroundChanger = await loadChanger();
    fakeTasks().behavior = "manual";
    const changer = new BackgroundChanger({ mode: "green", quality: "tasks" });
    await changer.start();
    await flush();
    await flush();
    expect(changer.getEngineKind()).toBe("tasks");
    // Step the loop: one frame goes out and pends on its matte.
    rafCallbacks[rafCallbacks.length - 1]?.();
    await flush();
    const engine = fakeTasks().instances[0];
    expect(engine.processCalls).toBe(1);
    // Deliver the matte; the matte path runs and composites.
    const canvas = changer.canvas as unknown as FakeCanvas;
    const before = canvas.ctx.calls.filter((c) => c === "drawImage").length;
    engine.deliver();
    await flush();
    const after = canvas.ctx.calls.filter((c) => c === "drawImage").length;
    expect(after).toBeGreaterThan(before);
    await changer.stop();
  });

  it("the Tasks ladder steps the refinement DOWN when round trips run slow — and stops at its floor", async () => {
    const BackgroundChanger = await loadChanger();
    const statuses: string[] = [];
    const changer = new BackgroundChanger({ mode: "green", quality: "tasks", onEngineStatus: (k) => statuses.push(k) });
    await changer.start();
    await flush();
    await flush();
    expect(changer.getEngineKind()).toBe("tasks");
    expect(changer.getRefinementStep()).toBe(0);
    // Every round trip reads ~300ms — far over the ladder's slow
    // line (150ms since the Oct 25, 2026 motion fix recalibrated
    // the ladders to round-trip reality; ~100ms no longer steps
    // down, by design — a healthy phone lives there).
    fakeTasks().processMs = 300;
    const stepFrame = async () => {
      rafCallbacks[rafCallbacks.length - 1]?.();
      await flush();
    };
    // Warmup (12 samples) + one eval window (24): the ladder sheds
    // one refinement step.
    for (let i = 0; i < 60 && changer.getRefinementStep() === 0; i++) await stepFrame();
    expect(changer.getRefinementStep()).toBe(1);
    expect(changer.getTasksStep()).toBe(1);
    expect(fakeTasks().instances[0].step).toBe(1);
    // Sustained slowness walks to the lightest step — and STAYS:
    // the ladder's floor verdict steps the output canvas down
    // instead (a no-op at this test's 720p frame), the engine
    // never drops out, and the status never re-reports.
    for (let i = 0; i < 120 && changer.getRefinementStep() === 1; i++) await stepFrame();
    expect(changer.getRefinementStep()).toBe(2);
    for (let i = 0; i < 80; i++) await stepFrame();
    expect(changer.getRefinementStep()).toBe(2);
    expect(changer.getEngineKind()).toBe("tasks");
    expect(changer.segmentationAvailable).toBe(true);
    expect(statuses).toEqual(["tasks"]);
    await changer.stop();
  }, 120000);

  it("setQuality re-runs selection live (tasks → pro → tasks): each pick gets its own engine, a failed pick lands raw honestly", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({ mode: "green", quality: "tasks" });
    await changer.start();
    await flush();
    await flush();
    expect(changer.getEngineKind()).toBe("tasks");
    // Switch to Pro: no Worker in this environment — the pick
    // lands raw with its reason, NOT back on Tasks.
    await changer.setQuality("pro");
    expect(changer.getQuality()).toBe("pro");
    expect(changer.getEngineKind()).toBe("off");
    expect(changer.getEngineStatusDetail()).toEqual({
      kind: "off",
      fellBack: true,
      reason: "pro-init-failed",
    });
    // Switch back: a FRESH Tasks engine is constructed and adopted.
    await changer.setQuality("tasks");
    expect(changer.getQuality()).toBe("tasks");
    expect(changer.getEngineKind()).toBe("tasks");
    expect(changer.getEngineStatusDetail()).toEqual({ kind: "tasks", fellBack: false, reason: null });
    expect(fakeTasks().instances).toHaveLength(2);
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
    // shipping defaults — the refinement table itself must not move
    // the picture the steps were calibrated against.
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

describe("premium quality + motion build (Oct 23, 2026)", () => {
  const src = readFileSync(new URL("./background-changer.ts", import.meta.url), "utf8");

  it("asks the camera for its best: 1920x1080 ideal by default, 30fps", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({});
    expect(changer.config.width).toBe(1920);
    expect(changer.config.height).toBe(1080);
    expect(changer.config.fps).toBe(30);
  });

  it("the output starts at the 1080p cap with a 720p governed floor; the sharpest step reads the mask at 960px", async () => {
    const { OUTPUT_HEIGHT_CAP, OUTPUT_HEIGHT_FLOOR, MATTE_REFINEMENT_STEPS } = await import("./background-changer");
    expect(OUTPUT_HEIGHT_CAP).toBe(1080);
    expect(OUTPUT_HEIGHT_FLOOR).toBe(720);
    expect(MATTE_REFINEMENT_STEPS[0].maskCap).toBe(960);
  });

  it("the composite canvas is sized by the session output cap — the flat 720p cap is gone", () => {
    expect(src).toContain("this._canvasCapH / hgt");
    expect(src).not.toContain("720 / hgt");
    // A fresh session restores the top cap.
    expect(src).toContain("this._canvasCapH = OUTPUT_HEIGHT_CAP");
  });

  it("motion fix (Oct 25, 2026): the engines still snapshot at send time, but the LIVE composite cuts the CURRENT frame with the latest matte", () => {
    // Snapshotting lives in the engines now: each one draws the
    // frame it is about to run, synchronously, inside process(),
    // and the snapshot rides back on the matte for callers that
    // want the aligned still (photo path).
    const rvmSrc = readFileSync(new URL("./rvm-engine.ts", import.meta.url), "utf8");
    expect(rvmSrc).toContain("this._frameCtx.drawImage(video, 0, 0)");
    expect(rvmSrc).toContain("frame: pending.frame");
    const tasksSrc = readFileSync(new URL("./tasks-segmenter-engine.ts", import.meta.url), "utf8");
    expect(tasksSrc).toContain("this._feedCtx.drawImage(video, 0, 0, fw, fh)");
    expect(tasksSrc).toContain("matte.frame = frame");
    // The Oct 23 snapshot doctrine is RETIRED for the live path
    // (owner's phone verdict: the person only moved when a matte
    // landed, and the stall fallback painted his room over the
    // effect). The live composite now cuts the live video with
    // the latest stored matte — the Meet/Zoom arrangement.
    expect(src).not.toContain("matte.frame ?? this._video");
    expect(src).not.toContain("frameSource");
    expect(src).toContain("p.drawImage(this._video, 0, 0, W, H)");
    // A landed matte is stored (post-processed once), and the
    // loop composites it on every tick.
    expect(src).toContain("this._storeLandedMatte(matte, epoch)");
    expect(src).toContain("this._liveMatte = { epoch, width: mw, height: mh }");
  });

  it("the studio matte pipeline runs the motion-adaptive blend (the still-photo path keeps its own)", () => {
    expect(src).toContain("new MattePostProcessor({ motionSnap: 1 })");
  });

  it("sustained slowness at the matte floor steps the OUTPUT down once — degrade reaches _stepDownOutput", () => {
    expect(src).toContain('action === "degrade"');
    expect(src).toContain("this._stepDownOutput()");
    expect(src).toContain("this._canvasCapH = OUTPUT_HEIGHT_FLOOR");
  });
});

describe("one-engine truth (source contract)", () => {
  const src = readFileSync(new URL("./background-changer.ts", import.meta.url), "utf8");

  it("both engines are selected in the studio path — each behind the creator's pick", () => {
    expect(src).toContain("new RvmEngine()");
    expect(src).toContain("new TasksSegmenterEngine()");
    expect(src).toContain("TASKS_MAX_STEP");
    expect(src).toContain("TasksSegmenterError");
  });

  it("the Pro client is imported at runtime, but ONNX itself never enters the page", () => {
    expect(src).toContain("import { RvmEngine, RvmEngineError, RVM_MAX_STEP");
    /* The runtime, the session, and the model all live in the
       worker (rvm-worker.js, pinned in rvm-engine.test.ts): the
       changer holds no ORT surface at all. */
    expect(src).not.toContain("InferenceSession");
    expect(src).not.toContain("ort.all.min.js");
    expect(src).not.toContain("window.ort");
  });

  it("there is NO degrade and NO substitute: one candidate per quality, a park lands raw", () => {
    /* The candidate list IS the doctrine: exactly one engine per
       quality, chosen by the creator's pick. */
    expect(src).toContain('this.config.quality === "tasks" ? ["tasks"] : ["pro"]');
    /* The silent swap that erased the creator under motion is
       deleted, with the legacy engine that received it. */
    expect(src).not.toContain("_degradeToStandard");
    expect(src).not.toContain("MediaPipeEngine");
    expect(src).not.toContain("pro-too-slow");
    expect(src).not.toContain("fallbackLeft");
    /* A park records the kind and lands the camera raw. */
    expect(src).toContain("this._parkedKinds.add(engine.kind)");
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
    const changer = new BackgroundChanger({ quality: "tasks", mode: "none" });
    const { stream } = await changer.start();
    expect(stream).toBeTruthy();
    expect(scripts).toHaveLength(0);
    expect(fakeTasks().instances).toHaveLength(0); // no engine was ever constructed
    expect(changer.getEngineKind()).toBe("off");
    expect(changer.segmentationAvailable).toBe(false);

    // First backdrop mode of the session: the engine loads now.
    changer.setMode("green");
    await flush();
    await flush();
    expect(fakeTasks().instances).toHaveLength(1);
    expect(changer.getEngineKind()).toBe("tasks");
    expect(changer.segmentationAvailable).toBe(true);
    await changer.stop();
  });

  it("switching to 'none' mid-session stands the engine down — as a choice, not a failure", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({ mode: "green", quality: "tasks" });
    await changer.start();
    await flush();
    await flush();
    expect(changer.segmentationAvailable).toBe(true);
    expect(changer.getEngineKind()).toBe("tasks");

    changer.setMode("none");
    await flush();
    expect(changer.getEngineKind()).toBe("off");
    expect(changer.segmentationAvailable).toBe(false);
    expect(changer.engineError).toBeNull();
    expect(changer.getEngineStatusDetail()).toEqual({ kind: "off", fellBack: false, reason: null });
    await changer.stop();
  });
});

describe("freeze fix (Oct 21, 2026) — raw-first, opt-in effects, init timeout, failure cap", () => {
  it("start() acquires the camera and paints raw BEFORE the engine is even requested", async () => {
    const BackgroundChanger = await loadChanger();
    const order: string[] = [];
    (globalThis as { __tasksOrder?: string[] }).__tasksOrder = order;
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => {
          order.push("camera");
          return new FakeMediaStream([new FakeTrack("video")]);
        },
      },
    });
    const changer = new BackgroundChanger({ mode: "green", quality: "tasks" });
    const started = changer.start();
    await flush();
    /* The camera was acquired first; the engine was requested after. */
    expect(order).toEqual(["camera", "engine"]);
    /* start() resolved on the camera alone. */
    await started;
    expect(changer.running).toBe(true);
    /* The raw frame paints while the engine warms. (Up to three
       ticks: a callback queued before the session started can
       early-return without painting — the live loop's tick is
       the one that must paint.) */
    const canvas = changer.canvas as unknown as FakeCanvas;
    const before = canvas.ctx.calls.filter((c) => c === "drawImage").length;
    let after = before;
    for (let i = 0; i < 3 && after <= before; i++) {
      rafCallbacks[rafCallbacks.length - 1]?.();
      await flush();
      after = canvas.ctx.calls.filter((c) => c === "drawImage").length;
    }
    expect(after).toBeGreaterThan(before);
    /* The engine arrives — only now does the effect take over. */
    await flush();
    await flush();
    expect(changer.segmentationAvailable).toBe(true);
    expect(changer.getEngineKind()).toBe("tasks");
    await changer.stop();
  });

  it("a fresh session defaults to Original (mode 'none') — no engine is requested until a backdrop is picked", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({});
    expect(changer.mode).toBe("none");
    const { stream } = await changer.start();
    expect(stream).toBeTruthy();
    expect(scripts).toHaveLength(0);
    expect(fakeTasks().instances).toHaveLength(0);
    expect(changer.getEngineKind()).toBe("off");
    expect(changer.engineError).toBeNull();
    await changer.stop();
  });

  it("engine init is capped: a load that never answers lands raw with an honest timeout — and a late load is disposed, not adopted", async () => {
    const BackgroundChanger = await loadChanger();
    fakeTasks().hangInit = true;
    const statuses: string[] = [];
    const changer = new BackgroundChanger({
      mode: "green",
      quality: "tasks",
      engineInitTimeoutMs: 40,
      onEngineStatus: (k) => statuses.push(k),
    });
    const { stream } = await changer.start(); // resolves on the camera
    expect(stream).toBeTruthy();
    /* Never release the init — the load hangs. The timeout must land it. */
    await new Promise((r) => setTimeout(r, 150));
    expect(changer.running).toBe(true);
    expect(changer.segmentationAvailable).toBe(false);
    expect(changer.getEngineKind()).toBe("off");
    expect(changer.engineError?.code).toBe("CDN_LOAD_FAILED");
    expect(changer.engineError?.message).toContain("took too long");
    expect(statuses).toEqual(["off"]);
    /* A late load completes the orphaned init — the engine is
       disposed, never adopted behind the timeout's back. */
    fakeTasks().instances[0].releaseInit();
    await flush();
    await flush();
    expect(fakeTasks().instances[0].disposed).toBe(true);
    expect(changer.segmentationAvailable).toBe(false);
    await changer.stop();
  });

  it("an engine whose inferences keep failing parks itself for the rest of the session", async () => {
    const { MAX_CONSECUTIVE_INFERENCE_FAILURES } = await import("./background-changer");
    const BackgroundChanger = await loadChanger();
    const statuses: string[] = [];
    const changer = new BackgroundChanger({ mode: "green", quality: "tasks", onEngineStatus: (k) => statuses.push(k) });
    await changer.start();
    await flush();
    await flush();
    expect(changer.segmentationAvailable).toBe(true);
    const engine = fakeTasks().instances[0];
    fakeTasks().behavior = "fail";
    const baselineCalls = engine.processCalls; // warm-up frames during adoption
    const stepFrame = async () => {
      rafCallbacks[rafCallbacks.length - 1]?.();
      await flush();
    };
    for (let i = 0; i < MAX_CONSECUTIVE_INFERENCE_FAILURES; i++) await stepFrame();
    await flush();
    expect(engine.processCalls - baselineCalls).toBe(MAX_CONSECUTIVE_INFERENCE_FAILURES);
    expect(changer.segmentationAvailable).toBe(false);
    expect(changer.engineError?.code).toBe("SEGMENTATION_FAILED");
    expect(changer.engineError?.message).toContain("stopped working");
    expect(changer.getEngineStatusDetail()).toEqual({
      kind: "off",
      fellBack: true,
      reason: "tasks-stopped",
    });
    expect(statuses[statuses.length - 1]).toBe("off");
    /* Parked: further frames attempt nothing at all. */
    await stepFrame();
    await stepFrame();
    expect(engine.processCalls - baselineCalls).toBe(MAX_CONSECUTIVE_INFERENCE_FAILURES);
    /* Re-picking a backdrop mode does not revive it this session. */
    changer.setMode("blur");
    await flush();
    await flush();
    expect(changer.segmentationAvailable).toBe(false);
    expect(changer.engineError?.code).toBe("SEGMENTATION_FAILED");
    await changer.stop();
    /* A fresh session clears the park — the engine is adopted again. */
    fakeTasks().behavior = "instant";
    await changer.start();
    await flush();
    await flush();
    expect(changer.segmentationAvailable).toBe(true);
    expect(changer.getEngineKind()).toBe("tasks");
    await changer.stop();
  }, 30000);

  it("a landed matte resets the failure run — intermittent failures never park the engine", async () => {
    const { MAX_CONSECUTIVE_INFERENCE_FAILURES } = await import("./background-changer");
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({ mode: "green", quality: "tasks" });
    await changer.start();
    await flush();
    await flush();
    expect(changer.segmentationAvailable).toBe(true);
    const engine = fakeTasks().instances[0];
    const stepFrame = async () => {
      rafCallbacks[rafCallbacks.length - 1]?.();
      await flush();
    };
    /* Drive exactly N failing frames (adoption warm-up calls are
       not failures and must not pollute the run). */
    const failFrames = async (n: number) => {
      fakeTasks().behavior = "fail";
      const target = engine.processCalls + n;
      for (let i = 0; i < n * 4 && engine.processCalls < target; i++) await stepFrame();
      expect(engine.processCalls).toBe(target);
    };
    await failFrames(MAX_CONSECUTIVE_INFERENCE_FAILURES - 1);
    fakeTasks().behavior = "instant";
    await stepFrame(); // one good matte lands — the run resets
    await failFrames(MAX_CONSECUTIVE_INFERENCE_FAILURES - 1);
    await flush();
    expect(changer.segmentationAvailable).toBe(true);
    expect(changer.engineError).toBeNull();
    await changer.stop();
  }, 120000);
});

/* ------------------------------------------------ Pro engine (worker) rig */

/**
 * Fake for the Pro engine's dedicated worker (the real one is
 * public/engines/rvm/rvm-worker.js; rvm-engine.test.ts fakes the
 * same protocol for the client). Behaviours: 'auto' answers init
 * and every frame with a small matte; 'hang-init' never answers
 * init; 'frame-error' answers every frame with an error.
 */
type ProWorkerBehavior = "auto" | "hang-init" | "frame-error";

class FakeProWorker {
  static instances: FakeProWorker[] = [];
  static behavior: ProWorkerBehavior = "auto";
  messages: Array<{ type?: string; seq?: number }> = [];
  terminated = false;
  private _messageListeners: Array<(ev: { data?: unknown }) => void> = [];

  constructor() {
    FakeProWorker.instances.push(this);
  }

  addEventListener(type: "message" | "error", listener: (ev: { data?: unknown }) => void): void {
    if (type === "message") this._messageListeners.push(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    queueMicrotask(() => {
      for (const l of this._messageListeners) l({ data });
    });
  }

  postMessage(message: unknown): void {
    const msg = message as { type?: string; seq?: number };
    this.messages.push(msg);
    if (msg.type === "init") {
      if (FakeProWorker.behavior !== "hang-init") this.emit({ type: "ready", provider: "wasm" });
    } else if (msg.type === "frame") {
      if (FakeProWorker.behavior === "frame-error") {
        this.emit({ type: "frame-error", seq: msg.seq, message: "inference boom" });
      } else if (FakeProWorker.behavior === "auto") {
        const alpha = new Float32Array(8).fill(0.5);
        this.emit({ type: "matte", seq: msg.seq, alpha: alpha.buffer, width: 4, height: 2, ms: 5 });
      }
    }
  }

  framesSent(): number {
    return this.messages.filter((m) => m.type === "frame").length;
  }
}

describe("Pro engine (Oct 25, 2026) — selection, steps, park — no degrade, no substitute", () => {
  beforeEach(() => {
    FakeProWorker.instances = [];
    FakeProWorker.behavior = "auto";
    vi.stubGlobal("Worker", FakeProWorker);
    vi.stubGlobal("createImageBitmap", async (video: { videoWidth: number; videoHeight: number }) => ({
      width: video.videoWidth,
      height: video.videoHeight,
      close(): void {},
    }));
  });

  it("auto starts on the Pro engine: kind 'pro', NO Tasks engine is constructed, and a worker matte composites", async () => {
    const BackgroundChanger = await loadChanger();
    const statuses: string[] = [];
    const changer = new BackgroundChanger({ mode: "green", onEngineStatus: (k) => statuses.push(k) });
    const { stream } = await changer.start();
    await flush();
    await flush();
    expect(stream).toBeTruthy();
    expect(changer.getEngineKind()).toBe("pro");
    expect(changer.segmentationAvailable).toBe(true);
    expect(changer.engineError).toBeNull();
    expect(statuses).toEqual(["pro"]);
    expect(scripts).toHaveLength(0);
    expect(fakeTasks().instances).toHaveLength(0); // the other engine was never even constructed
    expect(changer.getProStep()).toBe(0);
    /* A frame goes to the worker; its matte composites. */
    const canvas = changer.canvas as unknown as FakeCanvas;
    const before = canvas.ctx.calls.filter((c) => c === "drawImage").length;
    rafCallbacks[rafCallbacks.length - 1]?.();
    await flush();
    await flush();
    expect(FakeProWorker.instances[0].framesSent()).toBe(1);
    const after = canvas.ctx.calls.filter((c) => c === "drawImage").length;
    expect(after).toBeGreaterThan(before);
    await changer.stop();
    expect(FakeProWorker.instances[0].terminated).toBe(true);
  });

  it("'tasks' quality never constructs the Pro worker — the Tasks engine is its whole story", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({ mode: "green", quality: "tasks" });
    await changer.start();
    await flush();
    await flush();
    expect(changer.getEngineKind()).toBe("tasks");
    expect(FakeProWorker.instances).toHaveLength(0);
    expect(fakeTasks().instances).toHaveLength(1);
    await changer.stop();
  });

  it("a Pro worker that never answers init times out under the SAME cap and lands RAW — no substitute engine", async () => {
    FakeProWorker.behavior = "hang-init";
    const BackgroundChanger = await loadChanger();
    const statuses: string[] = [];
    const changer = new BackgroundChanger({
      mode: "green",
      engineInitTimeoutMs: 40,
      onEngineStatus: (k) => statuses.push(k),
    });
    const { stream } = await changer.start(); // resolves on the camera (raw-first)
    expect(stream).toBeTruthy();
    await new Promise((r) => setTimeout(r, 150)); // the 40ms cap fires on the hung init
    await flush();
    expect(changer.getEngineKind()).toBe("off");
    expect(changer.segmentationAvailable).toBe(false);
    expect(changer.engineError?.code).toBe("CDN_LOAD_FAILED");
    expect(changer.engineError?.message).toContain("took too long");
    expect(changer.getEngineStatusDetail()).toEqual({
      kind: "off",
      fellBack: true,
      reason: "pro-init-failed",
    });
    expect(statuses).toEqual(["off"]);
    expect(fakeTasks().instances).toHaveLength(0); // nobody was swapped in
    await changer.stop();
  });

  it("Pro inferences that keep failing park the Pro engine and land RAW — reported, never swapped", async () => {
    const { MAX_CONSECUTIVE_INFERENCE_FAILURES } = await import("./background-changer");
    FakeProWorker.behavior = "frame-error";
    const BackgroundChanger = await loadChanger();
    const statuses: string[] = [];
    const changer = new BackgroundChanger({ mode: "green", onEngineStatus: (k) => statuses.push(k) });
    await changer.start();
    await flush();
    await flush();
    expect(changer.getEngineKind()).toBe("pro");
    const stepFrame = async () => {
      rafCallbacks[rafCallbacks.length - 1]?.();
      await flush();
      await flush();
    };
    for (let i = 0; i < MAX_CONSECUTIVE_INFERENCE_FAILURES; i++) await stepFrame();
    await flush();
    const worker = FakeProWorker.instances[0];
    expect(worker.framesSent()).toBe(MAX_CONSECUTIVE_INFERENCE_FAILURES);
    expect(worker.terminated).toBe(true); // the parked engine is stood down
    /* The park lands the camera raw — and NO other engine is
       constructed to take its place. */
    expect(changer.getEngineKind()).toBe("off");
    expect(changer.segmentationAvailable).toBe(false);
    expect(changer.engineError?.code).toBe("SEGMENTATION_FAILED");
    expect(changer.getEngineStatusDetail()).toEqual({
      kind: "off",
      fellBack: true,
      reason: "pro-stopped",
    });
    expect(statuses).toEqual(["pro", "off"]);
    expect(fakeTasks().instances).toHaveLength(0);
    /* The parked Pro engine receives no further frames. */
    await stepFrame();
    expect(worker.framesSent()).toBe(MAX_CONSECUTIVE_INFERENCE_FAILURES);
    await changer.stop();
  }, 30000);

  it("auto walks the Pro steps down on sustained slowness — and HOLDS the floor step (the degrade is deleted)", async () => {
    const BackgroundChanger = await loadChanger();
    const statuses: string[] = [];
    const changer = new BackgroundChanger({ mode: "green", onEngineStatus: (k) => statuses.push(k) });
    await changer.start();
    await flush();
    await flush();
    expect(changer.getEngineKind()).toBe("pro");
    expect(changer.getProStep()).toBe(0);
    // Every performance.now() call jumps 300ms, so each worker
    // round trip reads as ~300ms — far over the ladder's slow line
    // (200ms since the Oct 25, 2026 motion fix recalibrated the
    // ladders to round-trip reality).
    let t = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => (t += 300));
    try {
      const stepFrame = async () => {
        rafCallbacks[rafCallbacks.length - 1]?.();
        await flush();
        await flush();
      };
      for (let i = 0; i < 120 && changer.getProStep() === 0; i++) await stepFrame();
      expect(changer.getProStep()).toBe(1);
      for (let i = 0; i < 120 && changer.getProStep() === 1; i++) await stepFrame();
      expect(changer.getProStep()).toBe(2);
      for (let i = 0; i < 120 && changer.getProStep() === 2; i++) await stepFrame();
      expect(changer.getProStep()).toBe(3);
      /* At the Pro floor, sustained slowness used to hand the
         session to the per-frame engine (the motion-erasure
         defect). Now the floor simply HOLDS: still Pro, no other
         engine constructed, no status change. */
      for (let i = 0; i < 200; i++) await stepFrame();
      expect(changer.getProStep()).toBe(3);
      expect(changer.getEngineKind()).toBe("pro");
      expect(changer.segmentationAvailable).toBe(true);
      expect(fakeTasks().instances).toHaveLength(0);
      expect(statuses).toEqual(["pro"]);
    } finally {
      nowSpy.mockRestore();
      await changer.stop();
    }
  }, 120000);

  it("'pro' quality walks its internal steps on slowness but NEVER swaps engines under the creator", async () => {
    const BackgroundChanger = await loadChanger();
    const statuses: string[] = [];
    const changer = new BackgroundChanger({ mode: "green", quality: "pro", onEngineStatus: (k) => statuses.push(k) });
    await changer.start();
    await flush();
    await flush();
    expect(changer.getEngineKind()).toBe("pro");
    let t = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => (t += 300)); // 300ms/trip: far over the recalibrated slow line (motion fix, Oct 25, 2026)
    try {
      const stepFrame = async () => {
        rafCallbacks[rafCallbacks.length - 1]?.();
        await flush();
        await flush();
      };
      for (let i = 0; i < 400 && changer.getProStep() < 3; i++) await stepFrame();
      expect(changer.getProStep()).toBe(3);
      /* Far past the floor: still Pro, still no other engine. */
      for (let i = 0; i < 120; i++) await stepFrame();
      expect(changer.getProStep()).toBe(3);
      expect(changer.getEngineKind()).toBe("pro");
      expect(fakeTasks().instances).toHaveLength(0);
      expect(statuses).toEqual(["pro"]);
    } finally {
      nowSpy.mockRestore();
      await changer.stop();
    }
  }, 120000);
});

describe("honest engine status (Stack-100 #3 Lane C — the exit is VISIBLE)", () => {
  /* The owner's retest verdict on the restored build was "still
     the same thing": on his device the Pro engine never served —
     it died on the freeze-era 10s init cap against a 27–37 MB
     cold payload — the light engine silently took over, and the
     studio's status line read "On" for both engines, so the
     fallback could not even be SEEN, let alone reported. These
     pins hold the truth channel: the detail reports the engine
     ACTUALLY adopted, whether the wanted engine exited, and why;
     the kind channel's sequences are unchanged. In the
     one-engine build an exit always pairs with kind 'off' —
     nothing serves in the wanted engine's place. */

  it("the init cap is sized for the Pro engine's real cold payload (45s, not the freeze-era 10s)", async () => {
    const { ENGINE_INIT_TIMEOUT_MS } = await import("./background-changer");
    expect(ENGINE_INIT_TIMEOUT_MS).toBe(45_000);
  });

  it("Pro live: the detail says Pro, no fallback, no reason — and the kind channel is untouched", async () => {
    FakeProWorker.instances = [];
    FakeProWorker.behavior = "auto";
    vi.stubGlobal("Worker", FakeProWorker);
    vi.stubGlobal("createImageBitmap", async (video: { videoWidth: number; videoHeight: number }) => ({
      width: video.videoWidth,
      height: video.videoHeight,
      close(): void {},
    }));
    const BackgroundChanger = await loadChanger();
    const statuses: string[] = [];
    const details: unknown[] = [];
    const changer = new BackgroundChanger({
      mode: "green",
      onEngineStatus: (k) => statuses.push(k),
      onEngineStatusDetail: (d) => details.push(d),
    });
    await changer.start();
    await flush();
    await flush();
    expect(changer.getEngineKind()).toBe("pro");
    expect(changer.getEngineStatusDetail()).toEqual({ kind: "pro", fellBack: false, reason: null });
    expect(details).toEqual([{ kind: "pro", fellBack: false, reason: null }]);
    expect(statuses).toEqual(["pro"]);
    await changer.stop();
  });

  it("Pro that cannot start: the RAW landing REPORTS the exit and its reason", async () => {
    /* No Worker in this environment: the Pro engine cannot even
       spawn — the exact shape of an unsupported browser. */
    const BackgroundChanger = await loadChanger();
    const details: unknown[] = [];
    const changer = new BackgroundChanger({
      mode: "green",
      onEngineStatusDetail: (d) => details.push(d),
    });
    await changer.start();
    await flush();
    await flush();
    expect(changer.getEngineKind()).toBe("off");
    expect(changer.getEngineStatusDetail()).toEqual({
      kind: "off",
      fellBack: true,
      reason: "pro-init-failed",
    });
    expect(details[details.length - 1]).toEqual({
      kind: "off",
      fellBack: true,
      reason: "pro-init-failed",
    });
    await changer.stop();
  });

  it("a pinned 'tasks' quality is a CHOICE, never reported as a fallback", async () => {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({ mode: "green", quality: "tasks" });
    await changer.start();
    await flush();
    await flush();
    expect(changer.getEngineKind()).toBe("tasks");
    expect(changer.getEngineStatusDetail()).toEqual({ kind: "tasks", fellBack: false, reason: null });
    await changer.stop();
  });

  it("Pro parked by the failure cap: the RAW landing reports 'pro-stopped'", async () => {
    const { MAX_CONSECUTIVE_INFERENCE_FAILURES } = await import("./background-changer");
    FakeProWorker.instances = [];
    FakeProWorker.behavior = "frame-error";
    vi.stubGlobal("Worker", FakeProWorker);
    vi.stubGlobal("createImageBitmap", async (video: { videoWidth: number; videoHeight: number }) => ({
      width: video.videoWidth,
      height: video.videoHeight,
      close(): void {},
    }));
    const BackgroundChanger = await loadChanger();
    const details: unknown[] = [];
    const changer = new BackgroundChanger({
      mode: "green",
      onEngineStatusDetail: (d) => details.push(d),
    });
    await changer.start();
    await flush();
    await flush();
    expect(changer.getEngineKind()).toBe("pro");
    const stepFrame = async () => {
      rafCallbacks[rafCallbacks.length - 1]?.();
      await flush();
      await flush();
    };
    for (let i = 0; i < MAX_CONSECUTIVE_INFERENCE_FAILURES; i++) await stepFrame();
    await flush();
    expect(changer.getEngineKind()).toBe("off");
    expect(changer.getEngineStatusDetail()).toEqual({
      kind: "off",
      fellBack: true,
      reason: "pro-stopped",
    });
    expect(details[details.length - 1]).toEqual({
      kind: "off",
      fellBack: true,
      reason: "pro-stopped",
    });
    expect(fakeTasks().instances).toHaveLength(0);
    await changer.stop();
  }, 30000);

  it("sustained slowness NEVER reports a fallback: Pro holds its floor step and the detail stays clean", async () => {
    FakeProWorker.instances = [];
    FakeProWorker.behavior = "auto";
    vi.stubGlobal("Worker", FakeProWorker);
    vi.stubGlobal("createImageBitmap", async (video: { videoWidth: number; videoHeight: number }) => ({
      width: video.videoWidth,
      height: video.videoHeight,
      close(): void {},
    }));
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({ mode: "green" });
    await changer.start();
    await flush();
    await flush();
    expect(changer.getEngineKind()).toBe("pro");
    let t = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => (t += 300)); // 300ms/trip: far over the recalibrated slow line (motion fix, Oct 25, 2026)
    try {
      const stepFrame = async () => {
        rafCallbacks[rafCallbacks.length - 1]?.();
        await flush();
        await flush();
      };
      for (let i = 0; i < 800 && changer.getProStep() < 3; i++) await stepFrame();
      expect(changer.getProStep()).toBe(3);
      for (let i = 0; i < 120; i++) await stepFrame();
      expect(changer.getEngineKind()).toBe("pro");
      expect(changer.getEngineStatusDetail()).toEqual({ kind: "pro", fellBack: false, reason: null });
      expect(fakeTasks().instances).toHaveLength(0);
    } finally {
      nowSpy.mockRestore();
      await changer.stop();
    }
  }, 120000);

  it("the studio renders the ACTUAL engine name and the plain exit notes (source contract)", () => {
    const studio = readFileSync(
      new URL("../../components/go-live/BroadcastStudio.tsx", import.meta.url),
      "utf8",
    );
    /* The live engine is NAMED — never a dressed-up "On". */
    expect(studio).toContain('engineKind === "pro" ? "Pro" : engineKind === "tasks" ? "MediaPipe Tasks" : "Off"');
    expect(studio).not.toContain('engineKind === "off" ? "Off" : "On"');
    /* An engine exit is VISIBLE, with its reason, worded for the
       creator — and the camera honestly reads as running plain. */
    expect(studio).toContain('data-testid="engine-fallback-note"');
    expect(studio).toContain("Pro engine couldn't start on this device — camera is running plain.");
    expect(studio).toContain("Pro engine stopped on this device — camera is running plain. Try MediaPipe, or reopen the studio.");
    expect(studio).toContain("MediaPipe engine couldn't start on this device — camera is running plain.");
    expect(studio).toContain("MediaPipe engine stopped on this device — camera is running plain. Try Pro, or reopen the studio.");
    /* And it is fed by the kit's probe-based detail channel. */
    expect(studio).toContain("onEngineStatusDetail");
    expect(studio).toContain("getEngineStatusDetail()");
  });
});

describe("motion fix (Oct 25, 2026) — the person moves at camera rate, the background never snaps to the raw room", () => {
  /* The owner's live verdict on the Stack-300 build: "The green
     screen is not fixed" — moving erased the background. Diagnosis
     in greenscreen-matting-scope-2026-10-25.md. These tests pin
     the arrangement at the pipeline level: compositing is
     decoupled from inference, a stall holds the effect instead of
     painting the raw room, and each engine's sends pair strictly
     with their own results (the send-pairing pins themselves
     live in the engines' own suites — the slow-send deadline pin
     is tasks-segmenter-engine.test.ts). */

  const drawCount = (changer: { canvas: unknown }) =>
    (changer.canvas as FakeCanvas).ctx.calls.filter((c) => c === "drawImage").length;
  const fillCount = (changer: { canvas: unknown }) =>
    (changer.canvas as FakeCanvas).ctx.calls.filter((c) => c === "fillRect").length;

  async function startTasks(mode: "green" | "blur" = "green", extra: Record<string, unknown> = {}) {
    const BackgroundChanger = await loadChanger();
    const changer = new BackgroundChanger({ mode, quality: "tasks", ...extra });
    await changer.start();
    await flush();
    await flush();
    expect(changer.getEngineKind()).toBe("tasks");
    return changer;
  }

  it("composites on EVERY loop tick while an inference is still in flight — motion no longer waits for mattes", async () => {
    const changer = await startTasks();
    fakeTasks().behavior = "manual";
    const engine = fakeTasks().instances[0];
    const baselineCalls = engine.processCalls; // warm-up frames during adoption
    // Tick 1: the first frame goes out and pends.
    rafCallbacks[rafCallbacks.length - 1]?.();
    await flush();
    expect(engine.processCalls).toBe(baselineCalls + 1);
    // Its matte lands: stored, and composited immediately.
    engine.deliver();
    await flush();
    const afterMatte = drawCount(changer);
    expect(afterMatte).toBeGreaterThan(0);
    // Tick 2 launches the next frame (which stays in flight — the
    // slow-device case). Ticks 2..4 must EACH paint a fresh frame:
    // before the fix, the canvas only changed when a matte landed,
    // so these counts froze between landings.
    let last = afterMatte;
    for (let i = 0; i < 3; i++) {
      rafCallbacks[rafCallbacks.length - 1]?.();
      await flush();
      const nowCount = drawCount(changer);
      expect(nowCount).toBeGreaterThan(last);
      last = nowCount;
    }
    expect(engine.processCalls).toBe(baselineCalls + 2); // still just the one in flight — never queued
    await changer.stop();
  });

  it("a matte stall holds the effect (the green stays painted) while the status honestly reports off — raw NEVER paints over a live backdrop", async () => {
    const statuses: string[] = [];
    const changer = await startTasks("green", { onEngineStatus: (k: string) => statuses.push(k) });
    fakeTasks().behavior = "manual";
    const engine = fakeTasks().instances[0];
    // The clock mock goes in BEFORE the first matte lands, so the
    // stall tracker's anchor lives on the same (mocked) clock:
    // every performance.now() call jumps a full second.
    let t = 0;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => (t += 1000));
    try {
      rafCallbacks[rafCallbacks.length - 1]?.();
      await flush();
      engine.deliver();
      await flush();
      await flush();
      expect(fillCount(changer)).toBeGreaterThan(0); // the green is up
      // The next frame never answers (a hung/slow engine on a
      // loaded device). A few ticks at +1s per clock call puts the
      // matte gap far past the 2s stall line.
      const fillsAtStallStart = fillCount(changer);
      for (let i = 0; i < 4; i++) {
        rafCallbacks[rafCallbacks.length - 1]?.();
        await flush();
      }
      // The status channel told the truth about the silence…
      expect(statuses).toContain("off");
      // …but the canvas kept painting the EFFECT (green fillRect
      // on every tick) instead of snapping to the raw room, which
      // is what the old stall fallback did.
      expect(fillCount(changer)).toBeGreaterThan(fillsAtStallStart);
    } finally {
      nowSpy.mockRestore();
      await changer.stop();
    }
  }, 30000);

  it("a healthy device's round trips (~100ms) hold the sharpest refinement step — the ladder no longer marches every device to the floor", async () => {
    const changer = await startTasks();
    expect(changer.getRefinementStep()).toBe(0);
    // Every round trip reads ~100ms — a healthy device. Before
    // the Oct 25 recalibration (slowMs 46) this walked the
    // refinement to step 2 and beyond; the ladder now only
    // rescues drowning.
    fakeTasks().processMs = 100;
    for (let i = 0; i < 80; i++) {
      rafCallbacks[rafCallbacks.length - 1]?.();
      await flush();
    }
    expect(changer.getRefinementStep()).toBe(0);
    expect(changer.getEngineKind()).toBe("tasks");
    await changer.stop();
  }, 30000);
});
