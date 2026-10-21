/**
 * photo-design-export.ts — professional file hand-off for the Photo
 * desk's layered canvas (lib/photo-canvas.ts): true-vector SVG and a
 * layered PNG set with a manifest.
 *
 * HONESTY RULES (the reason this module exists):
 *  - The SVG is generated FROM the same flatten plan the canvas draws
 *    (buildFlattenPlan), mapping each op to real vector elements —
 *    background → <rect>, shape → <rect>/<ellipse>, text → <text>.
 *    A generated/photo layer is raster: it is NEVER embedded in the
 *    SVG (no <image>, no data-URL, no "PNG in an SVG wrapper"). Raster
 *    layers are excluded and NAMED — in the file itself (comment +
 *    <desc>) and in the returned result — so the exclusion is never
 *    silent.
 *  - If a design has no visible vector-expressible layer, there is no
 *    SVG: the result says why instead of handing over an empty shell.
 *  - The layer set is one transparent full-canvas PNG per layer plus
 *    manifest.json, honestly labeled a PNG layer set — NOT a PSD.
 *    The design model stores no blend modes; the manifest says so
 *    rather than inventing them.
 *
 * Both exports are pure derivations of the saved doc and ride the
 * desk's existing discipline: editing and exporting are free, only AI
 * generations charge (editor-free law — see photo-canvas.ts).
 */
import {
  buildFlattenPlan,
  fontStackFor,
  type DevelopSettings,
  type LayerTransform,
  type PhotoCanvasDoc,
  type PhotoLayer,
} from "./photo-canvas";

/* ── small helpers ──────────────────────────────────────────────────── */

const fmt = (n: number): string => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? "0" : String(v);
};

function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s: string): string {
  return escText(s).replace(/"/g, "&quot;");
}
/** XML comments may not contain "--"; make arbitrary layer names safe. */
function commentSafe(s: string): string {
  return s.replace(/--+/g, "—").replace(/-+$/, "");
}
function idSafe(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "-");
}

/** Parse the CSS colors the layer model stores (#hex, rgb(), rgba())
 *  into an SVG flood color + opacity. Unparseable values ride through
 *  as-is with full opacity — SVG accepts any CSS color in flood-color. */
function parseCssColor(raw: string): { color: string; opacity: number } {
  const s = raw.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    const h = hex[1]!;
    if (h.length === 8) {
      const a = parseInt(h.slice(6, 8), 16) / 255;
      return { color: `#${h.slice(0, 6)}`, opacity: Math.round(a * 1000) / 1000 };
    }
    return { color: s, opacity: 1 };
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (fn) {
    const parts = fn[1]!.split(",").map((p) => p.trim());
    if (parts.length >= 3) {
      const a = parts.length >= 4 ? Number(parts[3]) : 1;
      return {
        color: `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`,
        opacity: Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1,
      };
    }
  }
  return { color: s, opacity: 1 };
}

/* ── SVG export ─────────────────────────────────────────────────────── */

export interface SvgExcludedLayer {
  layerId: string;
  name: string;
  /** Always the same reason, stated plainly: photos are raster. */
  reason: string;
}

export interface SvgExportResult {
  /** The SVG document, or null when the design has no visible
   *  vector-expressible layer — never an empty or raster-faked file. */
  svg: string | null;
  /** Why svg is null (null when an SVG was produced). */
  reason: string | null;
  /** Visible text/shape layers rendered as true vectors, bottom → top. */
  includedLayerIds: string[];
  /** Visible photo (raster) layers deliberately left out, named. */
  excludedRaster: SvgExcludedLayer[];
}

const RASTER_REASON = "photo (raster) layer — an SVG cannot hold it as a vector, and it is never embedded as a picture";

