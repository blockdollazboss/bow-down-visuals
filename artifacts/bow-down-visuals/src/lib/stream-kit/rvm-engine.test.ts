/**
 * RvmEngine worker-client tests (rvm-engine.ts).
 *
 * The Pro engine's freeze (Oct 18, 2026) was main-thread ONNX
 * inference; the fix (Oct 23) moved the session into a dedicated
 * worker and made this class a thin client. These pins hold the
 * client's disciplines:
 *  - frames are NEVER queued (one in flight; a busy ask is a
 *    skipped frame, and the worker sees exactly one frame);
 *  - a worker that stops answering is timed out and KILLED — the
 *    frame fails, the engine is dead, nothing wedges;
 *  - a frame error fails that frame but not the engine;
 *  - the matte rides back with the send-time frame snapshot
 *    (frame-aligned compositing);
 *  - the vendored worker script's step table matches RVM_STEPS.
 *
 * DOM + Worker are faked by hand (the kit suite runs in node).
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RvmEngine,
  RvmEngineError,
  RVM_STEPS,
  RVM_MAX_STEP,
  ortBases,
  rvmModelUrls,
  rvmWorkerUrl,
  RVM_ORIGIN_BASE,
  type RvmWorkerLike,
} from "./rvm-engine";

/* ---------------------------------------------------------------- fakes */

class FakeCtx {
  drawImage(): void {}
}

class FakeCanvas {
  width = 0;
  height = 0;
  ctx = new FakeCtx();
  getContext(): FakeCtx {
    return this.ctx;
  }
}

type WorkerBehavior = "auto" | "init-error" | "hang" | "frame-error" | "crash-on-frame";

class FakeWorker implements RvmWorkerLike {
  static instances: FakeWorker[] = [];
  static behavior: WorkerBehavior = "auto";
  messages: Array<{ type?: string; seq?: number; step?: number }> = [];
  terminated = false;
  private _messageListeners: Array<(ev: { data?: unknown }) => void> = [];
  private _errorListeners: Array<(ev: { data?: unknown }) => void> = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: "message" | "error", listener: (ev: { data?: unknown }) => void): void {
    if (type === "message") this._messageListeners.push(listener);
    else this._errorListeners.push(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: unknown): void {
    queueMicrotask(() => {
      for (const l of this._messageListeners) l({ data });
    });
  }

  emitError(): void {
    queueMicrotask(() => {
      for (const l of this._errorListeners) l({});
    });
  }

  postMessage(message: unknown): void {
    const msg = message as { type?: string; seq?: number; step?: number };
    this.messages.push(msg);
    if (FakeWorker.behavior === "hang") return;
    if (msg.type === "init") {
      if (FakeWorker.behavior === "init-error") this.emit({ type: "init-error", message: "nope" });
      else this.emit({ type: "ready", provider: "wasm" });
      return;
    }
    if (msg.type === "frame") {
      if (FakeWorker.behavior === "frame-error") {
        this.emit({ type: "frame-error", seq: msg.seq, message: "boom" });
      } else if (FakeWorker.behavior === "crash-on-frame") {
        this.emitError();
      } else {
        const alpha = new Float32Array([0, 0.25, 0.5, 0.75, 1, 0.9, 0.4, 0.1]);
        this.emit({ type: "matte", seq: msg.seq, alpha: alpha.buffer, width: 4, height: 2, ms: 7 });
      }
    }
  }

  framesSent(): number {
    return this.messages.filter((m) => m.type === "frame").length;
  }
}

