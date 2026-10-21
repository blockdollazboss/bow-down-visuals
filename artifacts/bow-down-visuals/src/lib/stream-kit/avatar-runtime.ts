/**
 * avatar-runtime.ts — the AvatarDirector: owns the face-tracking
 * engine, the drive ladder, and one offscreen canvas per avatar
 * source, and renders the characters onto those canvases on its own
 * rAF loop. The stage (stage.ts) treats an avatar exactly like the
 * camera: a canvas provider it composites — so avatars work in
 * scenes, Preview/Program, transitions, the controller, recording,
 * and the broadcast pipe with no special cases downstream.
 *
 * The ladder (avatar-drive.ts resolveDrive) is re-evaluated every
 * frame from live capabilities: face tracking when it is producing,
 * voice when only a mic is readable, idle (breathing, blinking)
 * otherwise. A dead rung never freezes the character.
 *
 * Tracking economy: the landmarker runs at ~30 Hz (every other
 * frame at 60 fps) with the smoother interpolating between samples,
 * and ONLY while at least one avatar source was actually drawn in
 * the last few hundred ms — hide or remove the source and tracking
 * stops. The engine itself stays loaded (it is expensive to build)
 * until the last avatar source is forgotten.
 *
 * PRIVACY: the tracking video is read for NUMBERS only (see
 * avatar-face-engine.ts). Nothing here ever draws it.
 */

import {
  NEUTRAL_DRIVE,
  DriveSmoother,
  MouthShaper,
  BlinkScheduler,
  applySensitivity,
  driveFromFace,
  idleDriveAt,
  micRmsFromByteData,
  resolveDrive,
  type AvatarDriveRequest,
  type DriveValues,
  type ResolvedDrive,
} from "./avatar-drive";
import { FaceDriveEngine, type FaceSample } from "./avatar-face-engine";
import { drawAvatar, type AvatarImageLike } from "./avatar-rigs";
import type { AvatarSettings, SceneSource } from "./scenes";

/** The engine surface the director needs (FaceDriveEngine satisfies it). */
export interface FaceEngineLike {
  init(): Promise<void>;
  detect(video: HTMLVideoElement, timestampMs: number): FaceSample | null;
  readonly ready: boolean;
  dispose(): Promise<void>;
}

export interface AvatarDirectorDeps {
  /** The raw camera element — TRACKING ONLY, never composited. */
  video: () => HTMLVideoElement | null;
  /** The mic channel's analyser, when the mixer/kit has one. */
  analyser: () => AnalyserNode | null;
  /** Test seam: build the face engine. */
  engineFactory?: () => FaceEngineLike;
  /** Test seams for time + frame scheduling. */
  now?: () => number;
  raf?: (cb: () => void) => number;
  cancelRaf?: (id: number) => void;
}

/** Avatar canvases are square; the stage letterboxes them by fit. */
export const AVATAR_CANVAS_SIZE = 720;
/** Detection cadence: ~30 Hz against a 60 fps render loop. */
export const FACE_DETECT_INTERVAL_MS = 33;
/** A face sample older than this no longer counts as "producing". */
export const FACE_FRESH_MS = 1500;
/** A source not drawn for this long releases the render loop. */
export const AVATAR_STALE_MS = 400;
/** After an engine load failure, wait this long before retrying. */
export const ENGINE_RETRY_MS = 20_000;

export interface AvatarStatus {
  requested: AvatarDriveRequest;
  mode: ResolvedDrive["mode"];
  fellBack: boolean;
  reason: string | null;
  /** Face engine state for the honest status line. */
  engine: "off" | "loading" | "ready" | "failed";
}

interface AvatarEntry {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  lastWantedAt: number;
  smoother: DriveSmoother;
  resolved: ResolvedDrive;
  requested: AvatarDriveRequest;
  /** Latest settings seen for this source (panel edits land live). */
  settings: AvatarSettings | undefined;
  image: { el: HTMLImageElement; url: string; state: "loading" | "ready" | "error" } | null;
}

type EngineState = "off" | "loading" | "ready" | "failed";

export class AvatarDirector {
  private _entries = new Map<string, AvatarEntry>();
  private _engine: FaceEngineLike | null = null;
  private _engineState: EngineState = "off";
  private _engineRetryAt = 0;
  private _lastDetectAt = -Infinity;
  private _lastSampleAt: number | null = null;
  private _faceDrive: DriveValues = { ...NEUTRAL_DRIVE };
  private _mouth = new MouthShaper();
  private _blink = new BlinkScheduler(987654321);
  private _micData = new Uint8Array(1024);
  private _raf = 0;
  private _running = false;
  private _lastTickAt: number | null = null;

