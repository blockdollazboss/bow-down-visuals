/**
 * A-01 (Stack-100 #3) — branded exports are FREE; no path charges the
 * clean price for watermarked output.
 *
 * predictExportWatermarked mirrors executeExport's own watermark
 * decision and drives the route gates + the at-start reservation (A-07).
 * These pins walk the truth table: plan gate, subscriber opt-in, and the
 * branding-watermark block (which decides for itself, including its one
 * clean escape — house watermark explicitly off with no custom logo).
 */
import { describe, it, expect } from "vitest";

import { predictExportWatermarked } from "../generate/export-video";

describe("predictExportWatermarked — branded-free prediction (A-01)", () => {
  it("free/trial users are always branded unless the branding block opts clean", () => {
    expect(predictExportWatermarked({ addWatermark: false }, "free")).toBe(true);
    expect(predictExportWatermarked({ addWatermark: false }, "trial")).toBe(true);
    expect(predictExportWatermarked({}, null)).toBe(true);
    expect(predictExportWatermarked({}, undefined)).toBe(true);
  });

  it("subscribers are clean by default and branded only when they ask", () => {
    expect(predictExportWatermarked({ addWatermark: false }, "pro")).toBe(false);
    expect(predictExportWatermarked({}, "elite")).toBe(false);
    expect(predictExportWatermarked({ addWatermark: true }, "pro")).toBe(true);
  });

  it("an enabled branding watermark decides for itself, on any plan", () => {
    // House watermark on → branded even for a subscriber who opted out.
    expect(
      predictExportWatermarked(
        { addWatermark: false, branding: { watermark: { enabled: true, bdvWatermark: true } } },
        "pro",
      ),
    ).toBe(true);
    // Custom logo → branded.
    expect(
      predictExportWatermarked(
        {
          addWatermark: false,
          branding: { watermark: { enabled: true, customLogoUrl: "https://cdn.example/logo.png", bdvWatermark: false } },
        },
        "pro",
      ),
    ).toBe(true);
    // The one clean escape: branding on, house watermark explicitly off,
    // no custom logo → no watermark is burned in → clean (gated + reserved).
    expect(
      predictExportWatermarked(
        { addWatermark: false, branding: { watermark: { enabled: true, bdvWatermark: false } } },
        "free",
      ),
    ).toBe(false);
  });

  it("a disabled branding block falls back to the plan gate", () => {
    expect(
      predictExportWatermarked(
        { addWatermark: false, branding: { watermark: { enabled: false, bdvWatermark: true } } },
        "pro",
      ),
    ).toBe(false);
    expect(
      predictExportWatermarked(
        { addWatermark: false, branding: { watermark: { enabled: false } } },
        "free",
      ),
    ).toBe(true);
  });
});
