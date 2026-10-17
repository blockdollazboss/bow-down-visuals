import { describe, it, expect } from "vitest";
import {
  computeMasterPlayerFit,
  MASTER_PLAYER_FIT_MARGIN,
  MASTER_PLAYER_MINIMIZED_CHIP_WIDTH,
  type MasterPlayerFitInput,
} from "./master-player-size";
import {
  MASTER_PLAYER_MAX_WIDTH,
  MASTER_PLAYER_MIN_WIDTH,
  MASTER_PLAYER_MIN_HEIGHT,
} from "./editor-settings";

const FORMATS: Record<string, number> = {
  "9:16": 9 / 16,
  "16:9": 16 / 9,
  "1:1": 1,
  "4:5": 4 / 5,
};

function base(over: Partial<MasterPlayerFitInput> = {}): MasterPlayerFitInput {
  return {
    viewportHeight: 900,
    headerHeight: 64,
    dockHeight: 160,
    chromeHeight: 150,
    columnWidth: 1200,
    aspect: FORMATS["9:16"],
    savedWidth: 480,
    minimized: false,
    ...over,
  };
}

/** Total on-screen footprint of video + player chrome. */
function total(input: MasterPlayerFitInput): number {
  const { height } = computeMasterPlayerFit(input);
  return height + input.chromeHeight;
}

/** Usable vertical space between toolbar and dock, minus margins.
 *  The margin is the module's own design constant (MASTER_PLAYER_FIT_MARGIN
 *  per side): it was 16px when this suite was written and was deliberately
 *  reduced to 8px in 7df8af33 ("just enough to see the player's hover
 *  glow"), so the band is derived from the constant, not a hardcoded 32. */
function usableBand(input: MasterPlayerFitInput): number {
  return input.viewportHeight - input.headerHeight - input.dockHeight - MASTER_PLAYER_FIT_MARGIN * 2;
}

