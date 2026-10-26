/**
 * tasks-segmenter-engine.ts — the MediaPipe Tasks background
 * engine: Google's Selfie Segmenter (float16) behind the shared
 * MattingEngine contract, running on the maintained MediaPipe
 * Tasks Vision runtime (the vendored 1.1.1 bundle + WASM fileset
 * in public/engines/face-landmarker, shared with the Face
 * Landmarker engine — see avatar-face-engine.ts) in VIDEO mode
 * with the GPU delegate first.
 *
 * Why it exists (one-engine build, Oct 25, 2026 — see
 * greenscreen-matting-scope-2026-10-25.md): the studio's live
 * path used to degrade SILENTLY from the Pro video-matting
 * engine (RVM) to the 2023 legacy Selfie Segmentation build
 * whenever a phone couldn't hold Pro's round trips — and the
 * per-frame legacy engine is what erased the creator under
 * motion. That degrade is deleted. This engine is the
 * maintained-runtime successor to the legacy one, offered as an
 * EXPLICIT creator choice next to Pro (the studio's engine
 * toggle), never as a silent substitute: its honest ceiling is
 * that per-frame segmentation flicker and motion erosion are
 * reduced versus the 2023 build, not cured — it has no temporal
 * state, and no post-processing here pretends otherwise. The
 * ground-truth motion harness numbers for both engines live in
 * ~/workspace/greenscreen-harness/results/.
 *
 * Discipline mirrors its siblings (rvm-engine.ts, the retired
 * legacy engine): ONE frame in flight — a frame asked for while
 * another is outstanding resolves null, never queues; the frame
 * is snapshotted synchronously at send time (at the step's feed
 * cap) and rides back on EngineMatte.frame; a send whose result
 * never lands inside TASKS_FRAME_TIMEOUT_MS settles as a failed
 * frame instead of wedging the pipeline, and a late result is
 * dropped, never paired with a newer frame.
 *
 * Everything is VENDORED (runtime + WASM in
 * public/engines/face-landmarker, the model in
 * public/engines/tasks-segmenter) and lazy-loaded only when the
 * studio selects this engine — a broadcast never depends on a
 * third-party CDN being reachable; the canonical Google storage
 * URL is the model chain's last resort only.
 */

import { mediaUrl } from "../media-cdn";
import { visionBundleUrls, visionWasmBases } from "./avatar-face-engine";
import type { EngineMatte, MattingEngine } from "./rvm-engine";

export const TASKS_MODEL_FILE = "selfie_segmenter.tflite";
export const TASKS_LOCAL_BASE = mediaUrl("engines/tasks-segmenter");
/* The shipped same-origin copy (public/engines/tasks-segmenter) —
   the fallback immediately after the R2 media bucket and before
   the canonical remote, so a bucket outage never makes the load
   depend on a third party. */
export const TASKS_ORIGIN_BASE = `${import.meta.env.BASE_URL}engines/tasks-segmenter`;
export const TASKS_MODEL_REMOTE_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite";

/** The vendored-first URLs for the segmenter model file. */
export function tasksModelUrls(): string[] {
  return [
    `${TASKS_LOCAL_BASE}/${TASKS_MODEL_FILE}`,
    `${TASKS_ORIGIN_BASE}/${TASKS_MODEL_FILE}`,
    TASKS_MODEL_REMOTE_URL,
  ];
}

/**
 * How long one frame may go unanswered before the send counts as
 * failed (ms). The Tasks runtime answers synchronously or via a
 * prompt callback in every healthy case; this cap exists so a
 * wedged graph can never wedge the studio's pipeline with it —
 * the failure lands in the changer's governance (failure counter,
 * then the park) instead.
 */
export const TASKS_FRAME_TIMEOUT_MS = 5_000;

