/**
 * True Cinematic FX — filter-chain contract tests.
 *
 * Covers: per-effect ffmpeg chains are the REAL burn (not the old CSS
 * approximations), intensity scales the wobble/noise, the attribution
 * drawtext is emitted only when requested, and the global export stack
 * (effects-ffmpeg.ts) resolves VHS / Cinematic Bars / Camera Shake /
 * Film Grain to dedicated true chains instead of the lossy CSS→eq path.
 */
import { describe, expect, it } from "vitest";

import {
  buildCinematicFxChains,
  buildCinematicFxFilterComplex,
  CINEMATIC_FX_EFFECTS,
} from "../cinematic-fx";
import {
  ffmpegForEffect,
  TRUE_LETTERBOX_FFMPEG,
  TRUE_CAMERA_SHAKE_FFMPEG,
  TRUE_VHS_FFMPEG,
  FILM_GRAIN_FFMPEG,
} from "../effects-ffmpeg";

describe("cinematic-fx chain builder", () => {
  it("exposes the four true effects", () => {
    expect([...CINEMATIC_FX_EFFECTS]).toEqual([
      "True Camera Shake",
      "True Letterbox Cinematic Bars",
      "True VHS",
      "Film Grain",
    ]);
  });

  it("burns real black bars for letterbox (drawbox, not dimming)", () => {
    const plan = buildCinematicFxChains(["True Letterbox Cinematic Bars"], 60);
    expect(plan.mainChain).toContain("drawbox");
    expect(plan.mainChain).toContain("c=black");
    expect(plan.mainChain).not.toContain("eq=");
    expect(plan.needsScanlines).toBe(false);
    expect(plan.needsTrackline).toBe(false);
  });

  it("burns a crop-wobble for camera shake (not a brightness tweak)", () => {
    const plan = buildCinematicFxChains(["True Camera Shake"], 60);
    expect(plan.mainChain).toContain("crop=w=iw/");
    expect(plan.mainChain).toContain("sin(n*0.9)");
    expect(plan.mainChain).not.toContain("brightness");
  });

  it("restores the exact input size after the shake wobble when dims are known", () => {
    const plan = buildCinematicFxChains(["True Camera Shake"], 60, { w: 640, h: 360 });
    expect(plan.mainChain).toContain("scale=640:360");
    const planNoDims = buildCinematicFxChains(["True Camera Shake"], 60);
    expect(planNoDims.mainChain).not.toContain("scale=640:360");
  });

  it("scales shake amplitude with intensity", () => {
    const low = buildCinematicFxChains(["True Camera Shake"], 10).mainChain;
    const high = buildCinematicFxChains(["True Camera Shake"], 100).mainChain;
    const amp = (s: string) => {
      const m = s.match(/sin\(n\*0\.9\)\*iw\*([\d.]+)/);
      return m ? Number(m[1]) : NaN;
    };
    expect(amp(low)).toBeLessThan(amp(high));
  });

  it("builds the full VHS stack: color + CA + noise + overlays", () => {
    const plan = buildCinematicFxChains(["True VHS"], 60);
    expect(plan.mainChain).toContain("rgbashift");
    expect(plan.mainChain).toContain("noise=alls=");
    expect(plan.mainChain).toContain("hue=h=8");
    expect(plan.needsScanlines).toBe(true);
    expect(plan.needsTrackline).toBe(true);
  });

  it("burns real temporal noise for film grain", () => {
    const plan = buildCinematicFxChains(["Film Grain"], 60);
    expect(plan.mainChain).toContain("noise=alls=");
    expect(plan.mainChain).toContain("allf=t");
  });

  it("chains multiple effects sequentially", () => {
    const plan = buildCinematicFxChains(
      ["True Camera Shake", "True VHS", "True Letterbox Cinematic Bars", "Film Grain"],
      60,
    );
    expect(plan.mainChain).toContain("crop=w=iw/");
    expect(plan.mainChain).toContain("rgbashift");
    expect(plan.mainChain).toContain("drawbox");
    expect(plan.needsScanlines).toBe(true);
  });

  it("emits the attribution drawtext only when requested", () => {
    const plan = buildCinematicFxChains(["Film Grain"], 60);
    const withAttr = buildCinematicFxFilterComplex(plan, {
      attribution: true,
      attributionFontSize: 24,
      scanLabel: "",
      trackLabel: "",
    });
    const withoutAttr = buildCinematicFxFilterComplex(plan, {
      attribution: false,
      attributionFontSize: 24,
      scanLabel: "",
      trackLabel: "",
    });
    expect(withAttr).toContain("drawtext");
    expect(withAttr).toContain("Made with Bow Down Visuals");
    expect(withAttr).toContain("fontsize=24");
    expect(withoutAttr).not.toContain("drawtext");
  });

  it("wires the scanline + tracking-line overlays for VHS", () => {
    const plan = buildCinematicFxChains(["True VHS"], 60);
    const fc = buildCinematicFxFilterComplex(plan, {
      attribution: false,
      attributionFontSize: 24,
      scanLabel: "[1:v]",
      trackLabel: "[2:v]",
    });
    expect(fc).toContain("[vfx][1:v]overlay=0:0");
    expect(fc).toContain("[vscan][2:v]overlay=0:");
    expect(fc).toContain("mod(t*120");
    expect(fc).toContain("[vout]");
  });
});

describe("global export stack resolves true chains", () => {
  it("VHS resolves to the true VHS core chain", () => {
    const r = ffmpegForEffect("VHS");
    expect(r.supported).toBe(true);
    expect(r.ffmpeg).toBe(TRUE_VHS_FFMPEG);
    expect(r.ffmpeg).toContain("rgbashift");
  });

  it("Cinematic Bars resolves to real drawbox bars", () => {
    const r = ffmpegForEffect("Cinematic Bars");
    expect(r.supported).toBe(true);
    expect(r.ffmpeg).toBe(TRUE_LETTERBOX_FFMPEG);
  });

  it("Camera Shake resolves to the crop-wobble chain", () => {
    const r = ffmpegForEffect("Camera Shake");
    expect(r.supported).toBe(true);
    expect(r.ffmpeg).toBe(TRUE_CAMERA_SHAKE_FFMPEG);
  });

  it("Film Grain keeps its dedicated noise chain", () => {
    const r = ffmpegForEffect("Film Grain");
    expect(r.supported).toBe(true);
    expect(r.ffmpeg).toBe(FILM_GRAIN_FFMPEG);
  });
});
