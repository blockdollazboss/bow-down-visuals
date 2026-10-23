/**
 * Face engine tests (avatar-face-engine.ts): vendored-first URL
 * order, init fallback order (bundle → wasm base follows the bundle,
 * GPU → CPU, local model → remote model), honest LOAD_FAILED when
 * everything fails, and detect() behaviour against a fake
 * landmarker — null paths, the frame cap, and strictly increasing
 * timestamps (the real API throws on equal timestamps).
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  FaceDriveEngine,
  FaceEngineError,
  visionBundleUrls,
  visionWasmBases,
  faceModelUrls,
  FACE_MODEL_LOCAL_URL,
  FACE_MODEL_ORIGIN_URL,
  FACE_MODEL_REMOTE_URL,
  VISION_LOCAL_BASE,
  VISION_ORIGIN_BASE,
  VISION_CDN_BASE,
  type FaceResultLike,
  type VisionModuleLike,
} from "./avatar-face-engine";

/* A document fake good enough for the scratch feed canvas. */
class FakeFeedCanvas {
  width = 0;
  height = 0;
  ctx = { drawImage: (..._a: unknown[]) => { this.draws++; } };
  draws = 0;
  getContext(): unknown {
    return this.ctx;
  }
}
let lastFeed: FakeFeedCanvas | null = null;
beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => {
      if (tag === "canvas") {
        lastFeed = new FakeFeedCanvas();
        return lastFeed;
      }
      throw new Error(`unexpected element ${tag}`);
    },
  };
});

interface FakeState {
  failUrls: Set<string>;
  createPlan: Array<"ok" | "fail">;
  createCalls: Array<{ delegate: unknown; model: unknown; wasm: unknown }>;
  detectResult: FaceResultLike;
  detectTs: number[];
  closed: boolean;
}

function makeFake(): { state: FakeState; importModule: (url: string) => Promise<VisionModuleLike> } {
  const state: FakeState = {
    failUrls: new Set(),
    createPlan: [],
    createCalls: [],
    detectResult: {
      faceBlendshapes: [{ categories: [{ categoryName: "jawOpen", score: 0.5 }] }],
      facialTransformationMatrixes: [{ rows: 4, columns: 4, data: new Array(16).fill(0) }],
    },
    detectTs: [],
    closed: false,
  };
  let wasmSeen: unknown = null;
  const mod: VisionModuleLike = {
    FilesetResolver: {
      forVisionTasks: async (wasmPath: string) => {
        wasmSeen = wasmPath;
        return { wasmPath };
      },
    },
    FaceLandmarker: {
      createFromOptions: async (_fileset: unknown, options: Record<string, unknown>) => {
        const base = options.baseOptions as { delegate: unknown; modelAssetPath: unknown };
        state.createCalls.push({ delegate: base.delegate, model: base.modelAssetPath, wasm: wasmSeen });
        const plan = state.createPlan.length ? state.createPlan.shift()! : "ok";
        if (plan === "fail") throw new Error("create failed (fake)");
        return {
          detectForVideo: (_src: unknown, ts: number) => {
            state.detectTs.push(ts);
            return state.detectResult;
          },
          close: () => {
            state.closed = true;
          },
        };
      },
    },
  };
  const importModule = async (url: string): Promise<VisionModuleLike> => {
    if (state.failUrls.has(url)) throw new Error(`import failed (fake): ${url}`);
    return mod;
  };
  return { state, importModule };
}

const fakeVideo = { videoWidth: 1280, videoHeight: 720, readyState: 4 };

describe("vendored-first URLs", () => {
  it("bundle, wasm and model all try the same-origin copy first", () => {
    expect(visionBundleUrls()[0]).toBe(`${VISION_LOCAL_BASE}/vision_bundle.mjs`);
    expect(visionWasmBases()[0]).toBe(`${VISION_LOCAL_BASE}/wasm`);
    expect(faceModelUrls()[0]).toBe(FACE_MODEL_LOCAL_URL);
  });

  it("fallback order is R2 bucket → shipped same-origin copy → third-party CDN (S27-18)", () => {
    expect(visionBundleUrls()).toEqual([
      `${VISION_LOCAL_BASE}/vision_bundle.mjs`,
      `${VISION_ORIGIN_BASE}/vision_bundle.mjs`,
      `${VISION_CDN_BASE}/vision_bundle.mjs`,
    ]);
    expect(visionWasmBases()).toEqual([
      `${VISION_LOCAL_BASE}/wasm`,
      `${VISION_ORIGIN_BASE}/wasm`,
      `${VISION_CDN_BASE}/wasm`,
    ]);
    expect(faceModelUrls()).toEqual([
      FACE_MODEL_LOCAL_URL,
      FACE_MODEL_ORIGIN_URL,
      FACE_MODEL_REMOTE_URL,
    ]);
    /* The middle step is the TRUE origin base: a same-origin path
       hanging off BASE_URL, not another remote host. */
    expect(VISION_ORIGIN_BASE).toBe(`${import.meta.env.BASE_URL}engines/face-landmarker`);
    expect(VISION_ORIGIN_BASE.startsWith("http")).toBe(false);
    expect(FACE_MODEL_ORIGIN_URL).toBe(
      `${import.meta.env.BASE_URL}engines/face-landmarker/face_landmarker.task`,
    );
  });
});

