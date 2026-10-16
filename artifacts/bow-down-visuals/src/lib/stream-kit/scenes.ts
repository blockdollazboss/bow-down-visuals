/**
 * scenes.ts — the scene/source model for the parity studio (our OBS).
 *
 * A scene is an ordered stack of sources composited onto the program
 * canvas. `sources` is stored in RENDER order: index 0 is drawn first
 * (the back), the last source is the front. The studio UI lists sources
 * front-first (like OBS) and maps the indices.
 *
 * Source rects are normalized to the canvas (0..1), so scenes are
 * resolution-independent. Fit modes decide how a source's intrinsic
 * pixels land inside its rect: 'cover' crops to fill, 'contain'
 * letterboxes, 'stretch' distorts to the rect exactly.
 *
 * Everything in this module is pure data + math (plus the canvas draw),
 * so the model operations and the chroma keyer are unit-testable.
 */

export type SourceType = "camera" | "screen" | "image" | "text" | "color" | "media" | "widget";
export type FitMode = "cover" | "contain" | "stretch";

/** Overlay widget kinds (Stack 2): all three render from real stream
 *  data — see stream-kit/widget-data.ts. */
export type WidgetKind = "latest-follower" | "tip-ticker" | "goal-bar";

export const WIDGET_KIND_LABELS: Record<WidgetKind, string> = {
  "latest-follower": "Latest follower",
  "tip-ticker": "Tip ticker",
  "goal-bar": "Tip goal bar",
};

export interface ChromaSettings {
  /** Key color as #rrggbb. */
  color: string;
  /** 0..1 — distance below which pixels are fully transparent. */
  similarity: number;
  /** 0..1 — feather width above similarity. */
  smoothness: number;
}

export interface TextSettings {
  content: string;
  /** px at the 720p reference height; scaled to the canvas at draw. */
  fontSize: number;
  color: string;
  bold: boolean;
  fontFamily: string;
  outlineColor: string | null;
}

export interface SceneSource {
  id: string;
  type: SourceType;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0..1 */
  opacity: number;
  /** Normalized destination rect on the canvas. */
  x: number;
  y: number;
  w: number;
  h: number;
  fit: FitMode;
  /* camera */
  cameraMode?: "kit" | "chroma";
  chroma?: ChromaSettings;
  /* image */
  imageUrl?: string;
  /* media (browser-source-LITE: a direct media URL) */
  mediaUrl?: string;
  /* text */
  text?: TextSettings;
  /* color: gradient from → to (equal values = solid) */
  fill?: { from: string; to: string };
  /* widget: which overlay widget this source renders */
  widget?: { kind: WidgetKind };
}

export interface Scene {
  id: string;
  name: string;
  sources: SceneSource[];
}

let uidCounter = 0;
export function uid(prefix: string): string {
  uidCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  camera: "Camera",
  screen: "Screen / Window",
  image: "Image",
  text: "Text",
  color: "Color / Gradient",
  media: "Media URL",
  widget: "Stream Widget",
};

export function createSource(type: SourceType, name?: string): SceneSource {
  const base: SceneSource = {
    id: uid("src"),
    type,
    name: name ?? SOURCE_TYPE_LABELS[type],
    visible: true,
    locked: false,
    opacity: 1,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    fit: "cover",
  };
  switch (type) {
    case "camera":
      return { ...base, cameraMode: "kit", chroma: { color: "#00FF00", similarity: 0.32, smoothness: 0.12 } };
    case "screen":
      return { ...base, name: "Screen Share" };
    case "image":
      return { ...base, fit: "contain" };
    case "text":
      return {
        ...base,
        x: 0.05,
        y: 0.82,
        w: 0.9,
        h: 0.13,
        fit: "contain",
        text: {
          content: "Your text here",
          fontSize: 44,
          color: "#F7ECD2",
          bold: true,
          fontFamily: "Georgia, serif",
          outlineColor: "#000000",
        },
      };
    case "color":
      return { ...base, fill: { from: "#14100a", to: "#0d0a04" } };
    case "media":
      return { ...base, fit: "contain" };
    case "widget":
      return {
        ...base,
        name: "Latest follower",
        x: 0.04,
        y: 0.05,
        w: 0.46,
        h: 0.11,
        fit: "contain",
        widget: { kind: "latest-follower" },
      };
    default:
      return base;
  }
}