  private readonly _now: () => number;
  private readonly _rafFn: (cb: () => void) => number;
  private readonly _cancelRafFn: (id: number) => void;

  constructor(private readonly _deps: AvatarDirectorDeps) {
    this._now = _deps.now ?? (() => performance.now());
    this._rafFn = _deps.raf ?? ((cb) => requestAnimationFrame(cb));
    this._cancelRafFn = _deps.cancelRaf ?? ((id) => cancelAnimationFrame(id));
  }

  /* ------------------------------------------------------------ stage API */

  /**
   * The canvas for an avatar source (null when it can't draw yet —
   * an upload character with no picture). Every call marks the
   * source wanted for this frame window, which is what keeps the
   * render loop (and tracking) alive.
   */
  canvasFor(source: SceneSource): HTMLCanvasElement | null {
    const entry = this._entryFor(source);
    entry.lastWantedAt = this._now();
    entry.settings = source.avatar;
    entry.requested = source.avatar?.drive ?? "face";
    this._ensureLoop();
    const settings = source.avatar;
    if (settings?.character === "upload" && !this._imageFor(entry, settings.imageUrl)) {
      return null;
    }
    return entry.canvas;
  }

  /** Why the source shows a placeholder, for the stage's note. */
  noteFor(source: SceneSource): string {
    if (source.avatar?.character === "upload" && !source.avatar.imageUrl) {
      return "Add your picture in the source settings";
    }
    if (source.avatar?.character === "upload") return "Loading your picture…";
    return "Avatar is warming up";
  }

  /** The live drive status for a source (studio status line). */
  statusFor(source: SceneSource): AvatarStatus {
    const entry = this._entries.get(source.id);
    const requested = source.avatar?.drive ?? "face";
    if (!entry) {
      return { requested, mode: "idle", fellBack: false, reason: null, engine: this._engineState };
    }
    return {
      requested: entry.requested,
      mode: entry.resolved.mode,
      fellBack: entry.resolved.fellBack,
      reason: entry.resolved.reason,
      engine: this._engineState,
    };
  }

  /** Release a source's canvas; the last forget retires the engine. */
  forget(sourceId: string): void {
    this._entries.delete(sourceId);
    if (this._entries.size === 0) {
      this._stopLoop();
      const engine = this._engine;
      this._engine = null;
      this._engineState = "off";
      this._lastSampleAt = null;
      if (engine) void engine.dispose().catch(() => undefined);
    }
  }

  /** Full teardown (stage disposal). */
  dispose(): void {
    this._stopLoop();
    this._entries.clear();
    const engine = this._engine;
    this._engine = null;
    this._engineState = "off";
    if (engine) void engine.dispose().catch(() => undefined);
  }

  get entryCount(): number {
    return this._entries.size;
  }

  /* ---------------------------------------------------------------- loop */

  private _entryFor(source: SceneSource): AvatarEntry {
    let entry = this._entries.get(source.id);
    if (!entry) {
      const canvas = document.createElement("canvas");
      canvas.width = AVATAR_CANVAS_SIZE;
      canvas.height = AVATAR_CANVAS_SIZE;
      entry = {
        canvas,
        ctx: canvas.getContext("2d")!,
        lastWantedAt: this._now(),
        smoother: new DriveSmoother(),
        resolved: { mode: "idle", fellBack: false, reason: null },
        requested: source.avatar?.drive ?? "face",
        settings: source.avatar,
        image: null,
      };
      this._entries.set(source.id, entry);
    }
    return entry;
  }

  private _imageFor(entry: AvatarEntry, url: string | undefined): AvatarImageLike | null {
    if (!url) {
      entry.image = null;
      return null;
    }
    if (!entry.image || entry.image.url !== url) {
      const el = new Image();
      const rec: NonNullable<AvatarEntry["image"]> = { el, url, state: "loading" };
      entry.image = rec;
      el.onload = () => {
        rec.state = "ready";
      };
      el.onerror = () => {
        rec.state = "error";
      };
      el.src = url;
    }
    if (entry.image.state !== "ready") return null;
    const el = entry.image.el;
    return { el, width: el.naturalWidth, height: el.naturalHeight };
  }

  private _ensureLoop(): void {
    if (this._running) return;
    this._running = true;
    this._lastTickAt = null;
    const tick = () => {
      if (!this._running) return;
      this._raf = this._rafFn(tick);
      this._tick();
    };
    tick();
  }

