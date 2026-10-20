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
  PRESS_KIT_SECTION_KEYS,
  defaultPressKitLayout,
  resolvePressKitLayout,
  movePressKitLayoutEntry,
  setPressKitSectionVisible,
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
const pressPublicPageSource = read("../pages/press-public.tsx");

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

describe("press-kit page layout", () => {
  it("names exactly the six sections the public page renders, in its historical order", () => {
    expect(PRESS_KIT_SECTION_KEYS).toEqual([
      "bio",
      "achievements",
      "press_quotes",
      "top_tracks",
      "photos",
      "contact",
    ]);
  });

  it("the default layout is every section visible, in canonical order", () => {
    expect(defaultPressKitLayout()).toEqual(
      PRESS_KIT_SECTION_KEYS.map((key) => ({ key, visible: true })),
    );
  });

  it("no saved layout resolves to the default — today's render", () => {
    expect(resolvePressKitLayout(null)).toEqual(defaultPressKitLayout());
    expect(resolvePressKitLayout(undefined)).toEqual(defaultPressKitLayout());
    expect(resolvePressKitLayout("garbage")).toEqual(defaultPressKitLayout());
  });

  it("a saved layout's order and visibility are honored", () => {
    const resolved = resolvePressKitLayout([
      { key: "top_tracks", visible: true },
      { key: "bio", visible: false },
    ]);
    expect(resolved.map((e) => e.key)).toEqual([
      "top_tracks",
      "bio",
      "achievements",
      "press_quotes",
      "photos",
      "contact",
    ]);
    expect(resolved.find((e) => e.key === "bio")?.visible).toBe(false);
    // sections the saved layout never mentioned append, visible
    expect(resolved.find((e) => e.key === "photos")?.visible).toBe(true);
  });

  it("unknown and duplicate keys drop out of a stored layout", () => {
    const resolved = resolvePressKitLayout([
      { key: "merch_table", visible: true },
      { key: "bio", visible: true },
      { key: "bio", visible: false },
      "junk",
      null,
    ]);
    expect(resolved.map((e) => e.key)).toEqual([...PRESS_KIT_SECTION_KEYS]);
    expect(resolved.find((e) => e.key === "bio")?.visible).toBe(true);
  });

  it("movePressKitLayoutEntry swaps neighbours and stops at the ends", () => {
    const start = defaultPressKitLayout();
    const moved = movePressKitLayoutEntry(start, "achievements", -1);
    expect(moved.map((e) => e.key)).toEqual([
      "achievements",
      "bio",
      "press_quotes",
      "top_tracks",
      "photos",
      "contact",
    ]);
    expect(movePressKitLayoutEntry(start, "bio", -1)).toBe(start);
    expect(movePressKitLayoutEntry(start, "contact", 1)).toBe(start);
    // the input array is not mutated
    expect(start.map((e) => e.key)).toEqual([...PRESS_KIT_SECTION_KEYS]);
  });

  it("setPressKitSectionVisible flips one section only", () => {
    const next = setPressKitSectionVisible(defaultPressKitLayout(), "photos", false);
    expect(next.find((e) => e.key === "photos")?.visible).toBe(false);
    expect(next.filter((e) => e.visible)).toHaveLength(5);
  });

  it("the public page renders through the resolver, visible sections only", () => {
    expect(pressPublicPageSource).toContain("resolvePressKitLayout(kit.layout)");
    expect(pressPublicPageSource).toContain(".filter((entry) => entry.visible)");
    expect(pressPublicPageSource).toContain("sectionBlocks[entry.key]");
    // every section key has a block on the public page
    for (const key of PRESS_KIT_SECTION_KEYS) {
      expect(pressPublicPageSource).toContain(`${key}:`);
    }
  });

  it("the editor saves the layout through the same PUT payload as the content", () => {
    expect(pressKitPageSource).toContain("layout,");
    expect(pressKitPageSource).toContain("movePressKitLayoutEntry");
    expect(pressKitPageSource).toContain("setPressKitSectionVisible");
    expect(pressKitPageSource).toContain("resolvePressKitLayout(k.layout)");
  });
});
