/**
 * Tests for the thumbnail template library (src/data/thumbnail-templates.ts).
 *
 * The library is pure DATA: the public /templates/thumbnails gallery
 * renders it and every entry deep-links into the Thumbnail Maker with
 * ?template=<slug>, where the maker applies the entry's stylePreset —
 * so every stylePreset must be one of the maker's real preset ids
 * (pages/thumbnail-studio.tsx STYLE_PRESETS). The count is pinned at
 * 31 after the Stack 200 U5 addition (live-stream-thumbnail).
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
  it("holds the full library (31 templates)", () => {
    expect(THUMBNAIL_TEMPLATES.length).toBe(31);
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
});
