/**
 * studio-gear.test.ts — the server mirror of the ruled studio-gear
 * catalog (owner delegation, Oct 25 2026) + the proof-gated order rail.
 *
 * Pins: every ruled price literally (FE mirror pins the same literals —
 * drift on either side fails a suite), the Studio Set bundle math, the
 * honest timelines, the proof state machine (production requires paid +
 * approved/not-required proof), and the TEST-MODE contract: the route
 * file contains no Stripe path at all, so no real charge can be taken.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  STUDIO_GEAR_PRODUCTS,
  STUDIO_GEAR_TEST_MODE,
  STUDIO_SET_ALACARTE_CENTS,
  STUDIO_SET_SAVING_CENTS,
  gearPriceCents,
  gearProofRequired,
  gearCartTotalCents,
  gearOrderStatusFor,
  validateGearSelection,
  initialGearOrderState,
  canTransitionProof,
  productionAllowed,
} from "../studio-gear";

describe("ruled catalog prices (server mirror)", () => {
  it("mic wrap house $49 / custom $79", () => {
    expect(gearPriceCents("mic-wrap", "house", "standard")).toBe(4900);
    expect(gearPriceCents("mic-wrap", "custom", "standard")).toBe(7900);
  });

  it("neon sign 24/32/42 at $249/$349/$499 for both variants", () => {
    for (const variant of ["house", "custom"] as const) {
      expect(gearPriceCents("neon-sign", variant, "24")).toBe(24900);
      expect(gearPriceCents("neon-sign", variant, "32")).toBe(34900);
      expect(gearPriceCents("neon-sign", variant, "42")).toBe(49900);
    }
  });

  it("panel $119/$199, bar $79, Studio Set $549", () => {
    expect(gearPriceCents("light-panel", "house", "single")).toBe(11900);
    expect(gearPriceCents("light-panel", "house", "pair")).toBe(19900);
    expect(gearPriceCents("light-bar", "house", "standard")).toBe(7900);
    expect(gearPriceCents("studio-set", "house", "set")).toBe(54900);
    expect(STUDIO_SET_ALACARTE_CENTS).toBe(62700);
    expect(STUDIO_SET_SAVING_CENTS).toBe(7800);
  });

  it("exactly five listings, honest timelines, warranty flags on lights only", () => {
    expect(STUDIO_GEAR_PRODUCTS).toHaveLength(5);
    const byId = Object.fromEntries(STUDIO_GEAR_PRODUCTS.map((p) => [p.id, p]));
    expect([byId["mic-wrap"]!.timelineMinDays, byId["mic-wrap"]!.timelineMaxDays]).toEqual([7, 12]);
    expect([byId["neon-sign"]!.timelineMinDays, byId["neon-sign"]!.timelineMaxDays]).toEqual([10, 15]);
    expect([byId["light-panel"]!.timelineMinDays, byId["light-panel"]!.timelineMaxDays]).toEqual([7, 10]);
    expect([byId["light-bar"]!.timelineMinDays, byId["light-bar"]!.timelineMaxDays]).toEqual([7, 10]);
    expect(byId["mic-wrap"]!.electronicsWarranty).toBe(false);
    expect(byId["light-panel"]!.electronicsWarranty).toBe(true);
  });
});

describe("proof gate + production rule", () => {
  it("custom always needs a proof; house never does", () => {
    expect(gearProofRequired("custom")).toBe(true);
    expect(gearProofRequired("house")).toBe(false);
    expect(productionAllowed("pending")).toBe(false);
    expect(productionAllowed("sent")).toBe(false);
    expect(productionAllowed("revision_requested")).toBe(false);
    expect(productionAllowed("approved")).toBe(true);
    expect(productionAllowed("not_required")).toBe(true);
  });

  it("fresh orders start at the gate when any item is custom", () => {
    expect(
      initialGearOrderState([{ product: "neon-sign", variant: "custom", option: "32", qty: 1 }]),
    ).toEqual({ status: "proof_pending", proofStatus: "pending" });
    expect(
      initialGearOrderState([{ product: "neon-sign", variant: "house", option: "32", qty: 1 }]),
    ).toEqual({ status: "received", proofStatus: "not_required" });
  });

  it("a paid custom order stays at the gate until the proof is approved", () => {
    expect(gearOrderStatusFor(true, "pending")).toBe("proof_pending");
    expect(gearOrderStatusFor(true, "sent")).toBe("proof_sent");
    expect(gearOrderStatusFor(true, "revision_requested")).toBe("proof_pending");
    expect(gearOrderStatusFor(true, "approved")).toBe("in_production");
    expect(gearOrderStatusFor(false, "approved")).toBe("received");
  });

  it("proof transitions never skip the sent state", () => {
    expect(canTransitionProof("pending", "approved")).toBe(false);
    expect(canTransitionProof("pending", "sent")).toBe(true);
    expect(canTransitionProof("sent", "approved")).toBe(true);
    expect(canTransitionProof("sent", "revision_requested")).toBe(true);
    expect(canTransitionProof("revision_requested", "sent")).toBe(true);
    expect(canTransitionProof("not_required", "approved")).toBe(false);
  });
});

describe("validation + totals", () => {
  it("server recomputation inputs validate strictly", () => {
    expect(validateGearSelection({ product: "mic-wrap", variant: "house", option: "standard", qty: 1 })).toBeNull();
    expect(validateGearSelection({ product: "mic-wrap", variant: "house", option: "42", qty: 1 })).toBeTruthy();
    expect(validateGearSelection({ product: "studio-set", variant: "custom", option: "set", qty: 100 })).toBeTruthy();
  });

  it("totals come from the ruled catalog only", () => {
    expect(
      gearCartTotalCents([
        { product: "studio-set", variant: "custom", option: "set", qty: 1 },
        { product: "mic-wrap", variant: "house", option: "standard", qty: 2 },
      ]),
    ).toBe(54900 + 4900 * 2);
  });
});

describe("route contract (source pins)", () => {
  const route = readFileSync(new URL("../../routes/studio-gear.ts", import.meta.url), "utf8");

  it("is TEST MODE with no real-charge path anywhere in the file", () => {
    expect(STUDIO_GEAR_TEST_MODE).toBe(true);
    /* No Stripe SDK, no guarded client, no checkout-session creation —
       the only "stripe" token allowed is the shared orders column name,
       stamped with a test_ session id. */
    expect(route).not.toContain("createGuardedStripeClient");
    expect(route).not.toContain("checkout.sessions");
    expect(route).not.toMatch(/from\s+["']stripe["']/);
    expect(route).toContain("`test_${randomUUID()}`");
    expect(route).toContain("no real charge");
  });

  it("exposes the full rail: catalog, orders, checkout, buyer proof actions", () => {
    expect(route).toContain('"/studio-gear/catalog"');
    expect(route).toContain('"/studio-gear/orders"');
    expect(route).toContain('"/studio-gear/checkout"');
    expect(route).toContain('"/studio-gear/orders/:id/proof/approve"');
    expect(route).toContain('"/studio-gear/orders/:id/proof/request-revision"');
  });

  it("the partner proof send is admin-gated, and custom orders require a spec", () => {
    expect(route).toContain('"/admin/studio-gear/orders/:id/proof/send"');
    expect(route).toContain("requireAdmin");
    expect(route).toContain("design proof is built from it");
  });

  it("checkout verifies the stored total against the catalog before marking paid", () => {
    expect(route).toContain("Order total mismatch");
    expect(route).toContain("gearOrderStatusFor(true, order.proof_status)");
  });
});