export function createScene(name: string, sources: SceneSource[] = []): Scene {
  return { id: uid("scene"), name, sources };
}

/** The starter scene every studio opens with: the kit camera, fullscreen. */
export function createDefaultScene(): Scene {
  return createScene("Main", [createSource("camera", "Camera")]);
}

export function duplicateScene(scene: Scene, name?: string): Scene {
  return {
    id: uid("scene"),
    name: name ?? `${scene.name} copy`,
    sources: scene.sources.map((s) => ({
      ...s,
      id: uid("src"),
      chroma: s.chroma ? { ...s.chroma } : undefined,
      text: s.text ? { ...s.text } : undefined,
      fill: s.fill ? { ...s.fill } : undefined,
      widget: s.widget ? { ...s.widget } : undefined,
    })),
  };
}

/** Move a source one step in render order (dir +1 = toward the front). */
export function moveSource(scene: Scene, sourceId: string, dir: 1 | -1): Scene {
  const idx = scene.sources.findIndex((s) => s.id === sourceId);
  const next = idx + dir;
  if (idx < 0 || next < 0 || next >= scene.sources.length) return scene;
  const sources = [...scene.sources];
  const [item] = sources.splice(idx, 1);
  sources.splice(next, 0, item!);
  return { ...scene, sources };
}

/* ── Fit math ───────────────────────────────────────────────────────────── */

export interface FitRects {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * The source-crop + destination pair for drawImage's 9-arg form.
 * iw/ih are the content's intrinsic size; dest is in canvas pixels.
 */
export function fitRects(
  iw: number,
  ih: number,
  dest: { x: number; y: number; w: number; h: number },
  fit: FitMode,
): FitRects {
  const d = { dx: dest.x, dy: dest.y, dw: dest.w, dh: dest.h };
  if (iw <= 0 || ih <= 0) return { sx: 0, sy: 0, sw: 1, sh: 1, ...d };
  if (fit === "stretch") {
    return { sx: 0, sy: 0, sw: iw, sh: ih, ...d };
  }
  if (fit === "cover") {
    const scale = Math.max(dest.w / iw, dest.h / ih);
    const sw = dest.w / scale;
    const sh = dest.h / scale;
    return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh, ...d };
  }
  // contain
  const scale = Math.min(dest.w / iw, dest.h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  return {
    sx: 0,
    sy: 0,
    sw: iw,
    sh: ih,
    dx: dest.x + (dest.w - dw) / 2,
    dy: dest.y + (dest.h - dh) / 2,
    dw,
    dh,
  };
}

/* ── Chroma key ─────────────────────────────────────────────────────────── */

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 255, b: 0 };
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Alpha (0..1) for one pixel under the key: normalized RGB distance to
 * the key color mapped through similarity (fully keyed) and smoothness
 * (feather). Pure — unit-tested directly.
 */
export function chromaAlpha(
  r: number,
  g: number,
  b: number,
  key: { r: number; g: number; b: number },
  similarity: number,
  smoothness: number,
): number {
  const dr = (r - key.r) / 255;
  const dg = (g - key.g) / 255;
  const db = (b - key.b) / 255;
  const dist = Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3);
  if (dist <= similarity) return 0;
  if (smoothness <= 0) return 1;
  return Math.min(1, Math.max(0, (dist - similarity) / smoothness));
}

/**
 * Apply the key to an ImageData in place: alpha from chromaAlpha, plus a
 * green despill on surviving pixels when the key is green-dominant (the
 * classic fringe fix — clamp green toward the red/blue average).
 */
export function applyChromaKey(data: ImageData, settings: ChromaSettings): void {
  const key = hexToRgb(settings.color);
  const px = data.data;
  const greenKey = key.g > key.r && key.g > key.b;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i]!;
    const g = px[i + 1]!;
    const b = px[i + 2]!;
    const a = chromaAlpha(r, g, b, key, settings.similarity, settings.smoothness);
    px[i + 3] = Math.round(a * 255);
    if (a > 0 && greenKey) {
      const avg = (r + b) / 2;
      if (g > avg) px[i + 1] = Math.round(avg + (g - avg) * a);
    }
  }
}
