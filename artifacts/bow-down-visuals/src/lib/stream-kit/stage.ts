/**
 * stage.ts — the compositing stage: a SourcePool (the live elements
 * behind sources), drawScene (one frame of a scene onto any 2d context),
 * the program Stage (with Cut/Fade transitions), and a PreviewStage
 * that renders the preview scene off the same pool.
 *
 * The published/recorded stream always carries the program Stage's
 * canvas. Preview exists so the next scene can be framed before it goes
 * out — OBS's studio mode.
 */

import {
  type Scene,
  type SceneSource,
  type SourceType,
  createScene,
  createSource,
  createDefaultScene,
  duplicateScene,
  duplicateSource,
  moveSource,
  fitRects,
  applyChromaKey,
} from "./scenes";
import { getWidgetData, widgetLines, goalProgress } from "./widget-data";
import { AvatarDirector, type AvatarStatus } from "./avatar-runtime";

type MediaState = "loading" | "ready" | "error";

interface ImageEntry {
  el: HTMLImageElement;
  url: string;
  state: MediaState;
}
interface MediaEntry {
  el: HTMLVideoElement | HTMLImageElement;
  url: string;
  kind: "video" | "image";
  state: MediaState;
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;

/* ── SourcePool — the live elements sources draw from ───────────────────── */

export class SourcePool {
  /** The kit's processed camera canvas (segmentation/backdrops/effects). */
  cameraCanvas: () => HTMLCanvasElement | null = () => null;
  /** The raw camera video (for chroma keying). */
  rawCameraVideo: () => HTMLVideoElement | null = () => null;

  /* Avatar sources: the director reads the raw camera for TRACKING
     ONLY (numbers out — the camera picture is never composited) and
     the mic analyser for voice drive. Providers are wired by the
     studio next to cameraCanvas; defaults keep avatars idling. */
  avatarVideo: () => HTMLVideoElement | null = () => null;
  avatarAnalyser: () => AnalyserNode | null = () => null;
  readonly avatarDirector: AvatarDirector = new AvatarDirector({
    video: () => this.avatarVideo(),
    analyser: () => this.avatarAnalyser(),
  });

  /** The rendered character canvas for an avatar source. */
  avatarCanvasFor(source: SceneSource): HTMLCanvasElement | null {
    return this.avatarDirector.canvasFor(source);
  }
  avatarNoteFor(source: SceneSource): string {
    return this.avatarDirector.noteFor(source);
  }
  avatarStatusFor(source: SceneSource): AvatarStatus {
    return this.avatarDirector.statusFor(source);
  }

  screenVideo: HTMLVideoElement | null = null;
  screenStream: MediaStream | null = null;
  screenEnded = false;

  /* Guest sources (Go Live guests, 0201): the live video element for
     an on-stage guest's WebRTC feed, resolved by guest session id.
     Wired by the studio to the backstage mesh's feed registry; the
     default keeps guest tiles at their honest placeholder. */
  guestVideoFor: (sessionId: string) => HTMLVideoElement | null = () => null;

  private _images = new Map<string, ImageEntry>();
  private _media = new Map<string, MediaEntry>();
  private _keyCanvas: HTMLCanvasElement | null = null;
  private _keyCtx: CanvasRenderingContext2D | null = null;
  private _lastKeyAt = 0;
  private _lastKeySig = "";

  /* Screen share (getDisplayMedia — the browser's own picker; the answer
     to game capture in a browser: share the window/screen). */
  async attachScreen(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("This browser doesn't support screen sharing.");
    }
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    this.detachScreen();
    this.screenStream = stream;
    this.screenEnded = false;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    this.screenVideo = video;
    const track = stream.getVideoTracks()[0];
    if (track) {
      track.onended = () => {
        this.screenEnded = true;
      };
    }
    return stream;
  }

  detachScreen(): void {
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.screenVideo = null;
    this.screenEnded = false;
  }

  get screenAudioTrack(): MediaStreamTrack | null {
    return this.screenStream?.getAudioTracks()[0] ?? null;
  }

  imageFor(source: SceneSource): ImageEntry | null {
    const url = source.imageUrl;
    if (!url) return null;
    let entry = this._images.get(source.id);
    if (!entry || entry.url !== url) {
      const el = new Image();
      el.crossOrigin = "anonymous";
      entry = { el, url, state: "loading" };
      el.onload = () => {
        if (entry) entry.state = "ready";
      };
      el.onerror = () => {
        if (entry) entry.state = "error";
      };
      el.src = url;
      this._images.set(source.id, entry);
    }
    return entry;
  }

