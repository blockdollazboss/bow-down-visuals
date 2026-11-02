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
import { changeCreatorTierSubscription, previewCreatorTierChange, prorationNetFromPreviewLines } from "../creator-tier-upgrade";

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
    /* stack1300: the effective key is the caller's key PLUS a
       fingerprint of the exact update parameters, so the key
       identifies this request (a parameter change under a reused key
       is what Stripe refuses). */
    expect(options.idempotencyKey).toMatch(/^idem-key-1:[0-9a-f]{32}$/);
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

/* Line fixtures in Stripe's preview shape. A preview invoice for a
   subscription change carries the swap's PRORATION lines (unused-time
   credit + remaining-time debit, each = price × remaining/period,
   rounded by Stripe) PLUS the next renewal line at the new price —
   and its amount_due is the sum of ALL of them. The quote must read
   only the proration lines (stack1100 Z2; Gate #5 quoted $46 = $17
   proration + $29 renewal for a same-day Pro→Elite switch). */
const prorationLine = (amount: number) => ({
  amount,
  parent: {
    type: "subscription_item_details",
    subscription_item_details: { proration: true },
    invoice_item_details: null,
  },
});
const renewalLine = (amount: number) => ({
  amount,
  parent: {
    type: "subscription_item_details",
    subscription_item_details: { proration: false },
    invoice_item_details: null,
  },
});

function fakeStripeWithPreview(sub: any, lines: any[], amountDue: number) {
  const base = fakeStripe(sub);
  return {
    ...base,
    invoices: {
      createPreview: vi.fn(async () => ({
        amount_due: amountDue,
        currency: "usd",
        lines: { data: lines, has_more: false },
      })),
    },
  };
}

describe("prorationNetFromPreviewLines (stack1100 Z2)", () => {
  it("sums ONLY proration lines — the renewal line never enters the quote", () => {
    const lines = [prorationLine(-1200), prorationLine(2900), renewalLine(2900)] as any;
    expect(prorationNetFromPreviewLines(lines)).toBe(1700);
  });

  it("counts invoice-item prorations too, and skips lines with no parent", () => {
    const lines = [
      { amount: -300, parent: { type: "invoice_item_details", subscription_item_details: null, invoice_item_details: { proration: true } } },
      { amount: 999, parent: null },
      renewalLine(1200),
    ] as any;
    expect(prorationNetFromPreviewLines(lines)).toBe(-300);
  });

  it("refuses a preview with no line list instead of quoting a guess", () => {
    expect(() => prorationNetFromPreviewLines(undefined)).toThrow(/without line items/);
    expect(() => prorationNetFromPreviewLines(null)).toThrow(/without line items/);
    expect(prorationNetFromPreviewLines([])).toBe(0);
  });
});

