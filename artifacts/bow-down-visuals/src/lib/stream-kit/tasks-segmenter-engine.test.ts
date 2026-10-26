/**
 * TasksSegmenterEngine tests (tasks-segmenter-engine.ts) — the
 * MediaPipe Tasks background engine behind the shared
 * MattingEngine contract.
 *
 * The engine is driven through an INJECTED fake tasks-vision
 * module (the avatar-face-engine.test.ts pattern): no real WASM,
 * no real model — the pins are the client's disciplines:
 *  - vendored-first model chain, GPU delegate before CPU;
 *  - ONE frame in flight: a frame asked for while another is
 *    outstanding resolves null, never queues;
 *  - the frame is snapshotted synchronously at send time, at the
 *    live step's feed cap, and rides back on EngineMatte.frame;
 *  - a send silent past its deadline settles as a FAILED frame
 *    (INFERENCE_FAILED) and its late result is dropped, never
 *    paired with a newer frame — the slow-send pin the legacy
 *    engine's changer tests used to hold, kept here where the
 *    deadline actually lives;
 *  - segmentForVideo timestamps strictly increase.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ---------------------------------------------------------------- fakes */

class FakeCtx {
  drawImage(): void {}
}

class FakeCanvas {
  width = 0;
  height = 0;
  getContext(): FakeCtx {
    return new FakeCtx();
  }
}

interface FakeMask {
  width: number;
  height: number;
  values: Float32Array;
  closed: boolean;
  getAsFloat32Array(): Float32Array;
  close(): void;
}

function makeMask(width = 4, height = 2, fill = 0.7): FakeMask {
  const mask: FakeMask = {
    width,
    height,
    values: new Float32Array(width * height).fill(fill),
    closed: false,
    getAsFloat32Array() {
      return this.values;
    },
    close() {
      this.closed = true;
    },
  };
  return mask;
}

type SegmenterBehavior = "callback" | "sync" | "hang" | "throw";

interface FakeState {
  behavior: SegmenterBehavior;
  failDelegates: string[];
  failModels: boolean;
  createOptions: Array<Record<string, unknown>>;
  wasmPaths: string[];
  sentSources: Array<{ width: number; height: number }>;
  timestamps: number[];
  masks: FakeMask[];
  segmenterClosed: boolean;
}

function makeFakeModule(state: FakeState) {
  return {
    FilesetResolver: {
      forVisionTasks: async (wasmPath: string) => {
        state.wasmPaths.push(wasmPath);
        return { wasmPath };
      },
    },
    ImageSegmenter: {
      createFromOptions: async (_fileset: unknown, options: Record<string, unknown>) => {
        state.createOptions.push(options);
        const base = options.baseOptions as { modelAssetPath: string; delegate: string };
        if (state.failModels || state.failDelegates.includes(base.delegate)) {
          throw new Error(`cannot start ${base.delegate}`);
        }
        return {
          segmentForVideo(
            source: { width: number; height: number },
            timestamp: number,
            callback?: (result: unknown) => void,
          ): unknown {
            state.sentSources.push({ width: source.width, height: source.height });
            state.timestamps.push(timestamp);
            if (state.behavior === "throw") throw new Error("graph boom");
            if (state.behavior === "hang") return undefined;
            const mask = makeMask();
            state.masks.push(mask);
            const result = { confidenceMasks: [mask] };
            if (state.behavior === "sync") return result;
            queueMicrotask(() => callback?.(result));
            return undefined;
          },
          close(): void {
            state.segmenterClosed = true;
          },
        };
      },
    },
  };
}

function freshState(): FakeState {
  return {
    behavior: "callback",
    failDelegates: [],
    failModels: false,
    createOptions: [],
    wasmPaths: [],
    sentSources: [],
    timestamps: [],
    masks: [],
    segmenterClosed: false,
  };
}

async function loadEngine() {
  vi.resetModules();
  return import("./tasks-segmenter-engine");
}

