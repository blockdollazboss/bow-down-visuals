/**
 * photo-canvas.ts — the Photo desk's layered canvas model (Stack 7).
 *
 * One document model backs the on-screen canvas AND export: the canvas
 * preview draws `buildFlattenPlan(doc)` ops in order, and the server
 * render endpoints consume the same camelCase recipe/layer JSON, so
 * what you see is what flattens. Editing is free; only AI generations
 * charge (editor-free law).
 *
 * Layer kinds:
 *  - image: a photo/generated plate, with an optional non-destructive
 *    develop recipe (adjust layer state living on the image layer).
 *  - text:  a true editable text layer — headline text is NEVER baked
 *    into a generated image again for canvas-built work.
 *  - shape: a flat rect/ellipse plate (color blocks, badges).
 */
import { SAFE_FONTS, type FontId } from "./artist-profiles";

export type { FontId };
export { SAFE_FONTS };

/* ── Develop recipe (raster only — no RAW/DNG claims anywhere) ─────── */
export interface DevelopSettings {
  /** EV stops, -2..2 → server eq brightness/contrast + gamma. */
  exposure: number;
  brightness: number; // -100..100
  contrast: number; // -100..100
  temperature: number; // -100 (cool) .. 100 (warm)
  hue: number; // degrees -180..180
  saturation: number; // -100..100
  lightness: number; // -100..100
  /** Normalized crop rect (0..1 of source), null = full frame. */
  crop: { x: number; y: number; w: number; h: number } | null;
  rotateDeg: number; // -45..45 fine rotation (90° steps live in transform)
}

