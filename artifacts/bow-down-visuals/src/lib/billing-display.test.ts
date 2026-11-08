/**
 * billing-display.test.ts — Settings → Billing display derivation
 * (payfix lane: billing-cancel).
 *
 * Pins the client half of the contract the API tests pin on the
 * server: the card renders the REAL state for free and paid users,
 * a cancel reads back "canceling" with the tier held until period
 * end, and a canceled plan reads ended/Free.
 */
import { describe, it, expect } from "vitest";
import { describeBilling, formatBillingDate, type BillingStateView } from "./billing-display";

const PERIOD_END = "2026-11-25T12:00:00.000Z";

function state(over: Partial<BillingStateView>): BillingStateView {
  return {
    plan: "free",
    planName: "Free",
    priceUsdPerMonth: null,
    status: "free",
    currentPeriodEnd: null,
    renewalDate: null,
    endsAt: null,
    hasStripeSubscription: false,
    hasStripeCustomer: false,
    canCancel: false,
    canResume: false,
    ...over,
  };
}

describe("describeBilling — free", () => {
  it("free renders Free: no price, no date, no cancel, plans door shown", () => {
    const d = describeBilling(state({}));
    expect(d.status).toBe("free");
    expect(d.isPaid).toBe(false);
    expect(d.priceLine).toBeNull();
    expect(d.dateKind).toBeNull();
    expect(d.showCancel).toBe(false);
    expect(d.showResume).toBe(false);
    expect(d.showManagePayment).toBe(false);
    expect(d.showSeePlans).toBe(true);
  });
});

describe("describeBilling — paid", () => {
  const paid = state({
    plan: "pro",
    planName: "Pro",
    priceUsdPerMonth: 12,
    status: "active",
    currentPeriodEnd: PERIOD_END,
    renewalDate: PERIOD_END,
    hasStripeSubscription: true,
    hasStripeCustomer: true,
    canCancel: true,
  });

  it("paid Pro renders plan, $12/mo price, and the renewal date", () => {
    const d = describeBilling(paid);
    expect(d.status).toBe("active");
    expect(d.isPaid).toBe(true);
    expect(d.priceLine).toBe("$12/mo");
    expect(d.dateKind).toBe("renews");
    expect(d.dateIso).toBe(PERIOD_END);
    expect(d.showCancel).toBe(true);
    expect(d.showManagePayment).toBe(true);
    expect(d.showSeePlans).toBe(false);
  });

  it("trialing also headlines the renewal date and can cancel", () => {
    const d = describeBilling({ ...paid, status: "trialing" });
    expect(d.dateKind).toBe("renews");
    expect(d.showCancel).toBe(true);
  });
});

describe("describeBilling — cancel sets canceling, period end holds", () => {
  it("after cancel: status canceling, tier STILL paid, ends date headlined, resume offered, no second cancel", () => {
    const d = describeBilling(
      state({
        plan: "pro",
        planName: "Pro",
        priceUsdPerMonth: 12,
        status: "canceling",
        currentPeriodEnd: PERIOD_END,
        renewalDate: null,
        endsAt: PERIOD_END,
        hasStripeSubscription: true,
        hasStripeCustomer: true,
        canCancel: false,
        canResume: true,
      }),
    );
    expect(d.status).toBe("canceling");
    // Period-end hold: the plan/price stay on the card until endsAt —
    // the user keeps the tier they paid for.
    expect(d.isPaid).toBe(true);
    expect(d.priceLine).toBe("$12/mo");
    expect(d.dateKind).toBe("ends");
    expect(d.dateIso).toBe(PERIOD_END);
    expect(d.showCancel).toBe(false);
    expect(d.showResume).toBe(true);
  });

  it("canceled reads ended, with the plans door back", () => {
    const d = describeBilling(
      state({
        plan: "elite",
        planName: "Creator Elite",
        priceUsdPerMonth: 29,
        status: "canceled",
        currentPeriodEnd: PERIOD_END,
        endsAt: PERIOD_END,
        hasStripeSubscription: true,
        hasStripeCustomer: true,
      }),
    );
    expect(d.status).toBe("canceled");
    expect(d.dateKind).toBe("ended");
    expect(d.dateIso).toBe(PERIOD_END);
    expect(d.showCancel).toBe(false);
    expect(d.showResume).toBe(false);
    expect(d.showSeePlans).toBe(true);
  });

  it("past_due offers payment management and no cancel", () => {
    const d = describeBilling(
      state({
        plan: "pro",
        planName: "Pro",
        priceUsdPerMonth: 12,
        status: "past_due",
        currentPeriodEnd: PERIOD_END,
        hasStripeSubscription: true,
        hasStripeCustomer: true,
      }),
    );
    expect(d.status).toBe("past_due");
    expect(d.showManagePayment).toBe(true);
    expect(d.showCancel).toBe(false);
  });
});

