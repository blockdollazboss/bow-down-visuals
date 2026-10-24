/**
 * Tests for the feed-format picker mirror (#30). The hint wording must
 * match the server's notices exactly, and a reframe must never read as
 * native.
 */
import { describe, expect, it } from "vitest";
import { CLIP_FORMAT_OPTIONS, FORMAT_TO_RATIO, feedFormatHint, isNativeFeedFormat } from "./feed-formats";

describe("feed-format picker options", () => {
  it("offers square + feed portrait beside the existing two", () => {
    expect(CLIP_FORMAT_OPTIONS.map((o) => o.format)).toEqual(["16:9", "9:16", "1:1", "4:5"]);
    expect(FORMAT_TO_RATIO["1:1"]).toBe("960:960");
    expect(FORMAT_TO_RATIO["4:5"]).toBe("1080:1350");
    expect(FORMAT_TO_RATIO["16:9"]).toBe("1280:720");
    expect(FORMAT_TO_RATIO["9:16"]).toBe("720:1280");
  });
});

describe("feedFormatHint — honest wording, mirrors the server", () => {
  it("legacy formats need no hint", () => {
    expect(feedFormatHint("gen4.5", "16:9", false)).toBeNull();
    expect(feedFormatHint("veo3_1", "9:16", true)).toBeNull();
  });
  it("square: native only where the server says native", () => {
    expect(feedFormatHint("seedance2_5", "1:1", false)).toContain("Native square");
    expect(feedFormatHint("gen4.5", "1:1", true)).toContain("Native square");
    expect(feedFormatHint("gen4.5", "1:1", false)).toBe("Generated wide, reframed to square");
    expect(feedFormatHint("veo3_1", "1:1", true)).toBe("Generated wide, reframed to square");
  });
  it("4:5 is always an honestly labelled reframe", () => {
    expect(feedFormatHint("seedance2_5", "4:5", true)).toBe("Generated in 3:4, reframed to 4:5");
    expect(feedFormatHint("gen4.5", "4:5", true)).toBe("Generated in 3:4, reframed to 4:5");
    expect(feedFormatHint("gen4.5", "4:5", false)).toBe("Generated vertical, reframed to 4:5");
    expect(feedFormatHint("veo3_1", "4:5", false)).toBe("Generated vertical, reframed to 4:5");
    for (const m of ["gen4.5", "seedance2_5", "veo3_1"] as const) {
      expect(isNativeFeedFormat(m, "4:5", true)).toBe(false);
    }
  });
});
