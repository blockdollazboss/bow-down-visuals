/**
 * photo-context-menu.ts — right-click menu items for a photo-canvas
 * layer (layer rows + elements hit on the canvas itself). Pure
 * builder: every item commits the result of the model's own pure
 * stack operations (duplicateLayer / reorderLayer / updateLayer /
 * removeLayer) through the editor's setDoc — the same operations the
 * row buttons call. Bring forward / send backward disable at the
 * ends of the stack, where reorderLayer is a no-op.
 */
import type { ContextMenuItem } from "../components/editor/ClipContextMenu";
import {
  duplicateLayer,
  removeLayer,
  reorderLayer,
  updateLayer,
  type PhotoCanvasDoc,
  type PhotoLayer,
} from "./photo-canvas";

export function buildPhotoLayerContextItems(
  doc: PhotoCanvasDoc,
  layer: PhotoLayer,
  onCommit: (next: PhotoCanvasDoc) => void,
): ContextMenuItem[] {
  const idx = doc.layers.findIndex((l) => l.id === layer.id);
  const atTop = idx >= 0 && idx === doc.layers.length - 1;
  const atBottom = idx <= 0;
  return [
    {
      key: "duplicate",
      label: "Duplicate layer",
      onClick: () => onCommit(duplicateLayer(doc, layer.id)),
    },
    { key: "div-1", divider: true, label: "" },
    {
      key: "forward",
      label: "Bring forward",
      disabled: atTop,
      disabledTitle: "Already at the top",
      onClick: () => onCommit(reorderLayer(doc, layer.id, 1)),
    },
    {
      key: "backward",
      label: "Send backward",
      disabled: atBottom,
      disabledTitle: "Already at the bottom",
      onClick: () => onCommit(reorderLayer(doc, layer.id, -1)),
    },
    { key: "div-2", divider: true, label: "" },
    {
      key: "visible",
      label: layer.visible ? "Hide layer" : "Show layer",
      checked: layer.visible,
      onClick: () => onCommit(updateLayer(doc, layer.id, { visible: !layer.visible })),
    },
    {
      key: "remove",
      label: "Remove layer",
      danger: true,
      onClick: () => onCommit(removeLayer(doc, layer.id)),
    },
  ];
}
