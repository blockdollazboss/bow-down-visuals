import { describe, it, expect } from "vitest";
import {
  STUDIO_GEAR_PRODUCTS,
  STUDIO_GEAR_FULFILLMENT,
  STUDIO_GEAR_TEST_MODE,
  STUDIO_SET_ALACARTE_CENTS,
  STUDIO_SET_SAVING_CENTS,
  gearProductById,
  gearPriceCents,
  gearProofRequired,
  gearCartTotalCents,
  gearOrderStatusFor,
  validateGearSelection,
  initialGearOrderState,
  canTransitionProof,
  formatGearMoney,
} from "./studio-gear";

/* Ruled prices (owner delegation, Oct 25 2026) — pinned literally so a
   drift on either the FE or BE mirror fails a suite. Invent nothing. */
describe("studio gear catalog — the five ruled listings", () => {
  it("has exactly the five listings", () => {
    expect(STUDIO_GEAR_PRODUCTS.map((p) => p.id).sort()).toEqual(
      ["light-bar", "light-panel", "mic-wrap", "neon-sign", "studio-set"].sort(),
    );
  });

  it("mic wrap: house $49 / creator-custom $79", () => {
    expect(gearPriceCents("mic-wrap", "house", "standard")).toBe(4900);
    expect(gearPriceCents("mic-wrap", "custom", "standard")).toBe(7900);
  });

  it("neon sign: 24/32/42 at $249/$349/$499, house = custom price", () => {
    for (const variant of ["house", "custom"] as const) {
      expect(gearPriceCents("neon-sign", variant, "24")).toBe(24900);
      expect(gearPriceCents("neon-sign", variant, "32")).toBe(34900);
      expect(gearPriceCents("neon-sign", variant, "42")).toBe(49900);
    }
  });

  it("light panel: $119 single / $199 pair; light bar $79", () => {
    expect(gearPriceCents("light-panel", "house", "single")).toBe(11900);
    expect(gearPriceCents("light-panel", "house", "pair")).toBe(19900);
    expect(gearPriceCents("light-panel", "custom", "pair")).toBe(19900);
    expect(gearPriceCents("light-bar", "house", "standard")).toBe(7900);
    expect(gearPriceCents("light-bar", "custom", "standard")).toBe(7900);
  });

  it("Studio Set: $549 bundle of the 32\" sign + panel pair + light bar", () => {
    expect(gearPriceCents("studio-set", "house", "set")).toBe(54900);
    expect(gearPriceCents("studio-set", "custom", "set")).toBe(54900);
    expect(gearProductById("studio-set").includes).toEqual([
      '32" LED neon-flex sign',
      "LED light panel — pair",
      "LED light bar",
    ]);
    /* À la carte from the ruled prices: 349 + 199 + 79 = 627 → saves $78. */
    expect(STUDIO_SET_ALACARTE_CENTS).toBe(62700);
    expect(STUDIO_SET_SAVING_CENTS).toBe(7800);
  });

  it("honest timelines ride every listing (wrap 7–12, signs 10–15, lights 7–10)", () => {
    expect([gearProductById("mic-wrap").timelineMinDays, gearProductById("mic-wrap").timelineMaxDays]).toEqual([7, 12]);
    expect([gearProductById("neon-sign").timelineMinDays, gearProductById("neon-sign").timelineMaxDays]).toEqual([10, 15]);
    expect([gearProductById("light-panel").timelineMinDays, gearProductById("light-panel").timelineMaxDays]).toEqual([7, 10]);
    expect([gearProductById("light-bar").timelineMinDays, gearProductById("light-bar").timelineMaxDays]).toEqual([7, 10]);
    for (const p of STUDIO_GEAR_PRODUCTS) expect(p.timelineLabel).toContain("made to order");
  });

  it("lights carry the electronics warranty flag; the wrap does not", () => {
    expect(gearProductById("neon-sign").electronicsWarranty).toBe(true);
    expect(gearProductById("light-panel").electronicsWarranty).toBe(true);
    expect(gearProductById("light-bar").electronicsWarranty).toBe(true);
    expect(gearProductById("mic-wrap").electronicsWarranty).toBe(false);
  });

  it("fulfillment copy states the ruled model: no inventory, proof first, replacement + 12-month warranty, test mode", () => {
    expect(STUDIO_GEAR_FULFILLMENT.model).toContain("no inventory");
    expect(STUDIO_GEAR_FULFILLMENT.proofRule).toContain("approve the proof");
    expect(STUDIO_GEAR_FULFILLMENT.returnsRule).toContain("replaces it");
    expect(STUDIO_GEAR_FULFILLMENT.returnsRule).toContain("12-month electronics warranty");
    expect(STUDIO_GEAR_TEST_MODE).toBe(true);
  });
});

