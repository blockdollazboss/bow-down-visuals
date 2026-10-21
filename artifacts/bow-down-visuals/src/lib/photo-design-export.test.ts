import { describe, it, expect } from "vitest";
import {
  createPhotoCanvasDoc, makeImageLayer, makeTextLayer, makeShapeLayer,
  addLayer, updateLayer,
} from "./photo-canvas";
import {
  buildSvgExport, buildLayerSetManifest, layerFileName, summarizeDesignExport,
} from "./photo-design-export";

/** image (bottom) + shape bar + headline text (top) — the standard desk doc. */
function docMixed() {
  let doc = createPhotoCanvasDoc(1280, 720);
  doc = addLayer(doc, makeImageLayer("https://x/cover.png", doc, "Cover photo"));
  doc = addLayer(doc, makeShapeLayer(doc, "Gold bar"));
  doc = addLayer(doc, makeTextLayer("BIG TITLE", doc, "Headline"));
  return doc;
}
function docVectorOnly() {
  let doc = createPhotoCanvasDoc(1000, 1000);
  doc = addLayer(doc, makeShapeLayer(doc, "Badge"));
  const badge = doc.layers[0]!;
  doc = updateLayer(doc, badge.id, { shape: "ellipse" } as never);
  doc = addLayer(doc, makeTextLayer("MY BRAND", doc, "Wordmark"));
  return doc;
}

