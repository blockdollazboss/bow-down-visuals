/**
 * avatar-drive.ts — the pure math between a face and a character.
 *
 * Everything here is data in, data out (no DOM, no MediaPipe types),
 * so the mapping is unit-testable end to end: blendshape scores +
 * the face-geometry matrix become DriveValues; DriveValues are
 * smoothed, sensitivity-scaled, and — when no face or no mic is
 * available — synthesised by the voice and idle layers of the ladder.
 *
 * DriveValues are the rig's vocabulary (avatar-rigs.ts):
 *   yaw / pitch / roll — head pose, -1..1 (0 = facing camera)
 *   lookX / lookY      — pupil offset, -1..1
 *   blinkL / blinkR    — eyelid closure, 0 open .. 1 shut
 *   mouthOpen          — jaw opening, 0..1
 *   brow               — brow raise, 0..1
 *   talk               — voice-activity envelope, 0..1
 */

export interface DriveValues {
  yaw: number;
  pitch: number;
  roll: number;
  lookX: number;
  lookY: number;
  blinkL: number;
  blinkR: number;
  mouthOpen: number;
  brow: number;
  talk: number;
}

export const NEUTRAL_DRIVE: DriveValues = {
  yaw: 0,
  pitch: 0,
  roll: 0,
  lookX: 0,
  lookY: 0,
  blinkL: 0,
  blinkR: 0,
  mouthOpen: 0,
  brow: 0,
  talk: 0,
};

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
const clamp01 = (v: number): number => clamp(v, 0, 1);
const clampSigned = (v: number): number => clamp(v, -1, 1);

/* ── Face geometry matrix → head pose ─────────────────────────────────── */

/**
 * Head pose from MediaPipe's facial transformation matrix (16 floats,
 * column-major: element [col*4 + row]). The rotation is read as a
 * YXZ Euler triple (yaw about Y, then pitch about X, then roll about
 * Z — the order a head actually moves in):
 *   yaw   = atan2(R[0][2], R[2][2])
 *   pitch = asin(−R[1][2])
 *   roll  = atan2(R[1][0], R[1][1])
 * Pure-axis rotations round-trip exactly (unit-tested). Signs follow
 * the matrix's own axes; the rig renderer treats yaw > 0 as the head
 * turning toward the viewer's right in the mirrored selfie view, so
 * the character moves the way the creator sees themselves move.
 */
export function eulerFromMatrix(data: ArrayLike<number>): { yaw: number; pitch: number; roll: number } {
  if (!data || data.length < 16) return { yaw: 0, pitch: 0, roll: 0 };
  // Row-major view of the rotation part: R[row][col] = data[col*4 + row].
  const yaw = Math.atan2(data[8]!, data[10]!);
  const pitch = Math.asin(clamp(-data[9]!, -1, 1));
  const roll = Math.atan2(data[1]!, data[5]!);
  return { yaw, pitch, roll };
}

/** Radians → normalised drive units. The caps are the comfortable
 *  head range a streamer actually uses; beyond them we clamp. */
export const POSE_CAPS = { yaw: 0.65, pitch: 0.5, roll: 0.55 } as const;

export function poseToDrive(e: { yaw: number; pitch: number; roll: number }): {
  yaw: number;
  pitch: number;
  roll: number;
} {
  return {
    yaw: clampSigned(e.yaw / POSE_CAPS.yaw),
    pitch: clampSigned(e.pitch / POSE_CAPS.pitch),
    roll: clampSigned(e.roll / POSE_CAPS.roll),
  };
}

/* ── Blendshapes → drive ──────────────────────────────────────────────── */

export interface BlendshapeCategory {
  categoryName: string;
  score: number;
}

export function blendshapeScore(categories: BlendshapeCategory[] | undefined, name: string): number {
  if (!categories) return 0;
  for (const c of categories) {
    if (c.categoryName === name) return clamp01(c.score);
  }
  return 0;
}

/**
 * Map one Face Landmarker result (blendshape categories + optional
 * transformation matrix) onto DriveValues. Missing inputs degrade to
 * neutral for that channel — a partial face read never snaps the
 * character into a strange pose.
 */
