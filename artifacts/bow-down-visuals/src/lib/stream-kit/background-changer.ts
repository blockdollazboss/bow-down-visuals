/**
 * background-changer.ts — camera background replacement for the Go Live
 * stream kit.
 *
 * Ported from the standalone Live Camera kit (~/workspace/discord-live-camera)
 * into the app as a typed source module. Takes a webcam feed, runs a
 * background-matting engine entirely in the browser, composites the person
 * over a chosen background (green screen, blur, custom backdrop image, or
 * the untouched original), and hands back a standard MediaStream via
 * canvas.captureStream() — ready for a <video> element, a recorder, or a
 * publish transport (see ./transport.ts).
 *
 * ONE engine does the matting: MediaPipe Selfie Segmentation,
 * vendored same-origin (below). It used to sit behind a two-engine
 * contract as the fallback for a heavy ONNX video-matting engine
 * (Robust Video Matting); that engine failed to load on the owner's
 * machine and froze the tab when an effect was picked, so it was
 * REMOVED from the studio path (owner's ruling, Oct 18, 2026) — it
 * is never fetched, constructed, or selected here. Cleaner edges
 * are chased the light way instead: the `quality` config picks a
 * matte-refinement step (MATTE_REFINEMENT_STEPS) — how finely the
 * mask is read and how much edge post-processing (matte-post.ts:
 * temporal blend, fringe choke, levels curve, feather) is applied.
 * 'auto' (default) lets the perf ladder (perf-ladder.ts) walk the
 * steps by measured engine speed; 'pro' pins the sharpest step;
 * 'standard' pins the balanced step (the behaviour that shipped
 * before refinement steps existed). If the engine can't run, the
 * camera still starts raw — an engine failure never holds the
 * camera hostage.
 *
 * FREEZE FIX (Oct 21, 2026) — the four-part guard against the tab
 * seizing when backdrop effects engage:
 *  1. RAW-FIRST START: start() acquires the camera and starts the
 *     render loop on the raw picture BEFORE any engine work
 *     begins; the engine loads afterwards and its effect fades in
 *     (ENGINE_FADE_IN_MS) only once it is actually live.
 *  2. DEFAULT MODE "none": a fresh session starts on the Original
 *     (raw) picture — backdrop effects are opt-in, never the
 *     default path. A mode the caller passes explicitly always
 *     wins; only the fallback changed.
 *  3. ENGINE-INIT TIMEOUT: engine initialisation is capped at
 *     ENGINE_INIT_TIMEOUT_MS; a stalled load lands raw with the
 *     honest engine-down note instead of hanging start() forever.
 *  4. INFERENCE FAILURE CAP: an engine whose inferences fail
 *     MAX_CONSECUTIVE_INFERENCE_FAILURES times in a row parks
 *     itself for the rest of the session (see _parkEngine) rather
 *     than retrying on the main thread forever.
 *
 * Audio: pass `audio: true` to carry the mic, and `noiseCancellation:
 * 'on' | 'max'` to run it through the VoiceIsolator (voice-isolator.ts)
 * first — the output stream then holds the processed picture and the
 * cleaned voice together.
 */

import { VoiceIsolator, VOICE_EFFECTS, type NoiseCancellationLevel, type VoiceIsolatorStatus } from "./voice-isolator";
/* Type-only: the shared matting contract. The heavy engine class
   behind it (rvm-engine.ts) is deliberately NOT imported — the
   studio never constructs it (see the header note). The contract
   types are erased at compile time; the still-photo matting path
   (photo-matting.ts) is the class's remaining consumer. */
import type { EngineMatte, MattingEngine } from "./rvm-engine";
import { MattePostProcessor, despillRgba } from "./matte-post";
import { PerfLadder } from "./perf-ladder";
import { FrameStallTracker } from "./frame-stall";
import { mediaUrl } from "../media-cdn";

/* The segmentation engine is VENDORED (public/engines/
   selfie-segmentation — @mediapipe/selfie_segmentation 0.1.1675465747)
   and lazy-loaded only when the studio starts a camera: a creator's
   broadcast must never depend on a third-party CDN being reachable from
   their browser. (The previous pin named a version that does not exist
   in the npm registry, so its CDN URL failed everywhere.) The first
   base below is the site's own media bucket serving those vendored
   files (its CORS policy covers the site's origins; the classic
   script tag + locateFile fetches already run cross-origin against
   the fallback). The CDN copy of the same build remains only as a
   last-resort fallback. */
export const SEGMENTATION_LOCAL_BASE = mediaUrl("engines/selfie-segmentation");
/* The shipped same-origin copy (public/engines/selfie-segmentation) —
   the fallback immediately after the R2 media bucket and before the
   CDN, so a bucket outage never makes the load depend on a third party. */
export const SEGMENTATION_ORIGIN_BASE = `${import.meta.env.BASE_URL}engines/selfie-segmentation`;
export const SEGMENTATION_CDN_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747";
const SEGMENTATION_BASES = [SEGMENTATION_LOCAL_BASE, SEGMENTATION_ORIGIN_BASE, SEGMENTATION_CDN_BASE] as const;
const GREEN = "#00FF00";

/**
 * The camera-effects library. The UI renders its preset row from this
 * array; growing the library = adding an entry here plus its grade /
 * overlay in CAMERA_EFFECT_FILTERS / _compositeMatte(). Grades are cheap
 * canvas filter strings applied to the composited frame; Vignette and
 * Gold Frame are pre-rendered overlays (built once per frame size).
 */
export const CAMERA_EFFECTS = [
  { id: "none", label: "None" },
  { id: "warm", label: "Warm Gold" },
  { id: "noir", label: "Noir" },
  { id: "vivid", label: "Vivid" },
  { id: "cool", label: "Cool" },
  { id: "vintage", label: "Vintage" },
  { id: "vignette", label: "Vignette" },
  { id: "gold-frame", label: "Gold Frame" },
] as const;

export type CameraEffectId = (typeof CAMERA_EFFECTS)[number]["id"];

/** Full-frame ctx.filter grades per camera-effect id (overlays have none). */
const CAMERA_EFFECT_FILTERS: Record<string, string> = {
  warm: "saturate(1.15) contrast(1.05) sepia(0.25) hue-rotate(-8deg)",
  noir: "grayscale(1) contrast(1.2) brightness(1.02)",
  vivid: "saturate(1.6) contrast(1.1)",
  cool: "saturate(0.85) contrast(1.04) brightness(1.06) hue-rotate(-12deg)",
  vintage: "sepia(0.55) saturate(0.8) contrast(0.95) brightness(1.05)",
  vignette: "contrast(1.03)",
};

export type BackgroundMode = "green" | "blur" | "image" | "none";

/**
 * Background quality — a matte-refinement choice on the ONE studio
 * engine (see MATTE_REFINEMENT_STEPS). 'auto' (default) lets the
 * perf ladder walk the refinement steps by measured engine speed,
 * shedding edge work on slow devices and restoring it on fast ones.
 * 'pro' pins the sharpest step. 'standard' pins the balanced step.
 */
export type BackgroundQuality = "auto" | "pro" | "standard";

/** Whether the background engine is live ('off' = raw camera). */
export type BackgroundEngineKind = "standard" | "off";

