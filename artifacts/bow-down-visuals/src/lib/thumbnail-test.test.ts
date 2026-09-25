import { describe, expect, it } from "vitest";
import { scoreBand, scoreBandClass, filterImageFiles } from "./thumbnail-test";

describe("scoreBand", () => {
  it("bands 75+ as high", () => {
    expect(scoreBand(75)).toBe("high");
    expect(scoreBand(100)).toBe("high");
  });

  it("bands 50-74 as medium", () => {
    expect(scoreBand(50)).toBe("medium");
    expect(scoreBand(74)).toBe("medium");
  });

  it("bands below 50 as low", () => {
    expect(scoreBand(49)).toBe("low");
    expect(scoreBand(0)).toBe("low");
  });
});

describe("scoreBandClass", () => {
  it("returns distinct tailwind classes per band", () => {
    const high = scoreBandClass("high");
    const medium = scoreBandClass("medium");
    const low = scoreBandClass("low");
    expect(new Set([high, medium, low]).size).toBe(3);
    expect(high).toContain("emerald");
    expect(low).toContain("red");
  });
});

describe("filterImageFiles", () => {
  const img = (name: string, type: string) => new File(["x"], name, { type });

  it("keeps only image files", () => {
    const files = [img("a.png", "image/png"), img("b.mp4", "video/mp4"), img("c.jpg", "image/jpeg")];
    expect(filterImageFiles(files).map((f) => f.name)).toEqual(["a.png", "c.jpg"]);
  });

  it("caps at the max file count", () => {
    const files = Array.from({ length: 6 }, (_, i) => img(`${i}.png`, "image/png"));
    expect(filterImageFiles(files, 4)).toHaveLength(4);
  });
});
