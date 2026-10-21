/**
 * Tests for the video template display metadata (src/data/video-templates.ts).
 *
 * These metas drive the public /templates/videos gallery and mirror the
 * server-side render recipes (api-server src/data/video-templates.ts) by
 * key. The key list is pinned exactly and matches the list pinned in the
 * api-server's video-templates test, so the gallery can never show a
 * template the engine cannot render (or hide one it can).
 */
import { describe, it, expect } from "vitest";
import {
  VIDEO_TEMPLATE_METAS,
  VIDEO_TEMPLATE_CATEGORIES,
  getVideoTemplateMeta,
} from "./video-templates";

/* Mirror of the server recipe keys — keep in lockstep with
   api-server/src/data/__tests__/video-templates.test.ts. */
const EXPECTED_KEYS = [
  "photo-dump-montage",
  "lyric-sync-cut",
  "product-promo-punch",
  "before-after-reveal",
  "travel-recap",
  "talking-head-polish",
  "hype-trailer",
  "podcast-highlight",
  "launch-announcement",
  "product-showcase",
  "sale-announcement",
  "seasonal-drop",
  "testimonial-spotlight",
  "quote-card",
  "event-recap",
  "tutorial-steps",
  "podcast-clip-vertical",
  "lyric-video-landscape",
];

describe("video template display metas", () => {
  it("mirrors the full server library (18 templates)", () => {
    expect(VIDEO_TEMPLATE_METAS.length).toBeGreaterThanOrEqual(16);
    expect(VIDEO_TEMPLATE_METAS.map((t) => t.key)).toEqual(EXPECTED_KEYS);
  });

  it("uses unique keys", () => {
    const keys = VIDEO_TEMPLATE_METAS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("round-trips every key through getVideoTemplateMeta", () => {
    for (const meta of VIDEO_TEMPLATE_METAS) {
      expect(getVideoTemplateMeta(meta.key)).toBe(meta);
    }
    expect(getVideoTemplateMeta("no-such-template")).toBeNull();
  });

  it("has complete, well-formed display fields on every card", () => {
    for (const meta of VIDEO_TEMPLATE_METAS) {
      expect(meta.name.trim().length, meta.key).toBeGreaterThan(0);
      expect(meta.tagline.trim().length, meta.key).toBeGreaterThan(0);
      expect(meta.description.trim().length, meta.key).toBeGreaterThan(0);
      expect(meta.outcome.trim().length, meta.key).toBeGreaterThan(0);
      expect(["9:16", "16:9", "1:1"], meta.key).toContain(meta.aspect);
      expect(meta.durationLabel, meta.key).toMatch(/^~\d+s$/);
      expect(meta.slotCount, meta.key).toBeGreaterThanOrEqual(1);
      expect(meta.slotCount, meta.key).toBeLessThanOrEqual(16);
    }
  });

  it("files every template under a listed category, with no empty category", () => {
    const real = VIDEO_TEMPLATE_CATEGORIES.filter((c) => c !== "All");
    for (const meta of VIDEO_TEMPLATE_METAS) {
      expect(real, meta.key).toContain(meta.category);
    }
    for (const cat of real) {
      expect(
        VIDEO_TEMPLATE_METAS.some((t) => t.category === cat),
        `category ${cat} is empty`
      ).toBe(true);
    }
  });
});
