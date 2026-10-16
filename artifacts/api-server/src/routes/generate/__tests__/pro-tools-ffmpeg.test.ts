import { describe, it, expect } from "vitest";
import {
  buildProToolsFilterChain,
  proToolsFilterActive,
  hexToFfmpegColor,
} from "../pro-tools-ffmpeg";

const NEUTRAL_CC = {
  brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0,
  highlights: 0, shadows: 0, vibrance: 0, exposure: 0,
};

describe("hexToFfmpegColor", () => {
  it("normalizes 6-digit hex with and without #", () => {
    expect(hexToFfmpegColor("#00ff00")).toBe("0x00FF00");
    expect(hexToFfmpegColor("ff0000")).toBe("0xFF0000");
  });
  it("expands 3-digit hex", () => {
    expect(hexToFfmpegColor("#0f0")).toBe("0x00FF00");
  });
  it("falls back to green on garbage", () => {
    expect(hexToFfmpegColor("notacolor")).toBe("0x00FF00");
    expect(hexToFfmpegColor(null)).toBe("0x00FF00");
    expect(hexToFfmpegColor("")).toBe("0x00FF00");
  });
});

describe("buildProToolsFilterChain", () => {
  it("returns empty string when nothing is active", () => {
    expect(buildProToolsFilterChain({})).toBe("");
    expect(buildProToolsFilterChain({ speed: 1, reverse: false })).toBe("");
    expect(buildProToolsFilterChain({ colorCorrection: NEUTRAL_CC })).toBe("");
    expect(buildProToolsFilterChain({ chromaKey: { enabled: false, color: "#00ff00", similarity: 30, blend: 20, bgColor: "#000000" } })).toBe("");
  });

  it("maps speed to setpts", () => {
    const chain = buildProToolsFilterChain({ speed: 2 });
    expect(chain).toContain("setpts=0.5000*PTS");
    expect(buildProToolsFilterChain({ speed: 0.5 })).toContain("setpts=2.0000*PTS");
  });

  it("ignores out-of-range speed", () => {
    expect(buildProToolsFilterChain({ speed: 10 })).toBe("");
    expect(buildProToolsFilterChain({ speed: 0 })).toBe("");
  });

  it("adds reverse filter", () => {
    expect(buildProToolsFilterChain({ reverse: true })).toContain("reverse");
  });

  it("maps rotation to transpose", () => {
    expect(buildProToolsFilterChain({ rotation: 90 })).toContain("transpose=1");
    expect(buildProToolsFilterChain({ rotation: 270 })).toContain("transpose=2");
    expect(buildProToolsFilterChain({ rotation: 180 })).toContain("transpose=1,transpose=1");
    expect(buildProToolsFilterChain({ rotation: 0 })).toBe("");
  });

  it("maps flips", () => {
    expect(buildProToolsFilterChain({ flipH: true })).toContain("hflip");
    expect(buildProToolsFilterChain({ flipV: true })).toContain("vflip");
    const both = buildProToolsFilterChain({ flipH: true, flipV: true });
    expect(both).toContain("hflip");
    expect(both).toContain("vflip");
  });

  it("maps color correction to eq", () => {
    const chain = buildProToolsFilterChain({
      colorCorrection: { ...NEUTRAL_CC, brightness: 50, contrast: 20, saturation: -30 },
    });
    expect(chain).toContain("eq=");
    expect(chain).toContain("brightness=0.2500"); // 50/100*0.5
    expect(chain).toContain("contrast=1.2000");
    expect(chain).toContain("saturation=0.7000");
  });

  it("folds exposure into eq brightness", () => {
    const chain = buildProToolsFilterChain({
      colorCorrection: { ...NEUTRAL_CC, exposure: 100 },
    });
    expect(chain).toContain("brightness=0.5000");
  });

  it("maps temperature/tint/highlights/shadows to colorbalance", () => {
    const chain = buildProToolsFilterChain({
      colorCorrection: { ...NEUTRAL_CC, temperature: 50, tint: -40, highlights: 30, shadows: -20 },
    });
    expect(chain).toContain("colorbalance=");
    // Warm temperature lifts red mids.
    expect(chain).toContain("rm=0.0400");
    // Negative tint (green) lifts green mids.
    expect(chain).toContain("gm=");
  });

  it("maps vibrance to the vibrance filter", () => {
    const chain = buildProToolsFilterChain({
      colorCorrection: { ...NEUTRAL_CC, vibrance: 50 },
    });
    expect(chain).toContain("vibrance=intensity=1.0000");
  });

  it("maps aspect crop to a conditional crop expression", () => {
    const chain = buildProToolsFilterChain({
      crop: { enabled: true, aspect: "9:16", x: 0, y: 0, w: 1, h: 1 },
    });
    expect(chain).toContain("crop=");
    expect(chain).toContain("iw/ih");
  });

  it("maps free crop to fractional crop", () => {
    const chain = buildProToolsFilterChain({
      crop: { enabled: true, aspect: "free", x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
    });
    expect(chain).toContain("crop=iw*0.8000:ih*0.8000:iw*0.1000:ih*0.1000");
  });

  it("builds the chroma key composite chain", () => {
    const chain = buildProToolsFilterChain({
      chromaKey: { enabled: true, color: "#00ff00", similarity: 30, blend: 20, bgColor: "#000000" },
    });
    expect(chain).toContain("chromakey=0x00FF00:0.300:0.200");
    expect(chain).toContain("drawbox=c=0x000000:t=fill");
    expect(chain).toContain("overlay=0:0");
    expect(chain).toContain("split=2[ckbg][ckfg]");
  });

  it("chains multiple tools in the documented order (speed→reverse→crop→rotate→flip→color→chroma)", () => {
    const chain = buildProToolsFilterChain({
      speed: 2,
      reverse: true,
      rotation: 90,
      flipH: true,
      colorCorrection: { ...NEUTRAL_CC, contrast: 20 },
    });
    const idx = (s: string) => chain.indexOf(s);
    expect(idx("setpts=")).toBeGreaterThan(-1);
    expect(idx("setpts=")).toBeLessThan(idx("reverse"));
    expect(idx("reverse")).toBeLessThan(idx("transpose=1"));
    expect(idx("transpose=1")).toBeLessThan(idx("hflip"));
    expect(idx("hflip")).toBeLessThan(idx("eq="));
  });

  it("wraps the chain as [0:v]...[ptout]", () => {
    const chain = buildProToolsFilterChain({ speed: 2 });
    expect(chain.startsWith("[0:v]")).toBe(true);
    expect(chain.endsWith("[ptout]")).toBe(true);
  });

  it("clamps extreme slider values into valid FFmpeg ranges", () => {
    const chain = buildProToolsFilterChain({
      colorCorrection: { ...NEUTRAL_CC, brightness: 100, contrast: 100, saturation: 100 },
    });
    // eq brightness clamps to [-1, 1]; contrast/saturation clamp to [0, 3].
    expect(chain).toContain("brightness=0.5000");
    expect(chain).toContain("contrast=2.0000");
    expect(chain).toContain("saturation=2.0000");
  });
});

describe("proToolsFilterActive", () => {
  it("is false for neutral input", () => {
    expect(proToolsFilterActive({})).toBe(false);
  });
  it("is true when any tool is active", () => {
    expect(proToolsFilterActive({ speed: 2 })).toBe(true);
    expect(proToolsFilterActive({ reverse: true })).toBe(true);
    expect(
      proToolsFilterActive({ colorCorrection: { ...NEUTRAL_CC, brightness: 10 } }),
    ).toBe(true);
  });
});

import { buildCurvesFilters, curveIsIdentity } from "../pro-tools-ffmpeg";

const ID = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
const curves = (over: Record<string, unknown> = {}) => ({
  rgb: { all: ID, r: ID, g: ID, b: ID },
  hsl: { h: ID, s: ID, l: ID },
  ...over,
}) as never;

describe("buildCurvesFilters (Stack 5 #2)", () => {
  it("identity curves emit no filters", () => {
    expect(buildCurvesFilters(curves())).toEqual([]);
    expect(curveIsIdentity(ID)).toBe(true);
  });
  it("RGB curves map exactly to one curves filter", () => {
    const out = buildCurvesFilters(curves({
      rgb: { all: ID, r: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }], g: ID, b: ID },
    }));
    expect(out).toEqual(["curves=r='0.000/0.000 0.500/0.700 1.000/1.000'"]);
  });
  it("HSL lightness uses a master curves pass; S/H sample mid-tones", () => {
    const out = buildCurvesFilters(curves({
      hsl: {
        h: [{ x: 0, y: 0 }, { x: 0.5, y: 0.75 }, { x: 1, y: 1 }],
        s: [{ x: 0, y: 0 }, { x: 0.5, y: 0.75 }, { x: 1, y: 1 }],
        l: [{ x: 0, y: 0.1 }, { x: 1, y: 0.9 }],
      },
    }));
    expect(out[0]).toContain("curves=all='0.000/0.100 1.000/0.900'");
    expect(out).toContain("eq=saturation=1.5000"); // 0.75/0.5
    expect(out).toContain("hue=h=90.00"); // (0.75-0.5)*360
  });
  it("curves compose AFTER sliders in the full chain (never collapsed to a preset)", () => {
    const chain = buildProToolsFilterChain({
      colorCorrection: { ...NEUTRAL_CC, contrast: 20 },
      curves: curves({ rgb: { all: ID, r: [{ x: 0, y: 0.2 }, { x: 1, y: 1 }], g: ID, b: ID } }),
    });
    expect(chain.indexOf("eq=")).toBeGreaterThan(-1);
    expect(chain.indexOf("curves=")).toBeGreaterThan(chain.indexOf("eq="));
  });
});

