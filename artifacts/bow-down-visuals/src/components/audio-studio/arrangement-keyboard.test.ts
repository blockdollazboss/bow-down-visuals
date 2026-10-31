/**
 * arrangement-keyboard.test.ts — stack1000 M5, surface 3 wiring pins.
 *
 * ArrangementStudio: clips focus + arrows/brackets via dragClipBy (the
 * pointer move handler's own step function), automation points gain a
 * key path through the drag's upsertPoint/removePointNear calls, and
 * comp regions become selectable by keyboard (onClick — they previously
 * selected on pointer-down only, which keyboards never fire).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./ArrangementStudio.tsx", import.meta.url), "utf8");

describe("ArrangementStudio keyboard editing — pins", () => {
  it("pointer move and keyboard share dragClipBy", () => {
    expect(src).toContain("const next = dragClipBy(drag.orig, drag.mode, dx);");
    expect(src).toContain("const next = dragClipBy(clip, mode, dx);");
  });
  it("clips are focusable and labelled with their position and the key help", () => {
    expect(src).toContain("tabIndex: 0,");
    expect(src).toContain("Arrow keys move it, bracket keys trim it.");
    expect(src).toContain("onFocus: () => setSelectedTrackId(track.id),");
    expect(src).toContain("onKeyDown: (e: React.KeyboardEvent) => handleClipKeyDown(e, track,");
  });
  it("the key map covers move + both trims, Shift for ×10 steps", () => {
    for (const line of [
      'e.key === "ArrowLeft") { mode = "move"; dx = -step; }',
      'e.key === "[") { mode = "trimStart"; dx = step; }',
      'e.key === "]") { mode = "trimStart"; dx = -step; }',
      'e.key === "{") { mode = "trimEnd"; dx = step; }',
      'e.key === "}") { mode = "trimEnd"; dx = -step; }',
      "const step = e.shiftKey ? 1 : 0.1;",
    ]) expect(src, line).toContain(line);
  });
  it("clip moves announce on a polite live region", () => {
    expect(src).toContain('aria-live="polite"');
    expect(src).toContain("starts at ${next.startTime.toFixed(2)} seconds");
  });
  it("automation points move and delete through the drag's own calls", () => {
    expect(src).toContain("setLane(upsertPoint(others, time, value));");
    expect(src).toContain("setLane(removePointNear(track.automation[kind], p.time, 0.001));");
    expect(src).toContain("Keyboard: focus a point, arrow keys move it, Delete removes it.");
  });
  it("comp regions select on click too, so the keyboard reaches Delete-selected-region", () => {
    expect(src).toContain("onClick={() => setSelectedRegionId(r.id)}");
    expect(src).toContain('data-testid="btn-delete-comp-region"');
  });
  it("comp segments stay non-interactive (edited in the Takes panel)", () => {
    expect(src).toContain("isCompSeg ? undefined : (e) => onClipPointerDown");
    expect(src).toContain("isCompSeg ? {} : {");
  });
});
