/**
 * preorder-charge-timing.test.ts — pre-order charge timing
 * (owner ruling, Oct 27, 2026, by delegation):
 *   "Digital charges at order; made-to-order gear charges at
 *    DESIGN-PROOF APPROVAL."
 *
 * DIGITAL HALF — already exactly so in this tree, pinned here:
 * every digital rail (the store rail in routes/store.ts and the
 * customer-shops rail in routes/generate/shops.ts) creates its
 * Stripe checkout session synchronously inside the purchase call
 * with mode "payment" — the buyer is charged at order, delivery
 * follows payment — and neither rail carries any deferred-capture
 * mechanism (no manual capture, no setup-for-later intent). These
 * source pins fail if a future change ever defers a digital charge
 * behind fulfillment.
 *
 * MADE-TO-ORDER HALF — the honest state of THIS base:
 * the made-to-order gear line the ruling names (studio gear: mic
 * wraps, neon signs, light panels — design proof approved before
 * production) does not exist in this tree; it lives in the
 * join-next lineage (lane stack200/rem-studio-gear, merged in
 * Join #1), where checkout can currently mark an order paid BEFORE
 * proof approval (the proof gates production, not payment). The
 * ruling's gear half is therefore a JOIN-LINEAGE fix — for custom
 * pieces, checkout must refuse until the design proof is approved —
 * recorded here and in the rulings-wave report as a named leftover;
 * porting the gear lane into this base would collide with Join #2.
 *
 * The one made-to-order line this base DOES carry is custom jewelry
 * (routes/jewelry.ts), and it is reservation-only: its order handler
 * takes no payment at all — no Stripe, no checkout session, no
 * credit charge — and its copy states payment is collected when
 * production is confirmed. The last pin holds that line honest: it
 * must never silently start charging at reservation time.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readRoute(rel: string): string {
  const url = new URL(`../${rel}`, import.meta.url);
  return readFileSync(url, "utf8");
}

describe("pre-order charge timing — digital charges at order", () => {
  it("store rail: checkout session is created in the purchase call, mode payment", () => {
    const src = readRoute("store.ts");
    expect(src).toContain("checkout.sessions.create");
    expect(src).toContain('mode: "payment"');
  });

  it("shops rail: both checkout sessions are mode payment, at order", () => {
    const src = readRoute("generate/shops.ts");
    const creates = src.match(/checkout\.sessions\.create/g) ?? [];
    const payments = src.match(/mode: "payment"/g) ?? [];
    expect(creates.length).toBe(2);
    expect(payments.length).toBeGreaterThanOrEqual(2);
  });

  it("neither digital rail defers capture behind fulfillment", () => {
    for (const rel of ["store.ts", "generate/shops.ts"]) {
      const src = readRoute(rel);
      expect(src, rel).not.toContain("capture_method");
      expect(src, rel).not.toContain("setup_future_usage");
      expect(src, rel).not.toContain("payment_intent_data");
    }
  });
});

describe("pre-order charge timing — made-to-order in this base", () => {
  it("custom jewelry is reservation-only: its order rail takes no payment", () => {
    const src = readRoute("jewelry.ts");
    expect(src).not.toContain("checkout.sessions.create");
    expect(src).not.toContain("chargeCredits");
    expect(src).not.toContain("paymentIntents.create");
  });
});