/**
 * Matte-refinement steps, sharpest first — the light way to cleaner
 * edges on the segmentation engine's mask. Each step sets how wide
 * the mask is read (a finer read keeps more edge detail) and how
 * the shared matte post-processing (matte-post.ts) is tuned: the
 * sharpest step reads finer, blends a little more history (less
 * flicker), chokes the fringe a little less hard, opens the levels
 * curve a touch (less hair eaten), and feathers twice for a soft
 * rim. The balanced step is byte-for-byte the behaviour that
 * shipped before refinement steps existed (480px read, the
 * MattePostProcessor defaults); the lightest step sheds read width
 * for the weakest devices. The perf ladder walks these steps in
 * 'auto' quality only — there is no second engine to degrade to,
 * so the lightest step is the floor.
 */
export interface MatteRefinementStep {
  /** Width cap when reading the engine's mask (px). */
  maskCap: number;
  /** Temporal-blend weight of the new frame (matte-post emaWeight). */
  emaWeight: number;
  /** Semi-transparent fringe choke (matte-post choke). */
  choke: number;
  /** Levels-curve low point (matte-post curveLo). */
  curveLo: number;
  /** Levels-curve high point (matte-post curveHi). */
  curveHi: number;
  /** Feather blur passes after the curve (matte-post featherPasses). */
  featherPasses: number;
}

export const MATTE_REFINEMENT_STEPS: readonly MatteRefinementStep[] = [
  { maskCap: 640, emaWeight: 0.45, choke: 0.04, curveLo: 0.05, curveHi: 0.92, featherPasses: 2 },
  { maskCap: 480, emaWeight: 0.55, choke: 0.05, curveLo: 0.06, curveHi: 0.94, featherPasses: 1 },
  { maskCap: 384, emaWeight: 0.6, choke: 0.05, curveLo: 0.06, curveHi: 0.94, featherPasses: 1 },
];
export const MATTE_MAX_STEP = MATTE_REFINEMENT_STEPS.length - 1;

/**
 * Hard cap on engine initialisation (ms). A stalled load — a hung
 * script fetch, a compile that never returns — must not wedge
 * start(): past this the engine reads as unavailable, the studio
 * shows its honest engine-down note, and the camera runs raw.
 */
export const ENGINE_INIT_TIMEOUT_MS = 10_000;

/**
 * Consecutive failed inferences after which the live engine parks
 * itself for the rest of the session. One failure is a hiccup; an
 * unbroken run of them is an engine that will not recover on its
 * own, and retrying it frame after frame is main-thread work the
 * tab pays for nothing.
 */
export const MAX_CONSECUTIVE_INFERENCE_FAILURES = 30;

/** How long a freshly-live engine's effect takes to fade in over
 *  the raw picture (ms) when it arrives while the session is
 *  already running. */
export const ENGINE_FADE_IN_MS = 350;

export type BackgroundChangerErrorCode = "PERMISSION_DENIED" | "NO_CAMERA" | "CDN_LOAD_FAILED" | "UNSUPPORTED" | "SEGMENTATION_FAILED";

/** Error with a stable machine-readable `code` for UI handling. */
export class BackgroundChangerError extends Error {
  code: BackgroundChangerErrorCode;
  cause?: unknown;
  constructor(code: BackgroundChangerErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "BackgroundChangerError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/* The Window.SelfieSegmentation global is declared once, by the video
   editor's BackgroundReplaceSection — this module consumes that same
   declaration rather than redeclaring it. */
type MediaPipeSegmenter = InstanceType<NonNullable<Window["SelfieSegmentation"]>>;
type MediaPipeResults = { image: HTMLVideoElement; segmentationMask: HTMLCanvasElement };

let segmenterScriptPromise: Promise<void> | null = null;
/** The base the engine script actually loaded from — locateFile follows it. */
let segmenterBase: string | null = null;

function loadScriptFrom(base: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${base}/selfie_segmentation.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error(`Segmentation script failed to load from ${base}`));
    };
    document.head.appendChild(script);
  });
}

/**
 * Lazily inject the MediaPipe Selfie Segmentation script (once): the
 * vendored same-origin copy first, the CDN build only if that fails.
 */
