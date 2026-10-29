/**
 * DM received → device-push wiring (push families #6).
 *
 * Two DM insert sites ride the one event door after this wiring:
 *   1. POST /dm/:id/send — a landed message in an accepted (inbox)
 *      thread pings the OTHER participant. The send is the moment (the
 *      message row lands exactly once; each further message is a new
 *      real message). Request threads are deliberately not wired at
 *      the send site — their first message is the request itself,
 *      already announced by site 2, so a send-side ping would double.
 *   2. POST /dm/start (request status) — the dm_request announcement,
 *      swapped from the bell-only local helper to the event door.
 *
 * Proven here at the composition level (the route handlers' DB path
 * is covered by the community suites): event shape, partner
 * addressing, excerpt rules, and the real notifyUserEvent's prefs
 * gate — messages-off lands the bell and silences the ping.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  __setDmEventNotifier,
  buildDmReceivedEvent,
  notifyDmReceived,
  notifyDmRequest,
} from "../community";
import {
  notifyUserEvent,
  type NotifyDeps,
  type PushPreferenceMap,
  type UserEventInput,
} from "../../lib/push-events";

const ON: PushPreferenceMap = { money: true, messages: true, live: true, mentions: true, social: false };
const MESSAGES_OFF: PushPreferenceMap = { ...ON, messages: false };

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
  __setDmEventNotifier(null);
});

describe("buildDmReceivedEvent", () => {
  it("addresses the partner (never the sender), messages category, /messages link", () => {
    const ev = buildDmReceivedEvent({ partnerId: "partner-1", senderName: "Kai", body: "yo, listen to this", hasAttachment: false });
    expect(ev).toMatchObject({ userId: "partner-1", category: "messages", kind: "dm", link: "/messages" });
    expect(ev.title).toContain("Kai");
    expect(ev.body).toBe("yo, listen to this");
  });

  it("truncates the excerpt at 120 chars and falls back for attachment-only messages", () => {
    const long = buildDmReceivedEvent({ partnerId: "p", senderName: "Kai", body: "x".repeat(300), hasAttachment: false });
    expect(long.body).toHaveLength(120);
    const att = buildDmReceivedEvent({ partnerId: "p", senderName: "Kai", body: "  ", hasAttachment: true });
    expect(att.body).toBe("Sent you an attachment.");
  });
});

describe("notifyDmReceived / notifyDmRequest through the real event door", () => {
  it("bell + ping land for the partner when messages are on", async () => {
    const legs = fakeLegs(ON);
    __setDmEventNotifier(async (input) => notifyUserEvent(input, legs.deps));
    await notifyDmReceived({ partnerId: "partner-1", senderName: "Kai", body: "hi", hasAttachment: false });
    expect(legs.bells).toHaveLength(1);
    expect(legs.bells[0]!.userId).toBe("partner-1");
    expect(legs.pushes).toHaveLength(1);
  });

  it("messages-off: the bell still lands, the ping stays silent", async () => {
    const legs = fakeLegs(MESSAGES_OFF);
    __setDmEventNotifier(async (input) => notifyUserEvent(input, legs.deps));
    await notifyDmReceived({ partnerId: "partner-1", senderName: "Kai", body: "hi", hasAttachment: false });
    expect(legs.bells).toHaveLength(1);
    expect(legs.pushes).toHaveLength(0);
  });

  it("the request announcement keeps its dm_request kind under the messages category", async () => {
    const legs = fakeLegs(ON);
    __setDmEventNotifier(async (input) => notifyUserEvent(input, legs.deps));
    await notifyDmRequest({ userId: "target-1", kind: "dm_request", title: "🦈 Kai sent you a message request", body: "", link: "/messages" });
    expect(legs.bells[0]).toMatchObject({ userId: "target-1", category: "messages", kind: "dm_request" });
    expect(legs.pushes).toHaveLength(1);
  });

  it("a failing notifier never throws back into the send path", async () => {
    __setDmEventNotifier(async () => {
      throw new Error("down");
    });
    await expect(
      notifyDmReceived({ partnerId: "p", senderName: "Kai", body: "hi", hasAttachment: false }),
    ).resolves.toBeUndefined();
  });
});