  mediaFor(source: SceneSource): MediaEntry | null {
    const url = source.mediaUrl;
    if (!url) return null;
    let entry = this._media.get(source.id);
    if (!entry || entry.url !== url) {
      entry = this._makeMedia(source.id, url, VIDEO_EXT.test(url) ? "video" : "video");
      this._media.set(source.id, entry);
    }
    return entry;
  }

  private _makeMedia(sourceId: string, url: string, kind: "video" | "image"): MediaEntry {
    if (kind === "video") {
      const el = document.createElement("video");
      el.crossOrigin = "anonymous";
      el.muted = true;
      el.loop = true;
      el.playsInline = true;
      const entry: MediaEntry = { el, url, kind: "video", state: "loading" };
      el.onloadeddata = () => {
        entry.state = "ready";
        void el.play().catch(() => undefined);
      };
      el.onerror = () => {
        // Not a video after all — try it as an image before giving up.
        const imgEntry = this._makeMedia(sourceId, url, "image");
        this._media.set(sourceId, imgEntry);
      };
      el.src = url;
      return entry;
    }
    const el = new Image();
    el.crossOrigin = "anonymous";
    const entry: MediaEntry = { el, url, kind: "image", state: "loading" };
    el.onload = () => {
      entry.state = "ready";
    };
    el.onerror = () => {
      entry.state = "error";
    };
    el.src = url;
    return entry;
  }

  forget(sourceId: string): void {
    this._images.delete(sourceId);
    this._media.delete(sourceId);
    this.avatarDirector.forget(sourceId);
  }

  /**
   * The chroma-keyed camera frame. Keyed at most every 30ms and at a
   * capped 640px width — per-pixel keying is the one expensive thing in
   * the kit, and the cap keeps the program at full frame rate.
   */
  keyedCamera(video: HTMLVideoElement, settings: { color: string; similarity: number; smoothness: number }): HTMLCanvasElement | null {
    if (!video.videoWidth || !video.videoHeight) return null;
    const sig = `${settings.color}|${settings.similarity}|${settings.smoothness}|${video.videoWidth}x${video.videoHeight}`;
    const now = performance.now();
    if (this._keyCanvas && now - this._lastKeyAt < 30 && sig === this._lastKeySig) return this._keyCanvas;
    if (!this._keyCanvas) {
      this._keyCanvas = document.createElement("canvas");
      this._keyCtx = this._keyCanvas.getContext("2d", { willReadFrequently: true });
    }
    const scale = Math.min(1, 640 / video.videoWidth);
    const w = Math.max(2, Math.round(video.videoWidth * scale));
    const h = Math.max(2, Math.round(video.videoHeight * scale));
    if (this._keyCanvas.width !== w || this._keyCanvas.height !== h) {
      this._keyCanvas.width = w;
      this._keyCanvas.height = h;
    }
    const ctx = this._keyCtx!;
    ctx.drawImage(video, 0, 0, w, h);
    try {
      const data = ctx.getImageData(0, 0, w, h);
      applyChromaKey(data, settings);
      ctx.putImageData(data, 0, 0);
    } catch {
      /* tainted canvas (CORS) — return the unkeyed frame rather than die */
    }
    this._lastKeyAt = now;
    this._lastKeySig = sig;
    return this._keyCanvas;
  }
}

/* ── One frame of a scene ───────────────────────────────────────────────── */

function placeholder(
  ctx: CanvasRenderingContext2D,
  dest: { x: number; y: number; w: number; h: number },
  title: string,
  note: string,
): void {
  ctx.save();
  ctx.fillStyle = "#0a0805";
  ctx.fillRect(dest.x, dest.y, dest.w, dest.h);
  ctx.strokeStyle = "rgba(201,168,76,.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(dest.x + 0.5, dest.y + 0.5, Math.max(0, dest.w - 1), Math.max(0, dest.h - 1));
  ctx.fillStyle = "rgba(247,236,210,.85)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = dest.x + dest.w / 2;
  const cy = dest.y + dest.h / 2;
  ctx.font = `700 ${Math.max(12, Math.min(20, dest.h / 6))}px Georgia, serif`;
  ctx.fillText(title, cx, cy - 10, dest.w - 16);
  ctx.font = `400 ${Math.max(10, Math.min(14, dest.h / 9))}px Georgia, serif`;
  ctx.fillStyle = "rgba(247,236,210,.5)";
  ctx.fillText(note, cx, cy + 14, dest.w - 16);
  ctx.restore();
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  pool: SourcePool,
  W: number,
  H: number,
): void {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  for (const source of scene.sources) {
    if (!source.visible) continue;
    const dest = { x: source.x * W, y: source.y * H, w: source.w * W, h: source.h * H };
    if (dest.w <= 0 || dest.h <= 0) continue;
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, source.opacity));
    drawSource(ctx, source, pool, dest, W, H);
    ctx.restore();
  }
}

