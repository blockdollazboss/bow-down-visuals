/**
 * Tests for #30 square & feed-format generation (Stack-100 #3).
 *
 * Covers: the verified per-model support table, honest-fallback resolution
 * (nearest supported ratio + exact notice wording — never labelled native),
 * legacy ratio behaviour unchanged, and price invariance across formats
 * (the rail charges exactly the same per ratio as before this feature).
 */
import { describe, expect, it } from "vitest";
import {
  GEN45_CREDIT_COST,
  formatFromRatio,
  formatSupport,
  resolveClipPlan,
  resolveFormatDelivery,
} from "../clip-pricing";
import { buildReframeArgs, REFRAME_OUTPUT_SIZE } from "../../../lib/feed-reframe";

describe("formatFromRatio", () => {
  it("maps legacy ratios to the original two formats", () => {
    expect(formatFromRatio("1280:720")).toBe("16:9");
    expect(formatFromRatio("1920:1080")).toBe("16:9");
    expect(formatFromRatio("720:1280")).toBe("9:16");
    expect(formatFromRatio(undefined)).toBe("9:16");
  });
  it("maps feed pixel ratios to feed formats", () => {
    expect(formatFromRatio("960:960")).toBe("1:1");
    expect(formatFromRatio("1080:1350")).toBe("4:5");
  });
});

describe("per-model native support (verified from provider shapes)", () => {
  it("seedance2_5 emits native square at every tier, never native 4:5", () => {
    expect(formatSupport("seedance2_5", "1:1", {}).nativeRatio).toBe("960:960");
    expect(formatSupport("seedance2_5", "1:1", { resolution: "1080p" }).nativeRatio).toBe("1440:1440");
    expect(formatSupport("seedance2_5", "1:1", { draft: true }).nativeRatio).toBe("640:640");
    expect(formatSupport("seedance2_5", "4:5", {}).nativeRatio).toBeNull();
    expect(formatSupport("seedance2_5", "4:5", { resolution: "1080p" }).nativeRatio).toBeNull();
  });
  it("gen4.5 emits native square ONLY with a reference image (image-to-video)", () => {
    expect(formatSupport("gen4.5", "1:1", { hasImageRef: true }).nativeRatio).toBe("960:960");
    expect(formatSupport("gen4.5", "1:1", { hasImageRef: false }).nativeRatio).toBeNull();
    expect(formatSupport("gen4.5", "4:5", { hasImageRef: true }).nativeRatio).toBeNull();
  });
  it("veo3_1 emits neither feed format natively", () => {
    expect(formatSupport("veo3_1", "1:1", { hasImageRef: true }).nativeRatio).toBeNull();
    expect(formatSupport("veo3_1", "4:5", {}).nativeRatio).toBeNull();
  });
});

