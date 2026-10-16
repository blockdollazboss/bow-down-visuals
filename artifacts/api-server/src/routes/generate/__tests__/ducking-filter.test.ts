import { describe, it, expect } from "vitest";
import { buildDuckingMixFilter, duckingParamsFromSimple } from "../ducking-filter";

describe("duckingParamsFromSimple (house simple terms)", () => {
  it("maps the extremes", () => {
    expect(duckingParamsFromSimple(0, 0)).toMatchObject({ threshold: 0.08, ratio: 2, musicLevel: 1 });
    expect(duckingParamsFromSimple(100, 100)).toMatchObject({ threshold: 0.01, ratio: 20, musicLevel: 0.6 });
  });
  it("mid settings land mid-range", () => {
    const p = duckingParamsFromSimple(50, 50);
    expect(p.threshold).toBeCloseTo(0.045);
    expect(p.ratio).toBeCloseTo(11);
    expect(p.musicLevel).toBeCloseTo(0.8);
  });
});

describe("buildDuckingMixFilter", () => {
  it("builds the sidechain graph with fixed input layout [0]=music [1]=voice", () => {
    const f = buildDuckingMixFilter({ threshold: 0.02, ratio: 20, attackMs: 200, releaseMs: 500, musicLevel: 0.6 });
    expect(f).toContain("[1:a]asplit=2[voice_out][sc]");
    expect(f).toContain("[0:a]volume=0.6[music_leveled]");
    expect(f).toContain("sidechaincompress=threshold=0.02:ratio=20:attack=200:release=500");
    expect(f).toContain("[ducked][voice_out]amix=inputs=2:duration=longest:normalize=0[aout]");
  });
  it("clamps out-of-range params into ffmpeg-safe values", () => {
    const f = buildDuckingMixFilter({ threshold: 9, ratio: 99, attackMs: 1, releaseMs: 99999, musicLevel: 5 });
    expect(f).toContain("threshold=0.2");
    expect(f).toContain("ratio=20");
    expect(f).toContain("attack=20");
  });
});
