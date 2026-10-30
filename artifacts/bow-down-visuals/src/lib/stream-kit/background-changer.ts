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
 * TWO engines sit behind the shared MattingEngine contract
 * (rvm-engine.ts), and `quality` — the creator's explicit pick —
 * chooses which ONE runs:
 *  - PRO — Robust Video Matting in a dedicated worker: a true
 *    video-matting model with hair-level alpha and recurrent
 *    temporal stability. 'pro' pins it; 'auto' runs it too (the
 *    perf ladder walks its internal steps — it never swaps
 *    engines).
 *  - TASKS — MediaPipe Selfie Segmenter (float16) on the
 *    maintained MediaPipe Tasks Vision runtime, VIDEO mode, GPU
 *    delegate (tasks-segmenter-engine.ts): a per-frame segmenter
 *    whose edges are cleaned the light way (MATTE_REFINEMENT_STEPS
 *    — how finely the mask is read and how much edge
 *    post-processing matte-post.ts applies). The pinned engine
 *    of 'tasks' quality.
 * ONE-ENGINE BUILD (Oct 25, 2026 — the owner's verdict on the
 * shipped two-engine build: "when I move it erases the green
 * screen"; full diagnosis in greenscreen-matting-scope-
 * 2026-10-25.md): the old 'auto' degrade — Pro handing the
 * session to the 2023 legacy Selfie Segmentation build whenever
 * its round trips crossed a line every phone crosses — is
 * DELETED, and the legacy engine is out of the live path
 * entirely (it remains only in the video editor's own background
 * feature, which loads its own copy). No engine ever replaces
 * another mid-session: an engine that can't start or can't keep
 * working parks, and the camera runs raw with the status shown.
 * The Pro/Tasks pair is a creator-facing A/B (the studio's
 * quality pills), chosen by hand and named honestly by the
 * status channel — never a silent runtime fallback. If NO
 * engine can run, the camera still starts raw — an engine
 * failure never holds the camera hostage.
 *
 * RVM RESTORED (Oct 23, 2026) — the heavy engine was REMOVED from
 * this path on Oct 18 after it froze the owner's tab when an
 * effect was picked, and the owner has now ordered it fixed and
 * put back. The freeze was never the model: it was WHERE the
 * model ran. ONNX Runtime Web executes on the calling thread
 * unless offloaded (the WASM proxy worker was never enabled; the
 * WebGPU backend orchestrates and reads back on the caller too),
 * so every frame cost the page a synchronous pixel conversion
 * PLUS the full fp32 inference, back to back, for as long as an
 * effect was on — the UI thread never got a gap. The fix
 * (rvm-engine.ts + public/engines/rvm/rvm-worker.js) moves the
 * session into a dedicated worker: frames ship in as transferred
 * bitmaps, mattes come back as transferred buffers, a frame that
 * goes unanswered past its deadline kills the worker, and every
 * failure here degrades — Pro init failure → Standard; sustained
 * Pro slowness in 'auto' → Standard; the failure-cap park falls
 * through to the other engine before it ever lands raw.
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
 * QUALITY + MOTION BUILD (Oct 23, 2026) — the owner's live verdict
 * on the freeze-fixed build was "works, but when I move it erases
 * the green screen that I moved from," and his standing order is
 * the highest level, premium. Three stacked causes, three fixes:
 *  1. FRAME-ALIGNED COMPOSITING: a matte describes the frame the
 *     engine was SENT, but the composite used to cut the person
 *     from the LIVE video — newer by the whole inference round
 *     trip — so every moving edge was wrong by that much motion:
 *     where he had just been, the stale matte still said "person"
 *     and his real room showed through the replacement (the erased
 *     green screen); where he now was, it still said "background"
 *     and the replacement painted over his body. The engine now
 *     snapshots the frame at send time and the composite cuts THAT
 *     frame with its own matte — matte and picture are always the
 *     same instant.
 *  2. MOTION-ADAPTIVE BLEND: the temporal blend (matte-post.ts)
 *     runs with motionSnap on — pixels whose matte swung hard take
 *     the new matte whole (a moved boundary lands in one frame),
 *     pixels that barely changed keep the calming blend (no
 *     flicker returns). The old fixed-weight blend lagged the
 *     subject by design: ~55% of the old matte survived every
 *     frame at the sharpest step, a visible ghost for ~4 frames.
 *  3. FULL-RESOLUTION PIPE: the camera is asked for the best it
 *     has (1920x1080 ideal, never a hard low demand) and the
 *     composite canvas runs at the feed's real size up to 1080p
 *     (it was hard-capped at 720p). The only step-down is earned:
 *     in 'auto' quality, sustained slowness at the lightest matte
 *     step drops the canvas to 720p ONCE (see _stepDownOutput) —
 *     a device that genuinely cannot hold the top, never a
 *     blanket low default. The sharpest refinement step also
 *     reads the mask finer (960px) so its feather works on more
 *     of the mask's real gradient.
 *
 * SAME-THING FIX (Stack-100 #3, Lane C — the owner retested the
 * build above on his phone and reported the Green Screen "doing
 * the same thing"). End-to-end audit of the SHIPPED path found the
 * new engines were not what his phone ever ran:
 *  1. THE 10-SECOND CAP VS A 27–37 MB COLD LOAD: engine init was
 *     capped at 10 s, a freeze-era budget from when a stalled init
 *     could hang start(). The Pro worker's cold payload — runtime
 *     script + WASM (11 MB wasm build; 22 MB on the WebGPU-first
 *     path) + the 15 MB model, plus session compile — cannot
 *     reliably land inside 10 s on a phone network, and the worker
 *     had no per-attempt deadline, so one slow WebGPU session
 *     create could eat the whole cap. Pro died on the cap and the
 *     light engine silently served. start() is raw-first now and
 *     never awaits the engine, so waiting is free: the cap is
 *     45 s (ENGINE_INIT_TIMEOUT_MS), and the worker bounds every
 *     session create and retries the next runtime base when a
 *     base's session chain fails outright.
 *  2. THE FALLBACK WAS INVISIBLE: the studio rendered the live
 *     engine as "On" for BOTH engines, so Pro, Standard, fallback
 *     and degrade were indistinguishable — the owner's report was
 *     the only one the UI made possible. The status channel now
 *     carries the truth (EngineStatusDetail): which engine is
 *     ACTUALLY live (probe-based — the adopted engine, never the
 *     configured intent), whether it is a fallback, and why Pro
 *     exited (couldn't start / too slow / stopped). The studio
 *     names the engine and shows the fallback plainly.
 *  The light engine's own motion build (frame-aligned snapshot +
 *  motion-adaptive blend) was audited IN the studio's exact code
 *  path and stands — it simply was not the whole story while the
 *  Pro engine never reached the phone.
 *
 * MOTION FIX (Oct 25, 2026 — the owner retested the build above on
 * his phone: "The green screen is not fixed"; when he MOVES, the
 * background gets erased/lost). Full diagnosis: .lane/DIAGNOSIS.md
 * in the lane worktree. What the audit of THIS path found:
 *  1. THE PICTURE ONLY MOVED WHEN A MATTE LANDED. Compositing lived
 *     exclusively in the inference promise callback, so the person
 *     rendered at the inference rate (on a phone, 2–8 fps) as a
 *     succession of send-time snapshots, each already one round
 *     trip old. The frame-aligned doctrine was correct on a fast
 *     desktop and is the wrong trade on a phone: a matte ~150 ms
 *     stale at a moving edge is a smaller, shorter error than the
 *     whole person frozen for 300–600 ms. RETIRED for the live
 *     path: the loop now composites EVERY tick from the LIVE
 *     camera frame with the latest landed matte (the Meet/Zoom
 *     arrangement); inference only replaces the matte. The
 *     send-time snapshot still rides on EngineMatte.frame for
 *     callers that want the aligned still (photo path included).
 *  2. THE STALL FALLBACK PAINTED HIS ROOM OVER THE EFFECT. Any
 *     2 s matte gap (frame-stall.ts) made the loop paint the raw
 *     camera full-frame — and the stall clock ran during ordinary
 *     in-flight inference, so on a phone the green screen was
 *     repeatedly replaced by his actual room. The stall STATUS
 *     still reports honestly; the painting never goes raw over a
 *     backdrop again once a matte exists.
 *  3. THE PERF LADDERS WERE CALIBRATED IN DESKTOP MILLISECONDS
 *     (slowMs 46 on ROUND-TRIP times no phone sustains), so 'auto'
 *     on a phone always marched Pro down its steps, degraded to
 *     Standard, walked its refinement to the floor and dropped
 *     the output to 720p. With compositing decoupled from
 *     inference, a 200 ms matte update is perfectly usable; the
 *     ladders now rescue only sustained drowning (Pro slowMs 200,
 *     Standard slowMs 150).
 *  4. MEDIAPIPE'S 1 s SEND TIMEOUT discarded late results (and
 *     could mispair one send's mask with the next send's
 *     snapshot), wrote an invented ≥1000 ms sample into the perf
 *     ladder, and counted toward the 30-failure park. A send is
 *     now one episode that settles on its own result whenever it
 *     lands (pairing can never cross sends), capped at
 *     MEDIAPIPE_SEND_CAP_MS; a result that lands after the cap is
 *     proof of life and resets the failure run instead of being
 *     dropped.
 *  5. THE DESPILL PIXEL PASS ran on every composite at up to
 *     1080p on the main thread — the same thread MediaPipe's
 *     results callback needs. It now runs when a matte lands and
 *     at most every 3rd tick; per-tick compositing is canvas draw
 *     ops only.
 *
 * Audio: pass `audio: true` to carry the mic, and `noiseCancellation:
 * 'on' | 'max'` to run it through the VoiceIsolator (voice-isolator.ts)
 * first — the output stream then holds the processed picture and the
 * cleaned voice together.
 */

