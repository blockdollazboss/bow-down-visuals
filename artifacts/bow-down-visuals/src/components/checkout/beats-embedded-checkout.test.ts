/**
 * Beat license checkout stays ON the site (stack1600 w8; owner law
 * 2026-10-26: the buyer never leaves bowdownvisuals.com).
 *
 * Proven live Nov 5, 2026: buying a beat license on /beats took the
 * buyer to Stripe's hosted checkout page — reserveLicense never asked
 * the license rail for its embedded presentation (the rail has
 * honored uiMode "embedded" since the World money-parity lane) and
 * full-page-redirected to the hosted checkoutUrl. The shop, credit
 * pack, bookings and shoutout doors all pay on-site.
 *
 * The fix is FE-only and reuses the proven doors' exact pattern:
 * ask uiMode "embedded" gated on the publishable key, mount the
 * shared <EmbeddedSessionCheckout> on the clientSecret answer in
 * the license modal, and NEVER navigate to a hosted URL. Settlement
 * is untouched: completion returns to /beats?session_id=… and the
 * page's verify effect settles the license from the payment record
 * (POST /api/beats/licenses/verify → settleBeatLicenseSession).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("beats page — license checkout embedded on-site", () => {
  const src = read("../../pages/beats.tsx");

  it("uses the shared embedded checkout panel, gated on the publishable key", () => {
    expect(src).toContain(
      'import { EmbeddedSessionCheckout, hasStripePublishableKey } from "@/components/checkout/EmbeddedCheckout"',
    );
    expect(src).toContain('uiMode: hasStripePublishableKey() ? "embedded" : undefined');
  });

  it("mounts the payment form in the license modal on the clientSecret answer", () => {
    expect(src).toContain('data-testid="beats-embedded-checkout"');
    expect(src).toContain("<EmbeddedSessionCheckout clientSecret={licenseSecret} />");
    expect(src).toContain("if (data.clientSecret) {");
    expect(src).toContain("setLicenseSecret(data.clientSecret);");
  });

  it("never navigates the buyer to a hosted checkout URL", () => {
    expect(src).not.toContain("window.location.href = data.checkoutUrl");
    expect(src).not.toMatch(/window\.location\.href\s*=\s*data\./);
    /* The license POST's answer type no longer carries a hosted URL
       for this flow to chase. */
    const post = src.slice(src.indexOf("async function reserveLicense()"));
    expect(post).not.toContain("checkoutUrl");
  });

  it("a changed offer clears the minted form (the form is bound to one offer + price)", () => {
    expect(src).toContain('setLicenseTier(tier.key); setLicenseTemplateId(null); setLicenseSecret(null);');
    expect(src).toContain('setLicenseTemplateId(tpl.id); setLicenseSecret(null);');
  });

  it("settlement still runs from the payment record on return (verify effect untouched)", () => {
    expect(src).toContain('fetch("/api/beats/licenses/verify", {');
    expect(src).toContain('body: JSON.stringify({ sessionId: sid })');
  });
});