export const DEFAULT_DEVELOP: DevelopSettings = {
  exposure: 0, brightness: 0, contrast: 0, temperature: 0,
  hue: 0, saturation: 0, lightness: 0, crop: null, rotateDeg: 0,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

export function clampDevelop(d: Partial<DevelopSettings> | null | undefined): DevelopSettings {
  const s = { ...DEFAULT_DEVELOP, ...(d ?? {}) };
  return {
    exposure: clamp(s.exposure, -2, 2),
    brightness: clamp(s.brightness, -100, 100),
    contrast: clamp(s.contrast, -100, 100),
    temperature: clamp(s.temperature, -100, 100),
    hue: clamp(s.hue, -180, 180),
    saturation: clamp(s.saturation, -100, 100),
    lightness: clamp(s.lightness, -100, 100),
    rotateDeg: clamp(s.rotateDeg, -45, 45),
    crop: s.crop
      ? {
          x: clamp(s.crop.x, 0, 0.99), y: clamp(s.crop.y, 0, 0.99),
          w: clamp(s.crop.w, 0.01, 1), h: clamp(s.crop.h, 0.01, 1),
        }
      : null,
  };
}

export function developIsIdentity(d: DevelopSettings): boolean {
  const c = clampDevelop(d);
  return (
    c.exposure === 0 && c.brightness === 0 && c.contrast === 0 && c.temperature === 0 &&
    c.hue === 0 && c.saturation === 0 && c.lightness === 0 && c.crop === null && c.rotateDeg === 0
  );
}

/** A recipe is exactly the syncable/presettable unit: develop state. */
export interface PhotoRecipe {
  develop: DevelopSettings;
}

export function recipeFromDevelop(develop: Partial<DevelopSettings> | null | undefined): PhotoRecipe {
  return { develop: clampDevelop(develop ?? undefined) };
}

/* ── Layers ─────────────────────────────────────────────────────────── */
export interface LayerTransform {
  x: number; y: number; // top-left in canvas px
  width: number; height: number;
  rotationDeg: number; // -180..180
  opacity: number; // 0..1
}

export const DEFAULT_TRANSFORM: LayerTransform = { x: 0, y: 0, width: 0, height: 0, rotationDeg: 0, opacity: 1 };

export interface PhotoLayerBase {
  id: string;
  name: string;
  visible: boolean;
  transform: LayerTransform;
}
export interface ImageLayer extends PhotoLayerBase {
  kind: "image";
  src: string;
  develop: DevelopSettings;
}
export interface TextLayer extends PhotoLayerBase {
  kind: "text";
  text: string;
  fontId: FontId;
  fontSize: number;
  color: string;
  strokeColor: string | null;
  strokeWidth: number;
  shadowColor: string | null;
  shadowBlur: number;
  shadowOffsetY: number;
  align: "left" | "center" | "right";
  bold: boolean;
}
export interface ShapeLayer extends PhotoLayerBase {
  kind: "shape";
  shape: "rect" | "ellipse";
  fill: string;
}
export type PhotoLayer = ImageLayer | TextLayer | ShapeLayer;

export interface PhotoCanvasDoc {
  version: 1;
  width: number;
  height: number;
  background: string; // CSS color painted under everything
  layers: PhotoLayer[]; // bottom → top
}

let seq = 0;
export function newLayerId(prefix = "layer"): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function createPhotoCanvasDoc(width = 1280, height = 720): PhotoCanvasDoc {
  return { version: 1, width: Math.max(16, Math.round(width)), height: Math.max(16, Math.round(height)), background: "#000000", layers: [] };
}

export function makeImageLayer(src: string, doc: PhotoCanvasDoc, name = "Photo"): ImageLayer {
  return {
    id: newLayerId("img"), kind: "image", name, src, visible: true,
    develop: { ...DEFAULT_DEVELOP },
    transform: { x: 0, y: 0, width: doc.width, height: doc.height, rotationDeg: 0, opacity: 1 },
  };
}

export function makeTextLayer(text: string, doc: PhotoCanvasDoc, name = "Headline"): TextLayer {
  return {
    id: newLayerId("txt"), kind: "text", name, text, visible: true,
    fontId: "Bebas Neue", fontSize: Math.max(24, Math.round(doc.height / 8)),
    color: "#ffffff", strokeColor: "#000000", strokeWidth: 2,
    shadowColor: "rgba(0,0,0,0.55)", shadowBlur: 6, shadowOffsetY: 3,
    align: "center", bold: true,
    transform: { x: doc.width * 0.05, y: doc.height * 0.68, width: doc.width * 0.9, height: doc.height * 0.22, rotationDeg: 0, opacity: 1 },
  };
}

export function makeShapeLayer(doc: PhotoCanvasDoc, name = "Shape"): ShapeLayer {
  return {
    id: newLayerId("shp"), kind: "shape", name, shape: "rect", fill: "#d4af37", visible: true,
    transform: { x: doc.width * 0.05, y: doc.height * 0.6, width: doc.width * 0.9, height: 8, rotationDeg: 0, opacity: 1 },
  };
}

/* ── Stack operations (pure — return a new doc) ─────────────────────── */
export function addLayer(doc: PhotoCanvasDoc, layer: PhotoLayer): PhotoCanvasDoc {
  return { ...doc, layers: [...doc.layers, layer] };
}
export function removeLayer(doc: PhotoCanvasDoc, id: string): PhotoCanvasDoc {
  return { ...doc, layers: doc.layers.filter((l) => l.id !== id) };
}
export function updateLayer(doc: PhotoCanvasDoc, id: string, patch: Partial<PhotoLayer>): PhotoCanvasDoc {
  return {
    ...doc,
    layers: doc.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as PhotoLayer) : l)),
  };
}
export function duplicateLayer(doc: PhotoCanvasDoc, id: string): PhotoCanvasDoc {
  const idx = doc.layers.findIndex((l) => l.id === id);
  if (idx < 0) return doc;
  const src = doc.layers[idx]!;
  const copy: PhotoLayer = {
    ...JSON.parse(JSON.stringify(src)),
    id: newLayerId(src.kind),
    name: `${src.name} copy`,
    transform: { ...src.transform, x: src.transform.x + 16, y: src.transform.y + 16 },
  } as PhotoLayer;
  const layers = [...doc.layers];
  layers.splice(idx + 1, 0, copy);
  return { ...doc, layers };
}
/** Move a layer one step up (+1, toward top) or down (-1). */
export function reorderLayer(doc: PhotoCanvasDoc, id: string, delta: 1 | -1): PhotoCanvasDoc {
  const idx = doc.layers.findIndex((l) => l.id === id);
  const next = idx + delta;
  if (idx < 0 || next < 0 || next >= doc.layers.length) return doc;
  const layers = [...doc.layers];
  const [moved] = layers.splice(idx, 1);
  layers.splice(next, 0, moved!);
  return { ...doc, layers };
}

