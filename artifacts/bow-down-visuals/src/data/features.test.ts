/**
 * Tests for the feature registry (src/data/features.ts).
 *
 * The registry powers the /features showcase and the /promote generator's
 * feature picker, so it must stay internally consistent: unique keys,
 * well-formed routes, valid categories, and complete display fields.
 */
import { describe, it, expect } from "vitest";
import {
  SITE_FEATURES,
  FEATURE_CATEGORIES,
  getFeature,
  featuresByCategory,
  type FeatureCategory,
} from "./features";

const VALID_CATEGORIES: FeatureCategory[] = ["create", "promote", "grow", "business"];

describe("feature registry", () => {
  it("has at least one feature in every category", () => {
    for (const cat of FEATURE_CATEGORIES) {
      expect(
        SITE_FEATURES.filter((f) => f.category === cat.key).length,
        `category ${cat.key} is empty`
      ).toBeGreaterThan(0);
    }
  });

  it("uses unique keys", () => {
    const keys = SITE_FEATURES.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every feature a name, tagline, route, credit cost, icon and valid category", () => {
    for (const f of SITE_FEATURES) {
      expect(f.name.trim().length, `${f.key}: name`).toBeGreaterThan(0);
      expect(f.tagline.trim().length, `${f.key}: tagline`).toBeGreaterThan(0);
      expect(f.route, `${f.key}: route`).toMatch(/^\/[a-z0-9/-]*$/);
      expect(f.creditCost.trim().length, `${f.key}: creditCost`).toBeGreaterThan(0);
      expect(f.icon, `${f.key}: icon`).toBeDefined();
      expect(VALID_CATEGORIES, `${f.key}: category`).toContain(f.category);
      if (f.badge) {
        expect(["POPULAR", "NEW"], `${f.key}: badge`).toContain(f.badge);
      }
    }
  });

  it("getFeature resolves every key and returns undefined for unknown keys", () => {
    for (const f of SITE_FEATURES) {
      expect(getFeature(f.key)?.name).toBe(f.name);
    }
    expect(getFeature("not-a-real-feature")).toBeUndefined();
  });

  it("featuresByCategory only returns features of that category", () => {
    for (const cat of VALID_CATEGORIES) {
      const list = featuresByCategory(cat);
      expect(list.length).toBeGreaterThan(0);
      for (const f of list) {
        expect(f.category).toBe(cat);
      }
    }
  });

  it("covers the core creator workflow (video, music, hooks, coach)", () => {
    const names = SITE_FEATURES.map((f) => f.name);
    for (const must of ["AI Video Generator", "Music Maker", "Hook Studio", "Monetization Coach"]) {
      expect(names, `missing ${must}`).toContain(must);
    }
  });
});
