/**
 * D4 follow-on — the remaining direct Checkout Session rails (creator
 * tiers, profile hosting, digital store, storefront, tip jar,
 * shoutouts, sponsors escrow, branding shop) carry deterministic
 * Stripe idempotency keys built from each rail's durable purchase
 * intent, the same treatment packs + the shared helper got first.
 *
 * The contract per rail: same member + same durable intent ⇒ the same
 * key at the Stripe boundary (a retry reuses the original session);
 * once completion advances the durable state (subscription recorded,
 * sale/order count up, a new pending row) ⇒ a fresh key.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildCheckoutSessionIdempotencyKey } from "../stripe-client";
import { buildCreatorTierCheckoutKey } from "../../routes/creator-tiers";
import { buildHostingCheckoutKey } from "../../routes/profile-hosting";
import { buildStoreCheckoutKey } from "../../routes/store";
import { buildStorefrontCheckoutKey } from "../../routes/storefront";
import { buildTipCheckoutKey } from "../../routes/generate/tip-jar";
import { buildShoutoutCheckoutKey } from "../../routes/generate/shoutouts";
import { buildSponsorEscrowCheckoutKey } from "../../routes/generate/sponsors";
import { buildBrandingOrderCheckoutKey } from "../../routes/generate/branding-shop";

const read = (rel: string) =>
  readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

describe("creator-tier checkout key", () => {
  const base = {
    userId: "user-1",
    tier: "pro",
    priceId: "price_pro",
    current: null,
  };

  it("is deterministic for the same pre-purchase state", () => {
    const a = buildCreatorTierCheckoutKey(base);
    expect(buildCreatorTierCheckoutKey({ ...base })).toBe(a);
    expect(a).toMatch(/^checkout:creator-tier:user-1:[0-9a-f]{32}$/);
    /* The rail scope is exactly the shared builder over its intent. */
    expect(a).toBe(
      buildCheckoutSessionIdempotencyKey({
        memberId: "user-1",
        rail: "creator-tier",
        purchaseIntent: { currentSubscription: null, priceId: "price_pro", tier: "pro" },
      }),
    );
  });

  it("changes once the subscription sync records the purchase", () => {
    const before = buildCreatorTierCheckoutKey(base);
    const recorded = buildCreatorTierCheckoutKey({
      ...base,
      current: {
        tier: "pro",
        status: "active",
        currentPeriodEnd: new Date("2026-11-21T00:00:00Z"),
        stripeSubscriptionId: "sub_123",
      },
    });
    expect(recorded).not.toBe(before);
    const renewed = buildCreatorTierCheckoutKey({
      ...base,
      current: {
        tier: "pro",
        status: "active",
        currentPeriodEnd: new Date("2026-12-21T00:00:00Z"),
        stripeSubscriptionId: "sub_123",
      },
    });
    expect(renewed).not.toBe(recorded);
  });
});

describe("creator-hosting checkout key", () => {
  const base = { userId: "user-1", priceId: "price_hosting", current: null };

  it("is deterministic for the same pre-purchase state", () => {
    const a = buildHostingCheckoutKey(base);
    expect(buildHostingCheckoutKey({ ...base })).toBe(a);
    expect(a).toMatch(/^checkout:creator-hosting:user-1:[0-9a-f]{32}$/);
  });

  it("changes once the hosting row records the subscription", () => {
    const before = buildHostingCheckoutKey(base);
    const after = buildHostingCheckoutKey({
      ...base,
      current: {
        status: "active",
        currentPeriodEnd: new Date("2026-11-21T00:00:00Z"),
        stripeSubscriptionId: "sub_host_1",
      },
    });
    expect(after).not.toBe(before);
  });
});

describe("digital-store checkout key", () => {
  const base = {
    userId: "buyer-1",
    kind: "track",
    itemId: "item-1",
    amountCents: 999,
    completedSaleCount: 0,
  };

  it("is deterministic while no sale has been recorded", () => {
    const a = buildStoreCheckoutKey(base);
    expect(buildStoreCheckoutKey({ ...base })).toBe(a);
    expect(a).toMatch(/^checkout:digital-store:buyer-1:[0-9a-f]{32}$/);
  });

  it("changes after the sale lands (count advances)", () => {
    expect(buildStoreCheckoutKey({ ...base, completedSaleCount: 1 })).not.toBe(
      buildStoreCheckoutKey(base),
    );
  });
});