/**
 * Hit test in document coordinates: the topmost VISIBLE layer under
 * (x, y), or null. Geometry matches drawFlattenPlan — the point is
 * un-rotated around the layer's center, rectangles test their bounds,
 * ellipse shapes test the ellipse equation (their corners miss).
 */
export function layerAtPoint(doc: PhotoCanvasDoc, x: number, y: number): PhotoLayer | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const layer = doc.layers[i]!;
    if (!layer.visible) continue;
    const t = layer.transform;
    if (!(t.width > 0) || !(t.height > 0)) continue;
    const cx = t.x + t.width / 2;
    const cy = t.y + t.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const rot = Number.isFinite(t.rotationDeg) ? t.rotationDeg : 0;
    const rad = (-rot * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    if (layer.kind === "shape" && layer.shape === "ellipse") {
      const ex = lx / (t.width / 2);
      const ey = ly / (t.height / 2);
      if (ex * ex + ey * ey <= 1) return layer;
    } else if (Math.abs(lx) <= t.width / 2 && Math.abs(ly) <= t.height / 2) {
      return layer;
    }
  }
  return null;
}

export function fontStackFor(fontId: string): string {
  return SAFE_FONTS.find((f) => f.id === fontId)?.stack ?? "'Inter', system-ui, sans-serif";
}

/* ── Flatten plan + canvas renderer (WYSIWYG core) ──────────────────── */
export type FlattenOp =
  | { op: "background"; color: string }
  | { op: "image"; layerId: string; src: string; transform: LayerTransform; develop: DevelopSettings }
  | { op: "text"; layerId: string; text: string; fontStack: string; fontSize: number; bold: boolean; color: string; strokeColor: string | null; strokeWidth: number; shadowColor: string | null; shadowBlur: number; shadowOffsetY: number; align: TextLayer["align"]; transform: LayerTransform }
  | { op: "shape"; layerId: string; shape: ShapeLayer["shape"]; fill: string; transform: LayerTransform };

/** Ordered draw ops, bottom → top, invisible layers excluded. Both the
 *  browser canvas and any other renderer consume THIS plan, so the
 *  flatten cannot drift from the preview's layer semantics. */
export function buildFlattenPlan(doc: PhotoCanvasDoc): FlattenOp[] {
  const ops: FlattenOp[] = [{ op: "background", color: doc.background }];
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    if (layer.kind === "image") {
      ops.push({ op: "image", layerId: layer.id, src: layer.src, transform: { ...layer.transform }, develop: clampDevelop(layer.develop) });
    } else if (layer.kind === "text") {
      ops.push({
        op: "text", layerId: layer.id, text: layer.text, fontStack: fontStackFor(layer.fontId),
        fontSize: layer.fontSize, bold: layer.bold, color: layer.color,
        strokeColor: layer.strokeColor, strokeWidth: layer.strokeWidth,
        shadowColor: layer.shadowColor, shadowBlur: layer.shadowBlur, shadowOffsetY: layer.shadowOffsetY,
        align: layer.align, transform: { ...layer.transform },
      });
    } else {
      ops.push({ op: "shape", layerId: layer.id, shape: layer.shape, fill: layer.fill, transform: { ...layer.transform } });
    }
  }
  return ops;
}

