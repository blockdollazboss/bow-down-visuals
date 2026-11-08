/**
 * hosting-desk.test.ts — Stack 300 item 90 seam pins.
 *
 * The World Hosting desk's parsers: a well-formed plan/me payload
 * parses to the exact views the 2D card renders from; a malformed
 * one parses to null so the desk shows its honest load-failed state
 * instead of inventing a hosting state. The payload builders carry
 * the in-world returnTo ("/world") and nothing else.
 */
import { describe, it, expect } from "vitest";
import {
  parseHostingPlan,
  parseHostingMe,
  hostingCheckoutPayload,
  hostingPortalPayload,
} from "./hosting-desk";

const PLAN = {
  name: "Profile Hosting",
  tagline: "Your own website, on your own domain.",
  features: [
    { label: "Custom domain", detailsUrl: null },
    { label: "Clean branding", detailsUrl: "/creator-pricing" },
    { label: "" },
    "not-an-object",
  ],
  priceUsdPerMonth: 9,
  includedWithTier: "elite",
  priceConfigured: true,
  available: true,
};

const ME = {
  hostingEntitled: true,
  hostingStatus: "active",
  hostingSource: "hosting",
  includedWithElite: false,
  currentPeriodEnd: "2026-12-07T00:00:00.000Z",
  cleanBranding: true,
  plan: PLAN,
};

describe("parseHostingPlan", () => {
  it("parses the plan DTO (bare or { plan }-wrapped), dropping malformed features", () => {
    const bare = parseHostingPlan(PLAN);
    expect(bare?.name).toBe("Profile Hosting");
    expect(bare?.priceUsdPerMonth).toBe(9);
    expect(bare?.features).toEqual([
      { label: "Custom domain", detailsUrl: "" },
      { label: "Clean branding", detailsUrl: "/creator-pricing" },
    ]);
    expect(parseHostingPlan({ plan: PLAN })?.priceConfigured).toBe(true);
  });

  it("a plan without a name or a numeric price is not a plan", () => {
    expect(parseHostingPlan({ ...PLAN, name: "" })).toBeNull();
    expect(parseHostingPlan({ ...PLAN, priceUsdPerMonth: "9" })).toBeNull();
    expect(parseHostingPlan(null)).toBeNull();
    expect(parseHostingPlan("plan")).toBeNull();
  });
});

describe("parseHostingMe", () => {
  it("parses the caller's hosting truth", () => {
    const me = parseHostingMe(ME);
    expect(me?.hostingEntitled).toBe(true);
    expect(me?.hostingSource).toBe("hosting");
    expect(me?.currentPeriodEnd).toBe("2026-12-07T00:00:00.000Z");
    expect(me?.plan.priceUsdPerMonth).toBe(9);
  });

  it("an unknown hosting source reads null, never a guessed one", () => {
    expect(parseHostingMe({ ...ME, hostingSource: "magic" })?.hostingSource).toBeNull();
  });

  it("no entitlement boolean or no plan → null (the desk retries honestly)", () => {
    expect(parseHostingMe({ ...ME, hostingEntitled: "yes" })).toBeNull();
    expect(parseHostingMe({ ...ME, plan: null })).toBeNull();
    expect(parseHostingMe({})).toBeNull();
  });
});

describe("payload builders", () => {
  it("checkout + portal both carry only the in-world returnTo", () => {
    expect(hostingCheckoutPayload()).toEqual({ returnTo: "/world" });
    expect(hostingPortalPayload()).toEqual({ returnTo: "/world" });
  });
});
