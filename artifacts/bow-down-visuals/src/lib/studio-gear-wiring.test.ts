/**
 * studio-gear-wiring.test.ts — the Studio Gear department must DOCK in the
 * Branding Shop (never a standalone page/route), carry both themes, and
 * drive the /api/studio-gear rail's proof gate from the orders list.
 * The frontend suite runs in node (no DOM), so these pin the sources —
 * the house wiring-pin pattern.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shopPage = readFileSync(new URL("../pages/branding-shop.tsx", import.meta.url), "utf8");
const gear = readFileSync(
  new URL("../components/branding/StudioGearShop.tsx", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("studio gear docks in the Branding Shop", () => {
  it("the shop page renders the gear department — no standalone route exists", () => {
    expect(shopPage).toContain('import StudioGearShop from "@/components/branding/StudioGearShop"');
    expect(shopPage).toContain('{shopCat === "gear" && <StudioGearShop />}');
    expect(shopPage).toContain('key: "gear"');
    expect(app).not.toContain("studio-gear");
    expect(app).not.toContain("StudioGear");
  });

  it("deep-links through the shop's subtab, like the other departments", () => {
    expect(shopPage).toContain('get("subtab") === "gear"');
  });

  it("the gear desk is themed both ways (light + dark company law)", () => {
    expect(gear).toContain("useIsLightTheme");
    expect(gear).toContain("isLight");
    expect(gear).toContain("#C9A84C");
  });

  it("states the fulfillment model + test mode up front", () => {
    expect(gear).toContain("STUDIO_GEAR_FULFILLMENT.model");
    expect(gear).toContain("STUDIO_GEAR_FULFILLMENT.proofRule");
    expect(gear).toContain("STUDIO_GEAR_FULFILLMENT.returnsRule");
    expect(gear).toContain("Test mode — no real charges");
  });

  it("custom pieces collect artwork + spec fields for the proof", () => {
    expect(gear).toContain("/api/branding-shop/upload-logo");
    expect(gear).toContain("customText");
    expect(gear).toContain("specNotes");
    expect(gear).toContain("artworkUrl");
  });

  it("orders ride the gear rail and the proof gate is buyer-driven", () => {
    expect(gear).toContain('"/api/studio-gear/orders"');
    expect(gear).toContain('"/api/studio-gear/checkout"');
    expect(gear).toContain("/proof/${action}");
    expect(gear).toContain('"approve" | "request-revision"');
    expect(gear).toContain('o.proofStatus === "sent"');
  });
});
