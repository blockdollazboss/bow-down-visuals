import { describe, it, expect } from "vitest";
import {
  createPhotoCanvasDoc, makeImageLayer, makeTextLayer, makeShapeLayer,
  addLayer, removeLayer, duplicateLayer, reorderLayer, updateLayer, layerAtPoint,
  buildFlattenPlan, drawFlattenPlan, clampDevelop, developIsIdentity,
  recipeFromDevelop, parseDoc, serializeDoc, type CanvasCtxLike,
} from "./photo-canvas";

function doc3() {
  let doc = createPhotoCanvasDoc(1280, 720);
  doc = addLayer(doc, makeImageLayer("https://x/a.png", doc, "Base"));
  doc = addLayer(doc, makeShapeLayer(doc, "Bar"));
  doc = addLayer(doc, makeTextLayer("BIG TITLE", doc));
  return doc;
}

describe("photo-canvas layer stack", () => {
  it("adds, duplicates (offset, above source), reorders and removes", () => {
    const doc = doc3();
    expect(doc.layers.map((l) => l.kind)).toEqual(["image", "shape", "text"]);
    const imgId = doc.layers[0]!.id;
    const dup = duplicateLayer(doc, imgId);
    expect(dup.layers).toHaveLength(4);
    expect(dup.layers[1]!.name).toBe("Base copy");
    expect(dup.layers[1]!.transform.x).toBe(doc.layers[0]!.transform.x + 16);
    const moved = reorderLayer(doc, imgId, 1);
    expect(moved.layers[0]!.kind).toBe("shape");
    expect(reorderLayer(doc, imgId, -1).layers[0]!.id).toBe(imgId); // bottom: no-op
    expect(removeLayer(doc, imgId).layers).toHaveLength(2);
    const upd = updateLayer(doc, imgId, { visible: false });
    expect(upd.layers[0]!.visible).toBe(false);
    expect(doc.layers[0]!.visible).toBe(true); // original untouched (pure ops)
  });

  it("flatten plan is bottom→top, skips invisible, carries text as a layer (never baked)", () => {
    let doc = doc3();
    doc = updateLayer(doc, doc.layers[1]!.id, { visible: false });
    const plan = buildFlattenPlan(doc);
    expect(plan.map((o) => o.op)).toEqual(["background", "image", "text"]);
    const text = plan[2]!;
    expect(text.op === "text" && text.text).toBe("BIG TITLE");
    expect(text.op === "text" && text.fontStack).toContain("Bebas Neue");
  });

  it("develop clamps and identity detection is exact", () => {
    const c = clampDevelop({ exposure: 99, hue: -999, crop: { x: 2, y: 0, w: 0, h: 5 } });
    expect(c.exposure).toBe(2); expect(c.hue).toBe(-180);
    expect(c.crop).toEqual({ x: 0.99, y: 0, w: 0.01, h: 1 });
    expect(developIsIdentity(clampDevelop({}))).toBe(true);
    expect(developIsIdentity(clampDevelop({ contrast: 5 }))).toBe(false);
    expect(recipeFromDevelop({ saturation: 30 }).develop.saturation).toBe(30);
  });

  it("doc round-trips through serialize/parse with develop clamped", () => {
    const doc = doc3();
    const back = parseDoc(serializeDoc(doc));
    expect(back?.layers).toHaveLength(3);
    expect(parseDoc("not json")).toBeNull();
    expect(parseDoc({ version: 9 })).toBeNull();
  });
});

class FakeCtx implements CanvasCtxLike {
  fillStyle: unknown = ""; globalAlpha = 1; font = ""; textAlign = "left" as CanvasTextAlign;
  textBaseline = "alphabetic" as CanvasTextBaseline; lineWidth = 1; strokeStyle: unknown = "";
  shadowColor = ""; shadowBlur = 0; shadowOffsetY = 0;
  calls: string[] = [];
  fillRect(x: number, y: number, w: number, h: number) { this.calls.push(`fillRect ${x},${y},${w},${h} ${String(this.fillStyle)} a=${this.globalAlpha}`); }
  drawImage(_img: unknown, x: number, y: number, w: number, h: number) { this.calls.push(`drawImage ${x},${y},${w},${h} a=${this.globalAlpha}`); }
  save() { this.calls.push("save"); } restore() { this.calls.push("restore"); }
  translate(x: number, y: number) { this.calls.push(`translate ${x},${y}`); }
  rotate(r: number) { this.calls.push(`rotate ${r.toFixed(3)}`); }
  beginPath() { this.calls.push("beginPath"); }
  ellipse() { this.calls.push("ellipse"); }
  fill() { this.calls.push("fill"); }
  strokeText(t: string, x: number, y: number) { this.calls.push(`strokeText ${t} ${x},${y}`); }
  fillText(t: string, x: number, y: number) { this.calls.push(`fillText ${t} ${x},${y} font=${this.font}`); }
}