function loadSegmenterScript(): Promise<void> {
  if (window.SelfieSegmentation) return Promise.resolve();
  if (segmenterScriptPromise) return segmenterScriptPromise;
  segmenterScriptPromise = (async () => {
    let lastErr: unknown = null;
    for (const base of SEGMENTATION_BASES) {
      try {
        await loadScriptFrom(base);
        segmenterBase = base;
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw new BackgroundChangerError(
      "CDN_LOAD_FAILED",
      "Could not load the background-effects engine. Check your connection and try again.",
      lastErr,
    );
  })();
  // A failed load must not poison later attempts (e.g. after reconnecting).
  segmenterScriptPromise.catch(() => {
    segmenterScriptPromise = null;
  });
  return segmenterScriptPromise;
}

export interface BackgroundChangerConfig {
  mode?: BackgroundMode;
  /** Background engine quality (see BackgroundQuality). Default 'auto'. */
  quality?: BackgroundQuality;
  /** Hard cap on engine initialisation (ms). Default ENGINE_INIT_TIMEOUT_MS. */
  engineInitTimeoutMs?: number;
  /** Fired whenever the live background engine changes
   *  ('standard' | 'off') — the studio shows it as the honest
   *  "Background engine: On / Off" status. */
  onEngineStatus?: (kind: BackgroundEngineKind) => void;
  image?: string | File | Blob | HTMLImageElement | null;
  blurAmount?: number;
  mirror?: boolean;
  audio?: boolean;
  noiseCancellation?: false | NoiseCancellationLevel;
  onNoiseStatus?: (status: VoiceIsolatorStatus & { error?: unknown }) => void;
  voiceEffect?: string;
  cameraEffect?: string;
  width?: number;
  height?: number;
  fps?: number;
  deviceId?: string | null;
  modelSelection?: 0 | 1;
}

/**
 * The studio's one background engine: MediaPipe Selfie Segmentation
 * behind the MattingEngine contract. MediaPipe is push-based
 * (send → onResults), so process() pairs one send with its results
 * callback; a frame requested while another is in flight is skipped
 * (null), never queued, and a results callback that never arrives
 * times out into a skipped frame rather than wedging the pipeline.
 * The mask arrives as a canvas whose ALPHA channel carries the
 * person mask (the same channel the composite has always keyed on);
 * the matte is read at a capped width set by the live refinement
 * step (MATTE_REFINEMENT_STEPS — a finer read is the light engine's
 * answer to rough edges). Flicker is calmed by the shared matte
 * post-processing (temporal blend), not here.
 */
class MediaPipeEngine implements MattingEngine {
  readonly kind = "standard" as const;
  segmenter: MediaPipeSegmenter | null = null;
  /** Duration (ms) of the most recent send→results round trip, or
   *  null when no round trip has completed since the caller last
   *  read it. The changer samples this into the perf ladder (auto
   *  quality) and clears it back to null. */
  lastMs: number | null = null;
  private _maskCap = MATTE_REFINEMENT_STEPS[1].maskCap;
  private _sentAt = 0;
  private _pending: { resolve: (m: EngineMatte | null) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private _work: HTMLCanvasElement;
  private _workCtx: CanvasRenderingContext2D;

  constructor(private readonly _modelSelection: 0 | 1) {
    this._work = document.createElement("canvas");
    this._workCtx = this._work.getContext("2d", { willReadFrequently: true })!;
  }

  async init(): Promise<void> {
    await loadSegmenterScript();
    if (!window.SelfieSegmentation) {
      throw new BackgroundChangerError("CDN_LOAD_FAILED", "The background-effects engine failed to initialise.");
    }
    let segmenter: MediaPipeSegmenter;
    try {
      // Assets resolve against the base the script loaded from (the
      // vendored copy normally; the CDN only when it served the script).
      const base = segmenterBase ?? SEGMENTATION_LOCAL_BASE;
      segmenter = new window.SelfieSegmentation({
        locateFile: (file: string) => `${base}/${file}`,
      });
      segmenter.setOptions({ modelSelection: this._modelSelection });
    } catch (err) {
      throw new BackgroundChangerError("CDN_LOAD_FAILED", "The background-effects engine failed to initialise.", err);
    }
    segmenter.onResults((results) => {
      const pending = this._pending;
      if (!pending) return; // a late result for a frame already given up on
      this._pending = null;
      clearTimeout(pending.timer);
      this.lastMs = performance.now() - this._sentAt;
      pending.resolve(this._extract((results as MediaPipeResults).segmentationMask));
    });
    this.segmenter = segmenter;
  }

  /** Set the width cap used when reading the mask (refinement step). */
  setMaskCap(px: number): void {
    this._maskCap = Math.max(64, Math.floor(px) || 64);
  }

  process(video: HTMLVideoElement): Promise<EngineMatte | null> {
    const segmenter = this.segmenter;
    if (!segmenter) return Promise.resolve(null);
    if (this._pending) return Promise.resolve(null); // one send in flight — skip, never queue
    return new Promise<EngineMatte | null>((resolve) => {
      const timer = setTimeout(() => {
        if (this._pending?.resolve === resolve) this._pending = null;
        this.lastMs = performance.now() - this._sentAt; // a timed-out trip is a slow trip
        resolve(null);
      }, 1000);
      this._pending = { resolve, timer };
      this._sentAt = performance.now();
      segmenter.send({ image: video }).catch(() => {
        if (this._pending?.resolve === resolve) {
          this._pending = null;
          clearTimeout(timer);
        }
        this.lastMs = performance.now() - this._sentAt;
        resolve(null);
      });
    });
  }

  private _extract(mask: HTMLCanvasElement): EngineMatte | null {
    const srcW = mask?.width ?? 0;
    const srcH = mask?.height ?? 0;
    if (!srcW || !srcH) return null;
    const w = Math.min(srcW, this._maskCap);
    const h = Math.max(1, Math.round((srcH * w) / srcW));
    if (this._work.width !== w || this._work.height !== h) {
      this._work.width = w;
      this._work.height = h;
    }
    const ctx = this._workCtx;
    ctx.drawImage(mask, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const alpha = new Float32Array(w * h);
    for (let i = 0, j = 3; i < alpha.length; i++, j += 4) alpha[i] = data[j] / 255;
    return { alpha, width: w, height: h };
  }

  reset(): void {
    /* MediaPipe carries no cross-frame state to drop. */
  }

  async dispose(): Promise<void> {
    if (this._pending) {
      clearTimeout(this._pending.timer);
      this._pending.resolve(null);
      this._pending = null;
    }
    if (this.segmenter) {
      try {
        await this.segmenter.close();
      } catch {
        /* already closed */
      }
      this.segmenter = null;
    }
  }
}

export class BackgroundChanger {
  config: Required<Omit<BackgroundChangerConfig, "image" | "onNoiseStatus" | "onEngineStatus" | "deviceId">> & {
    image: BackgroundChangerConfig["image"];
    onNoiseStatus: BackgroundChangerConfig["onNoiseStatus"];
    onEngineStatus: BackgroundChangerConfig["onEngineStatus"];
    deviceId: string | null;
  };
  mode: BackgroundMode;
  mirror: boolean;
  blurAmount: number;
  deviceId: string | null;
  isolator: VoiceIsolator | null = null;
  noiseStatus: (VoiceIsolatorStatus & { error?: unknown }) | null = null;
  stream: MediaStream | null = null;
  outputStream: MediaStream | null = null;
  segmenter: MediaPipeSegmenter | null = null;
  private _engineError: BackgroundChangerError | null = null;
  /* The live background engine behind the shared MattingEngine
     contract (the one MediaPipe engine); null = raw camera ("Off"). */
  private _engine: MattingEngine | null = null;
  private _engineKind: BackgroundEngineKind = "off";
  /* Consecutive inference failures against the live engine; reset
     by every landed matte and every engine swap. Past
     MAX_CONSECUTIVE_INFERENCE_FAILURES the engine parks. */
  private _consecutiveInferenceFailures = 0;
  /* True once the engine has parked itself this session (see
     _parkEngine). A parked engine is never revived implicitly —
     only a fresh start() (a new session) clears the park. */
  private _engineParked = false;
  /* The error a parked engine reports; re-asserted by _selectEngine
     so the honest unavailable note survives a trip through raw
     mode and back. */
  private _parkError: BackgroundChangerError | null = null;
  /* When the live engine arrived mid-session (the fade-in clock),
     or null when no fade is in progress. */
  private _engineFadeStart: number | null = null;
  /* Bumped on every engine swap/stop so in-flight frames from a
     retired engine can never composite (or un-block the loop). */
  private _engineEpoch = 0;
  private _busy = false;
  private readonly _frameStall = new FrameStallTracker(0);
  /* Governs the matte-refinement steps in 'auto' quality: sustained
     slowness sheds edge work, sustained speed restores it. */
  private readonly _perf = new PerfLadder({ maxStep: MATTE_MAX_STEP });
  private readonly _mattePost = new MattePostProcessor();
  private _matteCanvas: HTMLCanvasElement;
  private _matteCtx: CanvasRenderingContext2D;
  private _matteImage: ImageData | null = null;
  canvas: HTMLCanvasElement;
  private _ncLevel: NoiseCancellationLevel | null;
  private _fxName: string;
  private _camFx: string;
  private _ovVignette: HTMLCanvasElement | null = null;
  private _ovFrame: HTMLCanvasElement | null = null;
  private _running = false;
  private _rafId: number | null = null;
  private _backdrop: HTMLImageElement | null = null;
  private _backdropUrl: string | null = null;
  private _video: HTMLVideoElement;
  private _person: HTMLCanvasElement;
  private _ctx: CanvasRenderingContext2D;
  private _personCtx: CanvasRenderingContext2D;

  constructor(config: BackgroundChangerConfig = {}) {
    this.config = {
      /* Default mode is "none" (Original/raw): backdrop effects are
         opt-in per session, so the engine path is never the
         default path (freeze fix, part 2). An explicit mode from
         the caller always wins. */
      mode: config.mode ?? "none",
      quality: config.quality ?? "auto",
      engineInitTimeoutMs: config.engineInitTimeoutMs ?? ENGINE_INIT_TIMEOUT_MS,
      onEngineStatus: config.onEngineStatus,
      image: config.image ?? null,
      blurAmount: config.blurAmount ?? 18,
      mirror: config.mirror ?? false,
      audio: config.audio ?? false,
      noiseCancellation: config.noiseCancellation ?? false,
      onNoiseStatus: config.onNoiseStatus,
      voiceEffect: config.voiceEffect ?? "none",
      cameraEffect: config.cameraEffect ?? "none",
      width: config.width ?? 1280,
      height: config.height ?? 720,
      fps: config.fps ?? 30,
      deviceId: config.deviceId ?? null,
      modelSelection: config.modelSelection ?? 1,
    };

    this.mode = this.config.mode;
    this.mirror = !!this.config.mirror;
    this.blurAmount = this.config.blurAmount;
    this.deviceId = this.config.deviceId;
    // Noise cancellation: null = feature off entirely; otherwise the
    // VoiceIsolator level ('off' passes the raw mic through the isolator).
    this._ncLevel = (["off", "on", "max"] as const).includes(this.config.noiseCancellation as NoiseCancellationLevel)
      ? (this.config.noiseCancellation as NoiseCancellationLevel)
      : null;
    // Voice effect preset (delegated to the isolator's effect stage).
    this._fxName = VOICE_EFFECTS.some((e) => e.id === this.config.voiceEffect) ? this.config.voiceEffect : "none";
    // Camera effect preset + its pre-rendered overlays (rebuilt per size).
    this._camFx = CAMERA_EFFECTS.some((e) => e.id === this.config.cameraEffect) ? this.config.cameraEffect : "none";

    // Hidden source video + compositing canvases.
    this._video = document.createElement("video");
    this._video.muted = true;
    this._video.playsInline = true;

    this.canvas = document.createElement("canvas"); // the output canvas (captureStream source)
    this._person = document.createElement("canvas"); // person cutout
    this._ctx = this.canvas.getContext("2d")!;
    this._personCtx = this._person.getContext("2d")!;
    this._matteCanvas = document.createElement("canvas"); // rasterised alpha matte
    this._matteCtx = this._matteCanvas.getContext("2d", { willReadFrequently: true })!;
  }

  /* ------------------------------------------------------------ public API */

  /** Enumerate connected cameras. Labels are populated after permission is granted. */
  static async listCameras(): Promise<Array<{ deviceId: string; label: string }>> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      throw new BackgroundChangerError("UNSUPPORTED", "This browser does not expose media devices.");
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "videoinput")
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  }

  /** Instance convenience wrapper around the static listCameras(). */
  async listCameras(): Promise<Array<{ deviceId: string; label: string }>> {
    return BackgroundChanger.listCameras();
  }

  /** Enumerate connected microphones (for the studio's mic picker). */
  static async listMicrophones(): Promise<Array<{ deviceId: string; label: string }>> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      throw new BackgroundChangerError("UNSUPPORTED", "This browser does not expose media devices.");
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audioinput")
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  }

  /**
   * Start the camera + segmentation pipeline.
   */
  async start(deviceId?: string): Promise<{ stream: MediaStream; changer: BackgroundChanger }> {
    if (this._running) return { stream: this.outputStream!, changer: this };
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new BackgroundChangerError("UNSUPPORTED", "This browser does not support webcam capture (getUserMedia).");
    }
    if (typeof HTMLCanvasElement.prototype.captureStream !== "function") {
      throw new BackgroundChangerError("UNSUPPORTED", "This browser does not support canvas.captureStream().");
    }
    if (deviceId) this.deviceId = deviceId;

    // RAW-FIRST (freeze fix, part 1): the camera is acquired and
    // the render loop starts on the raw picture BEFORE any engine
    // work begins — the first frame never waits on an engine
    // download or compile. The engine then loads (under the init
    // timeout in _selectEngine) and its effect fades in once it is
    // actually live. The engine must NEVER hold the camera
    // hostage: if no engine can load, the camera still runs raw —
    // scenes, mixer, recording, the chroma key and camera effects
    // all stay live; only the AI backdrop modes (green/blur/image)
    // disable. Engine arrival and failure report through
    // onEngineStatus / engineError as they settle, and the studio
    // tells the creator plainly. _selectEngine never throws.
    //
    // Raw sessions (mode "none") skip the engine ENTIRELY (Lane F
    // audit, Flag E-1): no engine download, no inference CPU for a
    // matte that is never drawn. The engine loads lazily when the
    // first backdrop mode is picked (see setMode). A fresh session
    // also clears any engine park from the previous one.
    this._engineError = null;
    this._engineParked = false;
    this._parkError = null;
    this._consecutiveInferenceFailures = 0;
    await this._acquireCamera(this.deviceId);

    this.outputStream = this.canvas.captureStream(this.config.fps);
    await this._syncAudioTracks();
    this._running = true;
    this._frameStall.reset(performance.now());
    this._loop();
    if (this.mode !== "none") {
      /* Background, never awaited: the raw picture is already
         live, so the engine's warm-up gates nothing — no spinner,
         no blocked control waits on it. Its arrival (or failure)
         reports through onEngineStatus / engineError as it
         settles, exactly like the lazy setMode load. */
      void this._selectEngine();
    }
    if (this.config.image) await this.setImage(this.config.image);
    return { stream: this.outputStream, changer: this };
  }

  /** Switch to another camera without rebuilding the segmentation pipeline. */
  async switchCamera(deviceId: string | undefined): Promise<void> {
    if (!deviceId || deviceId === this.deviceId) return;
    this.deviceId = deviceId;
    if (!this._running) return;
    // Stop the old tracks; keep the pipeline and output stream.
    this.stream?.getTracks().forEach((t) => t.stop());
    await this._acquireCamera(deviceId);
    // A new camera means new framing: drop the engines' temporal
    // state so no ghost of the old feed lingers in the matte.
    this._engine?.reset();
    this._mattePost.reset();
    await this._syncAudioTracks();
  }

  /** Switch the microphone (re-acquires the same camera with the new mic). */
  async switchMicrophone(deviceId: string | undefined): Promise<void> {
    this._micDeviceId = deviceId ?? null;
    if (!this._running) return;
    this.stream?.getTracks().forEach((t) => t.stop());
    await this._acquireCamera(this.deviceId ?? undefined);
    await this._syncAudioTracks();
  }

  private _micDeviceId: string | null = null;

  /** The selected microphone deviceId, if any. */
  get microphoneDeviceId(): string | null {
    return this._micDeviceId;
  }

  /** Switch background mode: 'green' | 'blur' | 'image' | 'none'. */
  setMode(mode: BackgroundMode): this {
    if (!["green", "blur", "image", "none"].includes(mode)) {
      throw new BackgroundChangerError("UNSUPPORTED", `Unknown background mode: ${mode}`);
    }
    this.mode = mode;
    if (mode === "none") {
      /* Raw mode runs NO engine (Flag E-1): stand the matte engine
         down so a mid-session switch to None stops the download-side
         cost and the per-frame inference with it. */
      if (this._engine) void this._teardownEngine();
    } else if (this._running && !this._engine) {
      /* First backdrop mode of a raw-started session: load the engine
         now, lazily. _selectEngine never throws; the outcome lands via
         onEngineStatus / getEngineKind() as usual. */
      void this._selectEngine();
    }
    return this;
  }

  /**
   * Set the backdrop for mode 'image'. Accepts an image URL, a File/Blob,
   * or an HTMLImageElement. Cover-fit is applied at draw time.
   */
  async setImage(source: string | File | Blob | HTMLImageElement | null): Promise<this> {
    if (this._backdropUrl) {
      URL.revokeObjectURL(this._backdropUrl);
      this._backdropUrl = null;
    }
    if (!source) {
      this._backdrop = null;
      return this;
    }
    if (source instanceof HTMLImageElement) {
      this._backdrop = source;
      return this;
    }
    const url = typeof source === "string" ? source : URL.createObjectURL(source);
    if (typeof source !== "string") this._backdropUrl = url;
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new BackgroundChangerError("UNSUPPORTED", "That backdrop image could not be loaded."));
      img.src = url;
    });
    this._backdrop = img;
    return this;
  }

  /** Whether a backdrop image is currently loaded for mode 'image'. */
  hasBackdrop(): boolean {
    return this._backdrop !== null;
  }

  /** Set blur strength (px) for mode 'blur'. */
  setBlur(amount: number): this {
    this.blurAmount = Math.max(0, Number(amount) || 0);
    return this;
  }

  /** Mirror the processed output (selfie view). Applies to the whole frame. */
  setMirror(on: boolean): this {
    this.mirror = !!on;
    return this;
  }

  /**
   * Switch noise cancellation live: false (feature off — raw mic if audio
   * is on), 'off' (isolator passing the raw mic through), 'on', or 'max'.
   * At 'max', if the ML assets can't load, the isolator runs at 'on' and
   * says so through config.onNoiseStatus / getNoiseStatus().
   */
  async setNoiseCancellation(level: false | NoiseCancellationLevel): Promise<this> {
    if (level !== false && !["off", "on", "max"].includes(level)) {
      throw new BackgroundChangerError("UNSUPPORTED", `Unknown noise-cancellation level: ${level}`);
    }
    this._ncLevel = level === false ? null : level;
    this.config.noiseCancellation = level;
    if (!this._running) return this;
    // _syncAudioTracks reconciles the isolator: torn down only when no
    // voice effect needs it, otherwise downgraded to a plain 'off' stage.
    await this._syncAudioTracks();
    return this;
  }

  /**
   * Select a voice-effect preset live (see VOICE_EFFECTS). The effect runs
   * on the cleaned voice inside the VoiceIsolator; selecting one implies
   * audio capture, even with noise cancellation switched off.
   */
  async setVoiceEffect(name: string): Promise<this> {
    if (!VOICE_EFFECTS.some((e) => e.id === name)) {
      throw new BackgroundChangerError("UNSUPPORTED", `Unknown voice effect: ${name}`);
    }
    this._fxName = name;
    this.config.voiceEffect = name;
    if (!this._running) return this;
    await this._syncAudioTracks();
    return this;
  }

  /** The active voice-effect preset id. */
  getVoiceEffect(): string {
    return this._fxName;
  }

  /** Select a camera-effect preset live (see CAMERA_EFFECTS). */
  setCameraEffect(id: string): this {
    if (!CAMERA_EFFECTS.some((e) => e.id === id)) {
      throw new BackgroundChangerError("UNSUPPORTED", `Unknown camera effect: ${id}`);
    }
    this._camFx = id;
    this.config.cameraEffect = id;
    return this;
  }

  /** The active camera-effect preset id. */
  getCameraEffect(): string {
    return this._camFx;
  }

  /** The requested noise-cancellation level: false | 'off' | 'on' | 'max'. */
  getNoiseCancellation(): false | NoiseCancellationLevel {
    return this._ncLevel ?? false;
  }

  /** Latest noise-cancellation status (incl. ML fallback), or null if never enabled. */
  getNoiseStatus(): (VoiceIsolatorStatus & { error?: unknown }) | null {
    if (!this.isolator) return this.noiseStatus;
    return { ...this.isolator.getStatus(), message: this.noiseStatus?.message ?? "" };
  }

  /** AnalyserNode on the cleaned voice (for a level meter), or null. */
  getAnalyser(): AnalyserNode | null {
    return this.isolator?.getAnalyser() ?? null;
  }

  /** The processed MediaStream (null before start). */
  getStream(): MediaStream | null {
    return this.outputStream;
  }

  /**
   * The raw camera video element behind the kit (null before start).
   * The stage's chroma-key camera mode keys this directly; everything
   * else should use the processed output (canvas / stream).
   */
  getSourceVideo(): HTMLVideoElement | null {
    return this.stream ? this._video : null;
  }

  /** Whether the pipeline is running. */
  get running(): boolean {
    return this._running;
  }

  /** True when a background engine is live — backdrop modes work.
   *  False means the camera is running raw (see engineError). */
  get segmentationAvailable(): boolean {
    return this._engine !== null;
  }

  /** Why the background engine is unavailable, when it is. */
  get engineError(): BackgroundChangerError | null {
    return this._engineError;
  }

  /** Whether the background engine is live: 'standard' | 'off'. */
  getEngineKind(): BackgroundEngineKind {
    return this._engineKind;
  }

  /**
   * The matte-refinement step currently in force (index into
   * MATTE_REFINEMENT_STEPS). 'pro' pins 0 (sharpest), 'standard'
   * pins 1 (balanced), 'auto' reports wherever the perf ladder
   * currently sits.
   */
  getRefinementStep(): number {
    return this._refinementStep();
  }

  /** The configured background quality ('auto' | 'pro' | 'standard'). */
  getQuality(): BackgroundQuality {
    return this.config.quality;
  }

  /**
   * Switch background quality live. Re-runs engine selection against
   * the new setting (the camera never stops) and re-pins the
   * refinement step the quality names. Like start(), an engine
   * failure lands raw and is reported through getEngineKind() /
   * engineError / onEngineStatus, never thrown.
   */
  async setQuality(quality: BackgroundQuality): Promise<void> {
    if (!["auto", "pro", "standard"].includes(quality)) {
      throw new BackgroundChangerError("UNSUPPORTED", `Unknown background quality: ${quality}`);
    }
    this.config.quality = quality;
    if (!this._running && !this._engine) return; // applies at next start()
    if (this.mode === "none") return; // raw session: no engine to re-select — applies when a backdrop mode is picked
    await this._selectEngine();
  }

  /** Stop everything: camera tracks, render loop, segmenter, voice isolator, object URLs. */
  async stop(): Promise<void> {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    if (this.isolator) {
      try {
        await this.isolator.stop();
      } catch {
        /* already stopped */
      }
      this.isolator = null;
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.outputStream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.outputStream = null;
    this._engineEpoch++;
    const engine = this._engine;
    this._engine = null;
    this._engineKind = "off";
    this._engineFadeStart = null;
    this._busy = false;
    this.segmenter = null;
    if (engine) {
      try {
        await engine.dispose();
      } catch {
        /* already disposed */
      }
    }
    if (this._backdropUrl) {
      URL.revokeObjectURL(this._backdropUrl);
      this._backdropUrl = null;
    }
  }

  /* -------------------------------------------------------------- internal */

  /**
   * Run engine selection. There is exactly ONE engine to select —
   * the vendored MediaPipe segmentation engine — whatever the
   * configured quality (quality chooses the refinement step, not
   * an engine). NEVER throws: a load failure lands raw with
   * engineError set and onEngineStatus fired.
   */
  /* The in-flight engine selection, if any — concurrent callers
     (start, setMode, setQuality) share ONE load, never race two. */
  private _engineSelecting: Promise<void> | null = null;

  private _selectEngine(): Promise<void> {
    if (this._engineSelecting) return this._engineSelecting;
    const run = this._runEngineSelection();
    this._engineSelecting = run;
    void run.finally(() => {
      if (this._engineSelecting === run) this._engineSelecting = null;
    });
    return run;
  }

  private async _runEngineSelection(): Promise<void> {
    /* Raw mode never selects an engine (Flag E-1) — including a
       selection that was already in flight when the mode flipped. */
    if (this.mode === "none") {
      await this._teardownEngine();
      return;
    }
    /* A parked engine (inference failure cap) stays parked for the
       rest of the session: re-assert its error + status so the
       honest unavailable note survives, and never revive it here —
       only a fresh start() clears the park. */
    if (this._engineParked) {
      this._engineError = this._parkError;
      if (typeof this.config.onEngineStatus === "function") this.config.onEngineStatus("off");
      return;
    }
    try {
      const engine = new MediaPipeEngine(this.config.modelSelection);
      await this._initEngine(engine);
      if (!this._running || this._isRawMode()) {
        /* The session stopped, or went raw, while the engine was
           loading: the loaded engine is nobody's — dispose it and
           (for the raw flip) stand the engine state down. */
        await engine.dispose().catch(() => undefined);
        if (this._isRawMode()) await this._teardownEngine();
        return;
      }
      await this._swapEngine(engine);
    } catch (err) {
      await this._swapEngine(null, err);
    }
  }

  /**
   * Initialise an engine under the hard init timeout (freeze fix,
   * part 3). A stalled init — a script fetch that never answers, a
   * compile that never returns — rejects with a CDN_LOAD_FAILED
   * timeout error instead of hanging the caller forever. The
   * orphaned engine is disposed whenever its init eventually
   * settles, so a late success never leaks a live segmenter nobody
   * owns; a late failure is swallowed for the same reason (the
   * timeout already reported the outcome).
   */
  private async _initEngine(engine: MediaPipeEngine): Promise<void> {
    const timeoutMs = Math.max(1, this.config.engineInitTimeoutMs || ENGINE_INIT_TIMEOUT_MS);
    const init = engine.init();
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        init,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(
              new BackgroundChangerError(
                "CDN_LOAD_FAILED",
                "The background-effects engine took too long to load, so your camera is running plain.",
              ),
            );
          }, timeoutMs);
        }),
      ]);
    } catch (err) {
      void init.then(
        () => engine.dispose().catch(() => undefined),
        () => engine.dispose().catch(() => undefined),
      );
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Park the live engine for the rest of the session (freeze fix,
   * part 4): its inferences have failed
   * MAX_CONSECUTIVE_INFERENCE_FAILURES times in a row, so it is
   * stood down (disposed) and the studio falls back to the raw
   * picture with the engine-down note, instead of the loop paying
   * main-thread retries forever. Only a fresh start() — a new
   * session — clears the park.
   */
  private async _parkEngine(): Promise<void> {
    if (this._engineParked) return;
    this._engineParked = true;
    this._parkError = new BackgroundChangerError(
      "SEGMENTATION_FAILED",
      "Background effects stopped working, so your camera is running plain.",
    );
    await this._swapEngine(null, this._parkError);
  }

  /** One inference against the live engine produced nothing (a null
   *  matte or a rejection). Counts toward the park cap; a landed
   *  matte resets the run (see _loop). */
  private _noteInferenceFailure(): void {
    this._consecutiveInferenceFailures++;
    if (
      this._consecutiveInferenceFailures >= MAX_CONSECUTIVE_INFERENCE_FAILURES &&
      this._engine &&
      !this._engineParked
    ) {
      void this._parkEngine();
    }
  }

  /** Live mode read for async continuations (the mode can flip while an
   *  engine init is in flight; a method read also stays honest to the
   *  type checker, unlike a narrowed property access). */
  private _isRawMode(): boolean {
    return this.mode === "none";
  }

  /**
   * Retire the live engine because the session went raw (mode "none").
   * Unlike _swapEngine(null, err) this is NOT a failure: the error
   * state clears and the status honestly reports "off".
   */
  private async _teardownEngine(): Promise<void> {
    const old = this._engine;
    this._engineEpoch++;
    this._engine = null;
    this._engineKind = "off";
    this._engineFadeStart = null;
    this._consecutiveInferenceFailures = 0;
    this._busy = false;
    this._frameStall.reset(performance.now());
    this.segmenter = null;
    this._engineError = null;
    this._mattePost.reset();
    if (old) {
      try {
        await old.dispose();
      } catch {
        /* already disposed */
      }
    }
    if (typeof this.config.onEngineStatus === "function") this.config.onEngineStatus(this._engineKind);
  }

  /** Adopt a new live engine (or none), retiring the previous one.
   *  The only engine ever adopted is the MediaPipe engine (kind
   *  'standard'); the shared contract's wider kind union belongs to
   *  the still-photo path's engine, which the studio never adopts. */
  private async _swapEngine(next: MattingEngine | null, cause?: unknown): Promise<void> {
    const old = this._engine;
    this._engineEpoch++;
    this._engine = next;
    this._engineKind = next ? (next as MediaPipeEngine).kind : "off";
    /* An engine arriving while the session is already running
       fades its effect in over the raw picture instead of cutting
       to it (raw-first start, lazy setMode load, quality switch). */
    this._engineFadeStart = next && this._running ? performance.now() : null;
    this._consecutiveInferenceFailures = 0;
    this._busy = false;
    this._frameStall.reset(performance.now());
    this._mattePost.reset();
    if (next) {
      /* A fresh engine starts at the refinement step its quality
         names: the ladder restarts at the sharpest step, and the
         pinned qualities ('pro' / 'standard') land on theirs. */
      this._perf.reset();
      this._applyRefinement(next as MediaPipeEngine, this._refinementStep());
    }
    this.segmenter = next instanceof MediaPipeEngine ? next.segmenter : null;
    this._engineError = next
      ? null
      : cause instanceof BackgroundChangerError
        ? cause
        : new BackgroundChangerError("CDN_LOAD_FAILED", "Could not load the background-effects engine.", cause);
    if (old && old !== next) {
      try {
        await old.dispose();
      } catch {
        /* already disposed */
      }
    }
    if (typeof this.config.onEngineStatus === "function") this.config.onEngineStatus(this._engineKind);
  }

  /** The refinement step the configured quality names right now:
   *  'pro' pins the sharpest, 'standard' pins the balanced step,
   *  'auto' follows the perf ladder. */
  private _refinementStep(): number {
    const quality = this.config.quality;
    if (quality === "pro") return 0;
    if (quality === "standard") return 1;
    return this._perf.step;
  }

  /** Apply a refinement step to the live engine + matte pipeline:
   *  the engine reads its mask at the step's width, and the matte
   *  post-processing retunes to the step's edge settings. */
  private _applyRefinement(engine: MediaPipeEngine, step: number): void {
    const def = MATTE_REFINEMENT_STEPS[Math.max(0, Math.min(MATTE_MAX_STEP, step))];
    engine.setMaskCap(def.maskCap);
    this._mattePost.configure({
      emaWeight: def.emaWeight,
      choke: def.choke,
      curveLo: def.curveLo,
      curveHi: def.curveHi,
      featherPasses: def.featherPasses,
    });
  }

  /** Feed the engine's latest round-trip time to the perf ladder
   *  and act on its decision. Auto quality only — the pinned
   *  qualities never move. A step change retunes the refinement;
   *  the ladder's 'degrade' verdict has nowhere lighter to go (the
   *  lightest step IS the floor with one engine), so it is an
   *  honest stay, never an engine swap. */
  private _governPerf(engine: MediaPipeEngine): void {
    if (this.config.quality !== "auto") return;
    const ms = engine.lastMs;
    if (ms === null) return;
    engine.lastMs = null;
    const action = this._perf.sample(ms);
    if (action === "step-down" || action === "step-up") {
      this._applyRefinement(engine, this._perf.step);
    }
  }

  private async _acquireCamera(deviceId: string | null | undefined): Promise<void> {
    const video: MediaTrackConstraints = {
      width: { ideal: this.config.width },
      height: { ideal: this.config.height },
      frameRate: { ideal: this.config.fps },
    };
    if (deviceId) video.deviceId = { exact: deviceId };
    // Noise cancellation implies audio; whenever the mic is captured it is
    // requested with the browser's own suppression/echo/gain layer on.
    const audio: boolean | MediaTrackConstraints = this._wantsAudio()
      ? VoiceIsolator.micConstraints(this._micDeviceId ? { deviceId: { exact: this._micDeviceId } } : {})
      : false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new BackgroundChangerError("PERMISSION_DENIED", "Camera permission was denied. Allow camera access in your browser, then try again.", err);
      }
      if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
        throw new BackgroundChangerError("NO_CAMERA", "No camera was found. Connect a webcam, then try again.", err);
      }
      throw new BackgroundChangerError("NO_CAMERA", "The camera could not be started.", err);
    }
    if (!stream.getVideoTracks().length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new BackgroundChangerError("NO_CAMERA", "No camera was found. Connect a webcam, then try again.");
    }
    this.stream = stream;
    this._video.srcObject = stream;
    await this._video.play();
    // Size the canvases from the real feed, capped at 720p for stable 30fps.
    const w = this._video.videoWidth || this.config.width;
    const hgt = this._video.videoHeight || this.config.height;
    const scale = Math.min(1, 720 / hgt);
    this.canvas.width = Math.round(w * scale);
    this.canvas.height = Math.round(hgt * scale);
    this._person.width = this.canvas.width;
    this._person.height = this.canvas.height;
    this._buildOverlays(this.canvas.width, this.canvas.height);
  }

  /** True when the output stream should carry a microphone track at all. */
  private _wantsAudio(): boolean {
    return !!this.config.audio || this._ncLevel !== null || this._fxName !== "none";
  }

  /**
   * Reconcile the output stream's audio track with the current source:
   * the VoiceIsolator's cleaned track when noise cancellation is enabled,
   * otherwise the raw mic track (when audio is on), otherwise none.
   */
  private async _syncAudioTracks(): Promise<void> {
    if (!this.outputStream || !this.stream) return;
    let desired: MediaStreamTrack | null = null;
    // The isolator is needed when noise cancellation is enabled OR a voice
    // effect is selected (the effect lives in the isolator's chain; with NC
    // off it runs at level 'off' — shaped, not noise-cancelled).
    const needIsolator = this._ncLevel !== null || this._fxName !== "none";
    if (needIsolator) {
      try {
        const wantLevel: NoiseCancellationLevel = this._ncLevel ?? "off";
        if (!this.isolator) {
          this.isolator = new VoiceIsolator({
            level: wantLevel,
            effect: this._fxName,
            onStatus: (s) => {
              this.noiseStatus = s;
              if (typeof this.config.onNoiseStatus === "function") this.config.onNoiseStatus(s);
            },
          });
          await this.isolator.start(this.stream);
        } else {
          await this.isolator.setInput(this.stream);
          if (this.isolator.level !== wantLevel) await this.isolator.setLevel(wantLevel);
          if (this.isolator.getEffect() !== this._fxName) await this.isolator.setEffect(this._fxName);
        }
        desired = this.isolator.getOutputTrack();
      } catch (err) {
        // No mic track on this stream (or Web Audio unavailable): the video
        // must not fail over audio. Report it and carry on silent.
        this.isolator = null;
        this.noiseStatus = {
          level: this._ncLevel ?? "off",
          effectiveLevel: this._ncLevel ?? "off",
          mlState: "unavailable",
          fellBack: false,
          effect: this._fxName,
          message: "No microphone was available, so the voice features are off.",
          error: err,
        };
        if (typeof this.config.onNoiseStatus === "function") this.config.onNoiseStatus(this.noiseStatus);
        desired = null;
      }
    } else {
      if (this.isolator) {
        try {
          await this.isolator.stop();
        } catch {
          /* already stopped */
        }
        this.isolator = null;
      }
      if (this._wantsAudio()) {
        desired = this.stream.getAudioTracks()[0] ?? null;
      }
    }
    const current = this.outputStream.getAudioTracks();
    current.forEach((t) => {
      if (t !== desired) this.outputStream!.removeTrack(t);
    });
    if (desired && !current.includes(desired)) this.outputStream.addTrack(desired);
  }

  /**
   * Render loop. Runs one engine inference at a time — frames are
   * dropped rather than queued while an inference is in flight, which
   * keeps latency low and the UI thread free. With no engine live,
   * the raw frame is drawn instead (degraded start).
   */
  private _loop(): void {
    if (!this._running) return;
    this._rafId = requestAnimationFrame(() => this._loop());
    if (this.mode === "none") {
      // Raw mode: the raw frame, never an inference (Flag E-1) — even
      // if an engine somehow exists, it does not run here.
      if (this._video.readyState >= 2) this._compositeRaw();
      return;
    }
    const engine = this._engine;
    if (!engine) {
      // Engine down: draw the raw frame (with the camera-effect finish)
      // so the camera — and everything built on its canvas — stays live.
      if (this._video.readyState >= 2) this._compositeRaw();
      return;
    }
    if (this._video.readyState < 2) {
      // The camera frame isn't there to composite — counts toward the
      // stall clock like any other frameless pass.
      this._noteFrameMiss();
      return;
    }
    // Stall fallback: while the engine produces nothing, keep the live
    // raw picture on the canvas instead of a blank (or frozen) frame.
    // Inference attempts continue below, so a recovered engine takes
    // over again on its next landed matte.
    if (this._frameStall.stalled) this._compositeRaw();
    if (this._busy) {
      // An inference is in flight. Its wait still counts toward the
      // stall clock — a hung inference must trip the fallback, not
      // wedge the canvas blank forever.
      this._noteFrameMiss();
      return;
    }
    this._busy = true;
    const epoch = this._engineEpoch;
    engine
      .process(this._video)
      .then((matte) => {
        if (!this._running || epoch !== this._engineEpoch) return;
        this._governPerf(engine as MediaPipeEngine);
        if (matte) {
          this._consecutiveInferenceFailures = 0;
          this._compositeMatte(matte);
          this._noteMatteFrame();
        } else {
          this._noteInferenceFailure();
          this._noteFrameMiss();
        }
      })
      .catch(() => {
        /* transient inference failure — the next frame retries; the
           stall tracker decides when silence becomes a fallback, and
           the failure counter decides when retries become a park */
        if (epoch === this._engineEpoch) {
          this._noteInferenceFailure();
          this._noteFrameMiss();
        }
      })
      .finally(() => {
        if (epoch === this._engineEpoch) this._busy = false;
      });
  }

  /**
   * One loop pass produced no matte composite. When the frameless
   * passes add up to a stall (frame-stall.ts), say so ONCE through
   * the engine-status channel: the studio drops to its engine-down
   * presentation ("Background engine: Off", camera running plain)
   * for the length of the episode, while the loop paints the raw
   * camera — the feed is never dressed up as effects-active while
   * no effects frames are flowing.
   */
  private _noteFrameMiss(): void {
    if (!this._frameStall.noteMiss(performance.now())) return;
    if (typeof this.config.onEngineStatus === "function") this.config.onEngineStatus("off");
  }

  /**
   * A matte-composited frame landed. When it ends a stall episode,
   * restore the live engine status through the same channel — the
   * effects look is claimed again only now that composited frames
   * are actually flowing.
   */
  private _noteMatteFrame(): void {
    if (!this._frameStall.noteMatte(performance.now())) return;
    if (typeof this.config.onEngineStatus === "function") this.config.onEngineStatus(this._engineKind);
  }

  /** Alpha for the composited layers while a freshly-live engine
   *  is fading in over the raw picture: 1 when no fade is running. */
  private _fadeAlpha(now: number): number {
    if (this._engineFadeStart === null) return 1;
    const t = (now - this._engineFadeStart) / ENGINE_FADE_IN_MS;
    if (t >= 1) {
      this._engineFadeStart = null;
      return 1;
    }
    return Math.max(0, t);
  }

  /** Engine-down frame: the untouched camera picture, finished with the
   *  same mirror handling + camera-effect grade/overlays as _composite. */
  private _compositeRaw(): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const ctx = this._ctx;
    if (!W || !H) return;
    ctx.save();
    if (this.mirror) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(this._video, 0, 0, W, H);
    ctx.restore();
    this._applyEffectFinish(ctx);
  }

  /** Camera-effect finish shared by both frame paths: the full-frame
   *  grade, then the pre-rendered overlay presets. */
  private _applyEffectFinish(ctx: CanvasRenderingContext2D): void {
    const grade = CAMERA_EFFECT_FILTERS[this._camFx];
    if (grade && "filter" in ctx) {
      ctx.save();
      ctx.filter = grade;
      ctx.drawImage(this.canvas, 0, 0);
      ctx.filter = "none";
      ctx.restore();
    }
    if (this._camFx === "vignette" && this._ovVignette) ctx.drawImage(this._ovVignette, 0, 0);
    if (this._camFx === "gold-frame" && this._ovFrame) ctx.drawImage(this._ovFrame, 0, 0);
  }

  /**
   * Engine frame: post-process the alpha matte, cut the person out
   * with it, and lay the cutout over the background layer. The matte
   * pipeline (matte-post.ts, tuned by the live refinement step):
   * temporal blend → choke → levels curve → feather, rasterised as
   * a white image whose alpha IS the matte, then used as the person
   * layer's stencil ('copy' the matte in, 'source-in' the camera
   * picture). Edge despill runs on the person layer's own pixels,
   * keyed on its alpha band, so the engine needs to know nothing
   * about it.
   */
  private _compositeMatte(matte: EngineMatte): void {
    if (!this._running) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const ctx = this._ctx;
    if (!W || !H) return;
    // A freshly-live engine fades in over the raw picture: paint
    // the raw frame first (it applies the effect finish), then lay
    // the composited layers over it at the fade alpha and skip the
    // second finish below — the grade/overlays are already on.
    const fade = this._fadeAlpha(performance.now());
    if (fade < 1) this._compositeRaw();
    const mw = matte.width;
    const mh = matte.height;

    // 0 — post-process + rasterise the matte.
    const post = this._mattePost.process(matte.alpha, mw, mh);
    if (this._matteCanvas.width !== mw || this._matteCanvas.height !== mh) {
      this._matteCanvas.width = mw;
      this._matteCanvas.height = mh;
      this._matteImage = null;
    }
    if (!this._matteImage) this._matteImage = this._matteCtx.createImageData(mw, mh);
    const px = this._matteImage.data;
    for (let i = 0, j = 0; i < post.length; i++, j += 4) {
      px[j] = 255;
      px[j + 1] = 255;
      px[j + 2] = 255;
      px[j + 3] = Math.round(post[i] * 255);
    }
    this._matteCtx.putImageData(this._matteImage, 0, 0);

    // 1 — person cutout (built unmirrored; the mirror transform below
    // applies to the whole frame, exactly like before).
    if (this.mode !== "none") {
      const p = this._personCtx;
      p.save();
      p.clearRect(0, 0, W, H);
      p.globalCompositeOperation = "copy";
      p.drawImage(this._matteCanvas, 0, 0, W, H);
      p.globalCompositeOperation = "source-in";
      p.drawImage(this._video, 0, 0, W, H);
      p.restore();
      const personData = p.getImageData(0, 0, W, H);
      despillRgba(personData.data);
      p.putImageData(personData, 0, 0);
    }

    ctx.save();
    if (fade < 1) ctx.globalAlpha = fade;
    if (this.mirror) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }

    // 2 — background layer
    if (this.mode === "green") {
      ctx.fillStyle = GREEN;
      ctx.fillRect(0, 0, W, H);
    } else if (this.mode === "image" && this._backdrop) {
      this._drawCover(ctx, this._backdrop, W, H);
    } else if (this.mode === "blur") {
      // Slight overscale hides the fringe the blur leaves at the frame edges.
      ctx.save();
      ctx.filter = `blur(${this.blurAmount}px)`;
      const s = 1.06;
      ctx.drawImage(this._video, -(W * (s - 1)) / 2, -(H * (s - 1)) / 2, W * s, H * s);
      ctx.restore();
    } else {
      // 'none' — or 'image' with no backdrop set yet: raw camera frame.
      ctx.drawImage(this._video, 0, 0, W, H);
    }

    // 3 — person cutout (skipped for the raw passthrough)
    if (this.mode !== "none") {
      ctx.drawImage(this._person, 0, 0, W, H);
    }

    ctx.restore();

    // 4 — camera effect finish (shared with the engine-down raw path;
    // skipped mid-fade — the raw underlay already applied it).
    if (fade >= 1) this._applyEffectFinish(ctx);
  }

  /**
   * Pre-render the Vignette and Gold Frame overlays at the current frame
   * size (called whenever the canvas is sized — never per frame).
   */
  private _buildOverlays(W: number, H: number): void {
    // Vignette: transparent center easing to dark edges.
    const vig = document.createElement("canvas");
    vig.width = W;
    vig.height = H;
    const vctx = vig.getContext("2d")!;
    const grad = vctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.45)");
    vctx.fillStyle = grad;
    vctx.fillRect(0, 0, W, H);
    this._ovVignette = vig;

    // Gold Frame: a gold hairline rounded rect + brighter corner accents.
    const frame = document.createElement("canvas");
    frame.width = W;
    frame.height = H;
    const fctx = frame.getContext("2d")!;
    const inset = Math.max(10, Math.round(W * 0.012));
    const radius = Math.min(26, inset + 10);
    const hairline = Math.max(2, Math.round(W * 0.0035));
    const traceRect = (ins: number, lw: number, color: string) => {
      fctx.beginPath();
      fctx.strokeStyle = color;
      fctx.lineWidth = lw;
      if (typeof fctx.roundRect === "function") fctx.roundRect(ins, ins, W - ins * 2, H - ins * 2, radius);
      else fctx.rect(ins, ins, W - ins * 2, H - ins * 2);
      fctx.stroke();
    };
    traceRect(inset, hairline, "#C9A84C");
    // Corner accents: short, thicker L-strokes just outside the hairline.
    const L = Math.min(72, Math.round(W * 0.055));
    const o = Math.max(4, inset - Math.round(hairline * 1.6));
    fctx.strokeStyle = "#E9CD7A";
    fctx.lineWidth = hairline * 2.2;
    fctx.lineCap = "round";
    const corner = (x: number, y: number, dx: number, dy: number) => {
      fctx.beginPath();
      fctx.moveTo(x + dx * L, y);
      fctx.lineTo(x, y);
      fctx.lineTo(x, y + dy * L);
      fctx.stroke();
    };
    corner(o, o, 1, 1);
    corner(W - o, o, -1, 1);
    corner(o, H - o, 1, -1);
    corner(W - o, H - o, -1, -1);
    this._ovFrame = frame;
  }

  private _drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number): void {
    const scale = Math.max(W / img.width, H / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  }
}

/**
 * Convenience wrapper: create a BackgroundChanger, start it, and return
 * { stream, changer, stop }. The stream is a standard MediaStream.
 */
export async function getProcessedStream(
  config: BackgroundChangerConfig = {},
): Promise<{ stream: MediaStream; changer: BackgroundChanger; stop: () => Promise<void> }> {
  const changer = new BackgroundChanger(config);
  const { stream } = await changer.start(config.deviceId ?? undefined);
  return { stream, changer, stop: () => changer.stop() };
}