/* One shared fake for everything after the LOAD_FAILED test: the
 * engine module caches the imported bundle at module level (by
 * design — it is expensive), so later engines reuse the FIRST
 * successfully imported module. Resetting the shared state between
 * tests keeps them independent. */
const shared = makeFake();
function resetShared(): void {
  shared.state.createPlan = [];
  shared.state.createCalls = [];
  shared.state.detectTs = [];
  shared.state.closed = false;
  shared.state.detectResult = {
    faceBlendshapes: [{ categories: [{ categoryName: "jawOpen", score: 0.5 }] }],
    facialTransformationMatrixes: [{ rows: 4, columns: 4, data: new Array(16).fill(0) }],
  };
}

describe("init fallbacks", () => {
  it("LOAD_FAILED when every bundle import fails (ordered before any success — the module cache resets on failure)", async () => {
    const { state, importModule } = makeFake();
    for (const u of visionBundleUrls()) state.failUrls.add(u);
    const engine = new FaceDriveEngine({ importModule });
    await expect(engine.init()).rejects.toBeInstanceOf(FaceEngineError);
    await expect(engine.init()).rejects.toMatchObject({ code: "LOAD_FAILED" });
    expect(engine.ready).toBe(false);
  });

  it("happy path: local bundle + GPU + local model, wasm follows the bundle base", async () => {
    resetShared();
    const { state, importModule } = shared;
    const engine = new FaceDriveEngine({ importModule });
    await engine.init();
    expect(engine.ready).toBe(true);
    expect(engine.delegate).toBe("GPU");
    expect(engine.loadedFrom).toBe("local");
    expect(state.createCalls).toHaveLength(1);
    expect(state.createCalls[0]).toMatchObject({ delegate: "GPU", model: FACE_MODEL_LOCAL_URL, wasm: `${VISION_LOCAL_BASE}/wasm` });
    await engine.dispose();
    expect(state.closed).toBe(true);
    expect(engine.ready).toBe(false);
  });

  it("falls GPU → CPU and local model → remote model in order", async () => {
    resetShared();
    const { state, importModule } = shared;
    // GPU+local fails, GPU+origin fails, GPU+remote fails, CPU+local succeeds.
    state.createPlan = ["fail", "fail", "fail", "ok"];
    const engine = new FaceDriveEngine({ importModule });
    await engine.init();
    expect(engine.delegate).toBe("CPU");
    expect(state.createCalls.map((c) => [c.delegate, String(c.model).includes("storage.googleapis")])).toEqual([
      ["GPU", false],
      ["GPU", false],
      ["GPU", true],
      ["CPU", false],
    ]);
    /* The middle GPU attempt is the shipped same-origin model copy. */
    expect(state.createCalls[1]!.model).toBe(FACE_MODEL_ORIGIN_URL);
    await engine.dispose();
  });
});

describe("detect", () => {
  it("returns null before init and for an unready video; samples once ready", async () => {
    resetShared();
    const { state, importModule } = shared;
    const engine = new FaceDriveEngine({ importModule });
    expect(engine.detect(fakeVideo as never, 100)).toBeNull();
    await engine.init();
    expect(engine.detect({ videoWidth: 0, videoHeight: 0, readyState: 0 } as never, 100)).toBeNull();
    const sample = engine.detect(fakeVideo as never, 100);
    expect(sample).not.toBeNull();
    expect(sample!.categories[0]).toMatchObject({ categoryName: "jawOpen", score: 0.5 });
    expect(sample!.matrix).toHaveLength(16);
    // The feed is capped: 1280 wide → 384.
    expect(lastFeed!.width).toBe(384);
    expect(lastFeed!.height).toBe(216);
    await engine.dispose();
    expect(engine.detect(fakeVideo as never, 200)).toBeNull();
    void state;
  });

  it("timestamps are strictly increasing even when the caller repeats one", async () => {
    resetShared();
    const { state, importModule } = shared;
    const engine = new FaceDriveEngine({ importModule });
    await engine.init();
    engine.detect(fakeVideo as never, 500);
    engine.detect(fakeVideo as never, 500);
    engine.detect(fakeVideo as never, 499);
    expect(state.detectTs).toEqual([500, 501, 502]);
    await engine.dispose();
  });

  it("no face in frame → null sample (caller keeps the last pose)", async () => {
    resetShared();
    const { state, importModule } = shared;
    state.detectResult = { faceBlendshapes: [] };
    const engine = new FaceDriveEngine({ importModule });
    await engine.init();
    expect(engine.detect(fakeVideo as never, 100)).toBeNull();
    await engine.dispose();
  });
});