describe("storefront checkout key", () => {
  const base = {
    userId: "buyer-1",
    productId: "prod-1",
    quantity: 2,
    unitCents: 2500,
    lineTotalCents: 5000,
    discountCode: null,
    completedOrderCount: 0,
  };

  it("is deterministic while no order has been recorded", () => {
    const a = buildStorefrontCheckoutKey(base);
    expect(buildStorefrontCheckoutKey({ ...base })).toBe(a);
    expect(a).toMatch(/^checkout:storefront:buyer-1:[0-9a-f]{32}$/);
  });

  it("changes after the order lands, and with the purchase shape", () => {
    const a = buildStorefrontCheckoutKey(base);
    expect(buildStorefrontCheckoutKey({ ...base, completedOrderCount: 1 })).not.toBe(a);
    expect(buildStorefrontCheckoutKey({ ...base, discountCode: "GOLD10" })).not.toBe(a);
    expect(buildStorefrontCheckoutKey({ ...base, quantity: 3, lineTotalCents: 7500 })).not.toBe(a);
  });
});

describe("tip-jar checkout key", () => {
  it("is scoped to the durable tip row", () => {
    const a = buildTipCheckoutKey({ pageOwnerId: "owner-1", tipId: "tip-1" });
    expect(buildTipCheckoutKey({ pageOwnerId: "owner-1", tipId: "tip-1" })).toBe(a);
    expect(a).toMatch(/^checkout:tip-jar:owner-1:[0-9a-f]{32}$/);
    /* A genuinely new tip is a new row — a fresh key. */
    expect(buildTipCheckoutKey({ pageOwnerId: "owner-1", tipId: "tip-2" })).not.toBe(a);
  });
});

describe("shoutout checkout key", () => {
  const base = { creatorUserId: "creator-1", requestId: "req-1", priceCents: 5000 };

  it("is scoped to the durable request row", () => {
    const a = buildShoutoutCheckoutKey(base);
    expect(buildShoutoutCheckoutKey({ ...base })).toBe(a);
    expect(a).toMatch(/^checkout:shoutout-request:creator-1:[0-9a-f]{32}$/);
    expect(buildShoutoutCheckoutKey({ ...base, requestId: "req-2" })).not.toBe(a);
  });
});

describe("sponsor-escrow checkout key", () => {
  const base = {
    brandUserId: "brand-1",
    dealId: "deal-1",
    acceptedApplicationId: "app-1",
    amountCents: 250000,
  };

  it("is scoped to the one funding act for the deal", () => {
    const a = buildSponsorEscrowCheckoutKey(base);
    expect(buildSponsorEscrowCheckoutKey({ ...base })).toBe(a);
    expect(a).toMatch(/^checkout:sponsor-escrow:brand-1:[0-9a-f]{32}$/);
    expect(buildSponsorEscrowCheckoutKey({ ...base, dealId: "deal-2" })).not.toBe(a);
    expect(buildSponsorEscrowCheckoutKey({ ...base, amountCents: 300000 })).not.toBe(a);
  });
});

describe("branding-order checkout key", () => {
  const base = { userId: "user-1", orderId: "order-1", totalCents: 12900 };

  it("is scoped to the durable order row", () => {
    const a = buildBrandingOrderCheckoutKey(base);
    expect(buildBrandingOrderCheckoutKey({ ...base })).toBe(a);
    expect(a).toMatch(/^checkout:branding-order:user-1:[0-9a-f]{32}$/);
    /* A new order is a new row — a fresh key. */
    expect(buildBrandingOrderCheckoutKey({ ...base, orderId: "order-2" })).not.toBe(a);
  });
});

describe("every remaining direct rail passes its key to Stripe", () => {
  const rails: Array<[string, string]> = [
    ["routes/creator-tiers.ts", "buildCreatorTierCheckoutKey"],
    ["routes/profile-hosting.ts", "buildHostingCheckoutKey"],
    ["routes/store.ts", "buildStoreCheckoutKey"],
    ["routes/storefront.ts", "buildStorefrontCheckoutKey"],
    ["routes/generate/tip-jar.ts", "buildTipCheckoutKey"],
    ["routes/generate/shoutouts.ts", "buildShoutoutCheckoutKey"],
    ["routes/generate/sponsors.ts", "buildSponsorEscrowCheckoutKey"],
    ["routes/generate/branding-shop.ts", "buildBrandingOrderCheckoutKey"],
  ];

  it("each route builds its key and sends it as the create options", () => {
    for (const [rel, builder] of rails) {
      const src = read(rel);
      expect(src, rel).toContain(builder);
      expect(src, rel).toContain("{ idempotencyKey }");
    }
  });
});