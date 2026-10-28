/**
 * export-pricing.test.ts — payfix lane 6, rung 1 + stack400 lane 3.
 *
 * The client pricing mirror must agree with the server rail
 * (export-branded-free.test.ts truth table) so the spend dialog quotes
 * exactly what the rail charges: branded = 0 VB in the dialog AND on
 * the rail (A-01), clean = 400 VB (A-02). Lane 3: the truth table is
 * owned by the export-time toggle — OFF is clean at 400 VB on EVERY
 * plan (before, the default-on branding block and the free-plan gate
 * made the dialog quote "branded — free" no matter how the owner set
 * the toggle: the Oct 28 gate failure).
 */
import { describe, it, expect } from "vitest";
import {
  EXPORT_CLEAN_COST,
  predictClientExportWatermarked,
  exportPriceFor,
} from "./export-pricing";

describe("predictClientExportWatermarked — mirror of the server prediction", () => {
  it("toggle OFF is clean on every plan, branding block or not", () => {
    expect(predictClientExportWatermarked({ addWatermark: false, isSubscriber: false })).toBe(false);
    expect(predictClientExportWatermarked({ addWatermark: false, isSubscriber: true })).toBe(false);
    expect(predictClientExportWatermarked({ addWatermark: false })).toBe(false);
    // The Oct 28 defect shape exactly: editor-default branding must not
    // override the toggle.
    expect(
      predictClientExportWatermarked({
        addWatermark: false,
        isSubscriber: false,
        branding: { watermark: { enabled: true, bdvWatermark: true } },
      }),
    ).toBe(false);
    expect(
      predictClientExportWatermarked({
        addWatermark: false,
        isSubscriber: true,
        branding: {
          watermark: { enabled: true, customLogoUrl: "https://cdn.example/logo.png", bdvWatermark: false },
        },
      }),
    ).toBe(false);
  });

  it("toggle ON is branded on every plan", () => {
    expect(predictClientExportWatermarked({ addWatermark: true, isSubscriber: false })).toBe(true);
    expect(predictClientExportWatermarked({ addWatermark: true, isSubscriber: true })).toBe(true);
  });

  it("an enabled branding watermark chooses the artwork when the toggle is not OFF", () => {
    expect(
      predictClientExportWatermarked({
        isSubscriber: true,
        branding: { watermark: { enabled: true, bdvWatermark: true } },
      }),
    ).toBe(true);
    // The one clean escape: branding on, house watermark explicitly off,
    // no custom logo → clean (gated + reserved on the rail).
    expect(
      predictClientExportWatermarked({
        addWatermark: true,
        isSubscriber: false,
        branding: { watermark: { enabled: true, bdvWatermark: false } },
      }),
    ).toBe(false);
  });

  it("flag omitted keeps the legacy plan default", () => {
    expect(predictClientExportWatermarked({})).toBe(true);
    expect(predictClientExportWatermarked({ isSubscriber: false })).toBe(true);
    expect(predictClientExportWatermarked({ isSubscriber: true })).toBe(false);
    expect(
      predictClientExportWatermarked({
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
    expect(exportPriceFor({ addWatermark: true, isSubscriber: false }).cost).toBe(0);
  });

  it("toggle OFF → clean → 400 VB on every plan and both doors (A-02)", () => {
    expect(EXPORT_CLEAN_COST).toBe(400);
    for (const isSubscriber of [true, false]) {
      expect(exportPriceFor({ addWatermark: false, isSubscriber })).toMatchObject({
        branded: false,
        cost: 400,
      });
      expect(exportPriceFor({ addWatermark: false, isSubscriber, quality: true })).toMatchObject({
        branded: false,
        cost: 400,
      });
    }
    // …including with the editor-default branding block riding along.
    expect(
      exportPriceFor({
        addWatermark: false,
        isSubscriber: false,
        branding: { watermark: { enabled: true, bdvWatermark: true } },
      }).cost,
    ).toBe(400);
  });

  it("the flag-less default for a non-subscriber stays branded and free", () => {
    expect(exportPriceFor({}).cost).toBe(0);
    expect(exportPriceFor({ isSubscriber: false }).cost).toBe(0);
  });

  it("quality export with the watermark toggle on is branded and free", () => {
    expect(exportPriceFor({ addWatermark: true, isSubscriber: true, quality: true }).cost).toBe(0);
    expect(exportPriceFor({ addWatermark: true, isSubscriber: false, quality: true }).cost).toBe(0);
  });
});
