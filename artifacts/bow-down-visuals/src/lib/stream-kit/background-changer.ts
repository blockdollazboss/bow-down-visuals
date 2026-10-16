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
 * Two engines sit behind one contract (rvm-engine.ts MattingEngine):
 * the Pro engine (Robust Video Matting — a soft alpha matte with hair
 * detail and recurrent temporal stability) and the Standard engine
 * (MediaPipe Selfie Segmentation — a harder, lower-res mask). The
 * `quality` config picks: 'auto' (default) tries Pro, falls back to
 * Standard, and degrades Pro → Standard if Pro runs too slowly on the
 * device; 'pro' forces Pro (raw camera if it can't run — never a
 * silent downgrade); 'standard' forces Standard. Both engines' mattes
 * pass through the same post-processing (matte-post.ts). If NO engine
 * can run, the camera still starts raw — an engine failure never
 * holds the camera hostage.
 *
 * Audio: pass `audio: true` to carry the mic, and `noiseCancellation:
 * 'on' | 'max'` to run it through the VoiceIsolator (voice-isolator.ts)
 * first — the output stream then holds the processed picture and the
 * cleaned voice together.
 */

import { VoiceIsolator, VOICE_EFFECTS, type NoiseCancellationLevel, type VoiceIsolatorStatus } from "./voice-isolator";
import { RvmEngine, RvmEngineError, RVM_MAX_STEP, type EngineMatte, type MattingEngine } from "./rvm-engine";
import { MattePostProcessor, despillRgba } from "./matte-post";
import { PerfLadder } from "./perf-ladder";

/* The segmentation engine is VENDORED same-origin (public/engines/
   selfie-segmentation — @mediapipe/selfie_segmentation 0.1.1675465747)
   and lazy-loaded only when the studio starts a camera: a creator's
   broadcast must never depend on a third-party CDN being reachable from
   their browser. (The previous pin named a version that does not exist
   in the npm registry, so its CDN URL failed everywhere.) The CDN copy
   of the same build remains only as a last-resort fallback. */
export const SEGMENTATION_LOCAL_BASE = "/engines/selfie-segmentation";
export const SEGMENTATION_CDN_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747";
const SEGMENTATION_BASES = [SEGMENTATION_LOCAL_BASE, SEGMENTATION_CDN_BASE] as const;
const GREEN = "#00FF00";

/**
 * The camera-effects library. The UI renders its preset row from this
 * array; growing the library = adding an entry here plus its grade /
 * overlay in CAMERA_EFFECT_FILTERS / _composite(). Grades are cheap
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
 * Background engine quality. 'auto' (default) runs the ladder: Pro
 * first, Standard on load failure, and a live Pro → Standard degrade
 * if Pro inference is too slow for the device. 'pro' forces the Pro
 * engine — if it cannot run, the camera goes raw rather than silently
 * dropping to Standard. 'standard' forces the Standard engine.
 */
export type BackgroundQuality = "auto" | "pro" | "standard";

/** Which background engine is actually live ('off' = raw camera). */
export type BackgroundEngineKind = "pro" | "standard" | "off";
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
  /** Fired whenever the live background engine changes ('pro' |
   *  'standard' | 'off') — the studio shows it as the honest
   *  "Background engine: Pro / Standard / Off" status. */
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
 * The Standard engine: MediaPipe Selfie Segmentation behind the
 * MattingEngine contract. MediaPipe is push-based (send → onResults),
 * so process() pairs one send with its results callback; a frame
 * requested while another is in flight is skipped (null), never
 * queued, and a results callback that never arrives times out into a
 * skipped frame rather than wedging the pipeline. The mask arrives
 * as a canvas whose ALPHA channel carries the person mask (the same
 * channel the composite has always keyed on); the matte is read at a
 * capped width — the mask itself is low-resolution, which is exactly
 * the roughness the Pro engine exists to fix. Flicker is calmed by
 * the shared matte post-processing (temporal blend), not here.
 */
