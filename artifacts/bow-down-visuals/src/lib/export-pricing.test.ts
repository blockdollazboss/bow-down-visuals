/**
 * export-pricing.test.ts — payfix lane 6, rung 1.
 *
 * The client pricing mirror must agree with the server rail
 * (export-branded-free.test.ts truth table) so the spend dialog never
 * again prices a branded export at the 400 VB clean price (Oct 26
 * Pass-3 defect a): branded = 0 VB in the dialog AND on the rail (A-01),
 * clean = 400 VB (A-02).
 */
import { describe, it, expect } from "vitest";
import {
  EXPORT_CLEAN_COST,
  predictClientExportWatermarked,
  exportPriceFor,
} from "./export-pricing";

describe("predictClientExportWatermarked — mirror of the server prediction (A-01)", () => {
  it("non-subscribers are always branded unless the branding block opts clean", () => {
    expect(predictClientExportWatermarked({ addWatermark: false, isSubscriber: false })).toBe(true);
    expect(predictClientExportWatermarked({ addWatermark: false })).toBe(true);
    expect(predictClientExportWatermarked({})).toBe(true);
  });

  it("subscribers are clean by default and branded only when they ask", () => {
    expect(predictClientExportWatermarked({ addWatermark: false, isSubscriber: true })).toBe(false);
    expect(predictClientExportWatermarked({ isSubscriber: true })).toBe(false);
    expect(predictClientExportWatermarked({ addWatermark: true, isSubscriber: true })).toBe(true);
  });

  it("an enabled branding watermark decides for itself, on any plan", () => {
    expect(
      predictClientExportWatermarked({
        addWatermark: false,
        isSubscriber: true,
        branding: { watermark: { enabled: true, bdvWatermark: true } },
      }),
    ).toBe(true);
    expect(
      predictClientExportWatermarked({
        addWatermark: false,
        isSubscriber: true,
        branding: {
          watermark: { enabled: true, customLogoUrl: "https://cdn.example/logo.png", bdvWatermark: false },
        },
      }),
    ).toBe(true);
    // The one clean escape: branding on, house watermark explicitly off,
    // no custom logo → clean (gated + reserved on the rail).
    expect(
      predictClientExportWatermarked({
        addWatermark: false,
        isSubscriber: false,
        branding: { watermark: { enabled: true, bdvWatermark: false } },
      }),
    ).toBe(false);
  });

  it("a disabled branding block falls back to the plan gate", () => {
    expect(
      predictClientExportWatermarked({
        addWatermark: false,
        isSubscriber: true,
        branding: { watermark: { enabled: false, bdvWatermark: true } },
      }),
    ).toBe(false);
    expect(
      predictClientExportWatermarked({
        addWatermark: false,
        isSubscriber: false,
        branding: { watermark: { enabled: false } },
      }),
    ).toBe(true);
  });
});

describe("exportPriceFor — dialog price == rail price", () => {
  it("watermark on → branded → 0 VB (the Pass-3 defect: dialog showed 400)", () => {
    const price = exportPriceFor({ addWatermark: true, isSubscriber: true });
    expect(price.branded).toBe(true);
    expect(price.cost).toBe(0);
  });

  it("the default export for a non-subscriber is branded and free", () => {
    expect(exportPriceFor({ addWatermark: false, isSubscriber: false }).cost).toBe(0);
    expect(exportPriceFor({}).cost).toBe(0);
  });

  it("clean subscriber export → 400 VB on both doors (A-02)", () => {
    expect(EXPORT_CLEAN_COST).toBe(400);
    expect(exportPriceFor({ addWatermark: false, isSubscriber: true })).toMatchObject({
      branded: false,
      cost: 400,
    });
    expect(exportPriceFor({ addWatermark: false, isSubscriber: true, quality: true })).toMatchObject({
      branded: false,
      cost: 400,
    });
  });

  it("quality export with the watermark toggle on is branded and free", () => {
    expect(exportPriceFor({ addWatermark: true, isSubscriber: true, quality: true }).cost).toBe(0);
  });
});
