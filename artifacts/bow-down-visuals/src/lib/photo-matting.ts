/**
 * photo-matting.ts — background removal for STILL photos (Stack 7 #3).
 *
 * Primary path: the stream desk's Pro matting engine (RVM, vendored
 * same-origin under public/engines) run for a single frame through the
 * same MattingEngine contract, with the shared MattePostProcessor
 * (single-frame settings: no temporal blend). The still is fed to the
 * engine by streaming a canvas into a <video> element — the engine's
 * contract surface — so there is exactly ONE matting implementation.
 *
 * Fallback path: a corner-sampling color-key (chroma) — labeled
 * "Basic" everywhere it appears. It is a color heuristic, NOT a
 * matting model, and the UI must never call it AI.
 */
import { RvmEngine, type EngineMatte, type MattingEngine } from "./stream-kit/rvm-engine";
import { MattePostProcessor } from "./stream-kit/matte-post";

export type MattingTier = "pro" | "basic";

export const MATTING_TIERS: { id: MattingTier; label: string; blurb: string }[] = [
  { id: "pro", label: "Pro matting", blurb: "On-device matting model — soft edges, hair detail. Free, runs in your browser." },
  { id: "basic", label: "Basic color-key", blurb: "Color heuristic for solid backgrounds only — hard edges, no hair detail." },
];

export function tierLabel(tier: MattingTier): string {
  return MATTING_TIERS.find((t) => t.id === tier)!.label;
}

/* ── Single-frame path through the MattingEngine contract ───────────── */
export interface StillMattingEngine {
  /** Produce a post-processed matte for one still image. */
  processStill(source: HTMLImageElement | HTMLCanvasElement): Promise<EngineMatte>;
  dispose(): Promise<void>;
}

const MAX_FEED = 1280;

export function createStillMattingEngine(
  factory: () => MattingEngine = () => new RvmEngine(),
): StillMattingEngine {
  let engine: MattingEngine | null = null;
  const post = new MattePostProcessor({ emaWeight: 1 }); // single frame: no temporal blend
  return {
    async processStill(source) {
      if (!engine) { engine = factory(); await engine.init(); }
      engine.reset(); post.reset();
      const sw = (source as HTMLImageElement).naturalWidth || source.width;
      const sh = (source as HTMLImageElement).naturalHeight || source.height;
      if (!sw || !sh) throw new Error("That photo could not be read.");
      const scale = Math.min(1, MAX_FEED / Math.max(sw, sh));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(2, Math.round(sw * scale));
      canvas.height = Math.max(2, Math.round(sh * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable.");
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

      // Feed the still through a <video> — the MattingEngine contract.
      const stream = (canvas as HTMLCanvasElement & { captureStream(fps?: number): MediaStream }).captureStream(0);
      const track = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
      const video = document.createElement("video");
      video.muted = true; video.playsInline = true;
      video.srcObject = stream;
      try {
        await video.play().catch(() => {});
        track?.requestFrame?.();
        // Give the stream a tick to present the frame.
        await new Promise((r) => setTimeout(r, 60));
        track?.requestFrame?.();
        const matte = await engine.process(video);
        if (!matte) throw new Error("The matting engine produced no matte for this photo.");
        const alpha = post.process(matte.alpha, matte.width, matte.height);
        return { alpha: new Float32Array(alpha), width: matte.width, height: matte.height };
      } finally {
        video.pause();
        video.srcObject = null;
        stream.getTracks().forEach((t) => t.stop());
      }
    },
    async dispose() {
      if (engine) { await engine.dispose(); engine = null; }
    },
  };
}

/** Composite a photo with a matte over transparency → PNG data URL. */
export function cutoutDataUrl(
  source: HTMLImageElement | HTMLCanvasElement,
  matte: EngineMatte,
  background?: string | null,
): string {
  const sw = (source as HTMLImageElement).naturalWidth || source.width;
  const sh = (source as HTMLImageElement).naturalHeight || source.height;
  // Matte → alpha canvas at matte resolution, then scaled to full res.
  const alphaCanvas = document.createElement("canvas");
  alphaCanvas.width = matte.width; alphaCanvas.height = matte.height;
  const actx = alphaCanvas.getContext("2d")!;
  const img = actx.createImageData(matte.width, matte.height);
  for (let i = 0; i < matte.width * matte.height; i++) {
    img.data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, matte.alpha[i]!)) * 255);
  }
  actx.putImageData(img, 0, 0);

  const out = document.createElement("canvas");
  out.width = sw; out.height = sh;
  const ctx = out.getContext("2d")!;
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, sw, sh); }
  ctx.drawImage(source, 0, 0, sw, sh);
  ctx.globalCompositeOperation = "destination-in";
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(alphaCanvas, 0, 0, sw, sh);
  ctx.globalCompositeOperation = "source-over";
  return out.toDataURL("image/png");
}

/* ── Basic fallback: corner-sampling color-key (pure, tested) ───────── */
export function estimateKeyColor(pixels: Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const pts: [number, number][] = [
    [Math.floor(width * 0.05), Math.floor(height * 0.05)],
    [Math.floor(width * 0.95), Math.floor(height * 0.05)],
    [Math.floor(width * 0.05), Math.floor(height * 0.95)],
    [Math.floor(width * 0.95), Math.floor(height * 0.95)],
  ];
  let r = 0, g = 0, b = 0;
  for (const [x, y] of pts) {
    const i = (y * width + x) * 4;
    r += pixels[i]!; g += pixels[i + 1]!; b += pixels[i + 2]!;
  }
  return [Math.round(r / 4), Math.round(g / 4), Math.round(b / 4)];
}

/**
 * Alpha from color distance to the key color. `aggressiveness` 0..1
 * widens the keyed band (same meaning as the server chroma path).
 */
export function chromaKeyAlpha(
  pixels: Uint8ClampedArray, width: number, height: number,
  aggressiveness = 0.5, key = estimateKeyColor(pixels, width, height),
): Float32Array {
  const n = width * height;
  const alpha = new Float32Array(n);
  const inner = 30 + aggressiveness * 60;   // fully keyed below this distance
  const outer = inner + 70;                  // fully kept above this distance
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const dr = pixels[j]! - key[0], dg = pixels[j + 1]! - key[1], db = pixels[j + 2]! - key[2];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    alpha[i] = dist <= inner ? 0 : dist >= outer ? 1 : (dist - inner) / (outer - inner);
  }
  return alpha;
}