/** Minimal 2D context surface the renderer needs (real CanvasRenderingContext2D satisfies it). */
export interface CanvasCtxLike {
  fillStyle: string | CanvasGradient | CanvasPattern;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  lineWidth: number;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetY: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(img: unknown, x: number, y: number, w: number, h: number): void;
  save(): void; restore(): void;
  translate(x: number, y: number): void; rotate(rad: number): void;
  beginPath(): void; ellipse(x: number, y: number, rx: number, ry: number, rot: number, a: number, b: number): void; fill(): void;
  strokeText(text: string, x: number, y: number): void; fillText(text: string, x: number, y: number): void;
}

/**
 * Draw the flatten plan. NOTE on develop: CSS-canvas cannot apply the
 * full develop recipe per layer cheaply, so the preview applies the
 * recipe's crop/rotation via the transform and the EXPORT path applies
 * the color recipe server-side per image layer before compositing —
 * geometry (position/scale/rotation/opacity/order/text) is identical
 * in both; color-develop is export-authoritative and the UI says so.
 */
export function drawFlattenPlan(
  ctx: CanvasCtxLike,
  doc: PhotoCanvasDoc,
  images: ReadonlyMap<string, unknown>,
): { drawn: string[]; missingImages: string[] } {
  const drawn: string[] = [];
  const missingImages: string[] = [];
  for (const op of buildFlattenPlan(doc)) {
    if (op.op === "background") {
      ctx.globalAlpha = 1; ctx.fillStyle = op.color;
      ctx.fillRect(0, 0, doc.width, doc.height);
      drawn.push("background");
      continue;
    }
    const t = op.transform;
    ctx.save();
    ctx.globalAlpha = clamp(t.opacity, 0, 1);
    const cx = t.x + t.width / 2, cy = t.y + t.height / 2;
    ctx.translate(cx, cy);
    if (t.rotationDeg) ctx.rotate((t.rotationDeg * Math.PI) / 180);
    if (op.op === "image") {
      const img = images.get(op.layerId) ?? images.get(op.src);
      if (!img) { missingImages.push(op.layerId); ctx.restore(); continue; }
      ctx.drawImage(img, -t.width / 2, -t.height / 2, t.width, t.height);
      drawn.push(op.layerId);
    } else if (op.op === "shape") {
      ctx.fillStyle = op.fill;
      if (op.shape === "ellipse") {
        ctx.beginPath();
        ctx.ellipse(0, 0, t.width / 2, t.height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-t.width / 2, -t.height / 2, t.width, t.height);
      }
      drawn.push(op.layerId);
    } else {
      ctx.font = `${op.bold ? "700 " : ""}${op.fontSize}px ${op.fontStack}`;
      ctx.textAlign = op.align; ctx.textBaseline = "middle";
      const tx = op.align === "left" ? -t.width / 2 : op.align === "right" ? t.width / 2 : 0;
      if (op.shadowColor) { ctx.shadowColor = op.shadowColor; ctx.shadowBlur = op.shadowBlur; ctx.shadowOffsetY = op.shadowOffsetY; }
      if (op.strokeColor && op.strokeWidth > 0) {
        ctx.lineWidth = op.strokeWidth; ctx.strokeStyle = op.strokeColor;
        ctx.strokeText(op.text, tx, 0);
      }
      ctx.fillStyle = op.color;
      ctx.fillText(op.text, tx, 0);
      drawn.push(op.layerId);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  return { drawn, missingImages };
}

/* ── Presets (same recipe format batch look-sync uses) ──────────────── */
export interface PhotoPreset {
  id: string;
  name: string;
  recipe: PhotoRecipe;
  isPublic: boolean;
  shareSlug: string | null;
  storeProductId: string | null;
}

export function serializeDoc(doc: PhotoCanvasDoc): string {
  return JSON.stringify(doc);
}
export function parseDoc(raw: unknown): PhotoCanvasDoc | null {
  try {
    const d = (typeof raw === "string" ? JSON.parse(raw) : raw) as PhotoCanvasDoc;
    if (!d || d.version !== 1 || !Array.isArray(d.layers) || typeof d.width !== "number") return null;
    return {
      ...d,
      layers: d.layers.map((l) =>
        l.kind === "image" ? { ...l, develop: clampDevelop(l.develop) } : l,
      ),
    };
  } catch { return null; }
}
