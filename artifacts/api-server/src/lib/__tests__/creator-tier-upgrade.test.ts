/**
 * creator-tier-upgrade.test.ts — payfix upgrade-path rung 2.
 *
 * Pins the upgrade contract against a fake Stripe: a tier change is a
 * subscriptions.update on the SAME subscription id (never a create,
 * never a checkout), swapping the single item's price with
 * proration_behavior "always_invoice", carrying the tier metadata the
 * webhook sync reads. Terminal subscriptions and same-price changes
 * refuse instead of minting anything.
 */
import { describe, it, expect, vi } from "vitest";
import { changeCreatorTierSubscription } from "../creator-tier-upgrade";

function fakeStripe(sub: any) {
  return {
    subscriptions: {
      retrieve: vi.fn(async () => sub),
      update: vi.fn(async (id: string, params: any) => ({
        ...sub,
        id,
        status: "active",
        items: { data: [{ id: sub.items.data[0].id, price: { id: params.items[0].price }, current_period_end: 1_800_000_000 }] },
        metadata: params.metadata,
      })),
      create: vi.fn(async () => { throw new Error("create must never be called for a tier change"); }),
    },
  };
}

const baseSub = {
  id: "sub_1",
  customer: "cus_1",
  status: "active",
  metadata: { kind: "creator_tier", tier: "pro", user_id: "u1", profile_id: "p1" },
  items: { data: [{ id: "si_1", price: { id: "price_pro" }, current_period_end: 1_799_000_000 }] },
};

describe("changeCreatorTierSubscription", () => {
  it("updates the SAME subscription in place with proration — no create, same customer", async () => {
    const stripe = fakeStripe(structuredClone(baseSub));
    const result = await changeCreatorTierSubscription(stripe as any, {
      subscriptionId: "sub_1", priceId: "price_elite", tier: "elite", userId: "u1", profileId: "p1",
    });
    expect(stripe.subscriptions.create).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    const [id, params] = (stripe.subscriptions.update as any).mock.calls[0];
    expect(id).toBe("sub_1");
    expect(params.proration_behavior).toBe("always_invoice");
    expect(params.items).toEqual([{ id: "si_1", price: "price_elite" }]);
    expect(params.metadata).toMatchObject({ kind: "creator_tier", tier: "elite", user_id: "u1", profile_id: "p1" });
    expect(result.subscriptionId).toBe("sub_1");
    expect(result.customerId).toBe("cus_1");
    expect(result.currentPeriodEnd).toEqual(new Date(1_800_000_000 * 1000));
  });

  it("downgrade (elite → pro) is the same in-place update, not a new subscription", async () => {
    const elite = structuredClone(baseSub);
    elite.metadata.tier = "elite";
    elite.items.data[0].price.id = "price_elite";
    const stripe = fakeStripe(elite);
    const result = await changeCreatorTierSubscription(stripe as any, {
      subscriptionId: "sub_1", priceId: "price_pro", tier: "pro", userId: "u1", profileId: "p1",
    });
    expect(result.subscriptionId).toBe("sub_1");
    expect((stripe.subscriptions.update as any).mock.calls[0][1].items).toEqual([{ id: "si_1", price: "price_pro" }]);
  });

  it("refuses a canceled subscription instead of reviving/duplicating it", async () => {
    const dead = structuredClone(baseSub);
    dead.status = "canceled";
    const stripe = fakeStripe(dead);
    await expect(changeCreatorTierSubscription(stripe as any, {
      subscriptionId: "sub_1", priceId: "price_elite", tier: "elite", userId: "u1", profileId: "p1",
    })).rejects.toThrow(/cannot be changed/);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("refuses a same-price change (already on that tier's price)", async () => {
    const stripe = fakeStripe(structuredClone(baseSub));
    await expect(changeCreatorTierSubscription(stripe as any, {
      subscriptionId: "sub_1", priceId: "price_pro", tier: "pro", userId: "u1", profileId: "p1",
    })).rejects.toThrow(/already on that price/);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
});