describe("layerAtPoint — canvas hit testing", () => {
  it("returns the topmost visible layer, skipping invisible ones", () => {
    const doc = doc3(); // image (full frame) < shape bar < text (top)
    const text = doc.layers[2]!;
    // a point inside the text layer's rect hits the text (topmost)
    expect(layerAtPoint(doc, text.transform.x + 10, text.transform.y + 10)?.id).toBe(text.id);
    // hiding the text layer lets the hit fall through to what's under it
    const hidden = updateLayer(doc, text.id, { visible: false });
    expect(layerAtPoint(hidden, text.transform.x + 10, text.transform.y + 10)?.id).not.toBe(text.id);
    // outside every layer → null (the canvas leaves the browser menu alone)
    expect(layerAtPoint(doc, -50, -50)).toBeNull();
    expect(layerAtPoint(createPhotoCanvasDoc(100, 100), 50, 50)).toBeNull();
  });

  it("honors rotation: a 90°-rotated layer hits along its rotated bounds", () => {
    let doc = createPhotoCanvasDoc(1000, 1000);
    const shape = { ...makeShapeLayer(doc, "Plate"), shape: "rect" as const };
    shape.transform = { x: 400, y: 450, width: 200, height: 100, rotationDeg: 90, opacity: 1 };
    doc = addLayer(doc, shape);
    // center is (500,500); unrotated the layer spans y 450..550, x 400..600.
    // Rotated 90° it spans x 450..550, y 400..600 — (500, 580) only hits rotated.
    expect(layerAtPoint(doc, 500, 580)?.id).toBe(shape.id);
    expect(layerAtPoint(doc, 420, 500)).toBeNull();
  });

  it("ellipse shapes miss their corners and hit their center", () => {
    let doc = createPhotoCanvasDoc(1000, 1000);
    const dot = { ...makeShapeLayer(doc, "Dot"), shape: "ellipse" as const };
    dot.transform = { x: 400, y: 400, width: 200, height: 200, rotationDeg: 0, opacity: 1 };
    doc = addLayer(doc, dot);
    expect(layerAtPoint(doc, 500, 500)?.id).toBe(dot.id);
    expect(layerAtPoint(doc, 410, 410)).toBeNull(); // inside the rect, outside the ellipse
  });
});

describe("flatten fidelity — canvas draw matches the layer model", () => {
  it("draws background, image, then text with layer transforms/opacity, in plan order", () => {
    const doc = doc3();
    const img = doc.layers[0]!;
    const withT = updateLayer(doc, img.id, { transform: { ...img.transform, opacity: 0.5, rotationDeg: 90 } });
    const ctx = new FakeCtx();
    const images = new Map<string, unknown>([[img.id, { fake: true }]]);
    const { drawn, missingImages } = drawFlattenPlan(ctx as unknown as CanvasCtxLike, withT, images);
    expect(missingImages).toEqual([]);
    expect(drawn[0]).toBe("background");
    expect(drawn[1]).toBe(img.id);
    expect(ctx.calls.some((c) => c.startsWith("drawImage -640,-360,1280,720 a=0.5"))).toBe(true);
    expect(ctx.calls.some((c) => c.startsWith("rotate 1.571"))).toBe(true);
    const textCall = ctx.calls.find((c) => c.startsWith("fillText BIG TITLE"));
    expect(textCall).toContain("Bebas Neue");
    expect(ctx.calls.some((c) => c.startsWith("strokeText BIG TITLE"))).toBe(true);
    // order: background fillRect precedes drawImage precedes fillText
    const iBg = ctx.calls.findIndex((c) => c.startsWith("fillRect 0,0,1280,720"));
    const iImg = ctx.calls.findIndex((c) => c.startsWith("drawImage"));
    const iTxt = ctx.calls.findIndex((c) => c.startsWith("fillText"));
    expect(iBg).toBeLessThan(iImg); expect(iImg).toBeLessThan(iTxt);
  });

  it("reports missing images honestly instead of drawing a placeholder", () => {
    const doc = doc3();
    const ctx = new FakeCtx();
    const { missingImages } = drawFlattenPlan(ctx as unknown as CanvasCtxLike, doc, new Map());
    expect(missingImages).toEqual([doc.layers[0]!.id]);
  });
});
