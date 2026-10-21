/**
 * voice-isolator.ts — noise cancellation for the Go Live stream kit.
 *
 * Ported from the standalone Live Camera kit (~/workspace/discord-live-camera)
 * into the app as a typed source module. Takes a raw microphone stream and
 * returns a cleaned-up audio track in real time: the room (fan, hum,
 * keyboard, TV, echo) is cancelled, the voice stays. Everything runs in the
 * browser with Web Audio.
 *
 * Three layers, by level:
 *   'off' — passthrough. The raw mic track is handed back untouched
 *           (a silent analysis tap still feeds the level meter).
 *   'on'  — the browser's own noiseSuppression / echoCancellation /
 *           autoGainControl at capture time, plus a Web Audio chain:
 *           high-pass → noise gate (downward expander) → presence EQ →
 *           limiter-style compressor → output.
 *   'max' — everything in 'on', plus RNNoise machine-learning suppression
 *           (WASM in an AudioWorklet, loaded from CDN). If the ML assets
 *           can't load, the isolator quietly stays at 'on' and reports the
 *           fallback through config.onStatus — the stream never fails
 *           because the model didn't arrive.
 *
 * After the cleaning chain sits a voice-effects rack (the VOICE_EFFECTS
 * library): Deep / High (worklet pitch shift), Robot (ring modulation),
 * Echo, Reverb, Radio, Megaphone — Web Audio only, selected live with
 * setEffect(). An effect selected at level 'off' still runs (the chain
 * carries it with the noise-cancelling stages bypassed).
 */

/* RNNoise assets are VENDORED same-origin (public/engines/rnnoise —
   @sapphi-red/web-noise-suppressor 0.4.1 dist build), lazy-loaded only
   when Noise Cancellation Max is switched on; the pinned CDN build is
   the fallback if the local copy fails to serve. (The old loader asked
   the CDN for index.min.js, a file that exists only through the CDN's
   auto-minify — the vendored file is index.js.) */
export const RNNOISE_LOCAL_BASE = "/engines/rnnoise";
export const RNNOISE_CDN_BASE = "https://cdn.jsdelivr.net/npm/@sapphi-red/web-noise-suppressor@0.4.1/dist";
const RNNOISE_BASES = [RNNOISE_LOCAL_BASE, RNNOISE_CDN_BASE] as const;

/** Every asset URL for one base — module, WASM builds, worklet. */
export function rnnoiseUrls(base: string) {
  return {
    index: `${base}/index.js`,
    wasm: `${base}/rnnoise.wasm`,
    wasmSimd: `${base}/rnnoise_simd.wasm`,
    worklet: `${base}/rnnoise/workletProcessor.js`,
  };
}
const RNNOISE_SAMPLE_RATE = 48000; // RNNoise only understands 48 kHz.

export type NoiseCancellationLevel = "off" | "on" | "max";
export type MlState = "idle" | "loading" | "active" | "failed" | "unavailable";

export interface VoiceIsolatorStatus {
  level: NoiseCancellationLevel;
  effectiveLevel: NoiseCancellationLevel;
  mlState: MlState;
  fellBack: boolean;
  effect: string;
  message: string;
}

export type VoiceIsolatorErrorCode = "PERMISSION_DENIED" | "NO_MIC" | "UNSUPPORTED" | "NOT_STARTED";

