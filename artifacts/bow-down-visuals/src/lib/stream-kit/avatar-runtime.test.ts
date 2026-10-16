/**
 * AvatarDirector tests (avatar-runtime.ts) driven the way the stage
 * drives it: canvasFor() per frame from a manual clock + fake rAF,
 * a fake face engine, and a fake mic analyser. Covers the drive
 * ladder's honesty (engine failure → voice → idle, never a frozen
 * or fake "face" state), the ~30 Hz detection throttle, stale-source
 * parking (tracking stops when nobody draws the source), per-source
 * canvases, and engine disposal on the last forget.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { AvatarDirector, type FaceEngineLike } from "./avatar-runtime";
import { createSource, type SceneSource } from "./scenes";

class FakeCtx {
  calls: string[] = [];
  fillStyle: unknown = "";
  strokeStyle: unknown = "";
  lineWidth = 1;
  lineCap = "";
  globalAlpha = 1;
  save(): void {}
  restore(): void {}
  translate(): void {}
  rotate(): void {}
  scale(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  quadraticCurveTo(): void {}
  bezierCurveTo(): void {}
  ellipse(): void {}
  arc(): void {}
  roundRect(): void {}
  fill(): void {}
  stroke(): void {}
  clip(): void {}
  fillRect(): void {}
  clearRect(): void { this.calls.push("clearRect"); }
  drawImage(): void {}
  createLinearGradient(): { addColorStop: () => void } { return { addColorStop: () => undefined }; }
  createRadialGradient(): { addColorStop: () => void } { return { addColorStop: () => undefined }; }
}

class FakeCanvas {
  width = 0;
  height = 0;
  ctx = new FakeCtx();
  getContext(): FakeCtx {
    return this.ctx;
  }
}

beforeAll(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => {
      if (tag === "canvas") return new FakeCanvas();
      throw new Error(`unexpected element ${tag}`);
    },
  };
  (globalThis as { Image?: unknown }).Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    set src(_v: string) {}
  };
});

class FakeEngine implements FaceEngineLike {
  ready = false;
  detectCalls = 0;
  disposed = false;
  sample: { categories: Array<{ categoryName: string; score: number }>; matrix: null } | null = {
    categories: [
      { categoryName: "eyeBlinkLeft", score: 0 },
      { categoryName: "jawOpen", score: 0.3 },
    ],
    matrix: null,
  };
  constructor(private readonly failInit: boolean) {}
  async init(): Promise<void> {
    if (this.failInit) throw new Error("engine boom (fake)");
    this.ready = true;
  }
  detect(): typeof this.sample {
    this.detectCalls++;
    return this.sample;
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    this.ready = false;
  }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function harness(opts: { engineFails?: boolean; withMic?: boolean } = {}) {
  const clock = { t: 0 };
  let pending: (() => void) | null = null;
  const engine = new FakeEngine(!!opts.engineFails);
  const analyser = opts.withMic
    ? { getByteTimeDomainData: (arr: Uint8Array) => arr.fill(210) }
    : null;
  const director = new AvatarDirector({
    video: () => ({}) as never,
    analyser: () => analyser as never,
    engineFactory: () => engine,
    now: () => clock.t,
    raf: (cb) => {
      pending = cb;
      return 1;
    },
    cancelRaf: () => {
      pending = null;
    },
  });
  /** Advance the clock and run one scheduled frame (the loop parks itself). */
  const frame = (ms = 16) => {
    clock.t += ms;
    const cb = pending;
    pending = null;
    if (cb) cb();
    return pending !== null;
  };
  const frames = (n: number, ms = 16) => {
    for (let i = 0; i < n; i++) frame(ms);
  };
  return { director, engine, clock, frame, frames, isRunning: () => pending !== null };
}

function avatarSource(partial: Partial<SceneSource> = {}): SceneSource {
  return { ...createSource("avatar"), ...partial };
}

