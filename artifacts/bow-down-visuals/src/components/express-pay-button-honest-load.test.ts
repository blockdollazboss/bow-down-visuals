/**
 * ExpressPayButton (Apple Pay / Google Pay credit packs) —
 * honest money states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * A money surface held to the strictest truth discipline in
 * the tranche:
 * - THE AVAILABILITY PROBE is an entry point that exists
 *   only when proven: the intent must be ok AND carry
 *   success AND a clientSecret, and the wallet must answer
 *   canMakePayment, before the button appears at all. Any
 *   failure hides express pay silently — the regular
 *   checkout remains, and nothing claims a wallet option
 *   that doesn't exist.
 * - THE PAYMENT claims success only after BOTH proofs: the
 *   wallet confirm must report status "succeeded", and then
 *   the server verify leg must answer ok + success before
 *   onSuccess fires.
 * - THE IN-BETWEEN TRUTH is stated exactly: if the wallet
 *   charged but the verify leg can't confirm, the message
 *   says the payment went through and the Bucs are still
 *   being confirmed — never "credited" (unproven) and never
 *   "payment failed" (false).
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ExpressPayButton.tsx");

describe("the button exists only from a proven intent + a proven wallet", () => {
  it("the intent gate requires ok, success, and a clientSecret together", () => {
    expect(src).toContain("if (!res.ok || !data.success || !data.clientSecret) {");
    expect(src).toContain("const result = await pr.canMakePayment();");
    expect(src).toContain("setCanPay(true);");
    expect(src).toContain("// Network or Stripe.js failure — silently hide express pay");
  });
});

describe("success is claimed only after the wallet AND the server both prove it", () => {
  it("a non-succeeded wallet status fails honestly before any credit claim", () => {
    expect(src).toContain('if (paymentIntent?.status !== "succeeded") {');
    expect(src).toContain('fail("Payment was not completed.");');
  });

  it("the verify leg gates onSuccess — and its failure tells the in-between truth", () => {
    expect(src).toContain("if (!vRes.ok || !vData.success) {");
    expect(src).toContain("Your payment went through — we're still confirming your Visual Bucs.");
    expect(src).toContain("onSuccess(vData);");
  });
});
