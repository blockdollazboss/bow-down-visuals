/**
 * Referral earnings landed → referrer device-push wiring (#12).
 *
 * The authoritative moment is awardReferralPayout's success exit —
 * the one function every award path funnels through (hosted webhook,
 * embedded PI branch, embedded verify wrapper). Exactly-once rides
 * the referral_payouts claim (UNIQUE stripe_session_id): a replayed
 * webhook dies at the claim insert and returns 0 long before the
 * notify line. Proven here at the composition level through the real
 * notifyUserEvent with fake legs; the claim/grant behaviour itself is
 * covered by the referral suites.
 */
import { afterEach, describe, expect, it } from "vitest";
import { __setReferralEventNotifier, buildReferralEarnedEvent, notifyReferralEarned } from "../referrals";
import {
  notifyUserEvent,
  type NotifyDeps,
  type PushPreferenceMap,
  type UserEventInput,
} from "../../lib/push-events";

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

afterEach(() => {
  __setReferralEventNotifier(null);
});

describe("buildReferralEarnedEvent", () => {
  it("addresses the referrer, money category, amount in the body, credit-history link", () => {
    const ev = buildReferralEarnedEvent("referrer-1", 1250);
    expect(ev).toMatchObject({ userId: "referrer-1", category: "money", kind: "referral_earned", link: "/credit-history" });
    expect(ev.body).toContain("+1,250 VB");
  });
});

describe("notifyReferralEarned through the real event door", () => {
  it("bell + ping land when money is on", async () => {
    const legs = fakeLegs(ON);
    __setReferralEventNotifier(async (input) => notifyUserEvent(input, legs.deps));
    await notifyReferralEarned("referrer-1", 250);
    expect(legs.bells).toHaveLength(1);
    expect(legs.pushes).toHaveLength(1);
    expect(legs.pushes[0]!.userId).toBe("referrer-1");
  });

  it("money-off: bell lands, ping silent", async () => {
    const legs = fakeLegs(MONEY_OFF);
    __setReferralEventNotifier(async (input) => notifyUserEvent(input, legs.deps));
    await notifyReferralEarned("referrer-1", 250);
    expect(legs.bells).toHaveLength(1);
    expect(legs.pushes).toHaveLength(0);
  });

  it("a failing notifier never throws back into the award", async () => {
    __setReferralEventNotifier(async () => {
      throw new Error("down");
    });
    await expect(notifyReferralEarned("referrer-1", 250)).resolves.toBeUndefined();
  });
});