export class TasksSegmenterError extends Error {
  code: "LOAD_FAILED" | "INFERENCE_FAILED";
  cause?: unknown;
  constructor(code: "LOAD_FAILED" | "INFERENCE_FAILED", message: string, cause?: unknown) {
    super(message);
    this.name = "TasksSegmenterError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/* ------------------------------------------------------------- step table */

/** Internal quality steps, best first, aligned 1:1 by index with
 *  the changer's MATTE_REFINEMENT_STEPS: the ladder step retunes
 *  the feed cap here AND the matte post-processing there,
 *  together. `feedCap` bounds the width of the frame handed to
 *  the segmenter (its mask comes back at the feed size, so the
 *  cap is also the mask read width — the same lever the legacy
 *  engine's refinement steps pulled). */
export const TASKS_STEPS: ReadonlyArray<{ feedCap: number }> = [
  { feedCap: 960 },
  { feedCap: 480 },
  { feedCap: 384 },
];
export const TASKS_MAX_STEP = TASKS_STEPS.length - 1;

/* ------------------------------------------------- structural API types */

/** The slice of MPMask the engine reads. */
export interface TasksMaskLike {
  width: number;
  height: number;
  getAsFloat32Array(): Float32Array;
  close(): void;
}

/** The slice of ImageSegmenterResult the engine reads. */
export interface TasksSegmenterResultLike {
  confidenceMasks?: TasksMaskLike[];
  categoryMask?: TasksMaskLike;
}

/** The slice of ImageSegmenter the engine drives. In the real
 *  runtime, segmentForVideo delivers through the callback; some
 *  builds also return the result — the engine settles on
 *  whichever arrives first and ignores the other. */
export interface ImageSegmenterLike {
  segmentForVideo(
    source: unknown,
    timestamp: number,
    callback?: (result: TasksSegmenterResultLike) => void,
  ): TasksSegmenterResultLike | void;
  close(): void;
}

/** The slice of the tasks-vision module the engine imports. */
export interface VisionSegmenterModuleLike {
  FilesetResolver: {
    forVisionTasks(wasmPath: string): Promise<unknown>;
  };
  ImageSegmenter: {
    createFromOptions(
      fileset: unknown,
      options: Record<string, unknown>,
    ): Promise<ImageSegmenterLike>;
  };
}

type ImportModuleFn = (url: string) => Promise<VisionSegmenterModuleLike>;

const defaultImportModule: ImportModuleFn = async (url: string) => {
  // The URL is runtime data (vendored path / CDN fallback), never
  // a build-time specifier — Vite must leave it alone.
  const mod: unknown = await import(/* @vite-ignore */ url);
  return mod as VisionSegmenterModuleLike;
};

export interface TasksSegmenterEngineOptions {
  /** Import the tasks-vision bundle. Default: the vendored-first
   *  chain (tasks-segmenter-engine.test.ts injects a fake). */
  importModule?: ImportModuleFn;
  /** Per-frame answer deadline (ms). Default TASKS_FRAME_TIMEOUT_MS. */
  frameTimeoutMs?: number;
}

let modulePromise: Promise<{ mod: VisionSegmenterModuleLike; baseIndex: number }> | null = null;

/** Import the tasks-vision bundle once (vendored first, CDN
 *  second) — the same module the Face Landmarker engine loads;
 *  whichever engine warms it first, the other reuses it. */
function loadVisionModule(
  importModule: ImportModuleFn,
): Promise<{ mod: VisionSegmenterModuleLike; baseIndex: number }> {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    const urls = visionBundleUrls();
    let lastErr: unknown = null;
    for (let i = 0; i < urls.length; i++) {
      try {
        const mod = await importModule(urls[i]!);
        if (mod && mod.FilesetResolver && mod.ImageSegmenter) return { mod, baseIndex: i };
        lastErr = new Error("The MediaPipe Tasks bundle loaded without its expected exports.");
      } catch (err) {
        lastErr = err;
      }
    }
    throw new TasksSegmenterError("LOAD_FAILED", "The MediaPipe Tasks engine could not be loaded.", lastErr);
  })();
  // A failed load must not poison later attempts.
  modulePromise.catch(() => {
    modulePromise = null;
  });
  return modulePromise;
}

