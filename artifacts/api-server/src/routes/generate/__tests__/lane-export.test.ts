import { describe, it, expect } from "vitest";
import { buildAdjustmentGraph, bareGradeChain, windowChain } from "../lane-export";

const CC = {
  brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0,
  highlights: 0, shadows: 0, vibrance: 0, exposure: 0,
};

describe("bareGradeChain", () => {
  it("strips labels from a grade chain", () => {
    const chain = bareGradeChain({ ...CC, contrast: 20 });
    expect(chain).toContain("eq=contrast=1.2000");
    expect(chain).not.toContain("[0:v]");
    expect(chain).not.toContain("[ptout]");
  });
  it("is empty for a neutral grade", () => {
    expect(bareGradeChain(CC)).toBe("");
    expect(bareGradeChain(null)).toBe("");
  });
});

describe("windowChain", () => {
  it("stamps the enable window on every filter", () => {
    const out = windowChain("eq=contrast=1.2000,vibrance=intensity=1.0000", 2, 5);
    expect(out).toContain("eq=contrast=1.2000:enable='between(t\\,2.000\\,5.000)'");
    expect(out).toContain("vibrance=intensity=1.0000:enable='between(t\\,2.000\\,5.000)'");
  });
});

describe("buildAdjustmentGraph", () => {
  it("threads labels and applies only inside the item window", () => {
    const g = buildAdjustmentGraph(
      [{ startSec: 2, endSec: 5, colorCorrection: { ...CC, contrast: 20 } }],
      "vconcat", 10,
    );
    expect(g.applied).toBe(1);
    expect(g.outLabel).toBe("vadj0");
    expect(g.fragments[0]).toMatch(/^\[vconcat\]eq=.*between\(t\\,2\.000\\,5\.000\).*\[vadj0\]$/);
  });
  it("clamps the window to the export duration and skips out-of-range items", () => {
    const g = buildAdjustmentGraph(
      [
        { startSec: 8, endSec: 99, colorCorrection: { ...CC, contrast: 20 } },
        { startSec: 20, endSec: 30, colorCorrection: { ...CC, contrast: 20 } },
        { startSec: 1, endSec: 1, colorCorrection: { ...CC, contrast: 20 } },
      ],
      "vin", 10,
    );
    expect(g.applied).toBe(1);
    expect(g.fragments[0]).toContain("between(t\\,8.000\\,10.000)");
  });
  it("neutral items contribute nothing (no silent fake grade)", () => {
    const g = buildAdjustmentGraph([{ startSec: 0, endSec: 5, colorCorrection: CC }], "vin", 10);
    expect(g.applied).toBe(0);
    expect(g.fragments).toEqual([]);
    expect(g.outLabel).toBe("vin");
  });
  it("multiple windows chain in order", () => {
    const g = buildAdjustmentGraph(
      [
        { startSec: 0, endSec: 3, colorCorrection: { ...CC, contrast: 10 } },
        { startSec: 3, endSec: 6, colorCorrection: { ...CC, saturation: 30 } },
      ],
      "vin", 10,
    );
    expect(g.applied).toBe(2);
    expect(g.fragments[1]).toMatch(/^\[vadj0\]/);
    expect(g.outLabel).toBe("vadj1");
  });
});
