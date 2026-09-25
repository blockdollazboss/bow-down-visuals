import { describe, it, expect } from "vitest";
import {
  DISTRIBUTION_PLATFORMS,
  DISTRIBUTION_AI_CREDIT_COST,
  DISTRIBUTION_PACKAGING_CREDITS,
  DISTRIBUTION_STATUSES,
  platformLabel,
  isPackaged,
} from "./distribution";

describe("DISTRIBUTION_PLATFORMS", () => {
  it("lists 8 platforms with unique keys and labels", () => {
    expect(DISTRIBUTION_PLATFORMS).toHaveLength(8);
    const keys = DISTRIBUTION_PLATFORMS.map((p) => p.key);
    expect(new Set(keys).size).toBe(8);
    for (const p of DISTRIBUTION_PLATFORMS) {
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it("includes the major streaming services", () => {
    const keys = DISTRIBUTION_PLATFORMS.map((p) => p.key);
    expect(keys).toContain("spotify");
    expect(keys).toContain("apple_music");
    expect(keys).toContain("youtube_music");
  });
});

describe("platformLabel", () => {
  it("resolves known keys to labels", () => {
    expect(platformLabel("spotify")).toBe("Spotify");
    expect(platformLabel("apple_music")).toBe("Apple Music");
    expect(platformLabel("tidal")).toBe("Tidal");
  });

  it("falls back to the raw key for unknown platforms", () => {
    expect(platformLabel("myspace")).toBe("myspace");
  });
});

describe("pricing", () => {
  it("prices AI generations at 1 credit", () => {
    expect(DISTRIBUTION_AI_CREDIT_COST).toBe(1);
  });

  it("prices release packaging at 10 credits", () => {
    expect(DISTRIBUTION_PACKAGING_CREDITS).toBe(10);
  });
});

describe("DISTRIBUTION_STATUSES", () => {
  it("has no 'delivered' status — v1 prepares, it never claims delivery", () => {
    expect(DISTRIBUTION_STATUSES).toEqual(["draft", "packaged"]);
    expect(DISTRIBUTION_STATUSES).not.toContain("delivered");
  });
});

describe("isPackaged", () => {
  it("is true only for packaged releases", () => {
    expect(isPackaged("packaged")).toBe(true);
    expect(isPackaged("draft")).toBe(false);
    expect(isPackaged("delivered")).toBe(false);
  });
});