export function driveFromFace(
  categories: BlendshapeCategory[] | undefined,
  matrix: ArrayLike<number> | undefined,
): DriveValues {
  const pose = matrix ? poseToDrive(eulerFromMatrix(matrix)) : { yaw: 0, pitch: 0, roll: 0 };
  const s = (n: string) => blendshapeScore(categories, n);
  // Gaze: lookIn/lookOut are named from the face's own frame; combine
  // both eyes so the pupils track where the creator is looking.
  const lookX = clampSigned(
    (s("eyeLookInLeft") + s("eyeLookOutRight")) / 2 - (s("eyeLookOutLeft") + s("eyeLookInRight")) / 2,
  );
  const lookY = clampSigned(
    (s("eyeLookDownLeft") + s("eyeLookDownRight")) / 2 - (s("eyeLookUpLeft") + s("eyeLookUpRight")) / 2,
  );
  // Jaw: a gentle power curve keeps small mouth movements readable
  // without needing a shout to open the character's mouth.
  const jaw = s("jawOpen");
  return {
    ...pose,
    lookX,
    lookY,
    blinkL: s("eyeBlinkLeft"),
    blinkR: s("eyeBlinkRight"),
    mouthOpen: clamp01(Math.pow(jaw, 0.7) * 1.15),
    brow: clamp01((s("browInnerUp") + (s("browOuterUpLeft") + s("browOuterUpRight")) / 2) / 1.5),
    talk: clamp01(jaw * 1.6),
  };
}

/* ── Smoothing + sensitivity ──────────────────────────────────────────── */

/**
 * Per-channel exponential smoothing. Pose channels get a heavier tau
 * (calm head), blink/mouth a lighter one (they must stay snappy).
 * step() takes an absolute dt so a stalled tab never teleports the
 * character when it wakes.
 */
export class DriveSmoother {
  private _cur: DriveValues = { ...NEUTRAL_DRIVE };
  constructor(private readonly _tauMs: Partial<Record<keyof DriveValues, number>> = {}) {}

  reset(): void {
    this._cur = { ...NEUTRAL_DRIVE };
  }

  step(target: DriveValues, dtMs: number): DriveValues {
    const dt = clamp(dtMs, 0, 100);
    const taus: Record<keyof DriveValues, number> = {
      yaw: 85,
      pitch: 85,
      roll: 85,
      lookX: 60,
      lookY: 60,
      blinkL: 28,
      blinkR: 28,
      mouthOpen: 38,
      brow: 90,
      talk: 60,
      ...this._tauMs,
    };
    const next = { ...this._cur };
    (Object.keys(taus) as Array<keyof DriveValues>).forEach((k) => {
      const a = 1 - Math.exp(-dt / Math.max(1, taus[k]));
      next[k] = this._cur[k] + (target[k] - this._cur[k]) * a;
    });
    this._cur = next;
    return { ...next };
  }

  get current(): DriveValues {
    return { ...this._cur };
  }
}

/** Sensitivity scales the expressive channels (0.5 calm – 1.5 wild). */
export function applySensitivity(d: DriveValues, sensitivity: number): DriveValues {
  const s = clamp(sensitivity, 0.5, 1.5);
  return {
    ...d,
    yaw: clampSigned(d.yaw * s),
    pitch: clampSigned(d.pitch * s),
    roll: clampSigned(d.roll * s),
    lookX: clampSigned(d.lookX * s),
    lookY: clampSigned(d.lookY * s),
    mouthOpen: clamp01(d.mouthOpen * (0.7 + 0.5 * s)),
  };
}

/* ── Voice layer: mic level → mouth ───────────────────────────────────── */

/** RMS level (0..1) from byte time-domain data — the same math the
 *  studio's voice meter uses, so the mouth agrees with the meter. */
export function micRmsFromByteData(data: Uint8Array): number {
  if (!data.length) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i]! - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / data.length);
}

/**
 * Attack/release envelope turning a raw mic level into a mouth
 * opening. Fast attack (speech transients open the mouth inside a
 * frame or two), slower release (the mouth doesn't slam shut between
 * syllables). `talk` is the wider activity envelope used for bobbing.
 */
export class MouthShaper {
  private _mouth = 0;
  private _talk = 0;

  reset(): void {
    this._mouth = 0;
    this._talk = 0;
  }

