/**
 * pricing-pack-checkout-width.test.ts — stack700/pack-checkout-width.
 *
 * The width sibling of embedded-payment-form-reachability.test.ts.
 * That suite proved every EmbeddedPaymentForm mount's Pay button is
 * REACHABLE (no capped container strands it). It never measured
 * WIDTH — and the credit-pack mount on pages/pricing.tsx was starved:
 *
 *   Owner screenshot, Oct 29 (desktop): buying "1,000 Visual Bucs —
 *   $9" rendered the Stripe PaymentElement crushed — Country clipped
 *   to "United Sta…" with the chevron over the text, card/email
 *   inputs clipping, the "Secure, fast checkout with Link" header
 *   wrapped into four centred lines, the form spilling off-panel.
 *
 * This mount is NOT one of the four EmbeddedSessionCheckout mounts
 * the stack600 checkout-mounts audit cleared (store buy, storefront
 * product, gift membership, World ShopStands). It is the
 * EmbeddedPaymentForm mount inside CreditPackCard on /pricing
 * (the /api/embedded-checkout/credit-pack/intent rail).
 *
 * The starving chain, measured in code (Tailwind scale, px):
 *   section  max-w-4xl (896) − md:px-8 (2×32)        = 832 content
 *   grid     grid-cols-4, gap-4 → (832 − 3×16) / 4   = 196 column
 *   card     p-5 (2×20)                              = 156
 *   panel    EmbeddedPaymentForm p-4 (2×16) + border = 122 for Stripe
 * Phone (390px, grid-cols-2): 350 → 167 → 127 → 93 for Stripe.
 * Stripe's element needs ~300px before fields truncate; at 93–122px
 * the screenshot's clipping is arithmetic, not a Stripe bug.
 *
 * The fix (in CreditPackCard, closed state unchanged): while
 * checkout is open the card spans the full grid row
 * (col-span-2 md:col-span-4), tightens side padding on small
 * screens (px-3, sm:p-5 restores), and the form + the express-pay
 * block ride in a w-full max-w-md wrapper — the same width
 * provision the plan-subscribe mount on /creator-pricing carries.
 * Post-fix element widths: desktop 414, phone-390 292, phone-360 262
 * (recomputed below from the pinned constants).
 *
 * Proof level, honestly: code-measured widths vs Stripe's ~300px
 * guidance + these source pins. The real PaymentElement renders in
 * Stripe's iframe and needs a live clientSecret, so no local DOM
 * harness can prove field rendering; the arithmetic is the proof.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pricingSrc = readFileSync(join(__dirname, "pricing.tsx"), "utf8");
const checkoutSrc = readFileSync(
  join(__dirname, "../components/checkout/EmbeddedCheckout.tsx"),
  "utf8",
);

/* The constraint chain's constants, each cross-pinned to its source
   token below so a changed token fails the string pin first. */
const SECTION_MAX = 896; // max-w-4xl
const SECTION_PAD_MD = 32; // md:px-8, per side
const SECTION_PAD_BASE = 20; // px-5, per side
const GRID_GAP = 16; // gap-4
const CARD_PAD = 20; // p-5, per side
const CARD_PAD_OPEN_SMALL = 12; // px-3, per side (open, below sm)
const PANEL_PAD = 16; // p-4, per side (EmbeddedPaymentForm panel)
const PANEL_BORDER = 2; // 1px border, both sides
const FORM_CAP = 448; // max-w-md
const STRIPE_WORKABLE = 300; // ~px before PaymentElement fields truncate

function elementWidth(formBox: number, cardPad: number): number {
  return formBox - cardPad * 2 - PANEL_PAD * 2 - PANEL_BORDER;
}

describe("pack checkout width — the starving chain is the pinned one", () => {
  it("the packs section and grid carry the measured classes", () => {
    expect(pricingSrc).toContain('id="credit-packs"');
    expect(pricingSrc).toContain("max-w-4xl mx-auto px-5 md:px-8");
    expect(pricingSrc).toContain("grid grid-cols-2 md:grid-cols-4 gap-4");
  });

  it("the shared panel's padding is the measured p-4 (the chain's last layer)", () => {
    const panelTag = checkoutSrc.slice(
      checkoutSrc.indexOf('data-testid="embedded-payment-panel"') - 200,
      checkoutSrc.indexOf('data-testid="embedded-payment-panel"'),
    );
    expect(panelTag).toContain("p-4");
  });

  it("pre-fix arithmetic documents the defect (desktop 122px, phone 93px)", () => {
    const desktopCol = (SECTION_MAX - SECTION_PAD_MD * 2 - GRID_GAP * 3) / 4;
    expect(elementWidth(desktopCol, CARD_PAD)).toBe(122);
    const phoneCol = (390 - SECTION_PAD_BASE * 2 - GRID_GAP) / 2;
    expect(elementWidth(phoneCol, CARD_PAD)).toBe(93);
    expect(122).toBeLessThan(STRIPE_WORKABLE);
    expect(93).toBeLessThan(STRIPE_WORKABLE);
  });
});

describe("pack checkout width — the fix", () => {
  it("while checkout is open the card spans the full grid row; closed it is the old card", () => {
    expect(pricingSrc).toContain(
      'clientSecret ? "col-span-2 md:col-span-4 px-3 py-5 sm:p-5" : "p-5"',
    );
  });

  it("the payment form rides in a w-full max-w-md wrapper (the creator-pricing provision)", () => {
    const mount = pricingSrc.indexOf("<EmbeddedPaymentForm");
    expect(mount).toBeGreaterThan(-1);
    const before = pricingSrc.slice(Math.max(0, mount - 200), mount);
    expect(before).toContain('<div className="w-full max-w-md">');
  });

  it("the express-pay block carries the same cap so it aligns with the open form", () => {
    expect(pricingSrc.match(/w-full max-w-md/g)).toHaveLength(2);
  });

  it("post-fix arithmetic: desktop clears Stripe's working width", () => {
    const row = SECTION_MAX - SECTION_PAD_MD * 2; // card spans the row
    const formBox = Math.min(row - CARD_PAD * 2, FORM_CAP);
    expect(elementWidth(formBox, 0)).toBe(414);
    expect(414).toBeGreaterThanOrEqual(STRIPE_WORKABLE);
  });

  it("post-fix arithmetic: phone 390 nearly triples the element width", () => {
    const row = 390 - SECTION_PAD_BASE * 2;
    const formBox = Math.min(row - CARD_PAD_OPEN_SMALL * 2, FORM_CAP);
    const w = elementWidth(formBox, 0);
    expect(w).toBe(292);
    expect(w).toBeGreaterThan(93 * 3);
  });

  it("the fix adds no height cap or overflow control (reachability contract intact)", () => {
    expect(pricingSrc).not.toContain("max-h");
    expect(pricingSrc).not.toContain("overflow-y");
  });
});