  private _stopLoop(): void {
    this._running = false;
    if (this._raf) this._cancelRafFn(this._raf);
    this._raf = 0;
    this._lastTickAt = null;
  }

  private _tick(): void {
    const now = this._now();
    const dt = this._lastTickAt === null ? 16 : now - this._lastTickAt;
    this._lastTickAt = now;
    const tSec = now / 1000;

    // Wanted = drawn within the stale window. Nothing wanted → park.
    let anyWanted = false;
    let faceWanted = false;
    for (const [, entry] of this._entries) {
      if (now - entry.lastWantedAt <= AVATAR_STALE_MS) {
        anyWanted = true;
        if (entry.requested === "face") faceWanted = true;
      }
    }
    if (!anyWanted) {
      this._stopLoop();
      return;
    }

    this._updateFace(now, faceWanted);
    const mic = this._sampleMic(dt);
    const blink = this._blink.closureAt(tSec);
    const idle = idleDriveAt(tSec, blink);

    for (const [id, entry] of this._entries) {
      if (now - entry.lastWantedAt > AVATAR_STALE_MS) continue;
      const source = this._sourceSnapshot(id, entry);
      const resolved = resolveDrive(entry.requested, {
        faceReady: this._engineState === "ready" && this._lastSampleAt !== null && now - this._lastSampleAt <= FACE_FRESH_MS,
        micAvailable: mic.available,
      });
      entry.resolved = resolved;
      let target: DriveValues;
      if (resolved.mode === "face") {
        target = this._faceDrive;
      } else if (resolved.mode === "voice") {
        target = { ...idle, mouthOpen: mic.mouthOpen, talk: mic.talk };
      } else {
        target = idle;
      }
      const drive = applySensitivity(entry.smoother.step(target, Math.max(1, dt)), source.sensitivity);
      const ctx = entry.ctx;
      const S = AVATAR_CANVAS_SIZE;
      ctx.clearRect(0, 0, S, S);
      const image = source.character === "upload" ? this._imageFor(entry, source.imageUrl) : null;
      drawAvatar(ctx, source.character, drive, S, S, tSec, image);
    }
  }

  /** The settings a tick should render with — read live off the entry's
   *  last-seen source so panel edits land without a restart. */
  private _sourceSnapshot(
    _id: string,
    entry: AvatarEntry,
  ): Required<Pick<AvatarSettings, "character" | "drive" | "sensitivity">> & { imageUrl?: string } {
    const s = entry.settings;
    return {
      character: s?.character ?? "shark",
      drive: s?.drive ?? "face",
      sensitivity: s?.sensitivity ?? 1,
      imageUrl: s?.imageUrl,
    };
  }

  /* ------------------------------------------------------------ face + mic */

  private _updateFace(now: number, faceWanted: boolean): void {
    if (!faceWanted) return;
    if (this._engineState === "off" || (this._engineState === "failed" && now >= this._engineRetryAt)) {
      this._startEngine();
    }
    const engine = this._engine;
    if (!engine || this._engineState !== "ready") return;
    if (now - this._lastDetectAt < FACE_DETECT_INTERVAL_MS) return;
    this._lastDetectAt = now;
    const video = this._deps.video();
    if (!video) return;
    const sample = engine.detect(video, now);
    if (sample) {
      this._lastSampleAt = now;
      this._faceDrive = driveFromFace(sample.categories, sample.matrix ?? undefined);
    }
  }

  private _startEngine(): void {
    if (this._engineState === "loading") return;
    this._engineState = "loading";
    const engine = this._deps.engineFactory ? this._deps.engineFactory() : new FaceDriveEngine();
    this._engine = engine;
    engine.init().then(
      () => {
        if (this._engine === engine) this._engineState = "ready";
      },
      () => {
        if (this._engine === engine) {
          this._engineState = "failed";
          this._engineRetryAt = this._now() + ENGINE_RETRY_MS;
        }
      },
    );
  }

  private _sampleMic(dt: number): { available: boolean; mouthOpen: number; talk: number } {
    const analyser = this._deps.analyser();
    if (!analyser) {
      this._mouth.reset();
      return { available: false, mouthOpen: 0, talk: 0 };
    }
    try {
      analyser.getByteTimeDomainData(this._micData);
    } catch {
      return { available: false, mouthOpen: 0, talk: 0 };
    }
    const rms = micRmsFromByteData(this._micData);
    const shaped = this._mouth.step(rms, Math.max(1, dt));
    return { available: true, mouthOpen: shaped.mouthOpen, talk: shaped.talk };
  }
}