describe("buildSvgExport — true vectors only", () => {
  it("emits real vector elements for shape + text layers, and no raster machinery at all", () => {
    const { svg, includedLayerIds, excludedRaster } = buildSvgExport(docVectorOnly());
    expect(svg).not.toBeNull();
    const s = svg!;
    expect(s.startsWith(`<?xml version="1.0" encoding="UTF-8"?>`)).toBe(true);
    expect(s).toContain(`viewBox="0 0 1000 1000"`);
    expect(s).toContain("<ellipse"); // the badge shape, as a vector
    expect(s).toContain("<text");
    expect(s).toContain("MY BRAND");
    expect(s).toContain("Bebas Neue"); // resolved font stack rides along
    expect(includedLayerIds).toHaveLength(2);
    expect(excludedRaster).toEqual([]);
    /* the structural pin: nothing raster may ever appear in an SVG export */
    expect(s).not.toContain("<image");
    expect(s).not.toContain("data:image");
    expect(s).not.toContain("base64");
    expect(s).not.toContain("xlink:href");
  });

  it("mixed design: photo layer is excluded, NAMED in the file and in the result — never embedded", () => {
    const doc = docMixed();
    const { svg, includedLayerIds, excludedRaster } = buildSvgExport(doc);
    expect(svg).not.toBeNull();
    const s = svg!;
    expect(s).toContain("<rect"); // background + gold bar
    expect(s).toContain("BIG TITLE");
    expect(includedLayerIds).toEqual([doc.layers[1]!.id, doc.layers[2]!.id]);
    expect(excludedRaster).toHaveLength(1);
    expect(excludedRaster[0]!.name).toBe("Cover photo");
    expect(excludedRaster[0]!.reason).toContain("raster");
    /* the exclusion note lives inside the delivered file itself */
    expect(s).toContain("Cover photo");
    expect(s).toContain("NOT in this file");
    expect(s).not.toContain("<image");
    expect(s).not.toContain("cover.png");
  });

  it("photos-only design: no SVG at all, with the honest reason — never a wrapped picture", () => {
    let doc = createPhotoCanvasDoc(800, 800);
    doc = addLayer(doc, makeImageLayer("https://x/a.png", doc, "Only photo"));
    const { svg, reason } = buildSvgExport(doc);
    expect(svg).toBeNull();
    expect(reason).toContain("photos only");
    expect(reason).toContain("never faked");
  });

  it("hidden vector layers are not exported (flatten semantics), and the reason says they are hidden", () => {
    let doc = docVectorOnly();
    doc = updateLayer(doc, doc.layers[0]!.id, { visible: false });
    doc = updateLayer(doc, doc.layers[1]!.id, { visible: false });
    const { svg, reason } = buildSvgExport(doc);
    expect(svg).toBeNull();
    expect(reason).toContain("hidden");
  });

  it("empty canvas: no SVG, reason points at adding a layer", () => {
    const { svg, reason } = buildSvgExport(createPhotoCanvasDoc());
    expect(svg).toBeNull();
    expect(reason).toContain("empty");
  });

  it("carries the layer's rotation, opacity, stroke and shadow as vector presentation", () => {
    let doc = createPhotoCanvasDoc(1000, 500);
    doc = addLayer(doc, makeTextLayer("SALE", doc, "Promo"));
    const id = doc.layers[0]!.id;
    doc = updateLayer(doc, id, {
      transform: { x: 100, y: 100, width: 800, height: 200, rotationDeg: 30, opacity: 0.5 },
    } as never);
    const { svg } = buildSvgExport(doc);
    const s = svg!;
    expect(s).toContain("rotate(30)");
    expect(s).toContain(`opacity="0.5"`);
    expect(s).toContain(`paint-order="stroke"`); // makeTextLayer ships a stroke
    expect(s).toContain("feDropShadow"); // and a shadow
    expect(s).toContain(`data-layer-id="${id}"`);
  });

  it("escapes text content and attribute values (no markup breaks out of the file)", () => {
    let doc = createPhotoCanvasDoc(1000, 500);
    doc = addLayer(doc, makeTextLayer(`A & B <Co> "quoted"`, doc, "Tricky"));
    const { svg } = buildSvgExport(doc);
    const s = svg!;
    expect(s).toContain("A &amp; B &lt;Co&gt;");
    expect(s).not.toContain("<Co>");
    /* a hostile layer name cannot break the in-file comment either */
    let doc2 = createPhotoCanvasDoc(100, 100);
    doc2 = addLayer(doc2, makeImageLayer("https://x/a.png", doc2, "evil -- name -->"));
    doc2 = addLayer(doc2, makeShapeLayer(doc2, "ok"));
    const out2 = buildSvgExport(doc2);
    expect(out2.svg).not.toBeNull();
    /* the hostile name cannot mint a second comment close: exactly one
       "-->" exists in the file — the real one. */
    expect(out2.svg!.match(/-->/g)).toHaveLength(1);
  });

  it("does not mutate the doc", () => {
    const doc = docMixed();
    const before = JSON.stringify(doc);
    buildSvgExport(doc);
    buildLayerSetManifest(doc, new Map());
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("layer set manifest", () => {
  it("lists every layer bottom → top with render state, and labels itself honestly", () => {
    const doc = docMixed();
    const files = new Map<string, string | null>(doc.layers.map((l, i) => [l.id, layerFileName(i, l)]));
    const m = buildLayerSetManifest(doc, files);
    expect(m.format).toBe("bow-down-visuals/layer-set");
    expect(m.kind).toBe("png-layer-set");
    expect(m.order).toContain("bottom-to-top");
    expect(m.blendModes).toContain("none stored");
    expect(m.notes.join(" ")).toContain("not a PSD");
    expect(m.canvas).toEqual({ width: 1280, height: 720, background: "#000000" });
    expect(m.layers.map((l) => l.index)).toEqual([0, 1, 2]);
    expect(m.layers.map((l) => l.kind)).toEqual(["image", "shape", "text"]);
    expect(m.layers.every((l) => l.rendered && l.file?.endsWith(".png"))).toBe(true);
    expect(new Set(m.layers.map((l) => l.file)).size).toBe(3); // unique names
    /* the image entry records its develop recipe and says it is NOT baked in */
    const img = m.layers[0]!;
    expect(img.image?.developAppliedToFile).toBe(false);
    expect(img.image?.src).toBe("https://x/cover.png");
    expect(img.note).toContain("NOT baked into the PNG");
    /* the text entry carries the full type spec for a rebuild */
    const txt = m.layers[2]!;
    expect(txt.text?.text).toBe("BIG TITLE");
    expect(txt.text?.fontStack).toContain("Bebas Neue");
  });

  it("a layer that failed to render is marked, not silently dropped", () => {
    const doc = docMixed();
    const files = new Map<string, string | null>([
      [doc.layers[0]!.id, null],
      [doc.layers[1]!.id, layerFileName(1, doc.layers[1]!)],
      [doc.layers[2]!.id, layerFileName(2, doc.layers[2]!)],
    ]);
    const m = buildLayerSetManifest(doc, files);
    expect(m.layers[0]!.rendered).toBe(false);
    expect(m.layers[0]!.file).toBeNull();
    expect(m.layers[0]!.note).toContain("NOT in the ZIP");
    expect(m.layers[1]!.rendered).toBe(true);
  });

  it("hidden layers are included and marked visible: false", () => {
    let doc = docMixed();
    doc = updateLayer(doc, doc.layers[1]!.id, { visible: false });
    const files = new Map<string, string | null>(doc.layers.map((l, i) => [l.id, layerFileName(i, l)]));
    const m = buildLayerSetManifest(doc, files);
    expect(m.layers).toHaveLength(3);
    expect(m.layers[1]!.visible).toBe(false);
    expect(m.layers[0]!.visible).toBe(true);
  });

  it("file names are stable, ordered and filesystem-safe", () => {
    const doc = docMixed();
    expect(layerFileName(0, doc.layers[0]!)).toBe("01-cover-photo-image.png");
    expect(layerFileName(1, doc.layers[1]!)).toBe("02-gold-bar-shape.png");
    expect(layerFileName(2, doc.layers[2]!)).toBe("03-headline-text.png");
  });
});

describe("summarizeDesignExport", () => {
  it("counts visible vector vs raster layers for the UI's honest labels", () => {
    let doc = docMixed();
    expect(summarizeDesignExport(doc)).toEqual({ totalLayers: 3, vectorCount: 2, rasterCount: 1 });
    doc = updateLayer(doc, doc.layers[0]!.id, { visible: false });
    expect(summarizeDesignExport(doc)).toEqual({ totalLayers: 3, vectorCount: 2, rasterCount: 0 });
  });
});
