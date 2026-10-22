/**
 * avatar-face-engine.ts — MediaPipe Face Landmarker behind a small,
 * testable wrapper: the Avatar source's face-tracking engine.
 *
 * The runtime is @mediapipe/tasks-vision 1.1.1, VENDORED
 * (public/engines/face-landmarker) and lazy-loaded only when an
 * avatar source asks for face drive — a creator's broadcast must
 * never depend on a third-party CDN being reachable from their
 * browser. The version was verified against the npm registry before
 * pinning (1.1.1 is the latest stable; 1.2.0 is release candidates
 * only). The first base below is the site's own media bucket serving
 * those vendored files (its CORS policy covers the site's origins;
 * the module import, wasm fileset fetch and model fetch all already
 * run cross-origin against the fallbacks). The CDN copy of the same
 * build is the last-resort fallback for the JS/WASM; the model falls
 * back to its canonical Google storage URL.
 *
 * Output per frame: the blendshape categories (blink / jaw / brow /
 * gaze) and the facial transformation matrix (head pose). All the
 * mapping onto character motion lives in avatar-drive.ts.
 *
 * PRIVACY INVARIANT: this engine only reads the camera element it is
 * handed and produces NUMBERS. It has no canvas of its own that the
 * studio could composite, and the Avatar source never draws the
 * camera — tracking input only.
 */

import { mediaUrl } from "../media-cdn";

export const VISION_LOCAL_BASE = mediaUrl("engines/face-landmarker");
export const VISION_CDN_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1";
export const FACE_MODEL_LOCAL_URL = mediaUrl("engines/face-landmarker/face_landmarker.task");
export const FACE_MODEL_REMOTE_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/** Vendored-first URLs for the tasks-vision ES module bundle. */
export function visionBundleUrls(): string[] {
  return [`${VISION_LOCAL_BASE}/vision_bundle.mjs`, `${VISION_CDN_BASE}/vision_bundle.mjs`];
}

/** Vendored-first WASM fileset bases (bundle and wasm travel together). */
export function visionWasmBases(): string[] {
  return [`${VISION_LOCAL_BASE}/wasm`, `${VISION_CDN_BASE}/wasm`];
}

/** Vendored-first URLs for the face landmarker model file. */
export function faceModelUrls(): string[] {
  return [FACE_MODEL_LOCAL_URL, FACE_MODEL_REMOTE_URL];
}

export type FaceEngineErrorCode = "LOAD_FAILED" | "UNSUPPORTED";

export class FaceEngineError extends Error {
  code: FaceEngineErrorCode;
  cause?: unknown;
  constructor(code: FaceEngineErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "FaceEngineError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/* ------------------------------------------------ structural API types */

export interface FaceResultLike {
  faceBlendshapes?: Array<{
    categories: Array<{ categoryName: string; score: number; displayName?: string }>;
  }>;
  facialTransformationMatrixes?: Array<{ rows: number; columns: number; data: ArrayLike<number> }>;
}

export interface FaceLandmarkerLike {
  detectForVideo(source: unknown, timestamp: number): FaceResultLike;
  close(): void;
}

export interface VisionModuleLike {
  FilesetResolver: {
    forVisionTasks(wasmPath: string): Promise<unknown>;
  };
  FaceLandmarker: {
    createFromOptions(
      fileset: unknown,
      options: Record<string, unknown>,
    ): Promise<FaceLandmarkerLike>;
  };
}

export interface FaceSample {
  categories: Array<{ categoryName: string; score: number }>;
  matrix: ArrayLike<number> | null;
}

type ImportModuleFn = (url: string) => Promise<VisionModuleLike>;

const defaultImportModule: ImportModuleFn = async (url: string) => {
  // The URL is runtime data (vendored path / CDN fallback), never a
  // build-time specifier — Vite must leave it alone.
  const mod: unknown = await import(/* @vite-ignore */ url);
  return mod as VisionModuleLike;
};

let modulePromise: Promise<{ mod: VisionModuleLike; baseIndex: number }> | null = null;

/** Import the tasks-vision bundle once (vendored first, CDN second). */
function loadVisionModule(importModule: ImportModuleFn): Promise<{ mod: VisionModuleLike; baseIndex: number }> {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    const urls = visionBundleUrls();
    let lastErr: unknown = null;
    for (let i = 0; i < urls.length; i++) {
      try {
        const mod = await importModule(urls[i]!);
        if (mod && mod.FilesetResolver && mod.FaceLandmarker) return { mod, baseIndex: i };
        lastErr = new Error("The face-tracking bundle loaded without its expected exports.");
      } catch (err) {
        lastErr = err;
      }
    }
    throw new FaceEngineError("LOAD_FAILED", "The face-tracking engine could not be loaded.", lastErr);
  })();
  // A failed load must not poison later attempts.
  modulePromise.catch(() => {
    modulePromise = null;
  });
  return modulePromise;
}

