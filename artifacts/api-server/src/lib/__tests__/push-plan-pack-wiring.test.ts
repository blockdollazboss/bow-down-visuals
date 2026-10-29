/**
 * Plan + pack landed → device-push wiring (push families #5).
 *
 * Plan: the authoritative moment is the subscription RECEIPT landing —
 * creator_subscription_receipts.idempotency_key is UNIQUE and the
 * insert is ON CONFLICT DO NOTHING, so a replayed webhook lands no
 * receipt and fires no ping. Only paid moments (subscribed / renewed /
 * tier_changed to a paid tier) confirm; bad-news kinds never ride.
 *
 * Pack: the authoritative moment is fulfillCreditPurchase's "granted"
 * outcome — the insert-first claim both rails (hosted webhook +
 * embedded verify) ride, so the grant, and therefore the ping, happen
 * exactly once per purchase.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  maybeNotifyPlanLanded,
  planLandedCopy,
  type PlanLandedDeps,
} from "../creator-tier-sync";
import { __setPackEventNotifier, notifyPackLanded, type CreditPurchase } from "../payment-record";
import {
  notifyUserEvent,
  type NotifyDeps,
  type PushPreferenceMap,
  type UserEventInput,
} from "../push-events";

const ON: PushPreferenceMap = { money: true, messages: true, live: true, mentions: true, social: false };
const MONEY_OFF: PushPreferenceMap = { ...ON, money: false };

function fakeLegs(prefs: PushPreferenceMap) {
  const bells: UserEventInput[] = [];
  const pushes: Array<{ userId: string; payload: unknown }> = [];
  const deps: NotifyDeps = {
    getPrefs: async () => prefs,
    insertBell: async (input) => {
      bells.push(input);
    },
    sendPush: async (userId, payload) => {
      pushes.push({ userId, payload });
      return { sent: 1, pruned: 0, failed: 0, skippedReason: null };
    },
  };
  return { bells, pushes, deps };
}

describe("planLandedCopy — only paid landed moments confirm", () => {
  it("subscribed / renewed / tier_changed to a paid tier produce copy", () => {
    expect(planLandedCopy("subscribed", "pro")?.title).toContain("Pro");
    expect(planLandedCopy("renewed", "elite")?.title).toContain("Elite");
    expect(planLandedCopy("tier_changed", "elite")?.title).toContain("Elite");
  });

  it("bad-news and free outcomes never confirm", () => {
    expect(planLandedCopy("payment_failed", "pro")).toBeNull();
    expect(planLandedCopy("canceled", "pro")).toBeNull();
    expect(planLandedCopy("status_changed", "pro")).toBeNull();
    expect(planLandedCopy("tier_changed", "free")).toBeNull();
    expect(planLandedCopy("subscribed", null)).toBeNull();
  });
});

describe("maybeNotifyPlanLanded", () => {
  function planDeps(prefs: PushPreferenceMap, userId: string | null = "buyer-1") {
    const legs = fakeLegs(prefs);
    const deps: PlanLandedDeps = {
      readUserId: async () => userId,
      notify: async (input) => notifyUserEvent(input, legs.deps),
    };
    return { ...legs, deps };
  }

  it("fires bell + ping for a landed subscribe receipt", async () => {
    const { bells, pushes, deps } = planDeps(ON);
    const fired = await maybeNotifyPlanLanded({ profileId: "p1", kind: "subscribed", tier: "pro" }, deps);
    expect(fired).toBe(true);
    expect(bells[0]).toMatchObject({ userId: "buyer-1", category: "money", kind: "plan_subscribed", link: "/settings" });
    expect(pushes).toHaveLength(1);
  });

  it("prefs-off (money): bell lands, ping silent", async () => {
    const { bells, pushes, deps } = planDeps(MONEY_OFF);
    await maybeNotifyPlanLanded({ profileId: "p1", kind: "renewed", tier: "elite" }, deps);
    expect(bells).toHaveLength(1);
    expect(pushes).toHaveLength(0);
  });

  it("a non-landed kind fires nothing (this is also the replay guard's second wall)", async () => {
    const { bells, pushes, deps } = planDeps(ON);
    const fired = await maybeNotifyPlanLanded({ profileId: "p1", kind: "payment_failed", tier: "pro" }, deps);
    expect(fired).toBe(false);
    expect(bells).toHaveLength(0);
    expect(pushes).toHaveLength(0);
  });

  it("never throws when the notifier fails", async () => {
    const deps: PlanLandedDeps = {
      readUserId: async () => "buyer-1",
      notify: async () => {
        throw new Error("down");
      },
    };
    await expect(maybeNotifyPlanLanded({ profileId: "p1", kind: "subscribed", tier: "pro" }, deps)).resolves.toBe(false);
  });
});

describe("notifyPackLanded (fulfillCreditPurchase granted outcome)", () => {
  const purchase: CreditPurchase = {
    idempotencyKey: "cs_test_123",
    userId: "buyer-9",
    creditPack: "15,000 Visual Bucs",
    creditsAmount: 15000,
  };

  afterEach(() => {
    __setPackEventNotifier(null);
  });

  it("composes the landed event: buyer, money, amount + pack in the body, credit-history link", async () => {
    const seen: UserEventInput[] = [];
    __setPackEventNotifier(async (input) => {
      seen.push(input);
    });
    await notifyPackLanded(purchase);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ userId: "buyer-9", category: "money", kind: "pack_landed", link: "/credit-history" });
    expect(seen[0]!.body).toContain("15,000 VB");
  });

  it("rides the real event service: prefs-off (money) lands the bell, silences the ping", async () => {
    const legs = fakeLegs(MONEY_OFF);
    __setPackEventNotifier(async (input) => notifyUserEvent(input, legs.deps));
    await notifyPackLanded(purchase);
    expect(legs.bells).toHaveLength(1);
    expect(legs.pushes).toHaveLength(0);
  });

  it("a throwing notifier is swallowed — fulfillment can never fail over a ping", async () => {
    __setPackEventNotifier(async () => {
      throw new Error("down");
    });
    await expect(notifyPackLanded(purchase)).resolves.toBeUndefined();
  });
});