import { VoiceIsolator, VOICE_EFFECTS, type NoiseCancellationLevel, type VoiceIsolatorStatus } from "./voice-isolator";
/* The shared matting contract AND the Pro engine's worker client
   (rvm-engine.ts). Constructing RvmEngine loads nothing into this
   page — the ONNX runtime and the model load inside its dedicated
   worker (public/engines/rvm/rvm-worker.js); the still-photo
   matting path (photo-matting.ts) drives the same client. */
import { RvmEngine, RvmEngineError, RVM_MAX_STEP, type EngineMatte, type MattingEngine } from "./rvm-engine";
import { TasksSegmenterEngine, TasksSegmenterError, TASKS_MAX_STEP } from "./tasks-segmenter-engine";
import { MattePostProcessor, despillRgba } from "./matte-post";
import {
  sanitizeFineTune,
  composeMattePostOptions,
  despillRetentionFor,
  backdropFilterFor,
  MATTE_BASE_DEFAULTS,
  type GreenScreenFineTune,
  type MatteBaseTuning,
} from "./greenscreen-finetune";

export type { GreenScreenFineTune } from "./greenscreen-finetune";
import { PerfLadder } from "./perf-ladder";
import { FrameStallTracker } from "./frame-stall";
import { mediaUrl } from "../media-cdn";

const GREEN = "#00FF00";

/**
 * The camera-effects library. The UI renders its preset row from this
 * array; growing the library = adding an entry here plus its grade /
 * overlay in CAMERA_EFFECT_FILTERS / _compositeLive(). Grades are cheap
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
 * Background quality — which matting engine runs and how its
 * quality steps are governed (see the header note). The creator
 * picks the engine by hand; nothing ever switches engines under
 * them:
 *  - 'pro': the Pro engine (RVM in its worker). The perf ladder
 *    may retune its internal step, but pro NEVER switches
 *    engines — if the Pro engine can't initialise or parks, the
 *    camera runs raw with the status shown.
 *  - 'auto' (default): the Pro engine, with the ladder walking
 *    its steps on sustained slowness and the output step-down
 *    at the floor. Identical engine to 'pro'; only the ladder
 *    starts more willing to move.
 *  - 'tasks': the MediaPipe Tasks engine, with its own ladder
 *    walking the matte-refinement steps (feed cap + edge
 *    post-processing together) and the output step-down at its
 *    floor.
 */
export type BackgroundQuality = "auto" | "pro" | "tasks";

/** Which background engine is live ('off' = raw camera). */
export type BackgroundEngineKind = "pro" | "tasks" | "off";

