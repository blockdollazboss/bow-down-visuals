/**
 * rvm-engine.ts — the Pro background engine: Robust Video Matting
 * (RVM, MobileNetV3) via ONNX Runtime Web — running in a dedicated
 * Web Worker (public/engines/rvm/rvm-worker.js), never in the page.
 *
 * Why it exists: the Standard engine (MediaPipe Selfie
 * Segmentation) emits a hard, low-resolution mask — rough hair
 * edges and visible flicker. RVM is a true video-matting model: it
 * outputs a soft alpha matte with hair-level detail, and its
 * recurrent state is carried across frames, which is where its
 * temporal stability comes from (no per-frame mask flicker).
 *
 * THE FREEZE, AND THE FIX (Oct 18–23, 2026): this engine used to
 * run its ONNX session in the page. ONNX Runtime Web executes on
 * the calling thread unless it is offloaded — the WASM proxy
 * worker was never enabled, and the WebGPU backend orchestrates
 * and reads results back on the caller too — so every frame cost
 * the UI thread a synchronous drawImage + getImageData + a
 * per-pixel planar conversion AND the full fp32 inference, back
 * to back for as long as a backdrop effect was on. The caller's
 * one-in-flight discipline meant frames never queued; instead the
 * UI thread simply never got a gap — the tab froze solid when an
 * effect was picked on the owner's phone, and the engine was
 * pulled from the studio (Oct 18). The light engine's edge detail
 * was the price, and the owner has now ordered the heavy engine
 * fixed and restored (Oct 23). The fix is isolation: the session,
 * the recurrent state, and all per-frame math live in the worker;
 * this class is a thin client that ships one frame bitmap in
 * (transferred, zero-copy) and receives one alpha matte back
 * (transferred). Inference can block only the worker thread, and
 * a worker that stops answering is timed out and killed — a
 * heavy-engine failure degrades to the light engine, never a
 * frozen tab.
 *
 * Everything is VENDORED (public/engines/onnxruntime +
 * public/engines/rvm) and lazy-loaded only when a camera starts —
 * the same local-first discipline as the other engines. The
 * worker is constructed from the shipped same-origin copy (a
 * Worker cannot be constructed cross-origin); inside the worker,
 * the runtime script and the model load through the usual chain —
 * the site's media bucket, then the same-origin copies, then the
 * public CDN/GitHub as last-resort fallbacks.
 */

import { mediaUrl } from "../media-cdn";

export const ORT_LOCAL_BASE = mediaUrl("engines/onnxruntime");
/* The shipped same-origin copies (public/engines/…) — the fallback
   immediately after the R2 media bucket and before the CDN, so a
   bucket outage never makes the load depend on a third party. */
export const ORT_ORIGIN_BASE = `${import.meta.env.BASE_URL}engines/onnxruntime`;
export const ORT_CDN_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist";
export const RVM_LOCAL_BASE = mediaUrl("engines/rvm");
export const RVM_ORIGIN_BASE = `${import.meta.env.BASE_URL}engines/rvm`;
export const RVM_CDN_BASE =
  "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0";
export const RVM_MODEL_FILE = "rvm_mobilenetv3_fp32.onnx";

/** The vendored-first bases for the ORT runtime (the worker loads
 *  `ort.all.min.js` from the first that answers). */
export function ortBases(): string[] {
  return [ORT_LOCAL_BASE, ORT_ORIGIN_BASE, ORT_CDN_BASE];
}

/** The vendored-first asset URLs for the ORT runtime script. */
export function ortScriptUrls(): string[] {
  return ortBases().map((base) => `${base}/ort.all.min.js`);
}

/** The vendored-first URLs for the RVM model file. */
export function rvmModelUrls(): string[] {
  return [
    `${RVM_LOCAL_BASE}/${RVM_MODEL_FILE}`,
    `${RVM_ORIGIN_BASE}/${RVM_MODEL_FILE}`,
    `${RVM_CDN_BASE}/${RVM_MODEL_FILE}`,
  ];
}

/**
 * The worker script's URL. Workers cannot be constructed
 * cross-origin, so this is the shipped same-origin copy — it
 * travels with the app build, and the heavy assets it loads
 * (runtime + model) still resolve through the full fallback chain
 * inside the worker.
 */
export function rvmWorkerUrl(): string {
  return `${RVM_ORIGIN_BASE}/rvm-worker.js`;
}

/**
 * How long one frame may go unanswered before the worker is
 * declared wedged (ms). Far above a slow phone's worst honest
 * inference at the top step, far below "frozen forever": on
 * timeout the frame fails, the worker is killed, and the caller's
 * failure governance takes over (the studio falls back to the
 * light engine) instead of the pipeline wedging silently.
 */