/* ---------------------------------------------------------------- engine */

/**
 * The MediaPipe Tasks engine client. Owns the ImageSegmenter;
 * its disciplines, all pinned by tasks-segmenter-engine.test.ts:
 *  - ONE frame in flight: process() while a send is outstanding
 *    resolves null immediately. Frames are dropped, never queued.
 *  - The frame is snapshotted synchronously at send time, at the
 *    live step's feed cap, and rides back on EngineMatte.frame.
 *  - A send silent past its deadline settles as a failed frame;
 *    its late result is dropped, never paired with a newer send.
 */
export class TasksSegmenterEngine implements MattingEngine {
  readonly kind = "tasks" as const;
  /** Duration (ms) of the most recent send→results round trip, or
   *  null when no round trip has completed since the caller last
   *  read it. The changer samples this into the perf ladder and
   *  clears it back to null (the shared lastMs contract). */
  lastMs: number | null = null;
  /** The compute delegate the segmenter runs on. */
  delegate: "GPU" | "CPU" | null = null;

  private readonly _importModule: ImportModuleFn;
  private readonly _frameTimeoutMs: number;
  private _segmenter: ImageSegmenterLike | null = null;
  private _ready = false;
  private _disposed = false;
  private _step = 0;
  private _lastTs = -1;
  /* The one outstanding send episode, if any. `settle` is guarded
     by identity: whichever path answers first (callback, sync
     return, timeout, dispose) wins; later answers are dropped. */
  private _episode: {
    resolve: (m: EngineMatte | null) => void;
    reject: (e: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  /* The send-time frame snapshot (the feed canvas itself: drawn
     in process() and never redrawn while its episode is
     outstanding, because process() refuses to run then — the
     same reuse discipline as its sibling engines). */
  private _feed: HTMLCanvasElement;
  private _feedCtx: CanvasRenderingContext2D;

  constructor(options: TasksSegmenterEngineOptions = {}) {
    this._importModule = options.importModule ?? defaultImportModule;
    this._frameTimeoutMs = Math.max(50, options.frameTimeoutMs ?? TASKS_FRAME_TIMEOUT_MS);
    this._feed = document.createElement("canvas");
    this._feedCtx = this._feed.getContext("2d", { willReadFrequently: true })!;
  }

  async init(): Promise<void> {
    if (this._ready) return;
    if (this._disposed) {
      throw new TasksSegmenterError("LOAD_FAILED", "The MediaPipe Tasks engine could not be loaded.");
    }
    const { mod, baseIndex } = await loadVisionModule(this._importModule);
    const wasmBases = visionWasmBases();
    const fileset = await mod.FilesetResolver.forVisionTasks(wasmBases[baseIndex] ?? wasmBases[0]!);

    let lastErr: unknown = null;
    for (const delegate of ["GPU", "CPU"] as const) {
      for (const modelAssetPath of tasksModelUrls()) {
        try {
          this._segmenter = await mod.ImageSegmenter.createFromOptions(fileset, {
            baseOptions: { modelAssetPath, delegate },
            runningMode: "VIDEO",
            outputCategoryMask: false,
            outputConfidenceMasks: true,
          });
          this.delegate = delegate;
          this._ready = true;
          return;
        } catch (err) {
          lastErr = err;
          this._segmenter = null;
        }
      }
    }
    throw new TasksSegmenterError("LOAD_FAILED", "The MediaPipe Tasks engine could not be started.", lastErr);
  }

  /** Apply a PerfLadder step (the feed cap for subsequent sends). */
  setStep(step: number): void {
    this._step = Math.max(0, Math.min(TASKS_MAX_STEP, Math.floor(step)));
  }

  get step(): number {
    return this._step;
  }

  reset(): void {
    /* The Tasks segmenter is a per-frame model: VIDEO mode adds
       timestamp plumbing, not cross-frame state — there is
       nothing temporal to drop. (The timestamps themselves stay
       monotonic across resets; the runtime demands it.) */
  }

  async process(video: HTMLVideoElement): Promise<EngineMatte | null> {
    const segmenter = this._segmenter;
    if (!segmenter || !this._ready || this._disposed) return null;
    /* STRICT BACKPRESSURE: one frame in flight, ever. */
    if (this._episode) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    /* Snapshot the frame being sent, synchronously, at the step's
       feed cap: the matte that comes back describes THIS instant
       and rides back on EngineMatte.frame. */
    const cap = TASKS_STEPS[this._step]!.feedCap;
    const scale = Math.min(1, cap / vw);
    const fw = Math.max(2, Math.round(vw * scale));
    const fh = Math.max(2, Math.round((vh * fw) / vw));
    if (this._feed.width !== fw || this._feed.height !== fh) {
      this._feed.width = fw;
      this._feed.height = fh;
    }
    this._feedCtx.drawImage(video, 0, 0, fw, fh);
    const frame = this._feed;
    const sentAt = performance.now();
    // segmentForVideo demands strictly increasing timestamps.
    const ts = Math.max(Math.floor(sentAt), this._lastTs + 1);
    this._lastTs = ts;

    return new Promise<EngineMatte | null>((resolve, reject) => {
      const episode = {
        resolve,
        reject,
        timer: setTimeout(() => {
          if (this._episode !== episode) return;
          this._episode = null;
          reject(
            new TasksSegmenterError("INFERENCE_FAILED", "The MediaPipe Tasks engine stopped answering."),
          );
        }, this._frameTimeoutMs),
      };
      this._episode = episode;
      const settleWith = (result: TasksSegmenterResultLike | null | undefined): void => {
        if (this._episode !== episode) return; // a late or duplicate answer — dropped, never paired
        this._episode = null;
        clearTimeout(episode.timer);
        this.lastMs = performance.now() - sentAt;
        try {
          const matte = result ? this._extract(result) : null;
          if (matte) matte.frame = frame;
          resolve(matte);
        } catch (err) {
          reject(
            new TasksSegmenterError("INFERENCE_FAILED", "The MediaPipe Tasks engine failed on a frame.", err),
          );
        }
      };
      try {
        const returned = segmenter.segmentForVideo(frame, ts, (result) => settleWith(result));
        // Some builds return the result instead of (or as well as)
        // calling back; the identity guard settles exactly once.
        if (returned && typeof returned === "object") settleWith(returned);
      } catch (err) {
        if (this._episode === episode) {
          this._episode = null;
          clearTimeout(episode.timer);
        }
        reject(
          new TasksSegmenterError("INFERENCE_FAILED", "The MediaPipe Tasks engine failed on a frame.", err),
        );
      }
    });
  }

  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    this._ready = false;
    if (this._episode) {
      const episode = this._episode;
      this._episode = null;
      clearTimeout(episode.timer);
      episode.resolve(null);
    }
    if (this._segmenter) {
      try {
        this._segmenter.close();
      } catch {
        /* already closed */
      }
      this._segmenter = null;
    }
  }

  /* ------------------------------------------------------------ internal */

  /** Read the person confidence mask out of a result as the
   *  matte. The selfie model emits ONE confidence mask — the
   *  foreground (person) confidence per pixel, at the feed size.
   *  The mask is copied before it is closed: its float array is
   *  the runtime's own buffer. */
  private _extract(result: TasksSegmenterResultLike): EngineMatte | null {
    const mask = result.confidenceMasks?.[0];
    if (!mask || !mask.width || !mask.height) return null;
    try {
      const alpha = new Float32Array(mask.getAsFloat32Array());
      return { alpha, width: mask.width, height: mask.height };
    } finally {
      try {
        mask.close();
      } catch {
        /* already closed */
      }
    }
  }
}