/**
 * Why the wanted engine is not the live engine, when it was
 * wanted (one-engine build: the only way an engine exits now is
 * failing to start or parking — there is no degrade):
 *  - 'pro-init-failed' / 'tasks-init-failed': the engine could
 *    not start on this device (load failure, init timeout,
 *    unsupported browser).
 *  - 'pro-stopped' / 'tasks-stopped': the engine was live and
 *    its inferences failed until it parked for the session (the
 *    failure cap).
 */
export type EngineFallbackReason = "pro-init-failed" | "pro-stopped" | "tasks-init-failed" | "tasks-stopped";

/**
 * The engine truth, as adopted — PROBE-BASED, never intent-based:
 * `kind` is the engine actually compositing right now, `fellBack`
 * says the engine the configured quality wanted exited and is not
 * live, and `reason` says why it exited (null while the wanted
 * engine is live, or when no engine is live by choice / at all).
 * One-engine build: nothing is ever "serving" in the wanted
 * engine's place — a fellBack detail always pairs with kind 'off'
 * (camera raw, reason shown). Reported through
 * config.onEngineStatusDetail alongside every onEngineStatus kind
 * change, and readable any time via getEngineStatusDetail(). The
 * studio renders this verbatim — a fallback is VISIBLE, never a
 * silent "On" (Stack-100 #3 Lane C).
 */
export interface EngineStatusDetail {
  kind: BackgroundEngineKind;
  fellBack: boolean;
  reason: EngineFallbackReason | null;
}

/**
 * Matte-refinement steps, sharpest first — the light way to cleaner
 * edges on the MediaPipe Tasks engine's mask. Each step sets how
 * wide the mask is read (the Tasks engine's feed cap, in
 * TASKS_STEPS — aligned with `maskCap` here by index: the feed
 * IS the mask read) and how the shared matte post-processing
 * (matte-post.ts) is tuned: the sharpest step reads finer, blends
 * a little more history (less flicker), chokes the fringe a
 * little less hard, opens the levels curve a touch (less hair
 * eaten), and feathers twice for a soft rim. The balanced step is
 * byte-for-byte the behaviour that shipped before refinement
 * steps existed (480px read, the MattePostProcessor defaults);
 * the lightest step sheds read width for the weakest devices.
 * The perf ladder walks these steps while the TASKS engine is
 * live; at the lightest step the ladder's degrade verdict steps
 * the output canvas down (there is nowhere lighter to go).
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
  { maskCap: 960, emaWeight: 0.45, choke: 0.04, curveLo: 0.05, curveHi: 0.92, featherPasses: 2 },
  { maskCap: 480, emaWeight: 0.55, choke: 0.05, curveLo: 0.06, curveHi: 0.94, featherPasses: 1 },
  { maskCap: 384, emaWeight: 0.6, choke: 0.05, curveLo: 0.06, curveHi: 0.94, featherPasses: 1 },
];
export const MATTE_MAX_STEP = MATTE_REFINEMENT_STEPS.length - 1;

/**
 * Matte-post tuning while the PRO engine is live: as close to
 * identity as the pipeline allows. RVM's alpha is already soft,
 * hair-level, and temporally stable from its own recurrence — a
 * second temporal blend would only re-add motion lag, and the
 * choke / levels curve / feather were built to repair the light
 * engine's hard mask: applied here they would eat exactly the
 * hair detail the Pro engine exists to keep. (Single-frame
 * callers — the still-photo path — use emaWeight 1 the same way.)
 */
export const PRO_MATTE_POST = {
  emaWeight: 1,
  choke: 0,
  curveLo: 0,
  curveHi: 1,
  featherPasses: 0,
} as const;

/**
 * Hard cap on ONE engine's initialisation (ms). A stalled load —
 * a hung script fetch, a compile that never returns — must not
 * wedge selection forever: past this the engine reads as
 * unavailable and selection moves on.
 *
 * 45 s, sized by the Pro engine's real cold payload (runtime +
 * WASM + the 15 MB model + session compile ≈ 27–37 MB before the
 * first frame) on a phone network. The freeze-era 10 s cap made
 * sense when a stalled init could hang start(); start() is
 * raw-first now and never awaits the engine, so a generous cap
 * costs the creator nothing — the camera is already live — while
 * the 10 s cap cost the Pro engine its life on real phones
 * (Stack-100 #3 Lane C: the owner's "still the same thing" —
 * Pro died on this cap and the light engine silently served).
 */
export const ENGINE_INIT_TIMEOUT_MS = 45_000;

/**
 * Output-canvas height caps (px). A session STARTS at the top cap:
 * the composite canvas runs at the camera feed's real size up to
 * 1080p. The floor is the governed step-down (auto quality only,
 * sustained slowness at the lightest matte step — see
 * _stepDownOutput): the one sanctioned reduction, earned by the
 * device's measured performance, never a default.
 */
export const OUTPUT_HEIGHT_CAP = 1080;
export const OUTPUT_HEIGHT_FLOOR = 720;

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

export interface BackgroundChangerConfig {
  mode?: BackgroundMode;
  /** Background engine quality (see BackgroundQuality). Default 'auto'. */
  quality?: BackgroundQuality;
  /** Hard cap on engine initialisation (ms). Default ENGINE_INIT_TIMEOUT_MS. */
  engineInitTimeoutMs?: number;
  /** Fired whenever the live background engine changes
   *  ('pro' | 'tasks' | 'off') — the studio shows it as the
   *  honest "Background engine: On / Off" status. */
  onEngineStatus?: (kind: BackgroundEngineKind) => void;
  /** Fired alongside onEngineStatus with the full engine truth
   *  (EngineStatusDetail): which engine is ACTUALLY live, whether
   *  it is a fallback from the wanted Pro engine, and why Pro
   *  exited. The studio names the live engine and shows a
   *  fallback plainly instead of dressing it up as "On". */
  onEngineStatusDetail?: (detail: EngineStatusDetail) => void;
  image?: string | File | Blob | HTMLImageElement | null;
  blurAmount?: number;
  /** The creator's green-screen fine-tune settings
   *  (greenscreen-finetune.ts): offsets over the engines' own
   *  matte tuning + the despill strength + the backdrop blur/dim.
   *  Partial — missing fields take the defaults, and at the
   *  defaults the pipeline is the shipped one, value for value.
   *  An explicit blurAmount still wins the blur when fineTune
   *  carries none. Change live any time with setFineTune(). */
  fineTune?: Partial<GreenScreenFineTune>;
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
}

