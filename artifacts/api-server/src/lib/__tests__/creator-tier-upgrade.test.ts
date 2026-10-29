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
import { changeCreatorTierSubscription, previewCreatorTierChange } from "../creator-tier-upgrade";

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

  it("passes prorationDate, idempotencyKey and clearPendingCancel through to the update (stack600)", async () => {
    const stripe = fakeStripe(structuredClone(baseSub));
    await changeCreatorTierSubscription(stripe as any, {
      subscriptionId: "sub_1", priceId: "price_elite", tier: "elite", userId: "u1", profileId: "p1",
      prorationDate: 1_798_000_000, idempotencyKey: "idem-key-1", clearPendingCancel: true,
    });
    const [, params, options] = (stripe.subscriptions.update as any).mock.calls[0];
    expect(params.proration_date).toBe(1_798_000_000);
    expect(params.cancel_at_period_end).toBe(false);
    expect(options).toEqual({ idempotencyKey: "idem-key-1" });
  });

  it("without the stack600 options the update carries no proration_date, no cancel clear, no key (hosted rail unchanged)", async () => {
    const stripe = fakeStripe(structuredClone(baseSub));
    await changeCreatorTierSubscription(stripe as any, {
      subscriptionId: "sub_1", priceId: "price_elite", tier: "elite", userId: "u1", profileId: "p1",
    });
    const [, params, options] = (stripe.subscriptions.update as any).mock.calls[0];
    expect(params.proration_date).toBeUndefined();
    expect(params.cancel_at_period_end).toBeUndefined();
    expect(options).toBeUndefined();
  });

  it("a KEYED call whose change already landed answers success from the retrieved state — no second update", async () => {
    const stripe = fakeStripe(structuredClone(baseSub));
    const result = await changeCreatorTierSubscription(stripe as any, {
      subscriptionId: "sub_1", priceId: "price_pro", tier: "pro", userId: "u1", profileId: "p1",
      idempotencyKey: "idem-key-1",
    });
    expect(result.subscriptionId).toBe("sub_1");
    expect(result.customerId).toBe("cus_1");
    expect(result.status).toBe("active");
    expect(result.currentPeriodEnd).toEqual(new Date(1_799_000_000 * 1000));
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });
});

function fakeStripeWithPreview(sub: any, amountDue: number) {
  const base = fakeStripe(sub);
  return {
    ...base,
    invoices: {
      createPreview: vi.fn(async () => ({ amount_due: amountDue, currency: "usd" })),
    },
  };
}

describe("previewCreatorTierChange (stack600)", () => {
  it("upgrade: a positive amount_due is today's charge; the preview targets the same sub/item at the pinned proration_date", async () => {
    const stripe = fakeStripeWithPreview(structuredClone(baseSub), 850);
    const preview = await previewCreatorTierChange(stripe as any, {
      subscriptionId: "sub_1", priceId: "price_elite", prorationDate: 1_798_000_000,
    });
    expect(preview.amountDueTodayCents).toBe(850);
    expect(preview.creditCents).toBe(0);
    expect(preview.currency).toBe("usd");
    expect(preview.prorationDate).toBe(1_798_000_000);
    expect(preview.currentPeriodEnd).toEqual(new Date(1_799_000_000 * 1000));
    const [params] = (stripe.invoices.createPreview as any).mock.calls[0];
    expect(params.customer).toBe("cus_1");
    expect(params.subscription).toBe("sub_1");
    expect(params.subscription_details).toEqual({
      items: [{ id: "si_1", price: "price_elite" }],
      proration_date: 1_798_000_000,
    });
    /* A preview writes nothing. */
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("downgrade: a negative amount_due becomes a credit with $0 due today", async () => {
    const elite = structuredClone(baseSub);
    elite.items.data[0].price.id = "price_elite";
    const stripe = fakeStripeWithPreview(elite, -700);
    const preview = await previewCreatorTierChange(stripe as any, {
      subscriptionId: "sub_1", priceId: "price_pro", prorationDate: 1_798_000_000,
    });
    expect(preview.amountDueTodayCents).toBe(0);
    expect(preview.creditCents).toBe(700);
  });

  it("an unpinned preview picks a proration instant and reports the SAME one it sent to Stripe", async () => {
    const stripe = fakeStripeWithPreview(structuredClone(baseSub), 850);
    const preview = await previewCreatorTierChange(stripe as any, {
      subscriptionId: "sub_1", priceId: "price_elite",
    });
    expect(typeof preview.prorationDate).toBe("number");
    const [params] = (stripe.invoices.createPreview as any).mock.calls[0];
    expect(params.subscription_details.proration_date).toBe(preview.prorationDate);
  });

  it("refuses to preview a same-price change or a canceled subscription", async () => {
    const samePrice = fakeStripeWithPreview(structuredClone(baseSub), 0);
    await expect(previewCreatorTierChange(samePrice as any, {
      subscriptionId: "sub_1", priceId: "price_pro",
    })).rejects.toThrow(/already on that price/);
    expect(samePrice.invoices.createPreview).not.toHaveBeenCalled();

    const dead = structuredClone(baseSub);
    dead.status = "canceled";
    const canceled = fakeStripeWithPreview(dead, 0);
    await expect(previewCreatorTierChange(canceled as any, {
      subscriptionId: "sub_1", priceId: "price_elite",
    })).rejects.toThrow(/cannot be changed/);
    expect(canceled.invoices.createPreview).not.toHaveBeenCalled();
  });
});