import { buildSpeedSegmentsFilter, normalizeSpeedSegments, planKeyframeSegments, keyframeAt as kfAt } from "../pro-tools-ffmpeg";

describe("buildSpeedSegmentsFilter (Stack 5 #4)", () => {
  it("builds split/trim/setpts/concat per segment window", () => {
    const f = buildSpeedSegmentsFilter([
      { startT: 0, endT: 0.5, speed: 0.5 },
      { startT: 0.5, endT: 1, speed: 2 },
    ], 10);
    expect(f).toContain("[0:v]split=2[ss0][ss1]");
    expect(f).toContain("[ss0]trim=start=0.000:end=5.000,setpts=2.0000*PTS[sg0]");
    expect(f).toContain("[ss1]trim=start=5.000:end=10.000,setpts=0.5000*PTS[sg1]");
    expect(f).toContain("concat=n=2:v=1:a=0[ptout]");
  });
  it("a single 1x segment is a no-op", () => {
    expect(buildSpeedSegmentsFilter([{ startT: 0, endT: 1, speed: 1 }], 10)).toBe("");
  });
  it("normalize tiles gaps like the editor model", () => {
    const segs = normalizeSpeedSegments([{ startT: 0.3, endT: 0.8, speed: 2 }]);
    expect(segs[0]!.startT).toBe(0);
    expect(segs[segs.length - 1]!.endT).toBe(1);
  });
});

describe("bézier keyframes (Stack 5 #8)", () => {
  const base = { id: "a", time: 0, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };
  it("no handles keep legacy smoothstep values", () => {
    const v = kfAt([base, { ...base, id: "b", time: 2, scale: 2 }], 1);
    expect(v.scale).toBeCloseTo(1.5);
  });
  it("ease-out handles move the midpoint ahead", () => {
    const v = kfAt([
      { ...base, easeOutCp: { x: 0.1, y: 0.9 } },
      { ...base, id: "b", time: 2, scale: 2, easeInCp: { x: 0.3, y: 1 } },
    ], 1);
    expect(v.scale).toBeGreaterThan(1.5);
  });
  it("adaptive plan densifies high-curvature spans and caps at 48", () => {
    const snap = [
      { ...base, easeOutCp: { x: 0.05, y: 0.98 } },
      { ...base, id: "b", time: 4, scale: 3, easeInCp: { x: 0.95, y: 1 } },
    ];
    const n = planKeyframeSegments(snap, 4);
    expect(n).toBeGreaterThan(12);
    expect(n).toBeLessThanOrEqual(48);
    expect(planKeyframeSegments([base, { ...base, id: "b", time: 4 }], 4)).toBe(12);
  });
});
