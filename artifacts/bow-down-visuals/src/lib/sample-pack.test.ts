import { describe, expect, it } from "vitest";
import {
  creditsForSize,
  originBadge,
  formatDuration,
  perSampleCredits,
  PACK_SIZE_OPTIONS,
} from "./sample-pack";

describe("sample pack pricing helpers", () => {
  it("matches the server credit contract", () => {
    expect(creditsForSize(10)).toBe(5);
    expect(creditsForSize(25)).toBe(12);
    expect(creditsForSize(50)).toBe(20);
  });

  it("throws on unknown sizes", () => {
    expect(() => creditsForSize(15)).toThrow();
  });

  it("offers exactly three pack sizes", () => {
    expect(PACK_SIZE_OPTIONS.map((o) => o.size)).toEqual([10, 25, 50]);
  });

  it("computes per-sample cost for display", () => {
    expect(perSampleCredits(10)).toBe("0.5");
    expect(perSampleCredits(50)).toBe("0.4");
  });
});

describe("origin badges", () => {
  it("labels AI and Synth distinctly", () => {
    expect(originBadge("ai-generated").label).toBe("AI");
    expect(originBadge("synthesized").label).toBe("Synth");
    expect(originBadge("ai-generated").className).not.toBe(
      originBadge("synthesized").className,
    );
  });
});

describe("formatDuration", () => {
  it("formats seconds as m:ss", () => {
    expect(formatDuration(0.35)).toBe("0:00");
    expect(formatDuration(3)).toBe("0:03");
    expect(formatDuration(65)).toBe("1:05");
  });
});
