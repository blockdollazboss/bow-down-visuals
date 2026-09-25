/**
 * Unit tests for the press-kit client helpers: handle slugification,
 * handle validation (mirrors the server rules), and public URL building.
 */
import { describe, expect, it } from "vitest";
import { slugifyHandle, isValidHandle, publicPressKitUrl } from "./press-kit";

describe("slugifyHandle", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyHandle("Thy Cheat Code")).toBe("thy-cheat-code");
  });

  it("strips special characters", () => {
    expect(slugifyHandle("Shark King!!!")).toBe("shark-king");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugifyHandle("  --hello--  ")).toBe("hello");
  });

  it("caps at 30 characters", () => {
    expect(slugifyHandle("a".repeat(50)).length).toBe(30);
  });

  it("handles empty input", () => {
    expect(slugifyHandle("")).toBe("");
  });
});

describe("isValidHandle", () => {
  it("accepts a normal handle", () => {
    expect(isValidHandle("shark-king")).toBe(true);
  });

  it("rejects uppercase", () => {
    expect(isValidHandle("Shark-King")).toBe(false);
  });

  it("rejects too-short handles", () => {
    expect(isValidHandle("ab")).toBe(false);
  });

  it("rejects too-long handles", () => {
    expect(isValidHandle("a".repeat(31))).toBe(false);
  });

  it("rejects leading/trailing hyphens", () => {
    expect(isValidHandle("-shark")).toBe(false);
    expect(isValidHandle("shark-")).toBe(false);
  });

  it("rejects spaces and special chars", () => {
    expect(isValidHandle("shark king")).toBe(false);
    expect(isValidHandle("shark_king")).toBe(false);
  });
});

describe("publicPressKitUrl", () => {
  it("builds the shareable URL", () => {
    expect(publicPressKitUrl("https://bowdownvisuals.com", "shark-king")).toBe(
      "https://bowdownvisuals.com/press/shark-king",
    );
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(publicPressKitUrl("https://bowdownvisuals.com/", "shark-king")).toBe(
      "https://bowdownvisuals.com/press/shark-king",
    );
  });
});