describe("resolveFormatDelivery — honest fallback", () => {
  it("legacy formats stay native with today's provider ratios", () => {
    expect(resolveFormatDelivery({ model: "gen4.5", format: "16:9" })).toMatchObject({ delivery: "native", providerRatio: "1280:720", notice: null });
    expect(resolveFormatDelivery({ model: "seedance2_5", format: "9:16" })).toMatchObject({ delivery: "native", providerRatio: "720:1280", notice: null });
    expect(resolveFormatDelivery({ model: "veo3_1", format: "9:16" })).toMatchObject({ delivery: "native", providerRatio: "9:16", notice: null });
  });
  it("seedance square is native; seedance 4:5 generates nearest 3:4 then reframes", () => {
    expect(resolveFormatDelivery({ model: "seedance2_5", format: "1:1" })).toMatchObject({ delivery: "native", providerRatio: "960:960", reframeTarget: null });
    const r = resolveFormatDelivery({ model: "seedance2_5", format: "4:5" });
    expect(r).toMatchObject({ delivery: "reframe", providerRatio: "834:1112", reframeTarget: "4:5" });
    expect(r.notice).toBe("Generated in 3:4, reframed to 4:5");
    expect(resolveFormatDelivery({ model: "seedance2_5", format: "4:5", resolution: "1080p" }).providerRatio).toBe("1248:1664");
    expect(resolveFormatDelivery({ model: "seedance2_5", format: "4:5", draft: true }).providerRatio).toBe("560:752");
  });
  it("gen4.5 square: native with a photo, wide+reframe without one", () => {
    expect(resolveFormatDelivery({ model: "gen4.5", format: "1:1", hasImageRef: true })).toMatchObject({ delivery: "native", providerRatio: "960:960" });
    const r = resolveFormatDelivery({ model: "gen4.5", format: "1:1", hasImageRef: false });
    expect(r).toMatchObject({ delivery: "reframe", providerRatio: "1280:720", reframeTarget: "1:1" });
    expect(r.notice).toBe("Generated wide, reframed to square");
  });
  it("gen4.5 4:5: 3:4 with a photo, vertical without one — both honestly labelled", () => {
    const withRef = resolveFormatDelivery({ model: "gen4.5", format: "4:5", hasImageRef: true });
    expect(withRef).toMatchObject({ delivery: "reframe", providerRatio: "832:1104" });
    expect(withRef.notice).toBe("Generated in 3:4, reframed to 4:5");
    const noRef = resolveFormatDelivery({ model: "gen4.5", format: "4:5", hasImageRef: false });
    expect(noRef).toMatchObject({ delivery: "reframe", providerRatio: "720:1280" });
    expect(noRef.notice).toBe("Generated vertical, reframed to 4:5");
  });
  it("veo: square from wide, 4:5 from vertical — both reframed, both labelled", () => {
    const sq = resolveFormatDelivery({ model: "veo3_1", format: "1:1" });
    expect(sq).toMatchObject({ delivery: "reframe", providerRatio: "16:9", reframeTarget: "1:1" });
    expect(sq.notice).toBe("Generated wide, reframed to square");
    const feed = resolveFormatDelivery({ model: "veo3_1", format: "4:5" });
    expect(feed).toMatchObject({ delivery: "reframe", providerRatio: "9:16", reframeTarget: "4:5" });
    expect(feed.notice).toBe("Generated vertical, reframed to 4:5");
  });
  it("a reframe delivery is NEVER labelled native and always carries a notice", () => {
    for (const model of ["gen4.5", "seedance2_5", "veo3_1"] as const) {
      for (const format of ["1:1", "4:5"] as const) {
        const r = resolveFormatDelivery({ model, format, hasImageRef: false });
        if (r.delivery === "reframe") {
          expect(r.notice).toBeTruthy();
          expect(r.reframeTarget).toBe(format);
        }
      }
    }
  });
});

describe("resolveClipPlan — format plumbing + price invariance", () => {
  it("legacy calls (no format) behave exactly as before", () => {
    const wide = resolveClipPlan({ model: "gen4.5", ratio: "1280:720" });
    expect(wide).toMatchObject({ format: "16:9", formatDelivery: "native", gen45Ratio: "1280:720", seedanceRatio: "1280:720", creditCost: GEN45_CREDIT_COST });
    const vert = resolveClipPlan({ model: "seedance2_5", ratio: "720:1280", durationSec: 10 });
    expect(vert).toMatchObject({ format: "9:16", seedanceRatio: "720:1280" });
  });
  it("seedance square plan carries the native square seedanceRatio per tier", () => {
    expect(resolveClipPlan({ model: "seedance2_5", format: "1:1", durationSec: 5 }).seedanceRatio).toBe("960:960");
    expect(resolveClipPlan({ model: "seedance2_5", format: "1:1", durationSec: 5, resolution: "1080p" }).seedanceRatio).toBe("1440:1440");
    expect(resolveClipPlan({ model: "seedance2_5", format: "1:1", durationSec: 5, draft: true }).seedanceRatio).toBe("640:640");
    expect(resolveClipPlan({ model: "seedance2_5", format: "4:5", durationSec: 5 })).toMatchObject({ seedanceRatio: "834:1112", formatDelivery: "reframe" });
  });
  it("price is identical for every format (no ratio ever changes the charge)", () => {
    for (const model of ["gen4.5", "seedance2_5", "veo3_1"]) {
      const costs = (["16:9", "9:16", "1:1", "4:5"] as const).map(
        (format) => resolveClipPlan({ model, format, durationSec: 10, hasImageRef: true }).creditCost,
      );
      expect(new Set(costs).size).toBe(1);
    }
  });
});

describe("feed reframe args", () => {
  it("targets the feed canvas sizes", () => {
    expect(REFRAME_OUTPUT_SIZE["1:1"]).toEqual([1080, 1080]);
    expect(REFRAME_OUTPUT_SIZE["4:5"]).toEqual([1080, 1350]);
    const args = buildReframeArgs("in.mp4", "out.mp4", "4:5");
    expect(args.join(" ")).toContain("scale=1080:1350");
    expect(args[1]).toBe("-i");
  });
});
