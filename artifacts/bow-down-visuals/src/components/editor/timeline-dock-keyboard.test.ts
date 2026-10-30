/**
 * timeline-dock-keyboard.test.ts — stack1000 M5, surface 2 wiring pins.
 *
 * The dock's twelve drag handles (trim ×4 across both clip variants,
 * fade ×2, crop ×2, export range ×2, loop ×2) are sliders: focusable,
 * aria-valued, and keyed into handlers that share lib/dock-drag with the
 * pointer path. The split already had its keyboard path ("S" key) before
 * this lane — pinned here too so it can't silently regress.
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
    // 12 = trim ×4 + fade ×2 + crop ×2 + range ×2 + loop ×2. (The dock also
    // carries a 13th role="slider": the pre-existing dock-height handle —
    // window chrome, out of this lane's scope, named in the lane report.)
    expect(src.match(/role="slider"/g)?.length).toBeGreaterThanOrEqual(12);
    expect(src.match(/tabIndex=\{0\}/g)?.length).toBeGreaterThanOrEqual(12);
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
