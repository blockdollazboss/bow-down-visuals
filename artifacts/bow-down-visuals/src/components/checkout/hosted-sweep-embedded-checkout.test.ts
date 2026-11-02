/**
 * Hosted-checkout sweep FE contract (stack1200; owner law
 * 2026-10-26: the buyer never leaves bowdownvisuals.com):
 * live-shopping, shoutouts, sponsor escrow funding, performance-
 * booking escrow funding and the World Crowns stand join are
 * EMBEDDED FIRST — each asks its checkout endpoint for
 * uiMode: "embedded" when a publishable key is present and mounts
 * the shared <EmbeddedSessionCheckout> on the clientSecret answer.
 * The hosted redirect/tab survives only as the no-secret fallback,
 * so in every source the clientSecret branch must come BEFORE the
 * hosted-URL navigation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("live-shopping page — embedded first", () => {
  const src = read("../../pages/live-shopping.tsx");
  it("asks for embedded gated on the publishable key and mounts in place", () => {
    expect(src).toContain('uiMode: hasStripePublishableKey() ? "embedded" : undefined');
    expect(src).toContain("<EmbeddedSessionCheckout clientSecret={buySecret} />");
    expect(src).toContain('data-testid="live-shopping-embedded-checkout"');
  });
  it("mounts on clientSecret before any hosted redirect", () => {
    expect(src.indexOf("data.clientSecret")).toBeLessThan(src.indexOf("window.location.href = data.url"));
  });
});

describe("shoutouts page — embedded first", () => {
  const src = read("../../pages/shoutouts.tsx");
  it("asks for embedded gated on the publishable key and mounts in place", () => {
    expect(src).toContain('body: JSON.stringify({ uiMode: hasStripePublishableKey() ? "embedded" : undefined })');
    expect(src).toContain("<EmbeddedSessionCheckout clientSecret={paySecret} />");
    expect(src).toContain('data-testid="shoutouts-embedded-checkout"');
  });
  it("mounts on clientSecret before any hosted redirect", () => {
    expect(src.indexOf("coJson?.clientSecret")).toBeLessThan(
      src.indexOf("window.location.href = coJson.checkoutUrl"),
    );
  });
});

describe("sponsor deal detail — escrow funding embedded first", () => {
  const src = read("../../pages/sponsor-deal-detail.tsx");
  it("asks for embedded gated on the publishable key and mounts in place", () => {
    expect(src).toContain('{ amountCents, uiMode: hasStripePublishableKey() ? "embedded" : undefined }');
    expect(src).toContain("<EmbeddedSessionCheckout clientSecret={fundSecret} />");
    expect(src).toContain('data-testid="sponsor-fund-embedded-checkout"');
  });
  it("mounts on clientSecret before any hosted redirect", () => {
    expect(src.indexOf("data.clientSecret")).toBeLessThan(
      src.indexOf("window.location.href = data.checkoutUrl"),
    );
  });
});

describe("performance bookings — escrow funding embedded first", () => {
  const lib = read("../../lib/performance-bookings.ts");
  const section = read("../../components/artist/BookArtistSection.tsx");
  it("the client lib carries the uiMode ask and the clientSecret answer", () => {
    expect(lib).toContain('uiMode?: "embedded" | "hosted"');
    expect(lib).toContain("clientSecret?: string");
    expect(lib).toContain("body: JSON.stringify(uiMode ? { uiMode } : {})");
  });
  it("the section asks gated on the key, mounts in the card, redirects only as fallback", () => {
    expect(section).toContain('hasStripePublishableKey() ? "embedded" : undefined');
    expect(section).toContain("<EmbeddedSessionCheckout clientSecret={fundSecrets[b.id]!} />");
    expect(section).toContain('data-testid="performance-booking-embedded-checkout"');
    expect(section.indexOf("r.clientSecret")).toBeLessThan(section.indexOf("r.checkoutUrl"));
  });
});

describe("World Crowns stand — join embedded first", () => {
  const src = read("../world/native/ShopStands.tsx");
  const crowns = src.slice(src.indexOf("function CrownsStand"));
  it("asks for embedded gated on the publishable key, on the shared payload", () => {
    expect(crowns).toContain("...membershipCheckoutPayload(tier.id, period, recipientId)");
    expect(crowns).toContain('uiMode: hasStripePublishableKey() ? "embedded" : undefined');
  });
  it("mounts the shared checkout in the stand on clientSecret", () => {
    expect(crowns).toContain("<EmbeddedSessionCheckout clientSecret={joinSecret} />");
    expect(crowns).toContain('data-testid="world-crowns-embedded-checkout"');
  });
  it("mounts on clientSecret before the §3.9 new-tab fallback", () => {
    expect(crowns.indexOf("clientSecret")).toBeLessThan(crowns.indexOf("openCheckoutTab(url)"));
  });
  it("stashes the pending session for embedded joins too (the stand verifies the landing)", () => {
    const embBranch = crowns.slice(crowns.indexOf("clientSecret"), crowns.indexOf("openCheckoutTab(url)"));
    expect(embBranch).toContain("membershipPendingKey()");
    expect(embBranch).toContain("setPendingCheckout(pending)");
  });
});