describe("AvatarDirector ladder", () => {
  it("engine failure falls back to voice when a mic exists — never a fake face state", async () => {
    const h = harness({ engineFails: true, withMic: true });
    const src = avatarSource();
    const canvas = h.director.canvasFor(src);
    expect(canvas).not.toBeNull();
    await flush();
    h.frames(4);
    const status = h.director.statusFor(src);
    expect(status.engine).toBe("failed");
    expect(status.mode).toBe("voice");
    expect(status.fellBack).toBe(true);
    // The character still renders (no dead source).
    expect((canvas as unknown as FakeCanvas).ctx.calls).toContain("clearRect");
    h.director.dispose();
  });

  it("engine failure with no mic lands on idle, honestly labelled", async () => {
    const h = harness({ engineFails: true, withMic: false });
    const src = avatarSource();
    h.director.canvasFor(src);
    await flush();
    h.frames(4);
    const status = h.director.statusFor(src);
    expect(status.mode).toBe("idle");
    expect(status.fellBack).toBe(true);
    expect(status.reason).toBeTruthy();
    h.director.dispose();
  });

  it("a producing engine drives face mode with no fallback flag", async () => {
    const h = harness({ withMic: true });
    const src = avatarSource();
    h.director.canvasFor(src);
    await flush();
    h.frames(4);
    const status = h.director.statusFor(src);
    expect(status.engine).toBe("ready");
    expect(status.mode).toBe("face");
    expect(status.fellBack).toBe(false);
    expect(h.engine.detectCalls).toBeGreaterThan(0);
    h.director.dispose();
  });

  it("when face samples stop, the ladder drops to voice instead of freezing", async () => {
    const h = harness({ withMic: true });
    const src = avatarSource();
    h.director.canvasFor(src);
    await flush();
    h.frames(2);
    expect(h.director.statusFor(src).mode).toBe("face");
    h.engine.sample = null; // face left the frame; samples stop landing
    // Keep the source wanted (canvasFor each ~frame) while time passes
    // past the freshness window.
    for (let i = 0; i < 120; i++) {
      h.director.canvasFor(src);
      h.frame(16);
    }
    expect(h.director.statusFor(src).mode).toBe("voice");
    h.director.dispose();
  });

  it("voice-requested sources never start the face engine", async () => {
    const h = harness({ withMic: true });
    const src = avatarSource();
    src.avatar = { character: "shark", drive: "voice", sensitivity: 1 };
    h.director.canvasFor(src);
    await flush();
    h.frames(4);
    expect(h.director.statusFor(src).mode).toBe("voice");
    expect(h.director.statusFor(src).engine).toBe("off");
    expect(h.engine.detectCalls).toBe(0);
    h.director.dispose();
  });
});

describe("AvatarDirector economy + lifecycle", () => {
  it("detection is throttled to ~30 Hz, not once per render frame", async () => {
    const h = harness({});
    const src = avatarSource();
    h.director.canvasFor(src);
    await flush();
    for (let i = 0; i < 30; i++) {
      h.director.canvasFor(src);
      h.frame(16);
    }
    // 30 frames at 16 ms = 480 ms → about 10-15 detects, never 30.
    expect(h.engine.detectCalls).toBeGreaterThan(3);
    expect(h.engine.detectCalls).toBeLessThan(20);
    h.director.dispose();
  });

  it("a source nobody draws parks the loop; drawing it again resumes", async () => {
    const h = harness({});
    const src = avatarSource();
    h.director.canvasFor(src);
    await flush();
    h.frames(2);
    expect(h.isRunning()).toBe(true);
    h.frames(40); // 640 ms without a canvasFor → stale window (400 ms) passes
    expect(h.isRunning()).toBe(false);
    const detectsAtPark = h.engine.detectCalls;
    h.frames(20); // time passes; a parked loop must stay parked
    expect(h.engine.detectCalls).toBe(detectsAtPark);
    expect(h.engine.disposed).toBe(false); // engine survives a park
    h.director.canvasFor(src);
    expect(h.isRunning()).toBe(true);
    h.director.dispose();
  });

  it("each source gets its own canvas; the last forget disposes the engine", async () => {
    const h = harness({});
    const a = avatarSource();
    const b = avatarSource();
    const ca = h.director.canvasFor(a);
    const cb = h.director.canvasFor(b);
    expect(ca).not.toBeNull();
    expect(cb).not.toBeNull();
    expect(ca).not.toBe(cb);
    await flush();
    h.frames(2);
    h.director.forget(a.id);
    expect(h.engine.disposed).toBe(false);
    h.director.forget(b.id);
    expect(h.engine.disposed).toBe(true);
    expect(h.director.entryCount).toBe(0);
    h.director.dispose();
  });

  it("upload character: no picture yet → no canvas + an honest note", () => {
    const h = harness({});
    const src = avatarSource();
    src.avatar = { character: "upload", drive: "idle", sensitivity: 1 };
    expect(h.director.canvasFor(src)).toBeNull();
    expect(h.director.noteFor(src)).toContain("Add your picture");
    src.avatar = { character: "upload", drive: "idle", sensitivity: 1, imageUrl: "https://example.com/me.png" };
    expect(h.director.canvasFor(src)).toBeNull(); // still loading
    expect(h.director.noteFor(src)).toContain("Loading your picture");
    h.director.dispose();
  });
});
