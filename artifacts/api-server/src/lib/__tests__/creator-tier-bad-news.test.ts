/**
 * creator-tier-bad-news.test.ts — notification-completeness census
 * (stack1200): a creator plan's BAD news must tell the member too.
 *
 * THE GAP: planLandedCopy deliberately covers only the good news
 * (subscribed / renewed / tier_changed). A failed plan payment and
 * a plan cancellation landed receipts (payment_failed, canceled)
 * that told the member NOTHING — no bell, no push, and (unlike fan
 * memberships, which run a dunning email sequence) no email either.
 * A creator learned their plan died when a feature stopped working.
 *
 * The fix mirrors the good-news rail exactly: copy + a
 * maybeNotifyPlanBadNews fired only when the receipt LANDS (the
 * receipt's UNIQUE idempotency key is the exactly-once claim — a
 * replayed webhook lands nothing and tells nothing). Copy is
 * honest: a failed payment says past due and names the fix; it
 * never claims money moved. status_changed receipts stay silent —
 * that kind is an internal sync mirror with no member meaning.
 */
import { describe, it, expect } from "vitest";
import {
  planBadNewsCopy,
  maybeNotifyPlanBadNews,
  type PlanLandedDeps,
} from "../creator-tier-sync";
import { notifyUserEvent, type NotifyDeps, type PushPreferenceMap, type UserEventInput } from "../push-events";

const PROFILE_ID = "00000000-0000-4000-8000-0000000000p1".replace("p", "a");
const USER_ID = "00000000-0000-4000-8000-0000000000u1".replace("u", "b");

function recordingDeps(events: UserEventInput[]): PlanLandedDeps {
  return {
    readUserId: async () => USER_ID,
    notify: async (input) => { events.push(input); },
  };
}

describe("planBadNewsCopy — honest bad-news copy, nothing else", () => {
  it("payment_failed names the past-due state and the fix, never a landed payment", () => {
    const copy = planBadNewsCopy("payment_failed", "pro");
    expect(copy).not.toBeNull();
    expect(copy!.title).toMatch(/payment/i);
    expect(copy!.body).toMatch(/past due/i);
    expect(copy!.body).toMatch(/payment method/i);
    expect(copy!.body).not.toMatch(/landed|confirmed|received/i);
  });

  it("canceled says the plan ended and the free plan is what remains", () => {
    const copy = planBadNewsCopy("canceled", "elite");
    expect(copy).not.toBeNull();
    expect(copy!.body).toMatch(/free/i);
  });

  it("good-news kinds and the internal mirror kind get no bad-news copy", () => {
    expect(planBadNewsCopy("subscribed", "pro")).toBeNull();
    expect(planBadNewsCopy("renewed", "pro")).toBeNull();
    expect(planBadNewsCopy("tier_changed", "pro")).toBeNull();
    expect(planBadNewsCopy("status_changed", "pro")).toBeNull();
  });
});

describe("maybeNotifyPlanBadNews — fires on the landed receipt only", () => {
  it("payment_failed tells the member once, at category money", async () => {
    const events: UserEventInput[] = [];
    const fired = await maybeNotifyPlanBadNews(
      { profileId: PROFILE_ID, kind: "payment_failed", tier: "pro" },
      recordingDeps(events),
    );
    expect(fired).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId: USER_ID,
      category: "money",
      kind: "plan_payment_failed",
      link: "/settings",
    });
  });

  it("canceled tells the member once; status_changed stays silent", async () => {
    const events: UserEventInput[] = [];
    expect(await maybeNotifyPlanBadNews(
      { profileId: PROFILE_ID, kind: "canceled", tier: "elite" },
      recordingDeps(events),
    )).toBe(true);
    expect(events[0]).toMatchObject({ kind: "plan_canceled", category: "money" });

    expect(await maybeNotifyPlanBadNews(
      { profileId: PROFILE_ID, kind: "status_changed", tier: "pro" },
      recordingDeps(events),
    )).toBe(false);
    expect(events).toHaveLength(1);
  });

  it("an unresolvable profile tells nothing and never throws", async () => {
    const events: UserEventInput[] = [];
    const deps: PlanLandedDeps = {
      readUserId: async () => null,
      notify: async (input) => { events.push(input); },
    };
    expect(await maybeNotifyPlanBadNews(
      { profileId: PROFILE_ID, kind: "payment_failed", tier: "pro" },
      deps,
    )).toBe(false);
    expect(events).toHaveLength(0);
  });
});

describe("composition through the real door — the Settings gate applies", () => {
  const ON: PushPreferenceMap = { money: true, messages: true, live: true, mentions: true, social: false };

  function fakeLegs(prefs: PushPreferenceMap) {
    const bells: UserEventInput[] = [];
    const pushes: string[] = [];
    const deps: NotifyDeps = {
      getPrefs: async () => prefs,
      insertBell: async (input) => { bells.push(input); },
      sendPush: async (userId) => {
        pushes.push(userId);
        return { sent: 1, pruned: 0, failed: 0, skippedReason: null };
      },
    };
    return { bells, pushes, deps };
  }

  it("bell + push land with money on; the push alone silences with money off", async () => {
    const on = fakeLegs(ON);
    await maybeNotifyPlanBadNews(
      { profileId: PROFILE_ID, kind: "payment_failed", tier: "pro" },
      { readUserId: async () => USER_ID, notify: (input) => notifyUserEvent(input, on.deps) },
    );
    expect(on.bells).toHaveLength(1);
    expect(on.pushes).toEqual([USER_ID]);

    const off = fakeLegs({ ...ON, money: false });
    await maybeNotifyPlanBadNews(
      { profileId: PROFILE_ID, kind: "payment_failed", tier: "pro" },
      { readUserId: async () => USER_ID, notify: (input) => notifyUserEvent(input, off.deps) },
    );
    expect(off.bells).toHaveLength(1);
    expect(off.pushes).toHaveLength(0);
  });
});
