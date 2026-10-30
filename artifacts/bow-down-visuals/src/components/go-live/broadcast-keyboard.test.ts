/**
 * broadcast-keyboard.test.ts — stack1000 M5, surface 4 wiring pins.
 *
 * BroadcastStudio draws sources on canvas, so the keyboard path hangs
 * off the selection frame: it becomes focusable, arrows move the source
 * and Shift+arrows resize it, all through the drag's own updateSource +
 * applySourceDrag. Selection itself was already keyboard-reachable —
 * the Sources panel rows are real buttons that call onSelect.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./BroadcastStudio.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("./studio/SourcesPanel.tsx", import.meta.url), "utf8");

describe("BroadcastStudio keyboard frame — pins", () => {
  it("pointer drag and keyboard share applySourceDrag", () => {
    expect(src).toContain("applySourceDrag(drag.orig, \"move\", dx, dy)");
    expect(src).toContain("applySourceDrag(drag.orig, \"resize\", dx, dy)");
    expect(src).toContain("applySourceDrag(orig, \"resize\", step, 0)");
    expect(src).toContain("applySourceDrag(orig, \"move\", -step, 0)");
  });
  it("the keyboard path writes through the stage's own updateSource", () => {
    expect(src).toContain("stage.updateSource(stage.previewScene().id, source.id, patch);");
  });
  it("locked sources never move by keyboard, mirroring the drag", () => {
    expect(src).toContain("if (source.locked) return;");
  });
  it("the selection frame is focusable, named, and still drags by pointer", () => {
    expect(src).toContain('data-testid="broadcast-source-frame"');
    expect(src).toContain('aria-roledescription="Source frame"');
    expect(src).toContain("Arrow keys move it, Shift plus arrow keys resize it.");
    expect(src).toContain('onPointerDown={(e) => beginDrag(e, "move")}');
    expect(src).toContain("onKeyDown={(e) => handleSourceKeyDown(e, selectedSource)}");
  });
  it("nudges announce position and size on a polite live region", () => {
    expect(src).toContain('aria-live="polite"');
    expect(src).toContain("position ${Math.round(next.x * 100)}%, ${Math.round(next.y * 100)}%");
  });
  it("the hint teaches the keys, and selection stays reachable via the panel rows", () => {
    expect(src).toContain("Keyboard: select a source, focus its gold frame, then arrow keys move it and");
    expect(panel).toContain("onClick={() => onSelect(source.id)}");
  });
});