function makeVideo(width = 1280, height = 720): HTMLVideoElement {
  return { videoWidth: width, videoHeight: height } as HTMLVideoElement;
}

beforeEach(() => {
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag === "canvas") return new FakeCanvas();
      throw new Error(`unexpected element ${tag}`);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ---------------------------------------------------------------- tests */

describe("TasksSegmenterEngine", () => {
  it("model chain is vendored-first: R2 mirror → shipped origin copy → canonical Google storage", async () => {
    const { tasksModelUrls, TASKS_MODEL_FILE, TASKS_MODEL_REMOTE_URL } = await loadEngine();
    const urls = tasksModelUrls();
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain(TASKS_MODEL_FILE);
    expect(urls[0]).not.toContain("storage.googleapis.com");
    expect(urls[1]).toContain(`engines/tasks-segmenter/${TASKS_MODEL_FILE}`);
    expect(urls[2]).toBe(TASKS_MODEL_REMOTE_URL);
    expect(urls[2]).toContain("storage.googleapis.com");
  });

  it("step table aligns 1:1 with the changer's matte-refinement caps", async () => {
    const { TASKS_STEPS, TASKS_MAX_STEP } = await loadEngine();
    const { MATTE_REFINEMENT_STEPS, MATTE_MAX_STEP } = await import("./background-changer");
    expect(TASKS_MAX_STEP).toBe(MATTE_MAX_STEP);
    expect(TASKS_STEPS.map((s) => s.feedCap)).toEqual(MATTE_REFINEMENT_STEPS.map((s) => s.maskCap));
  }, 60000);

  it("init prefers the GPU delegate, VIDEO mode, confidence masks", async () => {
    const { TasksSegmenterEngine } = await loadEngine();
    const state = freshState();
    const engine = new TasksSegmenterEngine({ importModule: async () => makeFakeModule(state) as never });
    await engine.init();
    expect(engine.delegate).toBe("GPU");
    expect(state.wasmPaths).toHaveLength(1);
    const opts = state.createOptions[0] as { runningMode: string; outputConfidenceMasks: boolean };
    expect(opts.runningMode).toBe("VIDEO");
    expect(opts.outputConfidenceMasks).toBe(true);
    await engine.dispose();
    expect(state.segmenterClosed).toBe(true);
  });

  it("init falls back GPU → CPU when the GPU delegate cannot start", async () => {
    const { TasksSegmenterEngine } = await loadEngine();
    const state = freshState();
    state.failDelegates = ["GPU"];
    const engine = new TasksSegmenterEngine({ importModule: async () => makeFakeModule(state) as never });
    await engine.init();
    expect(engine.delegate).toBe("CPU");
    await engine.dispose();
  });

  it("a total start failure is LOAD_FAILED", async () => {
    const { TasksSegmenterEngine, TasksSegmenterError } = await loadEngine();
    const state = freshState();
    state.failModels = true;
    const engine = new TasksSegmenterEngine({ importModule: async () => makeFakeModule(state) as never });
    await expect(engine.init()).rejects.toBeInstanceOf(TasksSegmenterError);
    await expect(engine.init()).rejects.toMatchObject({ code: "LOAD_FAILED" });
  });

  it("process returns the person matte, copies its alpha, closes the mask, and attaches the send-time frame", async () => {
    const { TasksSegmenterEngine } = await loadEngine();
    const state = freshState();
    const engine = new TasksSegmenterEngine({ importModule: async () => makeFakeModule(state) as never });
    await engine.init();
    const matte = await engine.process(makeVideo());
    expect(matte).not.toBeNull();
    expect(matte!.width).toBe(4);
    expect(matte!.height).toBe(2);
    expect(Array.from(matte!.alpha)).toEqual(Array.from(new Float32Array(8).fill(0.7)));
    expect(matte!.alpha).not.toBe(state.masks[0].values); // a copy, not the runtime's buffer
    expect(state.masks[0].closed).toBe(true);
    expect(matte!.frame).toBeTruthy();
    expect(engine.lastMs).not.toBeNull();
    await engine.dispose();
  });

  it("the feed is snapshot at the step's cap: 1280px wide enters at 960 (step 0) and 384 (step 2)", async () => {
    const { TasksSegmenterEngine } = await loadEngine();
    const state = freshState();
    const engine = new TasksSegmenterEngine({ importModule: async () => makeFakeModule(state) as never });
    await engine.init();
    await engine.process(makeVideo(1280, 720));
    expect(state.sentSources[0].width).toBe(960);
    engine.setStep(2);
    await engine.process(makeVideo(1280, 720));
    expect(state.sentSources[1].width).toBe(384);
    engine.setStep(99); // clamps to the floor step
    expect(engine.step).toBe(2);
    await engine.dispose();
  });

  it("ONE frame in flight: a second process() while one pends resolves null — never queued", async () => {
    const { TasksSegmenterEngine } = await loadEngine();
    const state = freshState();
    state.behavior = "hang";
    const engine = new TasksSegmenterEngine({
      importModule: async () => makeFakeModule(state) as never,
      frameTimeoutMs: 60,
    });
    await engine.init();
    const first = engine.process(makeVideo());
    const second = await engine.process(makeVideo());
    expect(second).toBeNull();
    await expect(first).rejects.toMatchObject({ code: "INFERENCE_FAILED" });
    expect(state.sentSources).toHaveLength(1); // the second frame was never sent
    await engine.dispose();
  });

  it("SLOW-SEND PIN: a send silent past its deadline fails the frame; the late result is dropped, never mispaired", async () => {
    const { TasksSegmenterEngine } = await loadEngine();
    const state = freshState();
    state.behavior = "hang";
    const engine = new TasksSegmenterEngine({
      importModule: async () => makeFakeModule(state) as never,
      frameTimeoutMs: 60,
    });
    await engine.init();
    await expect(engine.process(makeVideo())).rejects.toMatchObject({ code: "INFERENCE_FAILED" });
    /* The engine is free again immediately: the next frame sends
       and lands normally (the hung send's callback, if it ever
       fires, belongs to a settled episode and is ignored). */
    state.behavior = "callback";
    const matte = await engine.process(makeVideo());
    expect(matte).not.toBeNull();
    expect(state.sentSources).toHaveLength(2);
    await engine.dispose();
  });

  it("a synchronously-returning segmenter settles the same way as the callback form", async () => {
    const { TasksSegmenterEngine } = await loadEngine();
    const state = freshState();
    state.behavior = "sync";
    const engine = new TasksSegmenterEngine({ importModule: async () => makeFakeModule(state) as never });
    await engine.init();
    const matte = await engine.process(makeVideo());
    expect(matte).not.toBeNull();
    expect(matte!.width).toBe(4);
    await engine.dispose();
  });

  it("a throwing graph fails the frame as INFERENCE_FAILED, and timestamps strictly increase across sends", async () => {
    const { TasksSegmenterEngine } = await loadEngine();
    const state = freshState();
    const engine = new TasksSegmenterEngine({ importModule: async () => makeFakeModule(state) as never });
    await engine.init();
    await engine.process(makeVideo());
    await engine.process(makeVideo());
    expect(state.timestamps).toHaveLength(2);
    expect(state.timestamps[1]).toBeGreaterThan(state.timestamps[0]);
    state.behavior = "throw";
    await expect(engine.process(makeVideo())).rejects.toMatchObject({ code: "INFERENCE_FAILED" });
    await engine.dispose();
  });

  it("process before init and after dispose resolves null; dispose closes the segmenter", async () => {
    const { TasksSegmenterEngine } = await loadEngine();
    const state = freshState();
    const engine = new TasksSegmenterEngine({ importModule: async () => makeFakeModule(state) as never });
    expect(await engine.process(makeVideo())).toBeNull();
    await engine.init();
    await engine.dispose();
    expect(state.segmenterClosed).toBe(true);
    expect(await engine.process(makeVideo())).toBeNull();
  });
});
