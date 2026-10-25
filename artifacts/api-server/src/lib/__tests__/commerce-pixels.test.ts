/**
 * Commerce tracking pixels (wave-4 #41) — the shared validation lib.
 * Mirrors the release rail's cleanPixelId shape table (distribution
 * suite) so both rails accept and refuse exactly the same IDs.
 */
import { describe, it, expect } from "vitest";
import {
  cleanCommercePixelId,
  cleanCommercePixels,
  sanitizeCommercePixels,
  hasArmedCommercePixel,
  NO_PIXELS,
} from "../commerce-pixels";

describe("cleanCommercePixelId: shape table (release-rail parity)", () => {
  it("accepts real shapes, refuses junk", () => {
    expect(cleanCommercePixelId("meta", "123456", null)).toEqual({ ok: true, value: "123456" });
    expect(cleanCommercePixelId("meta", "12345", null).ok).toBe(false);
    expect(cleanCommercePixelId("meta", "123456789012345678901", null).ok).toBe(false);
    expect(cleanCommercePixelId("tiktok", "C9ABCDEFGHIJKLMN12", null).ok).toBe(true);
    expect(cleanCommercePixelId("tiktok", "has spaces init", null).ok).toBe(false);
    expect(cleanCommercePixelId("google", "AW-123456789", null).ok).toBe(true);
    expect(cleanCommercePixelId("google", "GT-AB12CD", null).ok).toBe(true);
    expect(cleanCommercePixelId("google", "G-ABC123XYZ9", null).ok).toBe(true);
    expect(cleanCommercePixelId("google", "XX-12345", null).ok).toBe(false);
  });

  it("undefined keeps current, blank clears, whitespace trims", () => {
    expect(cleanCommercePixelId("meta", undefined, "999999")).toEqual({ ok: true, value: "999999" });
    expect(cleanCommercePixelId("meta", "  ", "999999")).toEqual({ ok: true, value: null });
    expect(cleanCommercePixelId("meta", " 123456 ", null)).toEqual({ ok: true, value: "123456" });
  });
});

describe("cleanCommercePixels", () => {
  it("one bent ID refuses the whole set", () => {
    const r = cleanCommercePixels(
      { metaPixelId: "123456789", googleTagId: "nope" },
      NO_PIXELS,
    );
    expect(r.ok).toBe(false);
  });

  it("merges a partial save over current values", () => {
    const r = cleanCommercePixels(
      { tiktokPixelId: "C9ABCDEFGHIJKLMN12" },
      { metaPixelId: "123456789", tiktokPixelId: null, googleTagId: null },
    );
    expect(r).toEqual({
      ok: true,
      value: { metaPixelId: "123456789", tiktokPixelId: "C9ABCDEFGHIJKLMN12", googleTagId: null },
    });
  });
});

describe("sanitizeCommercePixels + hasArmedCommercePixel", () => {
  it("null row → all null, nothing armed", () => {
    expect(sanitizeCommercePixels(null)).toEqual(NO_PIXELS);
    expect(hasArmedCommercePixel(NO_PIXELS)).toBe(false);
    expect(hasArmedCommercePixel(null)).toBe(false);
  });

  it("bent stored shapes present as null; valid ones pass through", () => {
    const p = sanitizeCommercePixels({
      meta_pixel_id: "junk!!",
      tiktok_pixel_id: "C9ABCDEFGHIJKLMN12",
      google_tag_id: " G-ABC123XYZ9 ",
    });
    expect(p).toEqual({ metaPixelId: null, tiktokPixelId: "C9ABCDEFGHIJKLMN12", googleTagId: "G-ABC123XYZ9" });
    expect(hasArmedCommercePixel(p)).toBe(true);
  });
});