export function buildSvgExport(doc: PhotoCanvasDoc): SvgExportResult {
  const plan = buildFlattenPlan(doc);
  const byId = new Map(doc.layers.map((l) => [l.id, l]));
  const includedLayerIds: string[] = [];
  const excludedRaster: SvgExcludedLayer[] = [];
  const defs: string[] = [];
  const body: string[] = [];

  for (const op of plan) {
    if (op.op === "background") {
      body.push(
        `  <rect data-layer-id="background" x="0" y="0" width="${fmt(doc.width)}" height="${fmt(doc.height)}" fill="${escAttr(op.color)}"/>`,
      );
      continue;
    }
    if (op.op === "image") {
      excludedRaster.push({
        layerId: op.layerId,
        name: byId.get(op.layerId)?.name ?? op.layerId,
        reason: RASTER_REASON,
      });
      continue;
    }
    const t = op.transform;
    const cx = t.x + t.width / 2;
    const cy = t.y + t.height / 2;
    const transform = `translate(${fmt(cx)} ${fmt(cy)})` + (t.rotationDeg ? ` rotate(${fmt(t.rotationDeg)})` : "");
    const opacity = t.opacity < 1 ? ` opacity="${fmt(Math.max(0, t.opacity))}"` : "";
    const name = byId.get(op.layerId)?.name ?? op.layerId;
    const tag = `data-layer-id="${escAttr(op.layerId)}" data-layer-name="${escAttr(name)}"`;

    if (op.op === "shape") {
      const inner =
        op.shape === "ellipse"
          ? `<ellipse cx="0" cy="0" rx="${fmt(t.width / 2)}" ry="${fmt(t.height / 2)}" fill="${escAttr(op.fill)}"/>`
          : `<rect x="${fmt(-t.width / 2)}" y="${fmt(-t.height / 2)}" width="${fmt(t.width)}" height="${fmt(t.height)}" fill="${escAttr(op.fill)}"/>`;
      body.push(`  <g ${tag} transform="${transform}"${opacity}>${inner}</g>`);
      includedLayerIds.push(op.layerId);
      continue;
    }

    /* text op — geometry mirrors drawFlattenPlan exactly: the text is
       centered on the layer's center point, aligned within its box. */
    const anchor = op.align === "left" ? "start" : op.align === "right" ? "end" : "middle";
    const tx = op.align === "left" ? -t.width / 2 : op.align === "right" ? t.width / 2 : 0;
    let filterAttr = "";
    if (op.shadowColor && (op.shadowBlur > 0 || op.shadowOffsetY !== 0)) {
      const fid = `layer-shadow-${idSafe(op.layerId)}`;
      const { color, opacity: floodOpacity } = parseCssColor(op.shadowColor);
      defs.push(
        `<filter id="${fid}" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="${fmt(op.shadowOffsetY)}" stdDeviation="${fmt(op.shadowBlur / 2)}" flood-color="${escAttr(color)}" flood-opacity="${fmt(floodOpacity)}"/></filter>`,
      );
      filterAttr = ` filter="url(#${fid})"`;
    }
    const strokeAttrs =
      op.strokeColor && op.strokeWidth > 0
        ? ` stroke="${escAttr(op.strokeColor)}" stroke-width="${fmt(op.strokeWidth)}" paint-order="stroke"`
        : "";
    body.push(
      `  <g ${tag} transform="${transform}"${opacity}><text x="${fmt(tx)}" y="0" font-family="${escAttr(op.fontStack)}" font-size="${fmt(op.fontSize)}" font-weight="${op.bold ? 700 : 400}" fill="${escAttr(op.color)}" text-anchor="${anchor}" dominant-baseline="central" xml:space="preserve"${strokeAttrs}${filterAttr}>${escText(op.text)}</text></g>`,
    );
    includedLayerIds.push(op.layerId);
  }

  if (includedLayerIds.length === 0) {
    const vectorLayers = doc.layers.filter((l) => l.kind === "text" || l.kind === "shape");
    const reason =
      doc.layers.length === 0
        ? "The canvas is empty — add a text or shape layer and the SVG export builds itself from it."
        : vectorLayers.length > 0
          ? "Every text/shape layer in this design is hidden, and hidden layers are never exported. Unhide one to get its true vectors."
          : "This design is photos only. SVG is built from true vector layers (text and shapes) and is never faked by wrapping a picture in an SVG file — download the layer set (ZIP) for the photo layers, or add a text or shape layer.";
    return { svg: null, reason, includedLayerIds, excludedRaster };
  }

  const excludedNote = excludedRaster.length
    ? ` Photo (raster) layers are NOT in this file and are never embedded as pictures: ${excludedRaster.map((e) => `"${e.name}"`).join(", ")}. They are in the layer-set (ZIP) export.`
    : " Every layer in this design is a true vector (text and shapes).";
  const desc = `True-vector export from Bow Down Visuals, generated from the design's text and shape layers.${excludedNote}`;
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!-- ${commentSafe(desc)} -->`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(doc.width)}" height="${fmt(doc.height)}" viewBox="0 0 ${fmt(doc.width)} ${fmt(doc.height)}" role="img">`,
    `  <desc>${escText(desc)}</desc>`,
    ...(defs.length ? [`  <defs>${defs.join("")}</defs>`] : []),
    ...body,
    `</svg>`,
    ``,
  ].join("\n");
  return { svg, reason: null, includedLayerIds, excludedRaster };
}

/* ── Layer set (transparent PNGs + manifest) ────────────────────────── */

export interface LayerSetLayerEntry {
  /** 0 = bottom of the stack; layers composite in index order. */
  index: number;
  layerId: string;
  name: string;
  kind: PhotoLayer["kind"];
  /** File inside the ZIP, or null when the layer did not render. */
  file: string | null;
  rendered: boolean;
  visible: boolean;
  transform: LayerTransform;
  note: string;
  text?: {
    text: string; fontId: string; fontStack: string; fontSize: number;
    color: string; strokeColor: string | null; strokeWidth: number;
    shadowColor: string | null; shadowBlur: number; shadowOffsetY: number;
    align: string; bold: boolean;
  };
  shape?: { shape: string; fill: string };
  image?: {
    src: string;
    develop: DevelopSettings;
    /** Layer PNGs are the photo as placed; develop is recorded for
     *  the record but applied only by the flattened server exports. */
    developAppliedToFile: false;
  };
}

