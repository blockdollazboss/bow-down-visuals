/**
 * A-01/A-02 (Stack-100 #3 + stack400 lane 3) — branded exports are FREE;
 * no path charges the clean price for watermarked output, and a CLEAN
 * export is reachable at the ruled 400 VB on every plan.
 *
 * predictExportWatermarked mirrors executeExport's own watermark
 * decision and drives the route gates + the at-start reservation (A-07).
 * The truth table is owned by the export-time decision:
 *  - addWatermark === false (the Export tab / Quality panel toggle OFF)
 *    is ALWAYS clean — before lane 3 the default-on branding block and
 *    the free-plan gate overrode the toggle, so the toggle changed
 *    nothing and clean could never be priced (Oct 28 gate failure);
 *  - otherwise an enabled branding watermark chooses the artwork,
 *    including its one clean escape (house watermark explicitly off
 *    with no custom logo → nothing is burned in → clean);
 *  - addWatermark === true → branded;
 *  - flag omitted → the legacy plan default (free/trial branded,
 *    subscribers clean).
 */
import { describe, it, expect } from "vitest";

import { predictExportWatermarked } from "../generate/export-video";

describe("predictExportWatermarked — the export-time toggle decides (lane 3)", () => {
  it("toggle OFF is clean on every plan, branding block or not", () => {
    expect(predictExportWatermarked({ addWatermark: false }, "free")).toBe(false);
    expect(predictExportWatermarked({ addWatermark: false }, "trial")).toBe(false);
    expect(predictExportWatermarked({ addWatermark: false }, "pro")).toBe(false);
    expect(predictExportWatermarked({ addWatermark: false }, "elite")).toBe(false);
    expect(predictExportWatermarked({ addWatermark: false }, null)).toBe(false);
    // The Oct 28 defect shape exactly: default editor branding
    // (watermark enabled + house mark on) must NOT override the toggle.
    expect(
      predictExportWatermarked(
        { addWatermark: false, branding: { watermark: { enabled: true, bdvWatermark: true } } },
        "free",
      ),
    ).toBe(false);
    // Not even a custom branding logo survives an explicit OFF.
    expect(
      predictExportWatermarked(
        {
          addWatermark: false,
          branding: { watermark: { enabled: true, customLogoUrl: "https://cdn.example/logo.png", bdvWatermark: true } },
        },
        "pro",
      ),
    ).toBe(false);
  });

  it("toggle ON is branded on every plan (branded = free, A-01)", () => {
    expect(predictExportWatermarked({ addWatermark: true }, "free")).toBe(true);
    expect(predictExportWatermarked({ addWatermark: true }, "pro")).toBe(true);
    expect(
      predictExportWatermarked(
        { addWatermark: true, branding: { watermark: { enabled: false, bdvWatermark: true } } },
        "free",
      ),
    ).toBe(true);
  });

  it("an enabled branding watermark chooses the artwork when the toggle is not OFF", () => {
    // House watermark on → branded (flag omitted).
    expect(
      predictExportWatermarked(
        { branding: { watermark: { enabled: true, bdvWatermark: true } } },
        "pro",
      ),
    ).toBe(true);
    // Custom logo → branded.
    expect(
      predictExportWatermarked(
        {
          addWatermark: true,
          branding: { watermark: { enabled: true, customLogoUrl: "https://cdn.example/logo.png", bdvWatermark: false } },
        },
        "free",
      ),
    ).toBe(true);
    // The one clean escape: branding on, house watermark explicitly off,
    // no custom logo → no watermark is burned in → clean (gated + reserved).
    expect(
      predictExportWatermarked(
        { addWatermark: true, branding: { watermark: { enabled: true, bdvWatermark: false } } },
        "free",
      ),
    ).toBe(false);
  });

  it("flag omitted keeps the legacy plan default", () => {
    expect(predictExportWatermarked({}, "free")).toBe(true);
    expect(predictExportWatermarked({}, "trial")).toBe(true);
    expect(predictExportWatermarked({}, null)).toBe(true);
    expect(predictExportWatermarked({}, undefined)).toBe(true);
    expect(predictExportWatermarked({}, "pro")).toBe(false);
    expect(predictExportWatermarked({}, "elite")).toBe(false);
    expect(
      predictExportWatermarked(
        { branding: { watermark: { enabled: false, bdvWatermark: true } } },
        "free",
      ),
    ).toBe(true);
  });
});
