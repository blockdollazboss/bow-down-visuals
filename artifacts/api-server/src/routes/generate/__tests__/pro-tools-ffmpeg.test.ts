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