  step(rms: number, dtMs: number): { mouthOpen: number; talk: number } {
    const dt = clamp(dtMs, 0, 100);
    // Speech RMS in a browser mic chain sits well below 1; the gain
    // maps a normal speaking voice to a near-full mouth opening.
    const target = clamp01((rms - 0.015) * 5.5);
    const attack = 1 - Math.exp(-dt / 26);
    const release = 1 - Math.exp(-dt / 95);
    this._mouth += (target - this._mouth) * (target > this._mouth ? attack : release);
    const talkTarget = target > 0.12 ? 1 : 0;
    const talkRate = 1 - Math.exp(-dt / (talkTarget > this._talk ? 40 : 220));
    this._talk += (talkTarget - this._talk) * talkRate;
    return { mouthOpen: clamp01(this._mouth), talk: clamp01(this._talk) };
  }
}

/* ── Idle layer: breathing, sway, blinking ────────────────────────────── */

/**
 * Deterministic blink schedule (seeded LCG — the same inputs always
 * produce the same blink pattern, which keeps it testable and keeps
 * every avatar from blinking in creepy unison). Closure is a smooth
 * bump: 1 at the middle of a ~140ms blink.
 */
export class BlinkScheduler {
  private _next: number;
  private _state: number;
  private readonly _blinkDur = 0.14;

  constructor(seed = 1234567) {
    this._state = seed >>> 0;
    this._next = 1.2 + this._rand() * 2.4;
  }

  private _rand(): number {
    // Numerical Recipes LCG — deterministic across runs and devices.
    this._state = (this._state * 1664525 + 1013904223) >>> 0;
    return this._state / 4294967296;
  }

  /** Eyelid closure (0..1) at absolute time tSec. */
  closureAt(tSec: number): number {
    while (tSec >= this._next + this._blinkDur) {
      this._next += 2.1 + this._rand() * 2.6;
    }
    if (tSec < this._next || tSec > this._next + this._blinkDur) return 0;
    const p = (tSec - this._next) / this._blinkDur;
    return Math.sin(p * Math.PI);
  }
}

/**
 * The idle pose: a gentle breathing bob, a slow sway, and scheduled
 * blinks. Used raw by the idle drive mode and layered UNDER voice
 * mode (a voice-driven character still breathes and blinks).
 */
export function idleDriveAt(tSec: number, blink: number): DriveValues {
  const breath = Math.sin(tSec * Math.PI * 2 * 0.21);
  const sway = Math.sin(tSec * Math.PI * 2 * 0.07 + 1.3);
  return {
    ...NEUTRAL_DRIVE,
    yaw: sway * 0.05,
    pitch: breath * 0.02,
    blinkL: blink,
    blinkR: blink,
    mouthOpen: 0,
    talk: 0,
  };
}

/* ── The drive ladder ─────────────────────────────────────────────────── */

export type AvatarDriveMode = "face" | "voice" | "idle";
export type AvatarDriveRequest = AvatarDriveMode;

export interface DriveCapabilities {
  /** Face tracking engine loaded and producing results. */
  faceReady: boolean;
  /** A microphone analyser is available to read levels from. */
  micAvailable: boolean;
}

export interface ResolvedDrive {
  mode: AvatarDriveMode;
  /** True when the effective mode is below what was requested. */
  fellBack: boolean;
  /** Plain-language reason when fellBack (shown in the studio). */
  reason: string | null;
}

/**
 * The ladder, in one pure function so the runtime can never disagree
 * with the tests: face → voice → idle. The character is never left
 * frozen: the worst case is a breathing, blinking idle.
 */
export function resolveDrive(requested: AvatarDriveRequest, caps: DriveCapabilities): ResolvedDrive {
  if (requested === "face") {
    if (caps.faceReady) return { mode: "face", fellBack: false, reason: null };
    if (caps.micAvailable) {
      return {
        mode: "voice",
        fellBack: true,
        reason: "Face tracking isn't available right now, so your voice is driving the character.",
      };
    }
    return {
      mode: "idle",
      fellBack: true,
      reason: "Face tracking and microphone aren't available, so the character is idling.",
    };
  }
  if (requested === "voice") {
    if (caps.micAvailable) return { mode: "voice", fellBack: false, reason: null };
    return {
      mode: "idle",
      fellBack: true,
      reason: "No microphone is available, so the character is idling.",
    };
  }
  return { mode: "idle", fellBack: false, reason: null };
}