export const RVM_FRAME_TIMEOUT_MS = 5_000;

/** A produced alpha matte: values 0..1, row-major, width*height. */
export interface EngineMatte {
  alpha: Float32Array;
  width: number;
  height: number;
  /** The exact source frame this matte was computed from. Engines
   *  that segment a LIVE feed snapshot the frame at send time and
   *  carry it here, so the caller composites the matte against its
   *  OWN frame — a matte laid over a newer live frame tears at
   *  every moving edge (ghost where the subject was, the subject
   *  erased where it now is). Still-image engines leave it unset
   *  and their callers draw their own source. */
  frame?: HTMLCanvasElement;
}

/** The contract every matting engine implements (Pro + Standard). */
export interface MattingEngine {
  readonly kind: "pro" | "standard";
  /** Load + initialise. Throws on failure (caller runs the ladder). */
  init(): Promise<void>;
  /** Produce the matte for the video's current frame, or null when
   *  no matte is available for this frame (caller skips compositing
   *  this tick rather than queueing). */
  process(video: HTMLVideoElement): Promise<EngineMatte | null>;
  /** Drop temporal/recurrent state (camera switch, resize, step). */
  reset(): void;
  /** Release sessions/workers. Safe to call once. */
  dispose(): Promise<void>;
}

export class RvmEngineError extends Error {
  code: "CDN_LOAD_FAILED" | "INFERENCE_FAILED";
  cause?: unknown;
  constructor(code: "CDN_LOAD_FAILED" | "INFERENCE_FAILED", message: string, cause?: unknown) {
    super(message);
    this.name = "RvmEngineError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/* ------------------------------------------------------------- step table */

/** Internal quality steps, best first. The PerfLadder walks these
 *  before the caller degrades engines. `feedCap` bounds the width
 *  fed to the model; `ratio` is RVM's downsample_ratio (the model's
 *  low-res branch works at feed * ratio — ~480px wide at step 0).
 *  The worker (public/engines/rvm/rvm-worker.js) carries a mirror
 *  of this table; rvm-engine.test.ts pins the two together. */
export const RVM_STEPS: ReadonlyArray<{ feedCap: number; ratio: number | "auto" }> = [
  { feedCap: 896, ratio: "auto" },
  { feedCap: 896, ratio: 0.32 },
  { feedCap: 640, ratio: 0.5 },
  { feedCap: 640, ratio: 0.34 },
];
export const RVM_MAX_STEP = RVM_STEPS.length - 1;

/* --------------------------------------------------------- worker seam */

/** The slice of the Worker API the client drives. Tests inject a
 *  fake through the constructor; production spawns the real
 *  vendored worker. */
export interface RvmWorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message" | "error", listener: (ev: { data?: unknown }) => void): void;
  terminate(): void;
}

export interface RvmEngineOptions {
  /** Spawn the engine worker. Default: the vendored worker script. */
  createWorker?: () => RvmWorkerLike;
  /** Per-frame answer deadline (ms). Default RVM_FRAME_TIMEOUT_MS. */
  frameTimeoutMs?: number;
}

function defaultCreateWorker(): RvmWorkerLike {
  if (typeof Worker === "undefined") {
    throw new RvmEngineError("CDN_LOAD_FAILED", "This browser cannot run the Pro background engine.");
  }
  try {
    return new Worker(rvmWorkerUrl()) as unknown as RvmWorkerLike;
  } catch (err) {
    throw new RvmEngineError("CDN_LOAD_FAILED", "The Pro background engine could not be loaded.", err);
  }
}

interface WorkerMatteMessage {
  type: "matte";
  seq: number;
  alpha: ArrayBuffer;
  width: number;
  height: number;
  ms: number;
}

interface PendingFrame {
  seq: number;
  frame: HTMLCanvasElement;
  sentAt: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (m: EngineMatte | null) => void;
  reject: (e: unknown) => void;
}

/* ---------------------------------------------------------------- engine */

/**
 * The Pro engine client. Owns NO ONNX session — the worker does.
 * Its own disciplines, all pinned by rvm-engine.test.ts:
 *  - ONE frame in flight: process() while a frame is outstanding
 *    resolves null immediately. Frames are dropped, never queued —
 *    the newest frame is always the one that matters.
 *  - The frame is snapshotted synchronously at send time and rides
 *    back on the matte (frame-aligned compositing).
 *  - A frame that outlives its deadline kills the worker: a wedged
 *    worker is never trusted again.
 */
export class RvmEngine implements MattingEngine {
  readonly kind = "pro" as const;
  /** Which execution provider the worker's session uses. */
  provider: "webgpu" | "wasm" | null = null;
  /** Round-trip duration (ms) of the most recent completed frame —
   *  snapshot → bitmap → worker inference → matte back — or null
   *  when no frame has completed since the caller last read it.
   *  The changer samples this into the perf ladder and clears it
   *  back to null (the light engine's lastMs contract, mirrored). */
  lastMs: number | null = null;
  /** Pure in-worker inference duration of the most recent frame. */
  lastInferenceMs = 0;

