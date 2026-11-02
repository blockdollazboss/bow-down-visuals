/**
 * Membership EMBEDDED checkout — FE pins (stack1200, Gate #5 defect).
 *
 * Live proof (staging, Nov 1): the profile "Join — $5 / month" button
 * navigated the fan AWAY to checkout.stripe.com. Owner law 2026-10-26:
 * customer-facing checkout happens ON bowdownvisuals.com. The shop and
 * plan-subscription flows already pay embedded; the membership join
 * (and the past-due card update, which collects a payment on the same
 * surface) now follow the same discipline:
 *
 *  - both join surfaces (the profile section and the /memberships fan
 *    club view) ask for uiMode "embedded" whenever this device can
 *    mount the form (publishable key configured);
 *  - a clientSecret answer mounts the shared <EmbeddedSessionCheckout>
 *    in place — the hosted URL is only the fallback rail, reached when
 *    no clientSecret comes back;
 *  - the past-due Fix-payment door asks for the same embedded
 *    presentation and mounts its form on the page.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const section = readFileSync(
  new URL("../components/artist/ProfileMembershipsSection.tsx", import.meta.url),
  "utf8",
);
const page = readFileSync(new URL("./memberships.tsx", import.meta.url), "utf8");

describe("profile memberships section — embedded-first join", () => {
  it("imports the shared embedded checkout mount", () => {
    expect(section).toContain('from "@/components/checkout/EmbeddedCheckout"');
    expect(section).toContain("EmbeddedSessionCheckout");
    expect(section).toContain("hasStripePublishableKey");
  });

  it("asks the checkout endpoint for the embedded presentation", () => {
    expect(section).toContain('"/api/memberships/checkout"');
    expect(section).toContain('hasStripePublishableKey() ? { uiMode: "embedded" } : {}');
  });

  it("mounts the embedded form on a clientSecret answer", () => {
    expect(section).toContain("<EmbeddedSessionCheckout clientSecret={embedded.clientSecret} />");
    expect(section).toContain('data-testid="profile-memberships-embedded-checkout"');
  });

  it("checks the clientSecret BEFORE any hosted redirect (hosted is fallback only)", () => {
    const secretAt = section.indexOf("res.clientSecret");
    const assignAt = section.indexOf("window.location.assign(res.url)");
    expect(secretAt).toBeGreaterThan(-1);
    expect(assignAt).toBeGreaterThan(secretAt);
  });
});

describe("memberships page — embedded-first join + card update", () => {
  it("imports the shared embedded checkout mount", () => {
    expect(page).toContain('from "@/components/checkout/EmbeddedCheckout"');
    expect(page).toContain("hasStripePublishableKey");
  });

  it("the fan-club join asks for the embedded presentation", () => {
    expect(page).toContain('fetch("/api/memberships/checkout"');
    expect(page).toContain('hasStripePublishableKey() ? { uiMode: "embedded" } : {}');
  });

  it("the fan-club join mounts the embedded form on a clientSecret answer", () => {
    expect(page).toContain("<EmbeddedSessionCheckout clientSecret={embeddedSecret} />");
    expect(page).toContain('data-testid="memberships-join-embedded-checkout"');
    const secretAt = page.indexOf("data.clientSecret");
    const redirectAt = page.indexOf("window.location.href = data.url");
    expect(secretAt).toBeGreaterThan(-1);
    expect(redirectAt).toBeGreaterThan(secretAt);
  });

  it("the past-due card update asks for embedded and mounts its form on the page", () => {
    expect(page).toContain("/update-payment`");
    expect(page).toContain("<EmbeddedSessionCheckout clientSecret={fixEmbeddedSecret} />");
    expect(page).toContain('data-testid="memberships-fix-embedded-checkout"');
    /* The hosted URL remains only as the fallback after the
       clientSecret branch in fixPayment. */
    const secretAt = page.indexOf('typeof data.clientSecret === "string"');
    const redirectAt = page.indexOf("window.location.href = String(data.url)");
    expect(secretAt).toBeGreaterThan(-1);
    expect(redirectAt).toBeGreaterThan(secretAt);
  });
});