const fakeVideo = { videoWidth: 1280, videoHeight: 720 } as unknown as HTMLVideoElement;
const flushMicro = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  FakeWorker.instances = [];
  FakeWorker.behavior = "auto";
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag === "canvas") return new FakeCanvas();
      throw new Error(`unexpected element ${tag}`);
    },
  });
  vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
  vi.stubGlobal("createImageBitmap", async (video: HTMLVideoElement) => ({
    width: video.videoWidth,
    height: video.videoHeight,
    close(): void {},
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeEngine(opts: { frameTimeoutMs?: number } = {}): RvmEngine {
  return new RvmEngine({
    createWorker: () => new FakeWorker(),
    frameTimeoutMs: opts.frameTimeoutMs ?? 500,
  });
}

/* ---------------------------------------------------------------- tests */

describe("RvmEngine worker client", () => {
  it("init hands the worker the vendored-first asset chains and resolves on ready", async () => {
    const engine = makeEngine();
    await engine.init();
    expect(engine.provider).toBe("wasm");
    const worker = FakeWorker.instances[0];
    const init = worker.messages.find((m) => m.type === "init") as unknown as {
      ortBases: string[];
      modelUrls: string[];
      threads: number;
    };
    expect(init.ortBases).toEqual(ortBases());
    expect(init.modelUrls).toEqual(rvmModelUrls());
    expect(init.threads).toBe(4); // min(4, hardwareConcurrency 8)
    await engine.dispose();
  });

  it("the worker script is the shipped same-origin copy (workers cannot be constructed cross-origin)", () => {
    expect(rvmWorkerUrl()).toBe(`${RVM_ORIGIN_BASE}/rvm-worker.js`);
    expect(RVM_ORIGIN_BASE.startsWith("http")).toBe(false);
  });

  it("init rejects CDN_LOAD_FAILED when the worker reports init-error", async () => {
    FakeWorker.behavior = "init-error";
    const engine = makeEngine();
    await expect(engine.init()).rejects.toMatchObject({ code: "CDN_LOAD_FAILED" });
    expect(engine.provider).toBeNull();
  });

  it("init rejects CDN_LOAD_FAILED when no worker can spawn (no Worker in this browser)", async () => {
    const engine = new RvmEngine({
      createWorker: () => {
        throw new RvmEngineError("CDN_LOAD_FAILED", "no workers here");
      },
    });
    await expect(engine.init()).rejects.toMatchObject({ code: "CDN_LOAD_FAILED" });
  });

  it("a matte rides back with the send-time frame snapshot and round-trip timing", async () => {
    const engine = makeEngine();
    await engine.init();
    const matte = await engine.process(fakeVideo);
    expect(matte).not.toBeNull();
    expect(matte!.width).toBe(4);
    expect(matte!.height).toBe(2);
    expect(Array.from(matte!.alpha)).toEqual(
      Array.from(new Float32Array([0, 0.25, 0.5, 0.75, 1, 0.9, 0.4, 0.1])),
    );
    /* Frame alignment: the snapshot is the video's own size, taken
       at send time — the composite cuts THIS frame with this matte. */
    expect(matte!.frame).toBeTruthy();
    expect(matte!.frame!.width).toBe(1280);
    expect(matte!.frame!.height).toBe(720);
    expect(engine.lastMs).not.toBeNull();
    expect(engine.lastInferenceMs).toBe(7);
    await engine.dispose();
  });

  it("BACKPRESSURE PIN: a frame asked for while one is in flight is skipped — never queued", async () => {
    FakeWorker.behavior = "hang"; // init never answers either — use a manual worker instead
    const worker = new FakeWorker();
    worker.postMessage = (message: unknown) => {
      const msg = message as { type?: string };
      worker.messages.push(msg);
      if (msg.type === "init") worker.emit({ type: "ready", provider: "wasm" });
      // frames are never answered: the first stays in flight
    };
    const engine = new RvmEngine({ createWorker: () => worker, frameTimeoutMs: 60_000 });
    await engine.init();
    const first = engine.process(fakeVideo);
    await flushMicro();
    expect(worker.framesSent()).toBe(1);
    /* The busy ask resolves null immediately and sends NOTHING. */
    await expect(engine.process(fakeVideo)).resolves.toBeNull();
    expect(worker.framesSent()).toBe(1);
    await engine.dispose();
    await expect(first).resolves.toBeNull(); // dispose settles the in-flight frame
  });

  it("FRAME TIMEOUT PIN: a worker that stops answering is killed — the frame fails, nothing wedges", async () => {
    FakeWorker.behavior = "hang";
    const worker = new FakeWorker();
    const realPost = worker.postMessage.bind(worker);
    worker.postMessage = (message: unknown) => {
      const msg = message as { type?: string };
      if (msg.type === "init") {
        worker.messages.push(msg);
        worker.emit({ type: "ready", provider: "wasm" });
        return;
      }
      realPost(message); // frames hang (behavior 'hang')
    };
    const engine = new RvmEngine({ createWorker: () => worker, frameTimeoutMs: 60 });
    await engine.init();
    await expect(engine.process(fakeVideo)).rejects.toMatchObject({ code: "INFERENCE_FAILED" });
    expect(worker.terminated).toBe(true);
    /* A dead engine yields null frames — the caller falls back. */
    await expect(engine.process(fakeVideo)).resolves.toBeNull();
    await engine.dispose();
  });

  it("a frame error fails that frame but NOT the engine — the next frame can land", async () => {
    const engine = makeEngine();
    await engine.init();
    FakeWorker.behavior = "frame-error";
    await expect(engine.process(fakeVideo)).rejects.toMatchObject({ code: "INFERENCE_FAILED" });
    expect(FakeWorker.instances[0].terminated).toBe(false);
    FakeWorker.behavior = "auto";
    const matte = await engine.process(fakeVideo);
    expect(matte).not.toBeNull();
    await engine.dispose();
  });

  it("a worker crash mid-frame fails the frame and retires the engine", async () => {
    FakeWorker.behavior = "crash-on-frame";
    const engine = makeEngine();
    await engine.init();
    await expect(engine.process(fakeVideo)).rejects.toMatchObject({ code: "INFERENCE_FAILED" });
    await expect(engine.process(fakeVideo)).resolves.toBeNull();
    await engine.dispose();
  });

  it("steps clamp to the table, post to the worker, and ride on frame messages", async () => {
    const engine = makeEngine();
    await engine.init();
    const worker = FakeWorker.instances[0];
    engine.setStep(99);
    expect(engine.step).toBe(RVM_MAX_STEP);
    expect(worker.messages).toContainEqual({ type: "step", step: RVM_MAX_STEP });
    engine.setStep(RVM_MAX_STEP); // no change — no second post
    expect(worker.messages.filter((m) => m.type === "step")).toHaveLength(1);
    await engine.process(fakeVideo);
    const frame = worker.messages.find((m) => m.type === "frame");
    expect(frame!.step).toBe(RVM_MAX_STEP);
    await engine.dispose();
  });

  it("reset posts to the worker (its recurrent state lives there)", async () => {
    const engine = makeEngine();
    await engine.init();
    engine.reset();
    expect(FakeWorker.instances[0].messages).toContainEqual({ type: "reset" });
    await engine.dispose();
  });

  it("dispose terminates the worker and is idempotent", async () => {
    const engine = makeEngine();
    await engine.init();
    await engine.dispose();
    expect(FakeWorker.instances[0].terminated).toBe(true);
    await expect(engine.process(fakeVideo)).resolves.toBeNull();
    await engine.dispose();
  });
});

describe("vendored worker script (source contract)", () => {
  const src = readFileSync(new URL("../../../public/engines/rvm/rvm-worker.js", import.meta.url), "utf8");

  it("carries the same step table as RVM_STEPS — feed caps and ratios in order", () => {
    const tableMatch = src.match(/var RVM_STEPS = \[([\s\S]*?)\];/);
    expect(tableMatch).not.toBeNull();
    const body = tableMatch![1];
    const entries = [...body.matchAll(/feedCap:\s*(\d+),\s*ratio:\s*("auto"|[\d.]+)/g)].map((m) => ({
      feedCap: Number(m[1]),
      ratio: m[2] === '"auto"' ? "auto" : Number(m[2]),
    }));
    expect(entries).toEqual(RVM_STEPS.map((s) => ({ feedCap: s.feedCap, ratio: s.ratio })));
  });

  it("loads the runtime with importScripts and runs the session off the page thread", () => {
    expect(src).toContain("importScripts(");
    expect(src).toContain("ort.all.min.js");
    expect(src).toContain("InferenceSession.create");
    expect(src).toContain("OffscreenCanvas");
    /* The recurrent state is held in the worker across frames. */
    expect(src).toContain("r1i: states[0]");
    /* Mattes are transferred back, not copied. */
    expect(src).toContain("[copy.buffer]");
  });

  it("init makes a FULL attempt per runtime base — no script-base lock-in (Stack-100 #3 Lane C)", () => {
    /* Before: the first base whose importScripts succeeded locked
       the init, and if every session create under it failed the
       whole init died — even with good runtime copies at the next
       bases. Now each base gets its own full attempt (script +
       provider × model chain) and init only fails when EVERY
       base's chain has failed. */
    expect(src).toContain("function attemptBase(");
    expect(src).toContain("return attemptBase(base, modelUrls, msg.threads, webgpu)");
    expect(src).toContain('type: "init-error"');
  });

  it("every session create races a deadline — a hung create cannot eat the init budget (Stack-100 #3 Lane C)", () => {
    expect(src).toContain("CREATE_DEADLINE_MS");
    expect(src).toContain("Promise.race([create, deadline])");
    /* A create that resolves after losing its race is released,
       never adopted as a second session. */
    expect(src).toContain("late.release()");
  });

  it("the page-side client never loads ONNX into the page (no ort global, no session)", () => {
    const clientSrc = readFileSync(new URL("./rvm-engine.ts", import.meta.url), "utf8");
    expect(clientSrc).not.toContain("InferenceSession");
    expect(clientSrc).not.toContain("loadOrtScript");
    expect(clientSrc).toContain("new Worker(rvmWorkerUrl())");
  });
});
