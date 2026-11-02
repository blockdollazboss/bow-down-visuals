/**
 * tip-page-embedded-checkout.test.ts — TIP-TRUTH (stack1200),
 * defect 3.
 *
 * Gate #5 staging evidence (Nov 1, stack1100 build): tipping TRGDY
 * left bowdownvisuals.com for a Stripe-HOSTED checkout page. The
 * standing law (owner, Oct 26): customer-facing checkout happens ON
 * the site — embedded — never a hosted redirect. The tip API has
 * supported embedded checkout (uiMode → ui_mode "embedded_page",
 * pinned by the API suite tip-jar-checkout-embedded.test.ts); the
 * public tip page simply never asked for it and always redirected
 * to the hosted URL.
 *
 * This suite pins the page the way gift-cards-embedded-checkout
 * pins the gift-card page: the page offers the embedded rail
 * (key-gated, uiMode "embedded"), a returned client secret mounts
 * the on-site EmbeddedSessionCheckout INSTEAD of any redirect, the
 * hosted URL survives only as the fallback when no secret came
 * back, and the verify-on-return settle stays intact (embedded
 * completion returns to /tips/:handle?session_id=…, which the API
 * settles against its durable tip row).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "tip-page.tsx"), "utf8");

const sendStart = src.indexOf("async function sendTip()");
const renderStart = src.indexOf("return (", sendStart);
const sendRegion = src.slice(sendStart, renderStart);
const pageRegion = src.slice(sendStart);

describe("public tip page — embedded checkout (TIP-TRUTH)", () => {
  it("uses the shared embedded checkout component and its key gate", () => {
    expect(src).toContain('from "@/components/checkout/EmbeddedCheckout"');
    expect(src).toContain("EmbeddedSessionCheckout");
    expect(src).toContain("hasStripePublishableKey");
  });

  it("asks the API for the embedded session when the key is configured", () => {
    expect(sendRegion).toContain('hasStripePublishableKey() ? "embedded" : undefined');
  });

  it("mounts the embedded checkout on a returned client secret — before any hosted redirect", () => {
    const secretBranch = sendRegion.indexOf("coJson.clientSecret");
    const redirectBranch = sendRegion.indexOf("window.location.href = coJson.checkoutUrl");
    expect(secretBranch).toBeGreaterThan(-1);
    expect(redirectBranch).toBeGreaterThan(-1);
    expect(secretBranch).toBeLessThan(redirectBranch);
    expect(sendRegion).toContain("setEmbeddedSecret(coJson.clientSecret as string)");
  });

  it("renders the inline checkout surface with a close control", () => {
    expect(pageRegion).toContain('data-testid="tip-embedded-checkout"');
    expect(pageRegion).toContain("clientSecret={embeddedSecret}");
    expect(pageRegion).toContain("setEmbeddedSecret(null)");
  });

  it("the hosted redirect survives only as the no-secret fallback", () => {
    expect(sendRegion).toContain("coJson.checkoutUrl");
    expect(sendRegion).toContain("window.location.href = coJson.checkoutUrl");
  });

  it("verify-on-return settle stays intact for the embedded return", () => {
    expect(src).toContain('.get("session_id")');
    expect(src).toContain('fetch("/api/tips/checkout/verify"');
  });
});