describe("previewCreatorTierChange (stack600, quote math stack1100 Z2)", () => {
  it("upgrade: the quote is the proration net, not the preview's amount_due; the preview targets the same sub/item at the pinned proration_date", async () => {
    /* Proration net +850 (credit −600, debit +1450); amount_due 3750
       includes the $29 renewal — the OLD code quoted 3750. */
    const stripe = fakeStripeWithPreview(structuredClone(baseSub),
      [prorationLine(-600), prorationLine(1450), renewalLine(2900)], 3750);
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

  it("downgrade: a negative proration net becomes a credit with $0 due today — even when amount_due is positive", async () => {
    /* Elite→Pro mid-period: proration net −700 (credit −1450, debit
       +750) but the preview's amount_due is +500 (net + $12 renewal)
       — the OLD code quoted a $5.00 CHARGE for a downgrade that
       actually credits $7. */
    const elite = structuredClone(baseSub);
    elite.items.data[0].price.id = "price_elite";
    const stripe = fakeStripeWithPreview(elite,
      [prorationLine(-1450), prorationLine(750), renewalLine(1200)], 500);
    const preview = await previewCreatorTierChange(stripe as any, {
      subscriptionId: "sub_1", priceId: "price_pro", prorationDate: 1_798_000_000,
    });
    expect(preview.amountDueTodayCents).toBe(0);
    expect(preview.creditCents).toBe(700);
  });

  /* ── The Gate #5 case table — Stripe's documented arithmetic on the
     real $12 Pro / $29 Elite prices. Each proration line is
     price × (seconds remaining / period seconds), rounded; the
     proration invoice always_invoice bills today is their net. ── */
  it("CASE same-day upgrade (Gate #5): quotes $17.00, not the preview's $46.00", async () => {
    /* Switch moments after subscribing: unused Pro ≈ −1200, Elite
       remaining ≈ +2900, renewal +2900 → amount_due 4600. */
    const stripe = fakeStripeWithPreview(structuredClone(baseSub),
      [prorationLine(-1200), prorationLine(2900), renewalLine(2900)], 4600);
    const preview = await previewCreatorTierChange(stripe as any, {
      subscriptionId: "sub_1", priceId: "price_elite",
    });
    expect(preview.amountDueTodayCents).toBe(1700);
    expect(preview.creditCents).toBe(0);
  });

  it("CASE mid-period upgrade (day 15 of 30): quotes half the difference, $8.50", async () => {
    /* f = 0.5: unused Pro −600, Elite remaining +1450 → net +850;
       amount_due 3750 with the renewal. */
    const stripe = fakeStripeWithPreview(structuredClone(baseSub),
      [prorationLine(-600), prorationLine(1450), renewalLine(2900)], 3750);
    const preview = await previewCreatorTierChange(stripe as any, {
      subscriptionId: "sub_1", priceId: "price_elite",
    });
    expect(preview.amountDueTodayCents).toBe(850);
    expect(preview.creditCents).toBe(0);
  });

  it("CASE same-day downgrade: quotes a $17.00 credit and $0 due — the preview's amount_due is −$5.00", async () => {
    const elite = structuredClone(baseSub);
    elite.items.data[0].price.id = "price_elite";
    const stripe = fakeStripeWithPreview(elite,
      [prorationLine(-2900), prorationLine(1200), renewalLine(1200)], -500);
    const preview = await previewCreatorTierChange(stripe as any, {
      subscriptionId: "sub_1", priceId: "price_pro",
    });
    expect(preview.amountDueTodayCents).toBe(0);
    expect(preview.creditCents).toBe(1700);
  });

  it("CASE mid-period downgrade: quotes an $8.50 credit — the preview's amount_due (+$3.50) reads as a charge under the old math", async () => {
    const elite = structuredClone(baseSub);
    elite.items.data[0].price.id = "price_elite";
    const stripe = fakeStripeWithPreview(elite,
      [prorationLine(-1450), prorationLine(600), renewalLine(1200)], 350);
    const preview = await previewCreatorTierChange(stripe as any, {
      subscriptionId: "sub_1", priceId: "price_pro",
    });
    expect(preview.amountDueTodayCents).toBe(0);
    expect(preview.creditCents).toBe(850);
  });

  it("CASE trial upgrade: no proration lines exist (nothing paid yet) — $0 due today, $0 credit", async () => {
    const trialing = structuredClone(baseSub);
    trialing.status = "trialing";
    const stripe = fakeStripeWithPreview(trialing, [renewalLine(2900)], 2900);
    const preview = await previewCreatorTierChange(stripe as any, {
      subscriptionId: "sub_1", priceId: "price_elite",
    });
    expect(preview.amountDueTodayCents).toBe(0);
    expect(preview.creditCents).toBe(0);
  });

  it("a preview without lines refuses instead of quoting", async () => {
    const base = fakeStripe(structuredClone(baseSub));
    const stripe = {
      ...base,
      invoices: { createPreview: vi.fn(async () => ({ amount_due: 4600, currency: "usd" })) },
    };
    await expect(previewCreatorTierChange(stripe as any, {
      subscriptionId: "sub_1", priceId: "price_elite",
    })).rejects.toThrow(/without line items/);
  });

  it("an unpinned preview picks a proration instant and reports the SAME one it sent to Stripe", async () => {
    const stripe = fakeStripeWithPreview(structuredClone(baseSub),
      [prorationLine(-600), prorationLine(1450), renewalLine(2900)], 3750);
    const preview = await previewCreatorTierChange(stripe as any, {
      subscriptionId: "sub_1", priceId: "price_elite",
    });
    expect(typeof preview.prorationDate).toBe("number");
    const [params] = (stripe.invoices.createPreview as any).mock.calls[0];
    expect(params.subscription_details.proration_date).toBe(preview.prorationDate);
  });

  it("refuses to preview a same-price change or a canceled subscription", async () => {
    const samePrice = fakeStripeWithPreview(structuredClone(baseSub), [], 0);
    await expect(previewCreatorTierChange(samePrice as any, {
      subscriptionId: "sub_1", priceId: "price_pro",
    })).rejects.toThrow(/already on that price/);
    expect(samePrice.invoices.createPreview).not.toHaveBeenCalled();

    const dead = structuredClone(baseSub);
    dead.status = "canceled";
    const canceled = fakeStripeWithPreview(dead, [], 0);
    await expect(previewCreatorTierChange(canceled as any, {
      subscriptionId: "sub_1", priceId: "price_elite",
    })).rejects.toThrow(/cannot be changed/);
    expect(canceled.invoices.createPreview).not.toHaveBeenCalled();
  });
});