class MediaPipeEngine implements MattingEngine {
  readonly kind = "standard" as const;
  segmenter: MediaPipeSegmenter | null = null;
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
      pending.resolve(this._extract((results as MediaPipeResults).segmentationMask));
    });
    this.segmenter = segmenter;
  }

  process(video: HTMLVideoElement): Promise<EngineMatte | null> {
    const segmenter = this.segmenter;
    if (!segmenter) return Promise.resolve(null);
    if (this._pending) return Promise.resolve(null); // one send in flight — skip, never queue
    return new Promise<EngineMatte | null>((resolve) => {
      const timer = setTimeout(() => {
        if (this._pending?.resolve === resolve) this._pending = null;
        resolve(null);
      }, 1000);
      this._pending = { resolve, timer };
      segmenter.send({ image: video }).catch(() => {
        if (this._pending?.resolve === resolve) {
          this._pending = null;
          clearTimeout(timer);
        }
        resolve(null);
      });
    });
  }

  private _extract(mask: HTMLCanvasElement): EngineMatte | null {
    const srcW = mask?.width ?? 0;
    const srcH = mask?.height ?? 0;
    if (!srcW || !srcH) return null;
    const w = Math.min(srcW, 480);
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
  /* The live background engine (Pro / Standard) behind the shared
     MattingEngine contract; null = raw camera ("Off"). */
  private _engine: MattingEngine | null = null;
  private _engineKind: BackgroundEngineKind = "off";
  /* Bumped on every engine swap/stop so in-flight frames from a
     retired engine can never composite (or un-block the loop). */
  private _engineEpoch = 0;
  private _busy = false;
  private _degrading = false;
  private readonly _perf = new PerfLadder({ maxStep: RVM_MAX_STEP });
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
      mode: config.mode ?? "green",
      quality: config.quality ?? "auto",
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

    // The engine must NEVER hold the camera hostage: if no engine can
    // load, the camera still starts and runs raw — scenes, mixer,
    // recording, the chroma key and camera effects all stay live;
    // only the AI backdrop modes (green/blur/image) disable. The
    // studio reads segmentationAvailable / engineError /
    // getEngineKind() after start() resolves and tells the creator
    // plainly. _selectEngine never throws.
    this._engineError = null;
    await this._selectEngine();
    await this._acquireCamera(this.deviceId);
    if (this.config.image) await this.setImage(this.config.image);

    this.outputStream = this.canvas.captureStream(this.config.fps);
    await this._syncAudioTracks();
    this._running = true;
    this._loop();
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

  /** Which background engine is live: 'pro' | 'standard' | 'off'. */
  getEngineKind(): BackgroundEngineKind {
    return this._engineKind;
  }

  /** The configured background quality ('auto' | 'pro' | 'standard'). */
  getQuality(): BackgroundQuality {
    return this.config.quality;
  }

  /**
   * Switch background quality live. Re-runs engine selection against
   * the new setting (the camera never stops). Like start(), an engine
   * failure lands on the ladder — Standard in auto, raw otherwise —
   * and is reported through getEngineKind() / engineError /
   * onEngineStatus, never thrown.
   */
  async setQuality(quality: BackgroundQuality): Promise<void> {
    if (!["auto", "pro", "standard"].includes(quality)) {
      throw new BackgroundChangerError("UNSUPPORTED", `Unknown background quality: ${quality}`);
    }
    this.config.quality = quality;
    if (!this._running && !this._engine) return; // applies at next start()
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
   * Run engine selection for the configured quality. NEVER throws:
   * every failure path lands on the ladder (Standard in auto, raw
   * otherwise) with engineError set and onEngineStatus fired.
   */
  private async _selectEngine(): Promise<void> {
    const quality = this.config.quality;
    let firstError: unknown = null;
    if (quality === "auto" || quality === "pro") {
      try {
        const engine = new RvmEngine();
        await engine.init();
        await this._swapEngine(engine);
        return;
      } catch (err) {
        firstError = err;
      }
    }
    if (quality === "auto" || quality === "standard") {
      try {
        const engine = new MediaPipeEngine(this.config.modelSelection);
        await engine.init();
        await this._swapEngine(engine);
        return;
      } catch (err) {
        firstError = firstError ?? err;
      }
    }
    await this._swapEngine(null, firstError);
  }

  /** Adopt a new live engine (or none), retiring the previous one. */
  private async _swapEngine(next: MattingEngine | null, cause?: unknown): Promise<void> {
    const old = this._engine;
    this._engineEpoch++;
    this._engine = next;
    this._engineKind = next ? next.kind : "off";
    this._busy = false;
    this._mattePost.reset();
    if (next?.kind === "pro") this._perf.reset();
    this.segmenter = next instanceof MediaPipeEngine ? next.segmenter : null;
    this._engineError = next
      ? null
      : cause instanceof BackgroundChangerError
        ? cause
        : cause instanceof RvmEngineError
          ? new BackgroundChangerError(
              cause.code === "INFERENCE_FAILED" ? "SEGMENTATION_FAILED" : "CDN_LOAD_FAILED",
              cause.message,
              cause,
            )
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

  /** Auto-mode live degrade: Pro is too slow for this device, so the
   *  Standard engine takes over (and the status says so). */
  private async _degradeToStandard(): Promise<void> {
    try {
      const engine = new MediaPipeEngine(this.config.modelSelection);
      await engine.init();
      await this._swapEngine(engine);
    } catch (err) {
      await this._swapEngine(null, err);
    }
  }

  /** Feed the Pro engine's latest inference time to the perf ladder
   *  and act on its decision: internal step changes, or — in auto
   *  mode only — the degrade to Standard. Pro mode steps internally
   *  but never switches engines under the creator. */
  private _governPerf(engine: RvmEngine): void {
    const action = this._perf.sample(engine.lastMs);
    if (action === "step-down" || action === "step-up") {
      engine.setStep(this._perf.step);
    } else if (action === "degrade" && this.config.quality === "auto" && !this._degrading) {
      this._degrading = true;
      void this._degradeToStandard().finally(() => {
        this._degrading = false;
      });
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
    if (this._video.readyState < 2) return;
    const engine = this._engine;
    if (!engine) {
      // Engine down: draw the raw frame (with the camera-effect finish)
      // so the camera — and everything built on its canvas — stays live.
      this._compositeRaw();
      return;
    }
    if (this._busy) return;
    this._busy = true;
    const epoch = this._engineEpoch;
    engine
      .process(this._video)
      .then((matte) => {
        if (!this._running || epoch !== this._engineEpoch) return;
        if (engine.kind === "pro") this._governPerf(engine as RvmEngine);
        if (matte) this._compositeMatte(matte);
      })
      .catch(() => {
        /* transient inference failure — the next frame retries */
      })
      .finally(() => {
        if (epoch === this._engineEpoch) this._busy = false;
      });
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
   * pipeline is shared by both engines: temporal blend → choke →
   * levels curve → feather (matte-post.ts), rasterised as a white
   * image whose alpha IS the matte, then used as the person layer's
   * stencil ('copy' the matte in, 'source-in' the camera picture).
   * Edge despill runs on the person layer's own pixels, keyed on its
   * alpha band, so neither engine needs to know about it.
   */
  private _compositeMatte(matte: EngineMatte): void {
    if (!this._running) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const ctx = this._ctx;
    if (!W || !H) return;
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

    // 4 — camera effect finish (shared with the engine-down raw path).
    this._applyEffectFinish(ctx);
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