export class BackgroundChanger {
  config: Required<Omit<BackgroundChangerConfig, "image" | "onNoiseStatus" | "onEngineStatus" | "onEngineStatusDetail" | "deviceId" | "fineTune">> & {
    image: BackgroundChangerConfig["image"];
    onNoiseStatus: BackgroundChangerConfig["onNoiseStatus"];
    onEngineStatus: BackgroundChangerConfig["onEngineStatus"];
    onEngineStatusDetail: BackgroundChangerConfig["onEngineStatusDetail"];
    deviceId: string | null;
    fineTune: GreenScreenFineTune;
  };
  mode: BackgroundMode;
  mirror: boolean;
  blurAmount: number;
  deviceId: string | null;
  isolator: VoiceIsolator | null = null;
  noiseStatus: (VoiceIsolatorStatus & { error?: unknown }) | null = null;
  stream: MediaStream | null = null;
  outputStream: MediaStream | null = null;
  private _engineError: BackgroundChangerError | null = null;
  /* The live background engine behind the shared MattingEngine
     contract (Pro or Standard); null = raw camera ("Off"). */
  private _engine: MattingEngine | null = null;
  private _engineKind: BackgroundEngineKind = "off";
  /* Consecutive inference failures against the live engine; reset
     by every landed matte and every engine swap. Past
     MAX_CONSECUTIVE_INFERENCE_FAILURES the engine parks. */
  private _consecutiveInferenceFailures = 0;
  /* Engine kinds parked this session (see _parkEngine). There
     is one candidate per quality now, so a park always lands
     the camera raw — no other engine is dressed up as the
     effect in its place. A parked kind is never revived
     implicitly — only a fresh start() (a new session) clears
     the parks. */
  private readonly _parkedKinds = new Set<"pro" | "tasks">();
  /* The error a parked engine reports; re-asserted by _selectEngine
     so the honest unavailable note survives a trip through raw
     mode and back. */
  private _parkError: BackgroundChangerError | null = null;
  /* Why the wanted engine last exited (init failure / park), or
     null while it is live or was never wanted. Set by the path
     that retires the engine, read by _reportStatusDetail when
     the next state is reported — this is what makes an engine
     exit VISIBLE with its real reason instead of a silent "On". */
  private _exitReason: EngineFallbackReason | null = null;
  /* The last reported engine truth (see EngineStatusDetail). */
  private _statusDetail: EngineStatusDetail = { kind: "off", fellBack: false, reason: null };
  /* When the live engine arrived mid-session (the fade-in clock),
     or null when no fade is in progress. */
  private _engineFadeStart: number | null = null;
  /* Bumped on every engine swap/stop so in-flight frames from a
     retired engine can never composite (or un-block the loop). */
  private _engineEpoch = 0;
  private _busy = false;
  private readonly _frameStall = new FrameStallTracker(0);
  /* Governs the matte-refinement steps while the TASKS engine
     is live: sustained slowness sheds edge work (feed cap +
     post-processing together), sustained speed restores it.
     Thresholds are ROUND-TRIP numbers (motion fix, Oct 25,
     2026): the ladder is fed send→results times, and with
     compositing decoupled from inference a ~150 ms matte update
     is perfectly usable — the old desktop-tuned slowMs 46
     marched every phone to the floor. The ladder now rescues
     only sustained drowning. */
  private readonly _perfTasks = new PerfLadder({ maxStep: TASKS_MAX_STEP, slowMs: 150, fastMs: 45 });
  /* Governs the Pro engine's internal steps (RVM_STEPS) while it
     is live: active in 'auto' AND 'pro' — a step retune is not an
     engine switch. At the Pro floor its 'degrade' verdict simply
     holds the floor step (one-engine build: there is no second
     engine to degrade TO). Same round-trip calibration: an RVM
     frame that lands every ~200 ms still drives a good live
     composite, so only sustained slowness past that sheds steps. */
  private readonly _perfPro = new PerfLadder({ maxStep: RVM_MAX_STEP, slowMs: 200, fastMs: 60 });
  /* The studio's matte pipeline runs the MOTION-ADAPTIVE blend
     (motionSnap): calm where the subject is still, instant where
     it moved — the still-photo path builds its own processor
     without it and is untouched. */
  private readonly _mattePost = new MattePostProcessor({ motionSnap: 1 });
  /* The creator's fine-tune settings (greenscreen-finetune.ts) and
     the BASE matte tuning the live engine state dictates (the
     Tasks step's values / the Pro tuning / the processor
     defaults). The pipeline always runs the COMPOSITION of the
     two (_applyMatteTuning): a ladder retune rewrites the base
     and re-derives; a fine-tune change rewrites the offsets and
     re-derives. Neither side stomps the other. */
  private _fineTune: GreenScreenFineTune;
  private _matteBase: MatteBaseTuning = { ...MATTE_BASE_DEFAULTS };
  /* The session's output-canvas height cap: starts at the top
     (OUTPUT_HEIGHT_CAP); the perf governor can step it down once
     to the floor on a device that genuinely cannot hold the top. */
  private _canvasCapH = OUTPUT_HEIGHT_CAP;
  /* The latest landed matte, post-processed and rasterised into
     _matteCanvas by _storeLandedMatte, tagged with the engine
     epoch that produced it. The loop composites the LIVE camera
     frame with this matte on every tick (motion fix, Oct 25,
     2026 — see the header note); inference only replaces it. An
     epoch mismatch means the matte belongs to a retired engine
     and is never painted. */
  private _liveMatte: { epoch: number; width: number; height: number } | null = null;
  /* A matte landed since the last composite — the despill pass
     runs on those composites (and on a slow cadence otherwise),
     instead of paying the full-frame pixel pass every tick. */
  private _liveMatteFresh = false;
  private _compositeCount = 0;
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
    /* Fine-tune resolution: the settings sanitize whole, and an
       explicit blurAmount (the kit's older knob) still wins the
       blur when the fine-tune carries none — after which the
       settings adopt it, so getFineTune() always reports the
       blur the compositor is actually running. */
    const fineTune = sanitizeFineTune(config.fineTune);
    if (config.fineTune?.blur === undefined && config.blurAmount !== undefined) {
      fineTune.blur = sanitizeFineTune({ blur: config.blurAmount }).blur;
    }
    this._fineTune = fineTune;
    this.config = {
      /* Default mode is "none" (Original/raw): backdrop effects are
         opt-in per session, so the engine path is never the
         default path (freeze fix, part 2). An explicit mode from
         the caller always wins. */
      mode: config.mode ?? "none",
      quality: config.quality ?? "auto",
      engineInitTimeoutMs: config.engineInitTimeoutMs ?? ENGINE_INIT_TIMEOUT_MS,
      onEngineStatus: config.onEngineStatus,
      onEngineStatusDetail: config.onEngineStatusDetail,
      image: config.image ?? null,
      blurAmount: fineTune.blur,
      fineTune,
      mirror: config.mirror ?? false,
      audio: config.audio ?? false,
      noiseCancellation: config.noiseCancellation ?? false,
      onNoiseStatus: config.onNoiseStatus,
      voiceEffect: config.voiceEffect ?? "none",
      cameraEffect: config.cameraEffect ?? "none",
      /* Ask for the best the device has: 1080p as an IDEAL (never
         an exact demand a weaker camera would fail on) — the old
         720p-class default never even asked a 1080p camera for
         more. The composite honours what actually arrives. */
      width: config.width ?? 1920,
      height: config.height ?? 1080,
      fps: config.fps ?? 30,
      deviceId: config.deviceId ?? null,
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
    this._parkedKinds.clear();
    this._parkError = null;
    this._exitReason = null;
    this._consecutiveInferenceFailures = 0;
    /* A fresh session starts at the TOP output cap again — a
       previous session's governed step-down never follows the
       creator into a new one. */
    this._canvasCapH = OUTPUT_HEIGHT_CAP;
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
    if (!source) {
      if (this._backdropUrl) {
        URL.revokeObjectURL(this._backdropUrl);
        this._backdropUrl = null;
      }
      this._backdrop = null;
      return this;
    }
    if (source instanceof HTMLImageElement) {
      if (this._backdropUrl) {
        URL.revokeObjectURL(this._backdropUrl);
        this._backdropUrl = null;
      }
      this._backdrop = source;
      return this;
    }
    const url = typeof source === "string" ? source : URL.createObjectURL(source);
    const img = new Image();
    img.crossOrigin = "anonymous";
    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new BackgroundChangerError("UNSUPPORTED", "That backdrop image could not be loaded."));
        img.src = url;
      });
    } catch (err) {
      /* A failed load keeps the PREVIOUS backdrop exactly as it was:
         its object URL is revoked only once a new image has actually
         landed (below), and the failed pick's own URL is cleaned up.
         A bad photo never costs the creator the background they had. */
      if (typeof source !== "string") URL.revokeObjectURL(url);
      throw err;
    }
    if (this._backdropUrl) URL.revokeObjectURL(this._backdropUrl);
    this._backdropUrl = typeof source === "string" ? null : url;
    this._backdrop = img;
    return this;
  }

  /** Whether a backdrop image is currently loaded for mode 'image'. */
  hasBackdrop(): boolean {
    return this._backdrop !== null;
  }

  /** Set blur strength (px) for mode 'blur'. The fine-tune
   *  settings adopt the value (range-clamped there) so the two
   *  knobs never tell different stories. */
  setBlur(amount: number): this {
    this.blurAmount = Math.max(0, Number(amount) || 0);
    this._fineTune = { ...this._fineTune, blur: sanitizeFineTune({ blur: this.blurAmount }).blur };
    this.config.fineTune = this._fineTune;
    return this;
  }

  /**
   * Apply the creator's green-screen fine-tune settings live
   * (greenscreen-finetune.ts): the matte composition re-derives
   * over the CURRENT base tuning on the very next landed matte,
   * the despill strength and the backdrop dim read the settings
   * on the very next composite, and the blur is the compositor's
   * own blurAmount. Partial patches merge over the live settings;
   * every value is range-sanitized on the way in.
   */
  setFineTune(patch: Partial<GreenScreenFineTune>): this {
    this._fineTune = sanitizeFineTune({ ...this._fineTune, ...patch });
    this.config.fineTune = this._fineTune;
    this.blurAmount = this._fineTune.blur;
    this.config.blurAmount = this._fineTune.blur;
    this._applyMatteTuning();
    return this;
  }

  /** The fine-tune settings currently in force (a copy). */
  getFineTune(): GreenScreenFineTune {
    return { ...this._fineTune };
  }

  /** Re-derive the matte pipeline's tuning: the live base (engine
   *  step / Pro tuning / processor defaults) composed with the
   *  creator's fine-tune offsets. Called whenever either side
   *  moves — an engine adoption, a ladder retune, a fine-tune
   *  change — so the two never stomp each other. */
  private _applyMatteTuning(): void {
    this._mattePost.configure(composeMattePostOptions(this._matteBase, this._fineTune));
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

  /** Which background engine is live: 'pro' | 'tasks' | 'off'. */
  getEngineKind(): BackgroundEngineKind {
    return this._engineKind;
  }

  /**
   * The full engine truth (EngineStatusDetail): the engine
   * ACTUALLY live, whether it is a fallback from the wanted Pro
   * engine, and why Pro exited. Mirrors the last
   * onEngineStatusDetail report; before any engine settles it
   * reads { kind: 'off', fellBack: false, reason: null }.
   */
  getEngineStatusDetail(): EngineStatusDetail {
    return this._statusDetail;
  }

  /**
   * Compute, store, and report the engine truth for a kind change.
   * `fellBack` reads "the wanted engine exited": the configured
   * quality's engine is not the live kind and its exit reason is
   * on record. With one engine per quality there is no substitute
   * serving in its place, so a fellBack detail always pairs with
   * kind 'off' (camera raw) — and raw-by-choice (mode 'none')
   * clears the record before reporting (see _teardownEngine), so
   * a deliberate Original never reads as a fallback.
   */
  private _reportStatusDetail(kind: BackgroundEngineKind): void {
    const wanted = this.config.quality === "tasks" ? "tasks" : "pro";
    const fellBack = kind !== wanted && this._exitReason !== null;
    this._statusDetail = { kind, fellBack, reason: fellBack ? this._exitReason : null };
    if (typeof this.config.onEngineStatusDetail === "function") {
      this.config.onEngineStatusDetail(this._statusDetail);
    }
  }

  /**
   * The Pro engine's internal step currently in force (index into
   * RVM_STEPS). The ladder restarts at the sharpest step (0) on
   * every Pro adoption; 'auto' and 'pro' both let it retune.
   */
  getProStep(): number {
    return this._perfPro.step;
  }

  /**
   * The matte-refinement step currently in force (index into
   * MATTE_REFINEMENT_STEPS). Only the Tasks engine runs under
   * refinement steps: for it this is wherever its perf ladder
   * currently sits. The Pro engine reports 0 — it has its own
   * internal steps (see getProStep).
   */
  getRefinementStep(): number {
    return this._refinementStep();
  }

  /**
   * The Tasks engine's ladder step currently in force (index
   * into TASKS_STEPS / MATTE_REFINEMENT_STEPS). 0 when the Tasks
   * engine has not run this session.
   */
  getTasksStep(): number {
    return this._perfTasks.step;
  }

  /** The configured background quality ('auto' | 'pro' | 'tasks'). */
  getQuality(): BackgroundQuality {
    return this.config.quality;
  }

  /**
   * Switch background quality live. Re-runs engine selection
   * against the new setting (the camera never stops): the new
   * quality's engine takes over — the Pro engine for
   * 'auto'/'pro', the Tasks engine for 'tasks' — and each engine
   * lands at the top of its own ladder. Like start(), an engine
   * failure lands raw and is reported through getEngineKind() /
   * engineError / onEngineStatus, never thrown. This is the
   * creator's A/B switch: it moves only when the creator moves
   * it.
   */
  async setQuality(quality: BackgroundQuality): Promise<void> {
    if (!["auto", "pro", "tasks"].includes(quality)) {
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
   * every failure path lands on the next candidate, and when no
   * candidate can run it lands raw with engineError set and
   * onEngineStatus fired.
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

  /** The engine kind the configured quality runs — exactly one
   *  (one-engine build): 'tasks' runs the MediaPipe Tasks engine;
   *  'auto' and 'pro' run the Pro engine (see BackgroundQuality).
   *  A parked kind is filtered out by the caller, and then the
   *  session stays raw — no substitute engine exists. */
  private _engineCandidates(): Array<"pro" | "tasks"> {
    return this.config.quality === "tasks" ? ["tasks"] : ["pro"];
  }

  private async _runEngineSelection(): Promise<void> {
    /* Raw mode never selects an engine (Flag E-1) — including a
       selection that was already in flight when the mode flipped. */
    if (this.mode === "none") {
      await this._teardownEngine();
      return;
    }
    const candidates = this._engineCandidates().filter((kind) => !this._parkedKinds.has(kind));
    if (candidates.length === 0) {
      /* Every engine this quality could run is parked for the
         session: re-assert the park error + status so the honest
         unavailable note survives, and never revive a parked
         engine here — only a fresh start() clears the parks. */
      this._engineError = this._parkError;
      if (typeof this.config.onEngineStatus === "function") this.config.onEngineStatus("off");
      this._reportStatusDetail("off");
      return;
    }
    let firstError: unknown = null;
    for (const kind of candidates) {
      try {
        const engine: MattingEngine = kind === "pro" ? new RvmEngine() : new TasksSegmenterEngine();
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
        return;
      } catch (err) {
        /* The engine's exit is recorded with its reason BEFORE
           the raw state is adopted, so the status detail can say
           "Pro couldn't start" (camera plain, reason shown)
           instead of a silent "On". */
        this._exitReason = kind === "pro" ? "pro-init-failed" : "tasks-init-failed";
        firstError = firstError ?? err;
      }
    }
    await this._swapEngine(null, firstError);
  }

  /**
   * Initialise an engine under the hard init timeout (freeze fix,
   * part 3). A stalled init — a script fetch that never answers, a
   * compile that never returns — rejects with a CDN_LOAD_FAILED
   * timeout error instead of hanging the caller forever. The
   * orphaned engine is disposed whenever its init eventually
   * settles, so a late success never leaks a live engine nobody
   * owns; a late failure is swallowed for the same reason (the
   * timeout already reported the outcome).
   */
  private async _initEngine(engine: MattingEngine): Promise<void> {
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
   * stood down (disposed) rather than retried frame after frame.
   * The park is PER KIND, and with one engine per quality there
   * is nothing to fall through to: the park presents as
   * engine-down (raw picture, honest note, the exit reason on the
   * status detail) — never as another engine quietly serving in
   * its place. Only a fresh start() — a new session — clears the
   * parks.
   */
  private async _parkEngine(): Promise<void> {
    const engine = this._engine;
    if (!engine || this._parkedKinds.has(engine.kind)) return;
    this._parkedKinds.add(engine.kind);
    this._exitReason = engine.kind === "pro" ? "pro-stopped" : "tasks-stopped";
    this._parkError = new BackgroundChangerError(
      "SEGMENTATION_FAILED",
      "Background effects stopped working, so your camera is running plain.",
    );
    /* Stand the parked engine down quietly (no status yet): the
       engine-down adoption below reports the status. */
    this._engineEpoch++;
    this._engine = null;
    this._engineKind = "off";
    this._engineFadeStart = null;
    this._consecutiveInferenceFailures = 0;
    this._busy = false;
    this._frameStall.reset(performance.now());
    try {
      await engine.dispose();
    } catch {
      /* already disposed */
    }
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
      !this._parkedKinds.has(this._engine.kind)
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
    this._engineError = null;
    /* Raw is a CHOICE here, not a fallback: the Pro exit record
       clears so the detail reports a plain 'off'. */
    this._exitReason = null;
    this._mattePost.reset();
    if (old) {
      try {
        await old.dispose();
      } catch {
        /* already disposed */
      }
    }
    if (typeof this.config.onEngineStatus === "function") this.config.onEngineStatus(this._engineKind);
    this._reportStatusDetail(this._engineKind);
  }

  /** Adopt a new live engine (or none), retiring the previous one.
   *  Adoption applies the step policy the engine kind runs under:
   *  the Pro engine restarts its internal ladder at the sharpest
   *  step with the near-identity Pro matte-post tuning; the
   *  Tasks engine restarts its refinement ladder at the sharpest
   *  step. Landing raw (next = null) reports the recorded exit
   *  reason through the status detail. */
  private async _swapEngine(next: MattingEngine | null, cause?: unknown): Promise<void> {
    const old = this._engine;
    this._engineEpoch++;
    this._engine = next;
    this._engineKind = next ? next.kind : "off";
    /* An engine arriving while the session is already running
       fades its effect in over the raw picture instead of cutting
       to it (raw-first start, lazy setMode load, quality switch). */
    this._engineFadeStart = next && this._running ? performance.now() : null;
    this._consecutiveInferenceFailures = 0;
    this._busy = false;
    this._frameStall.reset(performance.now());
    this._mattePost.reset();
    if (next) {
      if (next.kind === "pro") {
        /* A fresh Pro engine starts at the sharpest internal step:
           the ladder restarts, and the matte post-processing takes
           the Pro tuning (the model's own alpha, un-repaired) as
           the BASE — the creator's fine-tune offsets compose over
           it, so an engine swap never stomps their hand. */
        this._perfPro.reset();
        (next as RvmEngine).setStep(this._perfPro.step);
        this._matteBase = { ...PRO_MATTE_POST };
        this._applyMatteTuning();
      } else {
        /* A fresh Tasks engine starts at the sharpest refinement
           step: its ladder restarts and applies feed cap + matte
           post-processing together (_applyTasksStep). */
        this._perfTasks.reset();
        this._applyTasksStep(next as TasksSegmenterEngine, this._perfTasks.step);
      }
    }
    this._engineError = next
      ? null
      : cause instanceof BackgroundChangerError
        ? cause
        : cause instanceof RvmEngineError || cause instanceof TasksSegmenterError
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
    /* The wanted engine live again: any earlier exit record is
       history. (An adopted engine is always the wanted one —
       one candidate per quality.) */
    if (next) this._exitReason = null;
    if (typeof this.config.onEngineStatus === "function") this.config.onEngineStatus(this._engineKind);
    this._reportStatusDetail(this._engineKind);
  }

  /** The refinement step in force right now: the Tasks ladder's
   *  position while the Tasks engine is live; 0 otherwise (the
   *  Pro engine runs no refinement steps). */
  private _refinementStep(): number {
    return this._engine?.kind === "tasks" ? this._perfTasks.step : 0;
  }

  /** Apply a refinement step to the Tasks engine + matte
   *  pipeline: the engine's feed cap (TASKS_STEPS, aligned with
   *  MATTE_REFINEMENT_STEPS by index) and the matte
   *  post-processing's edge settings move together. */
  private _applyTasksStep(engine: TasksSegmenterEngine, step: number): void {
    const def = MATTE_REFINEMENT_STEPS[Math.max(0, Math.min(MATTE_MAX_STEP, step))];
    engine.setStep(step);
    /* The step's tuning becomes the BASE; the creator's fine-tune
       offsets compose over it (greenscreen-finetune.ts), so a
       ladder retune moves the engine's share and keeps theirs. */
    this._matteBase = {
      emaWeight: def.emaWeight,
      choke: def.choke,
      curveLo: def.curveLo,
      curveHi: def.curveHi,
      featherPasses: def.featherPasses,
    };
    this._applyMatteTuning();
  }

  /** Feed the live engine's latest round-trip time to its perf
   *  ladder and act on the decision. Each engine's ladder walks
   *  ITS OWN steps only (a step retune is not an engine switch):
   *  the Pro ladder walks RVM_STEPS in 'auto' AND 'pro', and at
   *  its floor the 'degrade' verdict simply holds the floor step
   *  — the one-engine build has no second engine to degrade to,
   *  and a floor-step Pro matte still lands every round trip.
   *  The Tasks ladder walks the refinement steps, and at ITS
   *  floor the degrade verdict steps the output canvas down
   *  (below). */
  private _governPerf(engine: MattingEngine): void {
    if (engine.kind === "pro") {
      const rvm = engine as RvmEngine;
      const ms = rvm.lastMs;
      if (ms === null) return;
      rvm.lastMs = null;
      const action = this._perfPro.sample(ms);
      if (action === "step-down" || action === "step-up") {
        rvm.setStep(this._perfPro.step);
      }
      return;
    }
    this._governTasksPerf(engine as TasksSegmenterEngine);
  }

  /** The Tasks engine's governance (see _governPerf): feed its
   *  latest round-trip time to the refinement ladder and act on
   *  its decision. A step change retunes the refinement (feed cap
   *  + matte post-processing together). The ladder's 'degrade'
   *  verdict (sustained slowness AT the lightest matte step)
   *  steps the OUTPUT canvas down once — the engine is already
   *  at its lightest, but there is a smaller picture the device
   *  may hold, and dropping to it beats dropping frames. */
  private _governTasksPerf(engine: TasksSegmenterEngine): void {
    const ms = engine.lastMs;
    if (ms === null) return;
    engine.lastMs = null;
    const action = this._perfTasks.sample(ms);
    if (action === "step-down" || action === "step-up") {
      this._applyTasksStep(engine, this._perfTasks.step);
    } else if (action === "degrade") {
      this._stepDownOutput();
    }
  }

  /**
   * The governor's one output step-down: the session's canvas cap
   * drops from 1080p to 720p and the live canvases resize to it.
   * Fires at most once per session (the cap check) and only from
   * the ladder's sustained-slowness verdict at the matte floor —
   * a device that genuinely cannot hold the top. A fresh start()
   * restores the top cap. Resizing clears the canvas; the same
   * loop tick composites the landed matte at the new size, and the
   * captureStream track carries the new size from that frame on.
   */
  private _stepDownOutput(): void {
    if (this._canvasCapH <= OUTPUT_HEIGHT_FLOOR) return;
    this._canvasCapH = OUTPUT_HEIGHT_FLOOR;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (!W || !H || H <= OUTPUT_HEIGHT_FLOOR) return;
    const scale = OUTPUT_HEIGHT_FLOOR / H;
    this.canvas.width = Math.round(W * scale);
    this.canvas.height = Math.round(H * scale);
    this._person.width = this.canvas.width;
    this._person.height = this.canvas.height;
    this._buildOverlays(this.canvas.width, this.canvas.height);
    /* The matte geometry the post pipeline holds is unchanged (it
       keys off the matte's own size), but its temporal state was
       earned at the old framing — reseed it rather than blend
       across the resize. */
    this._mattePost.reset();
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
    // Size the canvases from the real feed at its full size, under
    // the session's output cap (1080p at session start; the
    // governor's earned step-down can lower it — _stepDownOutput).
    // The old flat 720p cap threw away a 1080p camera's picture
    // before anything else got a say.
    const w = this._video.videoWidth || this.config.width;
    const hgt = this._video.videoHeight || this.config.height;
    const scale = Math.min(1, this._canvasCapH / hgt);
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
   * Render loop (motion fix, Oct 25, 2026 — see the header note).
   * Compositing and inference are DECOUPLED: every tick composites
   * the LIVE camera frame with the latest landed matte, so the
   * person's motion renders at camera rate no matter how slow the
   * engine is; inference runs alongside (one episode at a time —
   * frames are dropped rather than queued) and only replaces the
   * matte. With no engine live, the raw frame is drawn instead
   * (degraded start).
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
    if (this._liveMatte && this._liveMatte.epoch === this._engineEpoch) {
      // The effect, live: this tick's camera frame cut with the
      // newest matte we have. This runs through engine stalls
      // too — the stall channel reports the silence honestly,
      // but the raw room NEVER paints over a live backdrop.
      this._compositeLive();
    } else if (this._frameStall.stalled) {
      // No matte has landed for this engine yet (or its engine
      // was just swapped): while the engine produces nothing,
      // keep the live raw picture on the canvas instead of a
      // blank (or frozen) frame. Inference attempts continue
      // below, so a recovered engine takes over again on its
      // next landed matte.
      this._compositeRaw();
    }
    if (this._busy) {
      // An inference is in flight. Its wait still counts toward
      // the stall clock — a hung inference must trip the status
      // fallback, not wedge the status "on" forever.
      this._noteFrameMiss();
      return;
    }
    this._busy = true;
    const epoch = this._engineEpoch;
    engine
      .process(this._video)
      .then((matte) => {
        if (!this._running || epoch !== this._engineEpoch) return;
        this._governPerf(engine);
        if (matte) {
          this._consecutiveInferenceFailures = 0;
          this._storeLandedMatte(matte, epoch);
          // Composite the fresh matte immediately, against the
          // live frame of this instant — don't wait a tick.
          this._compositeLive();
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
   * One loop pass produced no landed matte. When the mateless
   * passes add up to a stall (frame-stall.ts), say so ONCE through
   * the engine-status channel: the studio drops to its engine-down
   * presentation ("Background engine: Off") for the length of the
   * episode. The canvas keeps compositing the last matte over
   * live frames — the effect degrades to a stale matte, it never
   * snaps to the raw room (motion fix, Oct 25, 2026); the status
   * is the honest channel, and it says Off.
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
   * A matte landed: run it through the matte pipeline once
   * (matte-post.ts, tuned by the live refinement step: temporal
   * blend → choke → levels curve → feather) and rasterise it as a
   * white image whose alpha IS the matte. The result is stored as
   * the live matte; _compositeLive cuts every subsequent camera
   * frame with it until the next matte lands. Post-processing
   * advances at inference rate (its temporal state assumes
   * matte-rate calls) — compositing is what runs at camera rate.
   */
  private _storeLandedMatte(matte: EngineMatte, epoch: number): void {
    const mw = matte.width;
    const mh = matte.height;
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
    this._liveMatte = { epoch, width: mw, height: mh };
    this._liveMatteFresh = true;
  }

  /**
   * One composited frame: cut the person out of the CURRENT camera
   * frame with the latest landed matte (stored rasterised in
   * _matteCanvas), and lay the cutout over the background layer.
   * The person layer is built with the matte as its stencil
   * ('copy' the matte in, 'source-in' the camera picture). Edge
   * despill runs on the person layer's own pixels, keyed on its
   * alpha band — but only when a matte just landed or every 3rd
   * composite: it is a full-frame pixel pass on the main thread,
   * and paying it on every tick starves the very engines this
   * loop waits on (motion fix, Oct 25, 2026).
   *
   * The picture source is the LIVE video, never the matte's
   * send-time snapshot: the snapshot doctrine (Oct 23) is retired
   * for the live path — see the header note. A matte that lags a
   * moving edge by one round trip is a smaller error than a
   * person who only moves when mattes land.
   */
  private _compositeLive(): void {
    if (!this._running) return;
    if (!this._liveMatte) return;
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
    this._compositeCount++;

    // 1 — person cutout (built unmirrored; the mirror transform below
    // applies to the whole frame, exactly like before). The picture
    // is the live video; the stencil is the latest matte.
    if (this.mode !== "none") {
      const p = this._personCtx;
      p.save();
      p.clearRect(0, 0, W, H);
      p.globalCompositeOperation = "copy";
      p.drawImage(this._matteCanvas, 0, 0, W, H);
      p.globalCompositeOperation = "source-in";
      p.drawImage(this._video, 0, 0, W, H);
      p.restore();
      if (this._liveMatteFresh || this._compositeCount % 3 === 0) {
        const personData = p.getImageData(0, 0, W, H);
        /* The band is the shipped one; the RETENTION is the
           creator's spill fine-tune (its default reproduces the
           shipped strength exactly). */
        despillRgba(personData.data, 10, 245, despillRetentionFor(this._fineTune));
        p.putImageData(personData, 0, 0);
      }
      this._liveMatteFresh = false;
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
      /* Backdrop dim (fine-tune): a brightness filter on the
         backdrop draw ONLY — the person layer composited over it
         is never dimmed. At dim 0 no filter is set and the draw
         is the shipped one, byte for byte. */
      const bgFilter = backdropFilterFor(this._fineTune);
      if (bgFilter) {
        ctx.save();
        ctx.filter = bgFilter;
        this._drawCover(ctx, this._backdrop, W, H);
        ctx.restore();
      } else {
        this._drawCover(ctx, this._backdrop, W, H);
      }
    } else if (this.mode === "blur") {
      // Slight overscale hides the fringe the blur leaves at the frame edges.
      // The blurred backdrop is the live frame, blurred — the backdrop
      // moves with the room while the matte holds the person out of it.
      ctx.save();
      ctx.filter = `blur(${this.blurAmount}px)`;
      const s = 1.06;
      ctx.drawImage(this._video, -(W * (s - 1)) / 2, -(H * (s - 1)) / 2, W * s, H * s);
      ctx.restore();
    } else {
      // 'none' — or 'image' with no backdrop set yet: the live frame.
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
