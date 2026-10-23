/**
 * rvm-engine.ts — the Pro background engine: Robust Video Matting
 * (RVM, MobileNetV3) running in the browser via ONNX Runtime Web.
 *
 * Why it exists: the Standard engine (MediaPipe Selfie Segmentation)
 * emits a hard, low-resolution mask — rough hair edges and visible
 * flicker. RVM is a true video-matting model: it outputs a soft
 * alpha matte with hair-level detail, and its recurrent state is
 * carried across frames, which is where its temporal stability
 * comes from (no per-frame mask flicker).
 *
 * Everything is VENDORED (public/engines/onnxruntime +
 * public/engines/rvm) and lazy-loaded only when a camera starts —
 * the same local-first discipline as the other engines. The first
 * base below is the site's own media bucket serving those vendored
 * files (its CORS policy covers the site's origins; every load here
 * — classic script tag, ORT wasm fetch — already runs cross-origin
 * against the CDN fallbacks). The public CDN/GitHub copies remain
 * only as last-resort fallbacks.
 *
 * Runtime selection: WebGPU when the browser exposes a working
 * adapter, otherwise the WASM build (SIMD; threads when the page is
 * cross-origin isolated). Performance governance (step-down /
 * degrade decisions) lives in perf-ladder.ts; this module only
 * executes the step table.
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

/** The vendored-first asset URLs for the ORT runtime script. */
export function ortScriptUrls(): string[] {
  return [
    `${ORT_LOCAL_BASE}/ort.all.min.js`,
    `${ORT_ORIGIN_BASE}/ort.all.min.js`,
    `${ORT_CDN_BASE}/ort.all.min.js`,
  ];
}

/** The vendored-first URLs for the RVM model file. */
export function rvmModelUrls(): string[] {
  return [
    `${RVM_LOCAL_BASE}/${RVM_MODEL_FILE}`,
    `${RVM_ORIGIN_BASE}/${RVM_MODEL_FILE}`,
    `${RVM_CDN_BASE}/${RVM_MODEL_FILE}`,
  ];
}

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

/* -------------------------------------------------- ORT global (structural) */

export interface OrtTensorLike {
  data: Float32Array | Uint16Array | BigInt64Array;
  dims: readonly number[];
}
export interface OrtSessionLike {
  run(feeds: Record<string, OrtTensorLike>): Promise<Record<string, OrtTensorLike>>;
  release(): Promise<void>;
}
export interface OrtApiLike {
  InferenceSession: {
    create(
      source: string,
      options: { executionProviders: string[] },
    ): Promise<OrtSessionLike>;
  };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => OrtTensorLike;
  env: {
    logLevel?: string;
    wasm: { wasmPaths?: string; numThreads?: number; simd?: boolean };
  };
}

function getOrt(): OrtApiLike | null {
  return (window as unknown as { ort?: OrtApiLike }).ort ?? null;
}

let ortScriptPromise: Promise<string> | null = null; // resolves to the base that served the script
let ortEnvConfigured = false;

/** Inject the ORT runtime script once (vendored first, CDN second);
 *  resolves to the base URL the script actually loaded from. */
function loadOrtScript(): Promise<string> {
  if (getOrt()) return Promise.resolve(ortScriptPromise ?? ORT_LOCAL_BASE);
  if (ortScriptPromise) return ortScriptPromise;
  ortScriptPromise = (async () => {
    const bases = [ORT_LOCAL_BASE, ORT_ORIGIN_BASE, ORT_CDN_BASE];
    let lastErr: unknown = null;
    for (const base of bases) {
      try {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = `${base}/ort.all.min.js`;
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => {
            script.remove();
            reject(new Error(`ONNX runtime failed to load from ${base}`));
          };
          document.head.appendChild(script);
        });
        if (getOrt()) return base;
        lastErr = new Error("ONNX runtime script loaded but the global is missing");
      } catch (err) {
        lastErr = err;
      }
    }
    throw new RvmEngineError("CDN_LOAD_FAILED", "The Pro background engine could not be loaded.", lastErr);
  })();
  ortScriptPromise.catch(() => {
    ortScriptPromise = null;
  });
  return ortScriptPromise;
}

