/**
 * Unit tests for the press-kit client helpers: handle slugification,
 * handle validation (mirrors the server rules), and public URL building.
 * Plus the pricing pins: what the page displays and confirms must equal
 * the credit registry — which records the server's actual charges
 * (PRESS_KIT_GENERATE_CREDITS 300 / PRESS_KIT_BIO_REFRESH_CREDITS 100
 * in the API's press-kit route; the page once confirmed a stale
 * pre-x100 3/1 in its popup while the server charged 300/100).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  slugifyHandle,
  isValidHandle,
  publicPressKitUrl,
  PRESS_KIT_GENERATE_COST_VISUAL_BUCS,
  PRESS_KIT_BIO_REFRESH_COST_VISUAL_BUCS,
} from "./press-kit";
import { getCreditCost } from "./credit-costs";
import {
  PRESS_KIT_GENERATE_COST_VISUAL_BUCS as WORLD_GENERATE_COST,
  PRESS_KIT_BIO_REFRESH_COST_VISUAL_BUCS as WORLD_REFRESH_COST,
} from "./world/business-desks";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const pressKitPageSource = read("../pages/press-kit.tsx");

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

describe("press-kit pricing — displayed == registry == server charge", () => {
  it("the generate price IS the registry price for /api/press-kit/generate", () => {
    expect(PRESS_KIT_GENERATE_COST_VISUAL_BUCS).toBe(
      getCreditCost("/api/press-kit/generate")?.cost,
    );
    expect(PRESS_KIT_GENERATE_COST_VISUAL_BUCS).toBe(300);
  });

  it("the bio-refresh price IS the registry price for the :id route", () => {
    expect(PRESS_KIT_BIO_REFRESH_COST_VISUAL_BUCS).toBe(
      getCreditCost("/api/press-kit/:id/regenerate-bio")?.cost,
    );
    expect(PRESS_KIT_BIO_REFRESH_COST_VISUAL_BUCS).toBe(100);
  });

  it("agrees with the in-world Business Desks prices for the same actions", () => {
    expect(WORLD_GENERATE_COST).toBe(PRESS_KIT_GENERATE_COST_VISUAL_BUCS);
    expect(WORLD_REFRESH_COST).toBe(PRESS_KIT_BIO_REFRESH_COST_VISUAL_BUCS);
  });

  it("the page confirms and labels by these constants — the stale 3/1 fallbacks are gone", () => {
    expect(pressKitPageSource).toContain("overrideCost: PRESS_KIT_GENERATE_COST_VISUAL_BUCS");
    expect(pressKitPageSource).toContain("overrideCost: PRESS_KIT_BIO_REFRESH_COST_VISUAL_BUCS");
    expect(pressKitPageSource).toContain("count: PRESS_KIT_GENERATE_COST_VISUAL_BUCS");
    expect(pressKitPageSource).toContain("count: PRESS_KIT_BIO_REFRESH_COST_VISUAL_BUCS");
    expect(pressKitPageSource).not.toContain("FALLBACK_GENERATE_COST");
    expect(pressKitPageSource).not.toContain("FALLBACK_REFRESH_COST");
  });
});