describe("describeBilling — change plan (stack600 plan-tier-change)", () => {
  const paidPro = state({
    plan: "pro",
    planName: "Pro",
    priceUsdPerMonth: 12,
    status: "active",
    currentPeriodEnd: PERIOD_END,
    renewalDate: PERIOD_END,
    hasStripeSubscription: true,
    hasStripeCustomer: true,
    canCancel: true,
  });

  it("Pro with the server's canChangePlan offers the switch to Elite", () => {
    const d = describeBilling({ ...paidPro, canChangePlan: true });
    expect(d.showChangePlan).toBe(true);
    expect(d.changeTargetTier).toBe("elite");
  });

  it("Elite with canChangePlan offers the switch DOWN to Pro", () => {
    const d = describeBilling({ ...paidPro, plan: "elite", planName: "Elite", priceUsdPerMonth: 29, canChangePlan: true });
    expect(d.showChangePlan).toBe(true);
    expect(d.changeTargetTier).toBe("pro");
  });

  it("without the server's word there is no change control — the client never guesses", () => {
    const missing = describeBilling(paidPro);
    expect(missing.showChangePlan).toBe(false);
    expect(missing.changeTargetTier).toBeNull();
    const refused = describeBilling({ ...paidPro, canChangePlan: false });
    expect(refused.showChangePlan).toBe(false);
    expect(refused.changeTargetTier).toBeNull();
  });

  it("a canceling member can still change plans (the server flags it — changing means staying)", () => {
    const d = describeBilling({
      ...paidPro,
      status: "canceling",
      renewalDate: null,
      endsAt: PERIOD_END,
      canCancel: false,
      canResume: true,
      canChangePlan: true,
    });
    expect(d.showChangePlan).toBe(true);
    expect(d.changeTargetTier).toBe("elite");
  });

  it("the free plan never offers a change, even if a stray flag arrives", () => {
    const d = describeBilling(state({ canChangePlan: true }));
    expect(d.showChangePlan).toBe(false);
    expect(d.changeTargetTier).toBeNull();
  });
});

describe("describeBilling — standalone Hosting buyer (Stack 300 A3)", () => {
  it("a Free-tier hosting buyer sees the portal entry — their subscription lives on the shared customer", () => {
    /* The exact broken population: tier state reads Free with no
       tier customer on the billing row, but the member holds a
       standalone Hosting subscription (hasHostingSubscription merged
       from /creator-hosting/me). The manage-payment door is the one
       the Hosting copy promises them. */
    const d = describeBilling(state({ hasHostingSubscription: true }));
    expect(d.status).toBe("free");
    expect(d.showManagePayment).toBe(true);
    /* Nothing else changes: still no tier price, no cancel, plans door. */
    expect(d.isPaid).toBe(false);
    expect(d.showCancel).toBe(false);
    expect(d.showSeePlans).toBe(true);
  });

  it("without the hosting flag a Free member still sees no portal entry", () => {
    expect(describeBilling(state({})).showManagePayment).toBe(false);
    expect(describeBilling(state({ hasHostingSubscription: false })).showManagePayment).toBe(false);
  });

  it("a paid tier member's portal entry is unchanged by the flag", () => {
    const d = describeBilling(
      state({
        plan: "pro",
        planName: "Pro",
        priceUsdPerMonth: 12,
        status: "active",
        currentPeriodEnd: PERIOD_END,
        renewalDate: PERIOD_END,
        hasStripeSubscription: true,
        hasStripeCustomer: true,
        canCancel: true,
        hasHostingSubscription: true,
      }),
    );
    expect(d.showManagePayment).toBe(true);
  });
});

describe("formatBillingDate", () => {
  it("formats an ISO period end as a stable UTC date", () => {
    expect(formatBillingDate(PERIOD_END, "en-US")).toBe("Nov 25, 2026");
  });
  it("null and garbage read null, never 'Invalid Date'", () => {
    expect(formatBillingDate(null)).toBeNull();
    expect(formatBillingDate("not-a-date")).toBeNull();
  });
});