  private readonly _createWorker: () => RvmWorkerLike;
  private readonly _frameTimeoutMs: number;
  private _worker: RvmWorkerLike | null = null;
  private _initPromise: Promise<void> | null = null;
  private _initWaiter: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  private _ready = false;
  private _dead = false;
  private _disposed = false;
  private _pending: PendingFrame | null = null;
  private _seq = 0;
  private _step = 0;
  private _frame: HTMLCanvasElement;
  private _frameCtx: CanvasRenderingContext2D;

  constructor(options: RvmEngineOptions = {}) {
    this._createWorker = options.createWorker ?? defaultCreateWorker;
    this._frameTimeoutMs = Math.max(50, options.frameTimeoutMs ?? RVM_FRAME_TIMEOUT_MS);
    /* The send-time frame snapshot (reused across sends — a
       snapshot is consumed by its own matte's composite before
       the next send can overwrite it, because this engine holds
       one frame in flight at a time). */
    this._frame = document.createElement("canvas");
    this._frameCtx = this._frame.getContext("2d")!;
  }

  async init(): Promise<void> {
    if (this._ready) return;
    if (this._initPromise) return this._initPromise;
    const run = this._doInit();
    this._initPromise = run;
    try {
      await run;
    } catch (err) {
      this._initPromise = null;
      throw err;
    }
  }

  private async _doInit(): Promise<void> {
    if (this._disposed || this._dead) {
      throw new RvmEngineError("CDN_LOAD_FAILED", "The Pro background engine could not be loaded.");
    }
    if (typeof createImageBitmap !== "function") {
      throw new RvmEngineError(
        "CDN_LOAD_FAILED",
        "This browser cannot hand frames to the Pro background engine.",
      );
    }
    const worker = this._createWorker(); // throws RvmEngineError when no worker can spawn
    this._worker = worker;
    worker.addEventListener("message", (ev) => this._onMessage(ev.data));
    worker.addEventListener("error", () => this._onWorkerError());
    const cores = (navigator as unknown as { hardwareConcurrency?: number }).hardwareConcurrency;
    const threads = Math.max(1, Math.min(4, cores ?? 1));
    await new Promise<void>((resolve, reject) => {
      this._initWaiter = { resolve, reject };
      try {
        worker.postMessage({ type: "init", ortBases: ortBases(), modelUrls: rvmModelUrls(), threads });
      } catch (err) {
        this._initWaiter = null;
        reject(new RvmEngineError("CDN_LOAD_FAILED", "The Pro background engine could not be loaded.", err));
      }
    });
    this._ready = true;
  }

  /** Apply a PerfLadder step (the worker resets the recurrence). */
  setStep(step: number): void {
    const next = Math.max(0, Math.min(RVM_MAX_STEP, Math.floor(step)));
    if (next === this._step) return;
    this._step = next;
    if (this._worker && this._ready) {
      try {
        this._worker.postMessage({ type: "step", step: next });
      } catch {
        /* a dead worker is reported by the next frame's outcome */
      }
    }
  }

  get step(): number {
    return this._step;
  }

  reset(): void {
    if (this._worker && this._ready) {
      try {
        this._worker.postMessage({ type: "reset" });
      } catch {
        /* a dead worker is reported by the next frame's outcome */
      }
    }
  }

