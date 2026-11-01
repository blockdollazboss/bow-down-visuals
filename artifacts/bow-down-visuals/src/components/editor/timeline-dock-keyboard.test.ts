/**
 * timeline-dock-keyboard.test.ts — stack1000 M5, surface 2 wiring pins.
 *
 * The dock's twelve drag handles (trim ×4 across both clip variants,
 * fade ×2, crop ×2, export range ×2, loop ×2) are sliders: focusable,
 * aria-valued, and keyed into handlers that share lib/dock-drag with the
 * pointer path. The split already had its keyboard path ("S" key) before
 * this lane — pinned here too so it can't silently regress.
 *
 * Stack1100 residuals round-up: the 13th slider — the dock-height
 * resize handle M5 named as its frontier remainder — is wired the same
 * way (tabIndex + handleResizeKey + the shared dockHeightNext math)
 * and pinned below.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./TimelineDock.tsx", import.meta.url), "utf8");

describe("TimelineDock keyboard handles — pins", () => {
  it("pointer and keyboard share the lib/dock-drag math", () => {
    expect(src).toContain('from "@/lib/dock-drag"');
    for (const fn of ["trimDragValue", "fadeDragValue", "cropDragNext", "rangeDragNext", "loopDragNext"]) {
      // import + pointer-move call + keyboard-handler call
      expect(src.match(new RegExp(`${fn}\\(`, "g"))?.length, fn).toBeGreaterThanOrEqual(2);
    }
  });
  it("all twelve editing handle sites are sliders", () => {
    // 12 = trim ×4 + fade ×2 + crop ×2 + range ×2 + loop ×2. (The dock's
    // 13th role="slider" — the dock-height handle — was M5's named
    // frontier remainder; the stack1100 residuals round-up wired it too,
    // pinned in the dedicated test below.)
    expect(src.match(/role="slider"/g)?.length).toBeGreaterThanOrEqual(12);
    expect(src.match(/tabIndex=\{0\}/g)?.length).toBeGreaterThanOrEqual(12);
  });
  it("the dock-height handle is focusable and keyed into the shared height math", () => {
    expect(src).toContain('data-testid="timeline-dock-resize-handle"');
    // The handle itself carries the focus + key wiring (M5's remainder:
    // it had role/aria but no tabIndex or key path).
    const handle = src.slice(src.indexOf('data-testid="timeline-dock-resize-handle"') - 400, src.indexOf('data-testid="timeline-dock-resize-handle"') + 800);
    expect(handle).toContain("tabIndex={0}");
    expect(handle).toContain("onKeyDown={handleResizeKey}");
    expect(handle).toContain("pixels tall");
    // Pointer resize branch + keyboard handler share dockHeightNext.
    expect(src.match(/dockHeightNext\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(src).toContain("const newHeight = dockHeightNext(drag.startHeight, deltaY, TIMELINE_DOCK_MIN_HEIGHT, TIMELINE_DOCK_MAX_HEIGHT)");
  });
  it("every waveform handle family is keyed (testids + handlers)", () => {
    for (const id of ["dock-range-start", "dock-range-end", "dock-loop-start", "dock-loop-end",
      "dock-fade-in", "dock-fade-out", "dock-crop-start", "dock-crop-end"]) {
      expect(src, id).toContain(`data-testid="${id}"`);
    }
    for (const h of ["handleRangeKey", "handleLoopKey", "handleFadeKey", "handleCropKey", "handleTrimKey"]) {
      expect(src, h).toContain(`onKeyDown={(e) => ${h}(e,`);
    }
  });
  it("trim handles in BOTH clip variants carry the slider wiring", () => {
    expect(src.match(/aria-label=\{`Trim clip \$\{i \+ 1\} start`\}/g)?.length).toBe(2);
    expect(src.match(/aria-label=\{`Trim clip \$\{i \+ 1\} end`\}/g)?.length).toBe(2);
  });
  it("sliders speak positions in human words (fmt m:ss / seconds text)", () => {
    expect(src).toContain("aria-valuetext={fmt(exportRange.customStartSec)}");
    expect(src).toContain("aria-valuetext={fmt(cropEndResolved)}");
    expect(src).toContain("seconds trimmed from the start");
    expect(src).toContain("seconds`}");
  });
  it("the pre-existing split keyboard path still stands", () => {
    expect(src).toContain("splitClipAt");
  });
});