describe("proof gate", () => {
  it("every creator-custom piece requires a proof; house pieces never do", () => {
    expect(gearProofRequired("custom")).toBe(true);
    expect(gearProofRequired("house")).toBe(false);
  });

  it("a mixed cart starts at the proof gate; an all-house cart does not", () => {
    expect(
      initialGearOrderState([
        { product: "light-bar", variant: "house", option: "standard", qty: 1 },
        { product: "mic-wrap", variant: "custom", option: "standard", qty: 1 },
      ]),
    ).toEqual({ status: "proof_pending", proofStatus: "pending" });
    expect(
      initialGearOrderState([
        { product: "light-bar", variant: "house", option: "standard", qty: 1 },
      ]),
    ).toEqual({ status: "received", proofStatus: "not_required" });
  });

  it("proof transitions: pending→sent→approved/revision, revision→sent, never backwards", () => {
    expect(canTransitionProof("pending", "sent")).toBe(true);
    expect(canTransitionProof("sent", "approved")).toBe(true);
    expect(canTransitionProof("sent", "revision_requested")).toBe(true);
    expect(canTransitionProof("revision_requested", "sent")).toBe(true);
    expect(canTransitionProof("pending", "approved")).toBe(false);
    expect(canTransitionProof("approved", "sent")).toBe(false);
    expect(canTransitionProof("not_required", "sent")).toBe(false);
  });

  it("production needs paid AND proof settled — paying never skips a proof", () => {
    expect(gearOrderStatusFor(true, "pending")).toBe("proof_pending");
    expect(gearOrderStatusFor(true, "sent")).toBe("proof_sent");
    expect(gearOrderStatusFor(true, "approved")).toBe("in_production");
    expect(gearOrderStatusFor(true, "not_required")).toBe("in_production");
    expect(gearOrderStatusFor(false, "approved")).toBe("received");
    expect(gearOrderStatusFor(false, "not_required")).toBe("received");
  });
});

describe("selection validation + totals", () => {
  it("rejects unknown products, options, variants, and bad quantities", () => {
    expect(validateGearSelection({ product: "yacht" as never, variant: "house", option: "standard", qty: 1 })).toBeTruthy();
    expect(validateGearSelection({ product: "mic-wrap", variant: "house", option: "huge", qty: 1 })).toBeTruthy();
    expect(validateGearSelection({ product: "mic-wrap", variant: "house", option: "standard", qty: 0 })).toBeTruthy();
    expect(validateGearSelection({ product: "mic-wrap", variant: "custom", option: "standard", qty: 2 })).toBeNull();
  });

  it("cart total sums ruled prices × qty", () => {
    expect(
      gearCartTotalCents([
        { product: "mic-wrap", variant: "custom", option: "standard", qty: 1 },
        { product: "light-panel", variant: "house", option: "pair", qty: 2 },
      ]),
    ).toBe(7900 + 19900 * 2);
    expect(gearCartTotalCents([])).toBe(0);
  });

  it("formats money like the shop", () => {
    expect(formatGearMoney(54900)).toBe("$549.00");
    expect(formatGearMoney(4900)).toBe("$49.00");
  });
});
