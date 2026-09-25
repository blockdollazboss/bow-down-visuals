import { describe, it, expect } from "vitest";
import {
  COMPARE_POS_DEFAULT,
  COMPARE_POS_MAX,
  COMPARE_POS_MIN,
  COMPARE_KEY_STEP,
  COMPARE_KEY_STEP_LARGE,
  clampComparePos,
  compareClipPath,
  comparePosFromClientX,
  hasActiveVisualEffects,
  type VisualEffectFlags,
} from "../compare-slider";

const noEffects: VisualEffectFlags = {
  testEffectActive: false,
  testOverlayActive: false,
  effectCount: 0,
  overlayChipCount: 0,
  soloPreviewOverlay: null,
};

describe("clampComparePos", () => {
  it("passes through in-range values", () => {
    expect(clampComparePos(50)).toBe(50);
    expect(clampComparePos(0)).toBe(0);
    expect(clampComparePos(100)).toBe(100);
  });

  it("clamps out-of-range values", () => {
    expect(clampComparePos(-5)).toBe(COMPARE_POS_MIN);
    expect(clampComparePos(140)).toBe(COMPARE_POS_MAX);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampComparePos(NaN)).toBe(COMPARE_POS_DEFAULT);
    expect(clampComparePos(Infinity)).toBe(COMPARE_POS_DEFAULT);
  });
});

describe("compareClipPath", () => {
  it("clips the left side of the after layer at the split position", () => {
    expect(compareClipPath(50)).toBe("inset(0 0 0 50%)");
    expect(compareClipPath(0)).toBe("inset(0 0 0 0%)");
    expect(compareClipPath(100)).toBe("inset(0 0 0 100%)");
  });

  it("clamps before formatting", () => {
    expect(compareClipPath(250)).toBe("inset(0 0 0 100%)");
  });
});

describe("comparePosFromClientX", () => {
  it("maps the left/right edges to 0/100", () => {
    expect(comparePosFromClientX(100, 100, 400)).toBe(0);
    expect(comparePosFromClientX(500, 100, 400)).toBe(100);
  });

  it("maps the middle to 50", () => {
    expect(comparePosFromClientX(300, 100, 400)).toBe(50);
  });

  it("clamps drags outside the track", () => {
    expect(comparePosFromClientX(0, 100, 400)).toBe(0);
    expect(comparePosFromClientX(9999, 100, 400)).toBe(100);
  });

  it("falls back to the default when the track has no width", () => {
    expect(comparePosFromClientX(300, 100, 0)).toBe(COMPARE_POS_DEFAULT);
  });
});

describe("hasActiveVisualEffects", () => {
  it("is false when nothing is active", () => {
    expect(hasActiveVisualEffects(noEffects)).toBe(false);
  });

  it("is true for the effect test", () => {
    expect(hasActiveVisualEffects({ ...noEffects, testEffectActive: true })).toBe(true);
  });

  it("is true for the overlay test", () => {
    expect(hasActiveVisualEffects({ ...noEffects, testOverlayActive: true })).toBe(true);
  });

  it("is true when color effects are applied", () => {
    expect(hasActiveVisualEffects({ ...noEffects, effectCount: 2 })).toBe(true);
  });

  it("is true when overlay chips are active", () => {
    expect(hasActiveVisualEffects({ ...noEffects, overlayChipCount: 1 })).toBe(true);
  });

  it("is true when a single overlay is solo-previewed", () => {
    expect(hasActiveVisualEffects({ ...noEffects, soloPreviewOverlay: "Rain" })).toBe(true);
  });
});

describe("compare constants", () => {
  it("uses a sane default and keyboard steps", () => {
    expect(COMPARE_POS_DEFAULT).toBe(50);
    expect(COMPARE_POS_MIN).toBe(0);
    expect(COMPARE_POS_MAX).toBe(100);
    expect(COMPARE_KEY_STEP).toBe(2);
    expect(COMPARE_KEY_STEP_LARGE).toBe(10);
  });
});