/** Error with a stable machine-readable `code`, mirroring BackgroundChangerError. */
export class VoiceIsolatorError extends Error {
  code: VoiceIsolatorErrorCode;
  cause?: unknown;
  constructor(code: VoiceIsolatorErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "VoiceIsolatorError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/**
 * The voice-effects library. Effects run AFTER noise cancellation in the
 * chain — the cleaned voice is what gets effected. The UI renders its
 * preset rack from this array; growing the library = adding an entry here
 * plus a builder case in VoiceIsolator._buildEffectStage().
 */
export const VOICE_EFFECTS = [
  { id: "none", label: "None" },
  { id: "deep", label: "Deep" },
  { id: "high", label: "High" },
  { id: "robot", label: "Robot" },
  { id: "echo", label: "Echo" },
  { id: "reverb", label: "Reverb" },
  { id: "radio", label: "Radio" },
  { id: "megaphone", label: "Megaphone" },
] as const;

export type VoiceEffectId = (typeof VOICE_EFFECTS)[number]["id"];

/**
 * The noise gate: a small AudioWorklet processor doing RMS-based downward
 * expansion. Below the threshold the gain eases toward a low floor (never a
 * hard mute, so speech tails don't chop); above it the gate opens fully.
 * Attack is fast so word onsets survive; release is slow so the gate doesn't
 * pump between syllables. A short hold keeps brief pauses inside a sentence
 * from closing the gate.
 */
const GATE_WORKLET_SOURCE = `
class BdvNoiseGate extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const p = (options && options.processorOptions) || {};
    this.thresholdDb = typeof p.thresholdDb === 'number' ? p.thresholdDb : -45;
    this.floorGain = typeof p.floorGain === 'number' ? p.floorGain : 0.02;
    this.attackMs = 3;
    this.releaseMs = 140;
    this.holdMs = 90;
    this.env = 0;
    this.gain = 1;
    this.hold = 0;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (typeof d.thresholdDb === 'number') this.thresholdDb = d.thresholdDb;
      if (typeof d.floorGain === 'number') this.floorGain = d.floorGain;
    };
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length || !output || !output.length) return true;
    const inCh = input.length;
    const outCh = output.length;
    const frames = input[0].length;
    const atk = Math.exp(-1 / (sampleRate * this.attackMs / 1000));
    const rel = Math.exp(-1 / (sampleRate * this.releaseMs / 1000));
    const holdSamples = Math.round(sampleRate * this.holdMs / 1000);
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let c = 0; c < inCh; c++) { const s = input[c][i]; sum += s * s; }
      const rms = Math.sqrt(sum / inCh);
      const coef = rms > this.env ? atk : rel;
      this.env = coef * this.env + (1 - coef) * rms;
      const thr = Math.pow(10, this.thresholdDb / 20);
      let target;
      if (this.env >= thr) {
        target = 1;
        this.hold = holdSamples;
      } else if (this.hold > 0) {
        this.hold--;
        target = 1;
      } else {
        const t = Math.min(1, this.env / thr);
        target = this.floorGain + (1 - this.floorGain) * t * t;
      }
      const g = target > this.gain ? atk : rel;
      this.gain = g * this.gain + (1 - g) * target;
      for (let c = 0; c < outCh; c++) {
        output[c][i] = input[Math.min(c, inCh - 1)][i] * this.gain;
      }
    }
    return true;
  }
}
registerProcessor('bdv-noise-gate', BdvNoiseGate);
`;

let gateWorkletPromise: Promise<void> | null = null;

/** Register the gate worklet on a context (once per page). */
function loadGateWorklet(ctx: AudioContext): Promise<void> {
  if (!gateWorkletPromise) {
    const url = URL.createObjectURL(new Blob([GATE_WORKLET_SOURCE], { type: "application/javascript" }));
    gateWorkletPromise = ctx.audioWorklet.addModule(url);
  }
  return gateWorkletPromise;
}

/**
 * The pitch shifter behind the Deep / High presets: a delay-modulation
 * shifter. Two read taps sweep a 2048-sample window half a period apart;
 * each tap's gain is a raised-sine window over its own sweep, so a tap is
 * always silent at the moment its delay wraps — the classic harmonizer
 * grain, click-free. Pitch moves, duration doesn't. Semitones arrive via
 * processorOptions and can be updated live through the port.
 */
const PITCH_WORKLET_SOURCE = `
class BdvPitchShift extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const p = (options && options.processorOptions) || {};
    this.semitones = typeof p.semitones === 'number' ? p.semitones : -4;
    this.size = 16384;
    this.window = 2048;
    this.buffers = [new Float32Array(this.size), new Float32Array(this.size)];
    this.write = 0;
    this.phase = 0;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (typeof d.semitones === 'number') this.semitones = d.semitones;
    };
  }
  read(buf, delay) {
    let pos = this.write - delay;
    pos = ((pos % this.size) + this.size) % this.size;
    const i0 = Math.floor(pos);
    const i1 = (i0 + 1) % this.size;
    const frac = pos - i0;
    return buf[i0] * (1 - frac) + buf[i1] * frac;
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length || !output || !output.length) return true;
    const inCh = input.length;
    const outCh = output.length;
    const frames = input[0].length;
    const ratio = Math.pow(2, this.semitones / 12);
    const step = (1 - ratio) / this.window;
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < 2; c++) {
        const src = input[Math.min(c, inCh - 1)];
        this.buffers[c][this.write] = src ? src[i] : 0;
      }
      this.phase += step;
      if (this.phase >= 1) this.phase -= 1;
      if (this.phase < 0) this.phase += 1;
      const pA = this.phase;
      const pB = pA + 0.5 >= 1 ? pA - 0.5 : pA + 0.5;
      const dA = pA * this.window;
      const dB = pB * this.window;
      const wA = Math.sin(Math.PI * pA);
      const wB = Math.sin(Math.PI * pB);
      for (let c = 0; c < outCh; c++) {
        const buf = this.buffers[Math.min(c, 1)];
        output[c][i] = (this.read(buf, dA) * wA + this.read(buf, dB) * wB) * 0.85;
      }
      this.write = (this.write + 1) % this.size;
    }
    return true;
  }
}
registerProcessor('bdv-pitch-shift', BdvPitchShift);
`;

let pitchWorkletPromise: Promise<void> | null = null;

/** Register the pitch worklet on a context (once per page). */
function loadPitchWorklet(ctx: AudioContext): Promise<void> {
  if (!pitchWorkletPromise) {
    const url = URL.createObjectURL(new Blob([PITCH_WORKLET_SOURCE], { type: "application/javascript" }));
    pitchWorkletPromise = ctx.audioWorklet.addModule(url);
  }
  return pitchWorkletPromise;
}

/** Exponential-decay noise impulse for the Reverb preset's ConvolverNode. */
function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buffer;
}

/** tanh-style saturation curve for the gritty presets (Robot / Radio / Megaphone). */
function makeDriveCurve(amount: number): Float32Array {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

interface RnnoiseModule {
  loadRnnoise: (opts: { url: string; simdUrl: string }) => Promise<ArrayBuffer>;
  RnnoiseWorkletNode: new (
    ctx: AudioContext,
    opts: { maxChannels: number; wasmBinary: ArrayBuffer },
  ) => AudioWorkletNode & { destroy?: () => void };
}

export interface VoiceIsolatorConfig {
  level?: NoiseCancellationLevel;
  input?: MediaStream | MediaStreamTrack;
  gateThresholdDb?: number;
  gateFloorGain?: number;
  effect?: string;
  onStatus?: (status: VoiceIsolatorStatus) => void;
}

export class VoiceIsolator {
  config: Required<Omit<VoiceIsolatorConfig, "input" | "onStatus">> & {
    input?: MediaStream | MediaStreamTrack;
    onStatus?: (status: VoiceIsolatorStatus) => void;
  };
  level: NoiseCancellationLevel;
  effectiveLevel: NoiseCancellationLevel;
  mlState: MlState = "idle";
  effect: string;
  onStatus: ((status: VoiceIsolatorStatus) => void) | null;

  ctx: AudioContext | null = null;
  inputStream: MediaStream | null = null;
  inputTrack: MediaStreamTrack | null = null;
  private _ownsInput = false;

  private _srcNode: MediaStreamAudioSourceNode | null = null;
  private _tapSrcNode: MediaStreamAudioSourceNode | null = null;
  private _hp: BiquadFilterNode | null = null;
  private _rnnoise: (AudioWorkletNode & { destroy?: () => void }) | null = null;
  private _gate: AudioWorkletNode | null = null;
  private _presence: BiquadFilterNode | null = null;
  private _comp: DynamicsCompressorNode | null = null;
  private _analyser: AnalyserNode | null = null;
  private _tapGain: GainNode | null = null;
  private _dest: MediaStreamAudioDestinationNode | null = null;
  private _fxIn: GainNode | null = null;
  private _fxOut: GainNode | null = null;
  private _fxNodes: AudioNode[] = [];
  private _fxOscs: OscillatorNode[] = [];
  private _fxStageFor: string | null = null;
  private _gateReady = false;
  private _running = false;
  private _mlPromise: Promise<void> | null = null;
  private _mlError: unknown = null;

  constructor(config: VoiceIsolatorConfig = {}) {
    const level = config.level && ["off", "on", "max"].includes(config.level) ? config.level : "on";
    const effect = VOICE_EFFECTS.some((e) => e.id === config.effect) ? config.effect! : "none";
    this.config = {
      level,
      gateThresholdDb: config.gateThresholdDb ?? -45,
      gateFloorGain: config.gateFloorGain ?? 0.02,
      effect,
      input: config.input,
      onStatus: config.onStatus,
    };
    this.level = level;
    this.effectiveLevel = level;
    this.effect = effect;
    this.onStatus = typeof config.onStatus === "function" ? config.onStatus : null;
  }

  /* ------------------------------------------------------------ public API */

  /** The capture-time constraints: the browser's own cancellation is layer one. */
  static micConstraints(extra: MediaTrackConstraints = {}): MediaTrackConstraints {
    return {
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      ...extra,
    };
  }

  /**
   * Ask for the microphone with browser noise suppression / echo
   * cancellation / gain control switched on.
   */
  static async acquireMic(extraConstraints: MediaTrackConstraints = {}): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new VoiceIsolatorError("UNSUPPORTED", "This browser does not support microphone capture (getUserMedia).");
    }
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: VoiceIsolator.micConstraints(extraConstraints) });
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new VoiceIsolatorError("PERMISSION_DENIED", "Microphone permission was denied. Allow microphone access in your browser, then try again.", err);
      }
      if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
        throw new VoiceIsolatorError("NO_MIC", "No microphone was found. Connect a mic, then try again.", err);
      }
      throw new VoiceIsolatorError("NO_MIC", "The microphone could not be started.", err);
    }
  }

  /**
   * Start processing. `input` may be a MediaStream, a MediaStreamTrack, or
   * omitted — in which case the mic is acquired via acquireMic().
   */
  async start(input?: MediaStream | MediaStreamTrack | null): Promise<this> {
    if (this._running) return this;
    if (typeof AudioContext === "undefined") {
      throw new VoiceIsolatorError("UNSUPPORTED", "This browser does not support Web Audio (AudioContext).");
    }
    if (input !== undefined && input !== null) this._setInput(input, false);
    if (!this.inputTrack && this.config.input) this._setInput(this.config.input, false);
    if (!this.inputTrack) {
      const mic = await VoiceIsolator.acquireMic();
      this._setInput(mic, true);
    }

    // RNNoise only speaks 48 kHz — ask for it; fall back to the default rate.
    try {
      this.ctx = new AudioContext({ sampleRate: RNNOISE_SAMPLE_RATE, latencyHint: "interactive" });
    } catch {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
    }
    if (this.ctx.state === "suspended") {
      // Never let a pending resume() hang start(): browsers hold it until a
      // user gesture lands, and some environments never grant one. The
      // graph is built either way — rendering begins the moment the
      // context starts, and callers can nudge ctx.resume() on a gesture.
      await Promise.race([
        this.ctx.resume().catch(() => undefined),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    }

    this._buildGraph();
    this._running = true;
    this._emitStatus();
    if (this.level === "max") this._ensureMl(); // async; falls back to 'on' on failure
    return this;
  }

  /** Swap the mic source mid-stream (e.g. the camera changed). Returns the current output track. */
  async setInput(input: MediaStream | MediaStreamTrack): Promise<MediaStreamTrack | null> {
    this._setInput(input, false);
    if (!this._running) return this.getOutputTrack();
    this._rewireSources();
    if (this.level === "max") this._ensureMl();
    return this.getOutputTrack();
  }

  /**
   * Switch level live: 'off' | 'on' | 'max'.
   * 'max' resolves once the standard chain is running; the ML stage joins
   * when (and if) its assets arrive, and the fallback is reported via
   * onStatus instead of thrown.
   */
  async setLevel(level: NoiseCancellationLevel): Promise<this> {
    if (!["off", "on", "max"].includes(level)) {
      throw new VoiceIsolatorError("UNSUPPORTED", `Unknown noise-cancellation level: ${level}`);
    }
    this.level = level;
    if (!this._running) {
      this.effectiveLevel = level;
      return this;
    }
    if (level !== "max" && this._rnnoise) this._removeMl();
    this.effectiveLevel = level === "max" && this.mlState !== "active" ? "on" : level;
    this._rewireChain(); // the gate belongs to the chain only above 'off'
    this._rewireSources();
    this._emitStatus();
    if (level === "max") this._ensureMl();
    return this;
  }

  /** Adjust the gate threshold (dBFS RMS) live. */
  setGateThreshold(db: number): this {
    this.config.gateThresholdDb = Number(db);
    this._gate?.port.postMessage({ thresholdDb: this.config.gateThresholdDb });
    return this;
  }

  /**
   * Select a voice-effect preset (see VOICE_EFFECTS). The effect sits after
   * noise cancellation: it hears the cleaned voice. Selecting an effect
   * while the level is 'off' runs the chain for the effect's sake — the
   * gate stays out, so the voice is shaped but not noise-cancelled — and
   * selecting 'none' at 'off' restores the true raw passthrough.
   */
  async setEffect(name: string): Promise<this> {
    if (!VOICE_EFFECTS.some((e) => e.id === name)) {
      throw new VoiceIsolatorError("UNSUPPORTED", `Unknown voice effect: ${name}`);
    }
    this.effect = name;
    this.config.effect = name;
    if (!this._running) return this;
    await this._buildEffectStage();
    this._rewireChain();
    this._rewireSources();
    return this;
  }

  /** The active voice-effect preset id. */
  getEffect(): string {
    return this.effect;
  }

  /**
   * True when audio flows through the Web Audio chain: at any NC level
   * above 'off', or whenever a voice effect is selected.
   */
  private _chainActive(): boolean {
    return this.level !== "off" || this.effect !== "none";
  }

  /** The processed (or, with the chain idle, the raw) output track. Null before start. */
  getOutputTrack(): MediaStreamTrack | null {
    if (!this._running) return null;
    if (!this._chainActive()) return this.inputTrack;
    return this._dest?.stream.getAudioTracks()[0] ?? null;
  }

  /** AnalyserNode tapped on the processed output — feed your level meter from this. */
  getAnalyser(): AnalyserNode | null {
    return this._analyser;
  }

  /** { level, effectiveLevel, mlState, fellBack, effect } — the honest state of the feature. */
  getStatus(): Omit<VoiceIsolatorStatus, "message"> {
    return {
      level: this.level,
      effectiveLevel: this.effectiveLevel,
      mlState: this.mlState,
      fellBack: this.level === "max" && this.mlState === "failed",
      effect: this.effect,
    };
  }

  /**
   * Stop processing: disconnect the graph, end the generated output track,
   * close the AudioContext. Input tracks are ended only when this isolator
   * acquired the mic itself (via start() with no input) — a caller-supplied
   * stream stays the caller's to stop.
   */
  async stop(): Promise<void> {
    this._running = false;
    try {
      this._rnnoise?.destroy?.();
    } catch {
      /* already gone */
    }
    this._rnnoise = null;
    this._disposeEffectStage();
    this._fxIn?.disconnect();
    this._fxOut?.disconnect();
    this._fxIn = null;
    this._fxOut = null;
    if (this._dest) this._dest.stream.getTracks().forEach((t) => t.stop());
    if (this._ownsInput && this.inputStream) this.inputStream.getTracks().forEach((t) => t.stop());
    this._srcNode?.disconnect();
    this._tapSrcNode?.disconnect();
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        /* already closed */
      }
    }
    this.ctx = null;
    this._dest = null;
    this._analyser = null;
    this._gate = null;
    this._mlPromise = null;
    this.mlState = "idle";
  }

  /* -------------------------------------------------------------- internal */

  private _setInput(input: MediaStream | MediaStreamTrack, owned: boolean): void {
    let track: MediaStreamTrack | null = null;
    let stream: MediaStream | null = null;
    if (typeof MediaStreamTrack !== "undefined" && input instanceof MediaStreamTrack) {
      track = input;
      stream = new MediaStream([input]);
    } else if (input && typeof (input as MediaStream).getAudioTracks === "function") {
      stream = input as MediaStream;
      track = stream.getAudioTracks()[0] ?? null;
    }
    if (!track || !stream) {
      throw new VoiceIsolatorError("NO_MIC", "No audio track was found in the supplied microphone stream.");
    }
    this.inputStream = stream;
    this.inputTrack = track as MediaStreamTrack;
    this._ownsInput = !!owned;
  }

  private _buildGraph(): void {
    const ctx = this.ctx!;

    this._analyser = ctx.createAnalyser();
    this._analyser.fftSize = 1024;
    this._analyser.smoothingTimeConstant = 0.55;

    // Analysis tap: source → analyser → silence → destination. It renders
    // even at 'off' (when the processed chain is bypassed) and never colors
    // the signal — its gain is zero.
    this._tapGain = ctx.createGain();
    this._tapGain.gain.value = 0;
    this._analyser.connect(this._tapGain);
    this._tapGain.connect(ctx.destination);

    // The processed chain.
    this._hp = ctx.createBiquadFilter();
    this._hp.type = "highpass";
    this._hp.frequency.value = 80;
    this._hp.Q.value = 0.7;

    this._presence = ctx.createBiquadFilter();
    this._presence.type = "peaking";
    this._presence.frequency.value = 2800;
    this._presence.Q.value = 0.9;
    this._presence.gain.value = 3;

    this._comp = ctx.createDynamicsCompressor();
    this._comp.threshold.value = -14;
    this._comp.knee.value = 6;
    this._comp.ratio.value = 12;
    this._comp.attack.value = 0.003;
    this._comp.release.value = 0.24;

    this._dest = ctx.createMediaStreamDestination();

    // Voice-effect stage plumbing: limiter → fxIn → [preset] → fxOut → out.
    this._fxIn = ctx.createGain();
    this._fxOut = ctx.createGain();

    // gate → presence → limiter → effect stage → destination; the analyser
    // taps the stage output so the meter shows what the audience hears.
    this._hp.connect(this._presence);
    this._presence.connect(this._comp);
    this._comp.connect(this._fxIn);
    this._fxOut.connect(this._dest);
    this._fxOut.connect(this._analyser);
    void this._buildEffectStage();

    // The gate worklet registers async; until it lands the chain runs
    // without the gate segment (filters + limiter still help).
    this._gateReady = false;
    if (ctx.audioWorklet) {
      loadGateWorklet(ctx)
        .then(() => {
          if (!this._running || !this.ctx) return;
          this._gate = new AudioWorkletNode(ctx, "bdv-noise-gate", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions: {
              thresholdDb: this.config.gateThresholdDb,
              floorGain: this.config.gateFloorGain,
            },
          });
          this._gateReady = true;
          this._rewireChain();
        })
        .catch(() => {
          /* no worklet — the chain runs gate-less */
        });
    }

    this._rewireSources();
  }

  /**
   * (Re)connect the chain's internal order: hp → [rnnoise] → [gate] →
   * presence. The gate (and RNNoise) belong to noise cancellation proper:
   * at level 'off' they stay out of the chain, so an effect running at
   * 'off' shapes the voice without noise-cancelling it.
   */
  private _rewireChain(): void {
    if (!this._hp || !this._presence) return;
    try {
      this._hp.disconnect();
    } catch {
      /* not connected yet */
    }
    try {
      this._gate?.disconnect();
    } catch {
      /* fresh node */
    }
    const ncOn = this.level !== "off";
    const gateNode = ncOn ? this._gate : null;
    const next: AudioNode = gateNode ?? this._presence;
    if (ncOn && this._rnnoise) {
      this._hp.connect(this._rnnoise);
      this._rnnoise.connect(next);
    } else {
      this._hp.connect(next);
    }
    if (gateNode) gateNode.connect(this._presence);
  }

  /** Point both source nodes at the current input stream and route by level. */
  private _rewireSources(): void {
    if (!this.ctx || !this.inputStream) return;
    if (this._srcNode) {
      try {
        this._srcNode.disconnect();
      } catch {
        /* fresh */
      }
    }
    if (this._tapSrcNode) {
      try {
        this._tapSrcNode.disconnect();
      } catch {
        /* fresh */
      }
    }
    this._srcNode = this.ctx.createMediaStreamSource(this.inputStream);
    this._tapSrcNode = this.ctx.createMediaStreamSource(this.inputStream);
    // The analyser shows what the audience hears: the raw mic when the
    // chain is idle (via the silent tap), the processed chain otherwise
    // (fed from the effect-stage output in _buildGraph — the tap stays
    // disconnected then, so the two never sum).
    if (!this._chainActive()) {
      if (this._analyser) this._tapSrcNode.connect(this._analyser);
    } else {
      this._srcNode.connect(this._hp!);
    }
  }

  /** Tear down the current effect preset: stop its oscillators, drop its nodes. */
  private _disposeEffectStage(): void {
    for (const osc of this._fxOscs) {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
    }
    this._fxOscs = [];
    for (const node of this._fxNodes) {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this._fxNodes = [];
    // fxIn's outgoing edges belong to the stage; its incoming edge (from
    // the limiter) is untouched by disconnect(), which is outgoing-only.
    try {
      this._fxIn?.disconnect();
    } catch {
      /* not built yet */
    }
    this._fxStageFor = null;
  }

  /**
   * Build the selected preset between _fxIn and _fxOut. Web Audio only.
   * If the pitch worklet can't register, Deep/High degrade to a straight
   * wire — the stream never fails over an effect.
   */
  private async _buildEffectStage(): Promise<void> {
    if (!this.ctx || !this._fxIn || !this._fxOut) return;
    const ctx = this.ctx;
    const fxIn = this._fxIn;
    const fxOut = this._fxOut;
    const effect = this.effect;
    this._disposeEffectStage();
    const keep = <T extends AudioNode>(node: T): T => {
      this._fxNodes.push(node);
      return node;
    };
    const wire = (from: AudioNode, to: AudioNode) => {
      from.connect(to);
    };
    try {
      switch (effect) {
        case "deep":
        case "high": {
          if (!ctx.audioWorklet) throw new Error("no AudioWorklet");
          await loadPitchWorklet(ctx);
          if (!this._running || this.effect !== effect) return; // superseded while loading
          const node = keep(
            new AudioWorkletNode(ctx, "bdv-pitch-shift", {
              numberOfInputs: 1,
              numberOfOutputs: 1,
              outputChannelCount: [2],
              processorOptions: { semitones: effect === "deep" ? -4 : 5 },
            }),
          );
          wire(fxIn, node);
          wire(node, fxOut);
          break;
        }
        case "robot": {
          // Ring modulation at ~30 Hz + a little grit ahead of it.
          const shaper = keep(ctx.createWaveShaper());
          shaper.curve = makeDriveCurve(6) as Float32Array<ArrayBuffer>;
          const ring = keep(ctx.createGain());
          ring.gain.value = 0; // the carrier supplies the whole gain signal
          const carrier = keep(ctx.createOscillator());
          carrier.type = "sine";
          carrier.frequency.value = 30;
          const carrierDepth = keep(ctx.createGain());
          carrierDepth.gain.value = 1;
          carrier.connect(carrierDepth);
          carrierDepth.connect(ring.gain);
          wire(fxIn, shaper);
          wire(shaper, ring);
          wire(ring, fxOut);
          carrier.start();
          this._fxOscs.push(carrier);
          break;
        }
        case "echo": {
          const delay = keep(ctx.createDelay(1));
          delay.delayTime.value = 0.18;
          const feedback = keep(ctx.createGain());
          feedback.gain.value = 0.35;
          const wet = keep(ctx.createGain());
          wet.gain.value = 0.3;
          wire(fxIn, fxOut); // dry
          wire(fxIn, delay);
          wire(delay, feedback);
          wire(feedback, delay);
          wire(delay, wet);
          wire(wet, fxOut);
          break;
        }
        case "reverb": {
          const conv = keep(ctx.createConvolver());
          conv.buffer = makeImpulse(ctx, 1.8, 2.6);
          const wet = keep(ctx.createGain());
          wet.gain.value = 0.35;
          wire(fxIn, fxOut); // dry
          wire(fxIn, conv);
          wire(conv, wet);
          wire(wet, fxOut);
          break;
        }
        case "radio": {
          // Telephone band (300–3400 Hz) + grit + a little makeup gain.
          const hp = keep(ctx.createBiquadFilter());
          hp.type = "highpass";
          hp.frequency.value = 300;
          hp.Q.value = 0.7;
          const lp = keep(ctx.createBiquadFilter());
          lp.type = "lowpass";
          lp.frequency.value = 3400;
          lp.Q.value = 0.7;
          const shaper = keep(ctx.createWaveShaper());
          shaper.curve = makeDriveCurve(10) as Float32Array<ArrayBuffer>;
          const makeup = keep(ctx.createGain());
          makeup.gain.value = 1.25;
          wire(fxIn, hp);
          wire(hp, lp);
          wire(lp, shaper);
          wire(shaper, makeup);
          wire(makeup, fxOut);
          break;
        }
        case "megaphone": {
          // Tighter band, harder drive, a short slap back.
          const hp = keep(ctx.createBiquadFilter());
          hp.type = "highpass";
          hp.frequency.value = 500;
          hp.Q.value = 0.7;
          const lp = keep(ctx.createBiquadFilter());
          lp.type = "lowpass";
          lp.frequency.value = 2800;
          lp.Q.value = 0.7;
          const shaper = keep(ctx.createWaveShaper());
          shaper.curve = makeDriveCurve(22) as Float32Array<ArrayBuffer>;
          const slap = keep(ctx.createDelay(0.5));
          slap.delayTime.value = 0.07;
          const slapGain = keep(ctx.createGain());
          slapGain.gain.value = 0.18;
          wire(fxIn, hp);
          wire(hp, lp);
          wire(lp, shaper);
          wire(shaper, fxOut);
          wire(shaper, slap);
          wire(slap, slapGain);
          wire(slapGain, fxOut);
          break;
        }
        default: {
          // 'none' — straight wire
          wire(fxIn, fxOut);
        }
      }
    } catch {
      // Any build failure degrades to the straight wire, never to silence.
      for (const node of this._fxNodes) {
        try {
          node.disconnect();
        } catch {
          /* partial build */
        }
      }
      this._fxNodes = [];
      try {
        fxIn.connect(fxOut);
      } catch {
        /* already wired */
      }
    }
    this._fxStageFor = effect;
  }

  /** Load RNNoise (vendored build first, CDN fallback) and splice it in
   *  ahead of the gate. Any failure keeps the honest fallback: level
   *  'on', mlState 'failed', the stream itself never fails. */
  private _ensureMl(): void {
    if (this._rnnoise || this.mlState === "active") return;
    if (this._mlPromise) return;
    if (!this.ctx || this.ctx.sampleRate !== RNNOISE_SAMPLE_RATE || !this.ctx.audioWorklet) {
      this.mlState = "unavailable";
      this.effectiveLevel = "on";
      this._emitStatus();
      return;
    }
    this.mlState = "loading";
    this._emitStatus();
    const ctx = this.ctx;
    this._mlPromise = (async () => {
      try {
        let lastErr: unknown = null;
        let loaded = false;
        for (const base of RNNOISE_BASES) {
          try {
            const urls = rnnoiseUrls(base);
            const mod = (await import(/* @vite-ignore */ urls.index)) as RnnoiseModule;
            const wasmBinary = await mod.loadRnnoise({ url: urls.wasm, simdUrl: urls.wasmSimd });
            await ctx.audioWorklet.addModule(urls.worklet);
            if (!this._running || !this.ctx) return; // stopped while loading
            this._rnnoise = new mod.RnnoiseWorkletNode(ctx, { maxChannels: 2, wasmBinary });
            loaded = true;
            break;
          } catch (err) {
            lastErr = err;
          }
        }
        if (!loaded) throw lastErr ?? new Error("RNNoise failed to load.");
        this.mlState = "active";
        this.effectiveLevel = "max";
        this._rewireChain();
      } catch (err) {
        this.mlState = "failed";
        this.effectiveLevel = "on";
        this._mlError = err;
      } finally {
        this._mlPromise = null;
        this._emitStatus();
      }
    })();
  }

  private _removeMl(): void {
    if (!this._rnnoise) return;
    try {
      this._rnnoise.disconnect();
    } catch {
      /* already disconnected */
    }
    try {
      this._rnnoise.destroy?.();
    } catch {
      /* already gone */
    }
    this._rnnoise = null;
    this.mlState = "idle";
    this._rewireChain();
  }

  private _emitStatus(): void {
    if (!this.onStatus) return;
    const s = this.getStatus();
    let message: string;
    if (s.level === "off") message = "Noise cancellation is off — your mic passes through unchanged.";
    else if (s.level === "max" && s.mlState === "active") message = "Noise cancellation is at Max — AI suppression plus the gate are cleaning your voice.";
    else if (s.level === "max" && s.mlState === "loading") message = "Noise cancellation is on — the AI suppression model is still loading.";
    else if (s.level === "max" && s.fellBack) message = "The AI suppression model could not load here, so standard noise cancellation is on instead.";
    else if (s.level === "max" && s.mlState === "unavailable") message = "AI suppression is unavailable in this browser, so standard noise cancellation is on instead.";
    else message = "Noise cancellation is on — room noise is being removed from your voice.";
    this.onStatus({ ...s, message });
  }
}
