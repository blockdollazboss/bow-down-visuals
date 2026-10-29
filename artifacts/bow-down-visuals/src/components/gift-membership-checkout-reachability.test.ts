/**
 * gift-membership-checkout-reachability.test.ts — stack600
 * checkout-mounts audit, mount 3 of 4.
 *
 * Gate Pass 2 (Oct 28, live) proved the drawer trap in shop.tsx:
 * the embedded Stripe checkout sat in a NON-scrollable region of a
 * height-capped fixed drawer, so at short viewports the Pay button
 * was unreachable (fixed in stack600/checkout-drawer-scroll by
 * making the drawer ONE scroll region). This lane audited every
 * remaining EmbeddedSessionCheckout mount for the same trap.
 *
 * VERDICT for GiftMembership (on /creator-pricing) — SAFE, by
 * structure. The component is a plain <section> rendered in the
 * pricing page's document flow — not a dialog, sheet, portal or
 * drawer — and it carries NO height, overflow or positioning
 * classes of its own (the audited counts are all zero, pinned
 * below). The host page is a `min-h-screen` page with no capped
 * container either, so the document itself is the scroll region:
 * the Stripe iframe (full content height, ~700–950 px) lengthens
 * the page and Pay is reachable at document-scroll bottom at any
 * viewport height. These pins freeze the audited shape — if the
 * component is ever moved into a modal/sheet, or gains a capped
 * wrapper, the mount must be re-audited against the drawer
 * contract (one scroll region containing the checkout).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const giftSrc = readFileSync(join(__dirname, "GiftMembership.tsx"), "utf8");
const pricingSrc = readFileSync(join(__dirname, "../pages/creator-pricing.tsx"), "utf8");

describe("GiftMembership — checkout reachability (stack600 audit)", () => {
  it("is a plain in-flow section, not a dialog, sheet or portal", () => {
    expect(giftSrc).toContain('<section id="gift-membership"');
    expect(giftSrc).not.toContain("Dialog");
    expect(giftSrc).not.toContain("Sheet");
    expect(giftSrc).not.toContain("Portal");
  });

  it("mounts the shared embedded checkout in a plain flow wrapper", () => {
    const mount = giftSrc.indexOf("<EmbeddedSessionCheckout clientSecret={clientSecret} />");
    expect(mount).toBeGreaterThan(-1);
    const before = giftSrc.slice(Math.max(0, mount - 400), mount);
    expect(before).toContain('<div className="mt-5">');
  });

  it("the component carries no height cap, overflow trap or fixed positioning (audited zeros)", () => {
    expect(giftSrc).not.toContain("overflow");
    expect(giftSrc).not.toContain("max-h");
    expect(giftSrc).not.toContain("fixed");
    expect(giftSrc).not.toContain("h-screen");
    expect(giftSrc).not.toContain("h-dvh");
    expect(giftSrc).not.toContain("h-svh");
  });

  it("the host page renders it in uncapped document flow", () => {
    expect(pricingSrc).toContain("<GiftMembership isLight={isLight} />");
    expect(pricingSrc).toContain('<div className="min-h-screen bg-black text-white">');
    /* The whole pricing page carries no overflow or height-cap
       classes at all today — pin the zero so a future panel cannot
       quietly become the checkout's trap. */
    expect(pricingSrc).not.toContain("overflow");
    expect(pricingSrc).not.toContain("max-h-");
  });
});