function drawFit(
  ctx: CanvasRenderingContext2D,
  drawable: CanvasImageSource & { width: number; height: number },
  iw: number,
  ih: number,
  dest: { x: number; y: number; w: number; h: number },
  fit: SceneSource["fit"],
): void {
  const r = fitRects(iw, ih, dest, fit);
  ctx.drawImage(drawable, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
}

function drawSource(
  ctx: CanvasRenderingContext2D,
  source: SceneSource,
  pool: SourcePool,
  dest: { x: number; y: number; w: number; h: number },
  W: number,
  H: number,
): void {
  switch (source.type) {
    case "camera": {
      if (source.cameraMode === "chroma") {
        const video = pool.rawCameraVideo();
        if (!video || video.readyState < 2 || !video.videoWidth) {
          placeholder(ctx, dest, source.name, "Camera is off");
          return;
        }
        const keyed = pool.keyedCamera(video, source.chroma ?? { color: "#00FF00", similarity: 0.32, smoothness: 0.12 });
        if (!keyed) {
          placeholder(ctx, dest, source.name, "Camera is warming up");
          return;
        }
        drawFit(ctx, keyed, keyed.width, keyed.height, dest, source.fit);
        return;
      }
      const canvas = pool.cameraCanvas();
      if (!canvas || !canvas.width) {
        placeholder(ctx, dest, source.name, "Camera is off — start it above");
        return;
      }
      drawFit(ctx, canvas, canvas.width, canvas.height, dest, source.fit);
      return;
    }
    case "avatar": {
      const canvas = pool.avatarCanvasFor(source);
      if (!canvas || !canvas.width) {
        placeholder(ctx, dest, source.name, pool.avatarNoteFor(source));
        return;
      }
      drawFit(ctx, canvas, canvas.width, canvas.height, dest, source.fit);
      return;
    }
    case "screen": {
      const video = pool.screenVideo;
      if (!video || video.readyState < 2 || !video.videoWidth) {
        placeholder(ctx, dest, source.name, pool.screenStream ? "Screen share is starting" : pool.screenEnded ? "Screen share ended" : "Not sharing yet — add starts the share");
        return;
      }
      if (pool.screenEnded) {
        placeholder(ctx, dest, source.name, "Screen share ended");
        return;
      }
      drawFit(ctx, video, video.videoWidth, video.videoHeight, dest, source.fit);
      return;
    }
    case "guest": {
      const sessionId = source.guest?.sessionId ?? "";
      const video = sessionId ? pool.guestVideoFor(sessionId) : null;
      if (!video || video.readyState < 2 || !video.videoWidth) {
        placeholder(ctx, dest, source.name, sessionId ? "Guest is connecting…" : "No guest assigned yet");
        return;
      }
      drawFit(ctx, video, video.videoWidth, video.videoHeight, dest, source.fit);
      return;
    }
    case "image": {
      const entry = pool.imageFor(source);
      if (!entry) {
        placeholder(ctx, dest, source.name, "No image set yet");
        return;
      }
      if (entry.state === "error") {
        placeholder(ctx, dest, source.name, "That image couldn't load");
        return;
      }
      if (entry.state !== "ready") {
        placeholder(ctx, dest, source.name, "Loading image…");
        return;
      }
      drawFit(ctx, entry.el, entry.el.naturalWidth, entry.el.naturalHeight, dest, source.fit);
      return;
    }
    case "media": {
      const entry = pool.mediaFor(source);
      if (!entry) {
        placeholder(ctx, dest, source.name, "No media URL set yet");
        return;
      }
      if (entry.state === "error") {
        placeholder(ctx, dest, source.name, "This URL couldn't load as media");
        return;
      }
      if (entry.state !== "ready") {
        placeholder(ctx, dest, source.name, "Loading media…");
        return;
      }
      if (entry.kind === "video") {
        const v = entry.el as HTMLVideoElement;
        drawFit(ctx, v, v.videoWidth, v.videoHeight, dest, source.fit);
      } else {
        const img = entry.el as HTMLImageElement;
        drawFit(ctx, img, img.naturalWidth, img.naturalHeight, dest, source.fit);
      }
      return;
    }
    case "text": {
      const t = source.text ?? {
        content: "",
        fontSize: 44,
        color: "#F7ECD2",
        bold: true,
        fontFamily: "Georgia, serif",
        outlineColor: null,
      };
      const scale = H / 720;
      const fontPx = Math.max(8, t.fontSize * scale);
      ctx.save();
      ctx.font = `${t.bold ? 700 : 400} ${fontPx}px ${t.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      const lines = (t.content || "").split("\n");
      const lineHeight = fontPx * 1.18;
      const blockH = lines.length * lineHeight;
      let baseline = dest.y + (dest.h - blockH) / 2 + fontPx * 0.85;
      for (const line of lines) {
        const cx = dest.x + dest.w / 2;
        if (t.outlineColor) {
          ctx.strokeStyle = t.outlineColor;
          ctx.lineWidth = Math.max(2, fontPx / 9);
          ctx.lineJoin = "round";
          ctx.strokeText(line, cx, baseline, dest.w);
        }
        ctx.fillStyle = t.color;
        ctx.fillText(line, cx, baseline, dest.w);
        baseline += lineHeight;
      }
      ctx.restore();
      return;
    }
    case "widget": {
      // Overlay widgets render real stream data only (widget-data.ts
      // is fed by the studio's poll of /api/live/:id/widgets). No
      // data → draw nothing: the program output stays clean instead
      // of showing a placeholder box.
      const kind = source.widget?.kind ?? "latest-follower";
      const data = getWidgetData();
      const lines = widgetLines(kind, data, performance.now() / 1000);
      if (!lines) return;
      ctx.save();
      ctx.fillStyle = "rgba(13,10,4,0.82)";
      ctx.strokeStyle = "rgba(201,168,76,0.65)";
      ctx.lineWidth = Math.max(1, H / 540);
      const radius = Math.min(14, dest.h / 3);
      ctx.beginPath();
      ctx.roundRect(dest.x, dest.y, dest.w, dest.h, radius);
      ctx.fill();
      ctx.stroke();
      const pad = dest.h * 0.16;
      ctx.textBaseline = "middle";
      if (kind === "goal-bar") {
        const progress = goalProgress(data) ?? 0;
        ctx.fillStyle = "#F7ECD2";
        ctx.font = `700 ${Math.max(11, dest.h * 0.3)}px Georgia, serif`;
        ctx.textAlign = "left";
        ctx.fillText(lines[0]!, dest.x + pad, dest.y + dest.h * 0.3, dest.w - pad * 2);
        // The bar itself: gold fill over a dark track.
        const barY = dest.y + dest.h * 0.58;
        const barH = Math.max(4, dest.h * 0.18);
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.beginPath();
        ctx.roundRect(dest.x + pad, barY, dest.w - pad * 2, barH, barH / 2);
        ctx.fill();
        if (progress > 0) {
          ctx.fillStyle = "#C9A84C";
          ctx.beginPath();
          ctx.roundRect(dest.x + pad, barY, (dest.w - pad * 2) * progress, barH, barH / 2);
          ctx.fill();
        }
      } else if (lines.length > 1) {
        ctx.fillStyle = "rgba(232,200,106,0.9)";
        ctx.font = `700 ${Math.max(9, dest.h * 0.22)}px Georgia, serif`;
        ctx.textAlign = "left";
        ctx.fillText(lines[0]!.toUpperCase(), dest.x + pad, dest.y + dest.h * 0.3, dest.w - pad * 2);
        ctx.fillStyle = "#F7ECD2";
        ctx.font = `700 ${Math.max(11, dest.h * 0.36)}px Georgia, serif`;
        ctx.fillText(lines[1]!, dest.x + pad, dest.y + dest.h * 0.68, dest.w - pad * 2);
      } else {
        ctx.fillStyle = "#F7ECD2";
        ctx.font = `700 ${Math.max(11, dest.h * 0.34)}px Georgia, serif`;
        ctx.textAlign = "center";
        ctx.fillText(lines[0]!, dest.x + dest.w / 2, dest.y + dest.h / 2, dest.w - pad * 2);
      }
      ctx.restore();
      return;
    }
    case "color": {
      const fill = source.fill ?? { from: "#14100a", to: "#0d0a04" };
      if (fill.from === fill.to) {
        ctx.fillStyle = fill.from;
        ctx.fillRect(dest.x, dest.y, dest.w, dest.h);
      } else {
        const grad = ctx.createLinearGradient(dest.x, dest.y, dest.x, dest.y + dest.h);
        grad.addColorStop(0, fill.from);
        grad.addColorStop(1, fill.to);
        ctx.fillStyle = grad;
        ctx.fillRect(dest.x, dest.y, dest.w, dest.h);
      }
      return;
    }
  }
}

/* ── The program Stage ──────────────────────────────────────────────────── */

export type TransitionKind = "cut" | "fade";

export class Stage {
  canvas: HTMLCanvasElement;
  pool = new SourcePool();
  scenes: Scene[] = [];
  programId = "";
  previewId = "";
  onChange: (() => void) | null = null;

  private _ctx: CanvasRenderingContext2D;
  private _raf = 0;
  private _running = false;
  private _fade: { from: Scene; startedAt: number; durationMs: number } | null = null;
  private _fadeCanvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, scenes?: Scene[]) {
    this.canvas = canvas;
    this._ctx = canvas.getContext("2d")!;
    this.scenes = scenes && scenes.length ? scenes : [createDefaultScene()];
    this.programId = this.scenes[0]!.id;
    this.previewId = this.scenes[0]!.id;
    this._fadeCanvas = document.createElement("canvas");
  }

  get width(): number {
    return this.canvas.width;
  }
  get height(): number {
    return this.canvas.height;
  }

  programScene(): Scene {
    return this.scenes.find((s) => s.id === this.programId) ?? this.scenes[0]!;
  }
  previewScene(): Scene {
    return this.scenes.find((s) => s.id === this.previewId) ?? this.scenes[0]!;
  }
  sceneById(id: string): Scene | null {
    return this.scenes.find((s) => s.id === id) ?? null;
  }

  private _emit(): void {
    this.onChange?.();
  }

  /* Scene operations -------------------------------------------------- */

  addScene(name?: string): Scene {
    const scene = createScene(name ?? `Scene ${this.scenes.length + 1}`);
    this.scenes = [...this.scenes, scene];
    this.previewId = scene.id;
    this._emit();
    return scene;
  }

  renameScene(id: string, name: string): void {
    this.scenes = this.scenes.map((s) => (s.id === id ? { ...s, name } : s));
    this._emit();
  }

  duplicateSceneById(id: string): Scene | null {
    const scene = this.sceneById(id);
    if (!scene) return null;
    const copy = duplicateScene(scene);
    const idx = this.scenes.findIndex((s) => s.id === id);
    this.scenes = [...this.scenes.slice(0, idx + 1), copy, ...this.scenes.slice(idx + 1)];
    this.previewId = copy.id;
    this._emit();
    return copy;
  }

  deleteScene(id: string): void {
    if (this.scenes.length <= 1) return;
    const removed = this.sceneById(id);
    removed?.sources.forEach((s) => this.pool.forget(s.id));
    this.scenes = this.scenes.filter((s) => s.id !== id);
    if (this.programId === id) this.programId = this.scenes[0]!.id;
    if (this.previewId === id) this.previewId = this.scenes[0]!.id;
    this._emit();
  }

  /* Source operations ------------------------------------------------- */

  addSource(sceneId: string, type: SourceType): SceneSource | null {
    const scene = this.sceneById(sceneId);
    if (!scene) return null;
    const source = createSource(type);
    scene.sources = [...scene.sources, source];
    this.scenes = [...this.scenes];
    this._emit();
    return source;
  }

  /** Duplicate a source in place: the copy lands directly in front of
      the original (one step toward the front of the stack). */
  duplicateSourceById(sceneId: string, sourceId: string): SceneSource | null {
    const scene = this.sceneById(sceneId);
    if (!scene) return null;
    const idx = scene.sources.findIndex((s) => s.id === sourceId);
    if (idx < 0) return null;
    const copy = duplicateSource(scene.sources[idx]!);
    scene.sources = [...scene.sources.slice(0, idx + 1), copy, ...scene.sources.slice(idx + 1)];
    this.scenes = [...this.scenes];
    this._emit();
    return copy;
  }

  updateSource(sceneId: string, sourceId: string, patch: Partial<SceneSource>): void {
    const scene = this.sceneById(sceneId);
    if (!scene) return;
    scene.sources = scene.sources.map((s) => (s.id === sourceId ? { ...s, ...patch } : s));
    this.scenes = [...this.scenes];
    this._emit();
  }

  removeSource(sceneId: string, sourceId: string): void {
    const scene = this.sceneById(sceneId);
    if (!scene) return;
    scene.sources = scene.sources.filter((s) => s.id !== sourceId);
    this.pool.forget(sourceId);
    this.scenes = [...this.scenes];
    this._emit();
  }

  moveSourceById(sceneId: string, sourceId: string, dir: 1 | -1): void {
    const scene = this.sceneById(sceneId);
    if (!scene) return;
    const updated = moveSource(scene, sourceId, dir);
    this.scenes = this.scenes.map((s) => (s.id === sceneId ? updated : s));
    this._emit();
  }

  /* Switching ---------------------------------------------------------- */

  setPreview(id: string): void {
    if (this.sceneById(id)) {
      this.previewId = id;
      this._emit();
    }
  }

  /** Cut: the given scene goes straight to Program. */
  cutTo(id: string): void {
    if (!this.sceneById(id)) return;
    this._fade = null;
    this.programId = id;
    this._emit();
  }

  /** Transition: Preview becomes Program (Cut or Fade). */
  transition(kind: TransitionKind, durationMs = 450): void {
    const target = this.previewId;
    if (target === this.programId) return;
    if (kind === "cut" || durationMs <= 0) {
      this.cutTo(target);
      return;
    }
    this._fade = { from: this.programScene(), startedAt: performance.now(), durationMs };
    this.programId = target;
    this._emit();
  }

  get transitioning(): boolean {
    return this._fade !== null;
  }

  /* Render loop --------------------------------------------------------- */

  start(): void {
    if (this._running) return;
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      this._raf = requestAnimationFrame(loop);
      this._drawProgram();
    };
    loop();
  }

  stop(): void {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  private _drawProgram(): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (!W || !H) return;
    const program = this.programScene();
    if (this._fade) {
      const p = Math.min(1, (performance.now() - this._fade.startedAt) / this._fade.durationMs);
      if (p >= 1) {
        this._fade = null;
      } else {
        // Draw the outgoing scene offscreen, the new program on the main
        // canvas, then lay the outgoing scene back at (1 - p) alpha.
        if (this._fadeCanvas.width !== W || this._fadeCanvas.height !== H) {
          this._fadeCanvas.width = W;
          this._fadeCanvas.height = H;
        }
        const fctx = this._fadeCanvas.getContext("2d")!;
        drawScene(fctx, this._fade.from, this.pool, W, H);
        drawScene(this._ctx, program, this.pool, W, H);
        this._ctx.save();
        this._ctx.globalAlpha = 1 - p;
        this._ctx.drawImage(this._fadeCanvas, 0, 0);
        this._ctx.restore();
        return;
      }
    }
    drawScene(this._ctx, program, this.pool, W, H);
  }

  /** One preview frame (PreviewStage drives this on its own loop). */
  drawPreview(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    drawScene(ctx, this.previewScene(), this.pool, W, H);
  }

  /** The program feed as a stream — what transports publish and recorders record. */
  getStream(fps = 30): MediaStream {
    return this.canvas.captureStream(fps);
  }
}

/* ── Preview renderer ───────────────────────────────────────────────────── */

export class PreviewStage {
  private _raf = 0;
  private _running = false;
  constructor(
    private _canvas: HTMLCanvasElement,
    private _stage: Stage,
  ) {}

  start(): void {
    if (this._running) return;
    this._running = true;
    const ctx = this._canvas.getContext("2d")!;
    const loop = () => {
      if (!this._running) return;
      this._raf = requestAnimationFrame(loop);
      if (this._canvas.width && this._canvas.height) {
        this._stage.drawPreview(ctx, this._canvas.width, this._canvas.height);
      }
    };
    loop();
  }

  stop(): void {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }
}