/* ---------------------------------------------------------------- engine */

/** Detection input cap: landmarks don't need a big frame, and the cap
 *  holds detection to a few ms on modest hardware. */
export const FACE_FEED_MAX_WIDTH = 384;

export class FaceDriveEngine {
  private _landmarker: FaceLandmarkerLike | null = null;
  private _feed: HTMLCanvasElement | null = null;
  private _feedCtx: CanvasRenderingContext2D | null = null;
  private _lastTs = -1;
  private _disposed = false;

  constructor(private readonly _deps: { importModule?: ImportModuleFn } = {}) {}

  /** Which fileset the live landmarker was built from (for status). */
  loadedFrom: "local" | "cdn" | null = null;
  /** The compute delegate the landmarker runs on. */
  delegate: "GPU" | "CPU" | null = null;

  async init(): Promise<void> {
    if (this._landmarker) return;
    if (typeof document === "undefined") {
      throw new FaceEngineError("UNSUPPORTED", "Face tracking needs a browser environment.");
    }
    const importModule = this._deps.importModule ?? defaultImportModule;
    const { mod, baseIndex } = await loadVisionModule(importModule);
    const wasmBases = visionWasmBases();
    const fileset = await mod.FilesetResolver.forVisionTasks(wasmBases[baseIndex] ?? wasmBases[0]!);

    let lastErr: unknown = null;
    for (const delegate of ["GPU", "CPU"] as const) {
      for (const modelAssetPath of faceModelUrls()) {
        try {
          this._landmarker = await mod.FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath, delegate },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
          });
          this.delegate = delegate;
          this.loadedFrom = baseIndex === 0 && modelAssetPath === FACE_MODEL_LOCAL_URL ? "local" : "cdn";
          return;
        } catch (err) {
          lastErr = err;
          this._landmarker = null;
        }
      }
    }
    throw new FaceEngineError("LOAD_FAILED", "The face-tracking engine could not be started.", lastErr);
  }

  /**
   * Sample the face in the video's current frame. Returns null when
   * there is nothing to read (engine down, video not ready, no face
   * in frame) — the caller keeps the previous drive values rather
   * than snapping to neutral. detectForVideo is synchronous; the
   * frame is first drawn to a capped scratch canvas to bound cost.
   */
  detect(video: HTMLVideoElement, timestampMs: number): FaceSample | null {
    const landmarker = this._landmarker;
    if (!landmarker || this._disposed) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return null;
    if (!this._feed) {
      this._feed = document.createElement("canvas");
      this._feedCtx = this._feed.getContext("2d", { willReadFrequently: true });
    }
    const scale = Math.min(1, FACE_FEED_MAX_WIDTH / vw);
    const w = Math.max(2, Math.round(vw * scale));
    const h = Math.max(2, Math.round(vh * scale));
    if (this._feed.width !== w || this._feed.height !== h) {
      this._feed.width = w;
      this._feed.height = h;
    }
    this._feedCtx!.drawImage(video, 0, 0, w, h);
    // detectForVideo demands strictly increasing timestamps.
    const ts = Math.max(timestampMs, this._lastTs + 1);
    this._lastTs = ts;
    let result: FaceResultLike;
    try {
      result = landmarker.detectForVideo(this._feed, ts);
    } catch {
      return null;
    }
    const shapes = result.faceBlendshapes?.[0];
    if (!shapes) return null;
    return {
      categories: shapes.categories,
      matrix: result.facialTransformationMatrixes?.[0]?.data ?? null,
    };
  }

  get ready(): boolean {
    return this._landmarker !== null && !this._disposed;
  }

  async dispose(): Promise<void> {
    this._disposed = true;
    if (this._landmarker) {
      try {
        this._landmarker.close();
      } catch {
        /* already closed */
      }
      this._landmarker = null;
    }
  }
}