async function webgpuAdapterAvailable(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu;
  if (!gpu?.requestAdapter) return false;
  try {
    const adapter = await Promise.race([
      gpu.requestAdapter(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
    return !!adapter;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- step table */

/** Internal quality steps, best first. The PerfLadder walks these
 *  before the caller degrades engines. `feedCap` bounds the width
 *  fed to the model; `ratio` is RVM's downsample_ratio (the model's
 *  low-res branch works at feed * ratio — ~480px wide at step 0). */
export const RVM_STEPS: ReadonlyArray<{ feedCap: number; ratio: number | "auto" }> = [
  { feedCap: 896, ratio: "auto" },
  { feedCap: 896, ratio: 0.32 },
  { feedCap: 640, ratio: 0.5 },
  { feedCap: 640, ratio: 0.34 },
];
export const RVM_MAX_STEP = RVM_STEPS.length - 1;

function ratioFor(step: (typeof RVM_STEPS)[number], feedLongSide: number): number {
  if (step.ratio !== "auto") return step.ratio;
  const r = 480 / Math.max(1, feedLongSide);
  return Math.min(0.6, Math.max(0.3, r));
}

/* ---------------------------------------------------------------- engine */

export class RvmEngine implements MattingEngine {
  readonly kind = "pro" as const;
  /** Which execution provider the live session uses. */
  provider: "webgpu" | "wasm" | null = null;
  /** Inference duration of the most recent frame (ms). */
  lastMs = 0;

  private _ort: OrtApiLike | null = null;
  private _session: OrtSessionLike | null = null;
  private _states: OrtTensorLike[] | null = null;
  private _step = 0;
  private _feed: HTMLCanvasElement;
  private _feedCtx: CanvasRenderingContext2D;
  private _feedW = 0;
  private _feedH = 0;
  private _srcBuf: Float32Array | null = null;
  private _ratioTensor: { value: number; tensor: OrtTensorLike } | null = null;
  private _disposed = false;

  constructor() {
    this._feed = document.createElement("canvas");
    this._feedCtx = this._feed.getContext("2d", { willReadFrequently: true })!;
  }

  async init(): Promise<void> {
    const base = await loadOrtScript();
    const ort = getOrt();
    if (!ort) throw new RvmEngineError("CDN_LOAD_FAILED", "The Pro background engine failed to initialise.");
    this._ort = ort;
    if (!ortEnvConfigured) {
      ortEnvConfigured = true;
      ort.env.logLevel = "warning";
      ort.env.wasm.wasmPaths = `${base}/`;
      const cores = (navigator as unknown as { hardwareConcurrency?: number }).hardwareConcurrency;
      ort.env.wasm.numThreads = Math.max(1, Math.min(4, cores ?? 1));
    }

    const providers: Array<"webgpu" | "wasm"> = [];
    if (await webgpuAdapterAvailable()) providers.push("webgpu");
    providers.push("wasm");

    let lastErr: unknown = null;
    for (const provider of providers) {
      for (const url of rvmModelUrls()) {
        try {
          this._session = await ort.InferenceSession.create(url, { executionProviders: [provider] });
          this.provider = provider;
          this._states = null;
          return;
        } catch (err) {
          lastErr = err;
          this._session = null;
        }
      }
    }
    throw new RvmEngineError("CDN_LOAD_FAILED", "The Pro background engine could not be loaded.", lastErr);
  }

  /** Apply a PerfLadder step (geometry change resets the recurrence). */
  setStep(step: number): void {
    const next = Math.max(0, Math.min(RVM_MAX_STEP, Math.floor(step)));
    if (next === this._step) return;
    this._step = next;
    this._states = null;
    this._feedW = 0; // force a geometry rebuild on the next frame
    this._feedH = 0;
  }

  get step(): number {
    return this._step;
  }

  reset(): void {
    this._states = null;
  }

  async process(video: HTMLVideoElement): Promise<EngineMatte | null> {
    const ort = this._ort;
    const session = this._session;
    if (!ort || !session || this._disposed) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    const stepDef = RVM_STEPS[this._step];
    const scale = Math.min(1, stepDef.feedCap / vw);
    const fw = Math.max(2, Math.round(vw * scale));
    const fh = Math.max(2, Math.round((vh * fw) / vw));
    if (fw !== this._feedW || fh !== this._feedH) {
      this._feed.width = fw;
      this._feed.height = fh;
      this._feedW = fw;
      this._feedH = fh;
      this._srcBuf = new Float32Array(3 * fw * fh);
      this._states = null; // geometry changed — recurrence restarts
    }

    const fctx = this._feedCtx;
    fctx.drawImage(video, 0, 0, fw, fh);
    const pixels = fctx.getImageData(0, 0, fw, fh).data;
    const buf = this._srcBuf!;
    const plane = fw * fh;
    for (let i = 0, j = 0; i < plane; i++, j += 4) {
      buf[i] = pixels[j] / 255;
      buf[plane + i] = pixels[j + 1] / 255;
      buf[2 * plane + i] = pixels[j + 2] / 255;
    }

    if (!this._states) {
      this._states = [0, 1, 2, 3].map(() => new ort.Tensor("float32", new Float32Array(1), [1, 1, 1, 1]));
    }
    const ratio = ratioFor(stepDef, Math.max(fw, fh));
    if (!this._ratioTensor || this._ratioTensor.value !== ratio) {
      this._ratioTensor = { value: ratio, tensor: new ort.Tensor("float32", new Float32Array([ratio]), [1]) };
    }

    const feeds: Record<string, OrtTensorLike> = {
      src: new ort.Tensor("float32", buf, [1, 3, fh, fw]),
      r1i: this._states[0],
      r2i: this._states[1],
      r3i: this._states[2],
      r4i: this._states[3],
      downsample_ratio: this._ratioTensor.tensor,
    };

    const t0 = performance.now();
    let outputs: Record<string, OrtTensorLike>;
    try {
      outputs = await session.run(feeds);
    } catch (err) {
      throw new RvmEngineError("INFERENCE_FAILED", "The Pro background engine failed on a frame.", err);
    }
    this.lastMs = performance.now() - t0;

    const next = [outputs.r1o, outputs.r2o, outputs.r3o, outputs.r4o];
    if (next.every(Boolean)) this._states = next;
    const pha = outputs.pha;
    if (!pha || !(pha.data instanceof Float32Array)) return null;
    return { alpha: pha.data, width: fw, height: fh };
  }

  async dispose(): Promise<void> {
    this._disposed = true;
    this._states = null;
    if (this._session) {
      try {
        await this._session.release();
      } catch {
        /* already released */
      }
      this._session = null;
    }
  }
}