describe("computeMasterPlayerFit", () => {
  it("9:16 on a normal laptop viewport fits with transport visible", () => {
    const input = base();
    const { width, height } = computeMasterPlayerFit(input);
    expect(width).toBeGreaterThan(0);
    expect(height).toBe(Math.round(width / FORMATS["9:16"]));
    // video + chrome must fit between toolbar and dock
    expect(total(input)).toBeLessThanOrEqual(usableBand(input));
  });

  it("16:9 grows to a readable height instead of a thin strip", () => {
    const input = base({ aspect: FORMATS["16:9"], columnWidth: 1200 });
    const { width, height } = computeMasterPlayerFit(input);
    expect(height).toBeGreaterThanOrEqual(MASTER_PLAYER_MIN_HEIGHT);
    expect(total(input)).toBeLessThanOrEqual(usableBand(input));
  });

  it("16:9 in a narrow column never exceeds the column (no clamp distortion)", () => {
    const input = base({ aspect: FORMATS["16:9"], columnWidth: 522 });
    const { width } = computeMasterPlayerFit(input);
    expect(width).toBeLessThanOrEqual(522);
    expect(total(input)).toBeLessThanOrEqual(usableBand(input));
  });

  it("1:1 and 4:5 fit with transport visible", () => {
    for (const fmt of ["1:1", "4:5"] as const) {
      const input = base({ aspect: FORMATS[fmt] });
      expect(total(input)).toBeLessThanOrEqual(usableBand(input));
    }
  });

  it("short viewport: 9:16 shrinks instead of overflowing (the reported bug)", () => {
    // 650px-tall viewport: old code floored width at 180 → 320px tall video,
    // pushing transport rows below the fold.
    const input = base({ viewportHeight: 650, aspect: FORMATS["9:16"] });
    const { width, height } = computeMasterPlayerFit(input);
    expect(width).toBeLessThan(MASTER_PLAYER_MIN_WIDTH); // floor yields to fit
    expect(height).toBeLessThanOrEqual(usableBand(input) - input.chromeHeight);
    expect(total(input)).toBeLessThanOrEqual(usableBand(input));
  });

  it("very short viewport collapses the canvas but never NaNs; chrome still renders", () => {
    // A viewport short enough that the band is genuinely exhausted:
    // header + dock + chrome + both fit margins, minus a few px. (At the
    // old 16px margin a 400px viewport exhausted the band; at the current
    // 8px margin the exhaustion point is 390px for these fixtures.)
    const exhausted =
      base().headerHeight + base().dockHeight + base().chromeHeight + MASTER_PLAYER_FIT_MARGIN * 2 - 10;
    const input = base({ viewportHeight: exhausted, aspect: FORMATS["9:16"] });
    const { width, height } = computeMasterPlayerFit(input);
    expect(Number.isFinite(width)).toBe(true);
    expect(Number.isFinite(height)).toBe(true);
    expect(width).toBe(0);
    expect(height).toBe(0);
    // transport chrome is a separate flex child — always rendered regardless
    expect(input.chromeHeight).toBeGreaterThan(0);
  });

  it("fills the available space — the saved width no longer sizes the player", () => {
    // Design change (0d963557, "master player not draggable — always fills
    // the available space"): the player takes the full fit width and the
    // persisted savedWidth is ignored, large or small.
    const input = base({
      viewportHeight: 1200,
      aspect: FORMATS["16:9"],
      savedWidth: 800,
      columnWidth: 1200,
    });
    const { width, height } = computeMasterPlayerFit(input);
    expect(width).toBe(1200);
    expect(height).toBe(Math.round(1200 / FORMATS["16:9"]));
    expect(total(input)).toBeLessThanOrEqual(usableBand(input));
    // A small saved width changes nothing either.
    expect(computeMasterPlayerFit({ ...input, savedWidth: 300 }).width).toBe(1200);
  });

  it("clamps an oversized saved width to the design max", () => {
    const input = base({
      viewportHeight: 1600,
      aspect: FORMATS["16:9"],
      savedWidth: 5000,
      columnWidth: 4000,
    });
    const { width } = computeMasterPlayerFit(input);
    expect(width).toBeLessThanOrEqual(MASTER_PLAYER_MAX_WIDTH);
  });

  it("unknown column width (0) does not break sizing", () => {
    const input = base({ columnWidth: 0 });
    const { width, height } = computeMasterPlayerFit(input);
    expect(width).toBeGreaterThan(0);
    expect(Number.isFinite(height)).toBe(true);
    expect(total(input)).toBeLessThanOrEqual(usableBand(input));
  });

  it("minimized returns the chip width", () => {
    const { width, height } = computeMasterPlayerFit(base({ minimized: true }));
    expect(width).toBe(MASTER_PLAYER_MINIMIZED_CHIP_WIDTH);
    expect(height).toBe(Math.round(MASTER_PLAYER_MINIMIZED_CHIP_WIDTH / FORMATS["9:16"]));
  });

  it("non-positive aspect falls back to 9:16", () => {
    const { width, height } = computeMasterPlayerFit(base({ aspect: 0 }));
    expect(height).toBe(Math.round(width / (9 / 16)));
  });

  it("sweep: every format × viewport × column keeps transport visible and width legal", () => {
    const viewports = [650, 800, 900, 1080];
    const columns = [360, 522, 900, 1400];
    for (const fmt of Object.keys(FORMATS)) {
      for (const vh of viewports) {
        for (const col of columns) {
          const input = base({ aspect: FORMATS[fmt], viewportHeight: vh, columnWidth: col });
          const { width, height } = computeMasterPlayerFit(input);
          expect(Number.isFinite(width) && Number.isFinite(height)).toBe(true);
          expect(width).toBeGreaterThanOrEqual(0);
          // never wider than the column or the design max
          expect(width).toBeLessThanOrEqual(Math.min(col, MASTER_PLAYER_MAX_WIDTH) + 1);
          // video + chrome never exceeds the usable band (transport always visible)
          expect(total(input)).toBeLessThanOrEqual(usableBand(input) + 1);
          // aspect box stays exact (no clamp distortion)
          if (width > 0) {
            expect(Math.abs(height - width / FORMATS[fmt])).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});
