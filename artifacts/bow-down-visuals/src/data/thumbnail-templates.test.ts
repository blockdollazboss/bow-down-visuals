/**
 * Tests for the thumbnail template library (src/data/thumbnail-templates.ts).
 *
 * The library is pure DATA: the public /templates/thumbnails gallery
 * renders it and every entry deep-links into the Thumbnail Maker with
 * ?template=<slug>, where the maker applies the entry's stylePreset —
 * so every stylePreset must be one of the maker's real preset ids
 * (pages/thumbnail-studio.tsx STYLE_PRESETS). The count is pinned at
 * 37 after the Stack 400 additions (challenge-30-day, tier-list and
 * documentary-deep-dive thumbnails — the Challenge, Tier List and
 * Documentary categories), on top of the Stack 300 additions
 * (horror-story, car-review and asmr-video thumbnails).
 */
import { describe, it, expect } from "vitest";
import {
  THUMBNAIL_TEMPLATES,
  THUMBNAIL_CATEGORIES,
  getThumbnailTemplate,
} from "./thumbnail-templates";

/* The Thumbnail Maker's style preset ids — a template pointing at any
   other id would preload a style the maker cannot render. */
const MAKER_STYLE_PRESETS = [
  "bold-text-pop",
  "shocked-face",
  "before-after",
  "luxury",
  "gaming",
  "vlog",
];

describe("thumbnail template library", () => {
  it("holds the full library (37 templates)", () => {
    expect(THUMBNAIL_TEMPLATES.length).toBe(37);
  });

  it("uses unique, kebab-case slugs", () => {
    const slugs = THUMBNAIL_TEMPLATES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug, `slug ${slug}`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("round-trips every slug through getThumbnailTemplate", () => {
    for (const tpl of THUMBNAIL_TEMPLATES) {
      expect(getThumbnailTemplate(tpl.slug)).toBe(tpl);
    }
    expect(getThumbnailTemplate("no-such-template")).toBeUndefined();
  });

  it("has complete, well-formed fields on every template", () => {
    for (const tpl of THUMBNAIL_TEMPLATES) {
      expect(tpl.title.trim().length, tpl.slug).toBeGreaterThan(0);
      expect(tpl.metaDescription.trim().length, tpl.slug).toBeGreaterThan(0);
      expect(tpl.metaDescription.length, tpl.slug).toBeLessThanOrEqual(200);
      expect(tpl.blurb.trim().length, tpl.slug).toBeGreaterThan(0);
      expect(tpl.category.trim().length, tpl.slug).toBeGreaterThan(0);
      expect(MAKER_STYLE_PRESETS, tpl.slug).toContain(tpl.stylePreset);
      expect(["16:9", "9:16"], tpl.slug).toContain(tpl.aspectRatio);
      expect(tpl.prompt.trim().length, tpl.slug).toBeGreaterThan(0);
      expect(tpl.overlayText.trim().length, tpl.slug).toBeGreaterThan(0);
      expect(tpl.keywords.length, tpl.slug).toBeGreaterThanOrEqual(1);
      expect(tpl.emoji.trim().length, tpl.slug).toBeGreaterThan(0);
    }
  });

  it("derives its category chips from the templates themselves", () => {
    expect(THUMBNAIL_CATEGORIES[0]).toBe("All");
    for (const tpl of THUMBNAIL_TEMPLATES) {
      expect(THUMBNAIL_CATEGORIES).toContain(tpl.category);
    }
  });

  it("the U5 live-stream cover resolves with its LIVE-badge shape", () => {
    const live = getThumbnailTemplate("live-stream-thumbnail");
    expect(live).toMatchObject({
      title: "Live Stream Thumbnail",
      category: "Live",
      stylePreset: "bold-text-pop",
      aspectRatio: "16:9",
      overlayText: "WE'RE LIVE!",
    });
    expect(live?.prompt).toContain("LIVE badge");
    expect(THUMBNAIL_CATEGORIES).toContain("Live");
  });

  it("the Stack 300 horror, car and ASMR covers resolve with their shapes", () => {
    const horror = getThumbnailTemplate("horror-story-thumbnail");
    expect(horror).toMatchObject({
      title: "Horror Story Thumbnail",
      category: "Horror",
      stylePreset: "shocked-face",
      aspectRatio: "16:9",
      overlayText: "DON'T TURN AROUND",
    });
    expect(horror?.prompt).toContain("flashlight beam");
    expect(THUMBNAIL_CATEGORIES).toContain("Horror");

    const car = getThumbnailTemplate("car-review-thumbnail");
    expect(car).toMatchObject({
      title: "Car Review Thumbnail",
      category: "Cars",
      stylePreset: "bold-text-pop",
      aspectRatio: "16:9",
      overlayText: "500HP MONSTER",
    });
    expect(car?.prompt).toContain("three-quarter");
    expect(THUMBNAIL_CATEGORIES).toContain("Cars");

    const asmr = getThumbnailTemplate("asmr-video-thumbnail");
    expect(asmr).toMatchObject({
      title: "ASMR Video Thumbnail",
      category: "ASMR",
      stylePreset: "vlog",
      aspectRatio: "16:9",
      overlayText: "PURE TINGLES",
    });
    expect(asmr?.prompt).toContain("microphone");
    expect(THUMBNAIL_CATEGORIES).toContain("ASMR");
  });

  it("the Stack 400 challenge, tier list and documentary covers resolve with their shapes", () => {
    const challenge = getThumbnailTemplate("challenge-30-day-thumbnail");
    expect(challenge).toMatchObject({
      title: "30-Day Challenge Thumbnail",
      category: "Challenge",
      stylePreset: "before-after",
      aspectRatio: "16:9",
      overlayText: "I TRIED IT FOR 30 DAYS",
    });
    expect(challenge?.prompt).toContain("day one vs day thirty");
    expect(THUMBNAIL_CATEGORIES).toContain("Challenge");

    const tier = getThumbnailTemplate("tier-list-thumbnail");
    expect(tier).toMatchObject({
      title: "Tier List Thumbnail",
      category: "Tier List",
      stylePreset: "bold-text-pop",
      aspectRatio: "16:9",
      overlayText: "MY TIER LIST",
    });
    expect(tier?.prompt).toContain("ranked rows");
    expect(THUMBNAIL_CATEGORIES).toContain("Tier List");

    const doc = getThumbnailTemplate("documentary-deep-dive-thumbnail");
    expect(doc).toMatchObject({
      title: "Documentary Deep Dive Thumbnail",
      category: "Documentary",
      stylePreset: "luxury",
      aspectRatio: "16:9",
      overlayText: "THE FULL STORY",
    });
    expect(doc?.prompt).toContain("investigation board");
    expect(THUMBNAIL_CATEGORIES).toContain("Documentary");
  });
});