export interface LayerSetManifest {
  format: "bow-down-visuals/layer-set";
  version: 1;
  generatedBy: string;
  /** Honest labeling: this is a PNG layer set, never a "PSD". */
  kind: "png-layer-set";
  canvas: { width: number; height: number; background: string };
  /** How to rebuild the design: stack the files in index order. */
  order: "bottom-to-top by index";
  /** The model stores no blend modes — stated, never invented. */
  blendModes: string;
  notes: string[];
  layers: LayerSetLayerEntry[];
}

function slugify(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "layer";
}

export function layerFileName(index: number, layer: PhotoLayer): string {
  return `${String(index + 1).padStart(2, "0")}-${slugify(layer.name)}-${layer.kind}.png`;
}

const LAYER_NOTES: Record<PhotoLayer["kind"], string> = {
  image:
    "Photo (raster) layer rendered as placed, at full canvas size. Its develop recipe is recorded in this entry but is NOT baked into the PNG — the flattened server exports are where develop is applied.",
  text: "Text layer rendered as pixels for this set. The SVG export carries this same layer as true, editable vector text.",
  shape:
    "Shape layer rendered as pixels for this set. The SVG export carries this same layer as a true vector shape.",
};

/**
 * Build the layer-set manifest. `files` maps layer id → the PNG file
 * name the caller actually rendered into the ZIP (absent/null = the
 * layer failed to render and is NOT in the ZIP — the entry says so).
 * Every layer is listed, including hidden ones (marked visible:false),
 * exactly like a professional layered file.
 */
export function buildLayerSetManifest(
  doc: PhotoCanvasDoc,
  files: ReadonlyMap<string, string | null>,
): LayerSetManifest {
  const layers: LayerSetLayerEntry[] = doc.layers.map((layer, index) => {
    const file = files.get(layer.id) ?? null;
    const entry: LayerSetLayerEntry = {
      index,
      layerId: layer.id,
      name: layer.name,
      kind: layer.kind,
      file,
      rendered: file !== null,
      visible: layer.visible,
      transform: { ...layer.transform },
      note: LAYER_NOTES[layer.kind],
    };
    if (!entry.rendered) {
      entry.note += " This layer could not be rendered (its photo had not loaded) and is NOT in the ZIP.";
    }
    if (layer.kind === "text") {
      entry.text = {
        text: layer.text,
        fontId: layer.fontId,
        fontStack: fontStackFor(layer.fontId),
        fontSize: layer.fontSize,
        color: layer.color,
        strokeColor: layer.strokeColor,
        strokeWidth: layer.strokeWidth,
        shadowColor: layer.shadowColor,
        shadowBlur: layer.shadowBlur,
        shadowOffsetY: layer.shadowOffsetY,
        align: layer.align,
        bold: layer.bold,
      };
    } else if (layer.kind === "shape") {
      entry.shape = { shape: layer.shape, fill: layer.fill };
    } else {
      entry.image = { src: layer.src, develop: { ...layer.develop, crop: layer.develop.crop ? { ...layer.develop.crop } : null }, developAppliedToFile: false };
    }
    return entry;
  });

  return {
    format: "bow-down-visuals/layer-set",
    version: 1,
    generatedBy: "Bow Down Visuals — Thumbnail Studio, Photo desk",
    kind: "png-layer-set",
    canvas: { width: doc.width, height: doc.height, background: doc.background },
    order: "bottom-to-top by index",
    blendModes: "none stored — the design model has no per-layer blend modes; every layer composites source-over at its stored opacity (see each layer's transform)",
    notes: [
      "This is a PNG layer set, not a PSD: one transparent full-canvas PNG per layer, so stacking the files in index order rebuilds the design in any editor.",
      "Hidden layers are included and marked visible: false, like a professional layered file.",
      "For true vectors, use the SVG export — it carries the text and shape layers as real vector elements and never embeds photos.",
    ],
    layers,
  };
}

/* ── UI summary ─────────────────────────────────────────────────────── */

export interface DesignExportSummary {
  totalLayers: number;
  /** Visible text/shape layers — what the SVG will carry. */
  vectorCount: number;
  /** Visible photo layers — what the SVG will leave out, by name. */
  rasterCount: number;
}

export function summarizeDesignExport(doc: PhotoCanvasDoc): DesignExportSummary {
  let vectorCount = 0;
  let rasterCount = 0;
  for (const l of doc.layers) {
    if (!l.visible) continue;
    if (l.kind === "image") rasterCount += 1;
    else vectorCount += 1;
  }
  return { totalLayers: doc.layers.length, vectorCount, rasterCount };
}
