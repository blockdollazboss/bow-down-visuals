/**
 * Payout-ready → device-push wiring (push families #4, on the Stack500
 * push foundation). The authoritative moment is the flags crossing in
 * persistConnectFlags — the ONE writer of the Connect flags (webhook
 * sync + status self-heal both ride it). The transition itself is the
 * exactly-once gate: the stored row crosses false → true exactly once.
 *
 * Proven here: the pure crossing decision, and maybeNotifyPayoutReady
 * composed with the REAL notifyUserEvent (fake legs) — fires on the
 * crossing, silent on every non-crossing, silent when the profile has
 * no user, prefs-off silences the ping but never the bell, and a
 * notifier failure can never throw into the Connect sync.
 */
import { describe, expect, it } from "vitest";
import {
  maybeNotifyPayoutReady,
  payoutBecameReady,
  type PayoutReadyDeps,
} from "../stripe-connect";
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

function payoutDeps(prefs: PushPreferenceMap, userId: string | null = "user-1") {
  const legs = fakeLegs(prefs);
  const deps: PayoutReadyDeps = {
    readUserId: async () => userId,
    notify: async (input) => notifyUserEvent(input, legs.deps),
  };
  return { ...legs, deps };
}

describe("payoutBecameReady — the crossing decision", () => {
  it("fires only on false → true", () => {
    expect(payoutBecameReady({ payoutsEnabled: false }, { payoutsEnabled: true })).toBe(true);
    expect(payoutBecameReady({ payoutsEnabled: true }, { payoutsEnabled: true })).toBe(false);
    expect(payoutBecameReady({ payoutsEnabled: false }, { payoutsEnabled: false })).toBe(false);
    expect(payoutBecameReady({ payoutsEnabled: true }, { payoutsEnabled: false })).toBe(false);
  });
});

describe("maybeNotifyPayoutReady", () => {
  it("fires bell + ping on the crossing, with the money category and Earnings link", async () => {
    const { bells, pushes, deps } = payoutDeps(ON);
    const fired = await maybeNotifyPayoutReady("profile-1", { payoutsEnabled: false }, { payoutsEnabled: true }, deps);
    expect(fired).toBe(true);
    expect(bells).toHaveLength(1);
    expect(bells[0]).toMatchObject({ userId: "user-1", category: "money", kind: "payout_ready", link: "/earnings" });
    expect(pushes).toHaveLength(1);
  });

  it("a replayed sync (already true) never re-fires — the crossing is the gate", async () => {
    const { bells, pushes, deps } = payoutDeps(ON);
    const fired = await maybeNotifyPayoutReady("profile-1", { payoutsEnabled: true }, { payoutsEnabled: true }, deps);
    expect(fired).toBe(false);
    expect(bells).toHaveLength(0);
    expect(pushes).toHaveLength(0);
  });

  it("prefs-off (money) silences the ping but the bell still lands", async () => {
    const { bells, pushes, deps } = payoutDeps(MONEY_OFF);
    const fired = await maybeNotifyPayoutReady("profile-1", { payoutsEnabled: false }, { payoutsEnabled: true }, deps);
    expect(fired).toBe(true);
    expect(bells).toHaveLength(1);
    expect(pushes).toHaveLength(0);
  });

  it("no user on the profile → silent, no throw", async () => {
    const { bells, deps } = payoutDeps(ON, null);
    const fired = await maybeNotifyPayoutReady("profile-1", { payoutsEnabled: false }, { payoutsEnabled: true }, deps);
    expect(fired).toBe(false);
    expect(bells).toHaveLength(0);
  });

  it("a failing notifier never throws into the Connect sync", async () => {
    const deps: PayoutReadyDeps = {
      readUserId: async () => "user-1",
      notify: async () => {
        throw new Error("push service down");
      },
    };
    await expect(
      maybeNotifyPayoutReady("profile-1", { payoutsEnabled: false }, { payoutsEnabled: true }, deps),
    ).resolves.toBe(false);
  });
});
