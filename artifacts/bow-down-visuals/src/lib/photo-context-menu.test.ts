import { describe, it, expect, vi } from "vitest";
import { buildPhotoLayerContextItems } from "./photo-context-menu";
import {
  createPhotoCanvasDoc, makeImageLayer, makeShapeLayer, makeTextLayer, addLayer,
  type PhotoCanvasDoc,
} from "./photo-canvas";
import type { ContextMenuItem } from "../components/editor/ClipContextMenu";

function doc3(): PhotoCanvasDoc {
  let doc = createPhotoCanvasDoc(1280, 720);
  doc = addLayer(doc, makeImageLayer("https://x/a.png", doc, "Base"));
  doc = addLayer(doc, makeShapeLayer(doc, "Bar"));
  doc = addLayer(doc, makeTextLayer("BIG TITLE", doc));
  return doc;
}

function item(items: ContextMenuItem[], key: string): ContextMenuItem {
  const found = items.find((i) => i.key === key);
  if (!found) throw new Error(`missing item ${key}`);
  return found;
}

describe("photo layer context menu", () => {
  it("duplicate commits a doc with the copy above the source", () => {
    const doc = doc3();
    const onCommit = vi.fn();
    const base = doc.layers[0]!;
    const items = buildPhotoLayerContextItems(doc, base, onCommit);
    item(items, "duplicate").onClick?.();
    const next = onCommit.mock.calls[0]![0] as PhotoCanvasDoc;
    expect(next.layers).toHaveLength(4);
    expect(next.layers[1]!.name).toBe("Base copy");
  });

  it("bring forward / send backward disable at the stack ends and reorder for real", () => {
    const doc = doc3();
    const onCommit = vi.fn();
    const top = doc.layers[2]!;
    const topItems = buildPhotoLayerContextItems(doc, top, onCommit);
    expect(item(topItems, "forward").disabled).toBe(true);
    expect(item(topItems, "backward").disabled).toBeFalsy();
    item(topItems, "backward").onClick?.();
    const moved = onCommit.mock.calls[0]![0] as PhotoCanvasDoc;
    expect(moved.layers[1]!.id).toBe(top.id);
    expect(moved.layers[2]!.kind).toBe("shape");

    const bottomItems = buildPhotoLayerContextItems(doc, doc.layers[0]!, vi.fn());
    expect(item(bottomItems, "backward").disabled).toBe(true);
    expect(item(bottomItems, "forward").disabled).toBeFalsy();
  });

  it("visibility toggle and remove commit the model's own operations", () => {
    const doc = doc3();
    const onCommit = vi.fn();
    const bar = doc.layers[1]!;
    const items = buildPhotoLayerContextItems(doc, bar, onCommit);
    expect(item(items, "visible").checked).toBe(true);
    item(items, "visible").onClick?.();
    let next = onCommit.mock.calls[0]![0] as PhotoCanvasDoc;
    expect(next.layers[1]!.visible).toBe(false);
    item(items, "remove").onClick?.();
    next = onCommit.mock.calls[1]![0] as PhotoCanvasDoc;
    expect(next.layers.map((l) => l.id)).not.toContain(bar.id);
    expect(item(items, "remove").danger).toBe(true);
  });
});