  async process(video: HTMLVideoElement): Promise<EngineMatte | null> {
    if (!this._ready || !this._worker || this._disposed || this._dead) return null;
    /* STRICT BACKPRESSURE: one frame in flight, ever. A frame
       asked for while another is outstanding is skipped (null),
       never queued — a queue of stale frames is latency the
       subject has already moved out of. */
    if (this._pending) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    /* Snapshot the frame being sent, synchronously: the matte that
       comes back describes THIS instant and rides back on
       EngineMatte.frame, so the composite cuts this frame with its
       own matte — never the newer live frame. */
    if (this._frame.width !== vw || this._frame.height !== vh) {
      this._frame.width = vw;
      this._frame.height = vh;
    }
    this._frameCtx.drawImage(video, 0, 0);
    const frame = this._frame;
    const seq = ++this._seq;

    const result = new Promise<EngineMatte | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pending?.seq !== seq) return;
        this._pending = null;
        /* A worker that stops answering is not trusted again:
           kill it, fail the frame, and let the caller's failure
           governance (fallback / park) take over. */
        this._killWorker();
        reject(new RvmEngineError("INFERENCE_FAILED", "The Pro background engine stopped answering."));
      }, this._frameTimeoutMs);
      this._pending = { seq, frame, sentAt: performance.now(), timer, resolve, reject };
    });

    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(video);
    } catch {
      /* A capture hiccup is a skipped frame, not a dead engine. */
      this._settlePending(seq, (p) => p.resolve(null));
      return result;
    }
    const pendingSeq = this._pendingSeq();
    if (pendingSeq === null || pendingSeq !== seq) {
      /* Settled meanwhile (dispose / worker death): the promise
         already has its answer; just release the bitmap. */
      bitmap.close();
      return result;
    }
    try {
      this._worker.postMessage({ type: "frame", seq, step: this._step, bitmap }, [bitmap]);
    } catch (err) {
      try {
        bitmap.close();
      } catch {
        /* already transferred */
      }
      this._settlePending(seq, (p) =>
        p.reject(new RvmEngineError("INFERENCE_FAILED", "The Pro background engine failed on a frame.", err)),
      );
    }
    return result;
  }

  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    this._ready = false;
    if (this._initWaiter) {
      const waiter = this._initWaiter;
      this._initWaiter = null;
      waiter.reject(new RvmEngineError("CDN_LOAD_FAILED", "The Pro background engine was released."));
    }
    if (this._pending) {
      const pending = this._pending;
      this._pending = null;
      clearTimeout(pending.timer);
      pending.resolve(null);
    }
    this._killWorker();
  }

  /* ------------------------------------------------------------ internal */

  private _pendingSeq(): number | null {
    return this._pending?.seq ?? null;
  }

  private _settlePending(seq: number, settle: (p: PendingFrame) => void): void {
    const pending = this._pending;
    if (!pending || pending.seq !== seq) return;
    this._pending = null;
    clearTimeout(pending.timer);
    settle(pending);
  }

  private _killWorker(): void {
    const worker = this._worker;
    this._worker = null;
    this._ready = false;
    this._dead = true;
    if (worker) {
      try {
        worker.postMessage({ type: "dispose" });
      } catch {
        /* already gone */
      }
      try {
        worker.terminate();
      } catch {
        /* already gone */
      }
    }
  }

  private _onWorkerError(): void {
    this._dead = true;
    this._ready = false;
    if (this._initWaiter) {
      const waiter = this._initWaiter;
      this._initWaiter = null;
      waiter.reject(new RvmEngineError("CDN_LOAD_FAILED", "The Pro background engine could not be loaded."));
    }
    if (this._pending) {
      const pending = this._pending;
      this._pending = null;
      clearTimeout(pending.timer);
      pending.reject(new RvmEngineError("INFERENCE_FAILED", "The Pro background engine failed on a frame."));
    }
  }

  private _onMessage(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const msg = data as { type?: unknown };
    if (msg.type === "ready") {
      const provider = (msg as { provider?: unknown }).provider;
      this.provider = provider === "webgpu" || provider === "wasm" ? provider : null;
      if (this._initWaiter) {
        const waiter = this._initWaiter;
        this._initWaiter = null;
        waiter.resolve();
      }
      return;
    }
    if (msg.type === "init-error") {
      if (this._initWaiter) {
        const waiter = this._initWaiter;
        this._initWaiter = null;
        waiter.reject(
          new RvmEngineError("CDN_LOAD_FAILED", "The Pro background engine could not be loaded."),
        );
      }
      return;
    }
    if (msg.type === "matte") {
      const matte = msg as unknown as WorkerMatteMessage;
      const pending = this._pending;
      if (!pending || pending.seq !== matte.seq) return; // a late matte for a frame already given up on
      this._pending = null;
      clearTimeout(pending.timer);
      this.lastMs = performance.now() - pending.sentAt;
      this.lastInferenceMs = matte.ms;
      pending.resolve({
        alpha: new Float32Array(matte.alpha),
        width: matte.width,
        height: matte.height,
        frame: pending.frame,
      });
      return;
    }
    if (msg.type === "frame-error") {
      const seq = (data as { seq?: unknown }).seq;
      if (typeof seq !== "number") return;
      this._settlePending(seq, (p) =>
        p.reject(new RvmEngineError("INFERENCE_FAILED", "The Pro background engine failed on a frame.")),
      );
    }
  }
}
