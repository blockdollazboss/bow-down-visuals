/**
 * Group-join → device-push wiring (stack800 lane 8 — the push-families
 * lane's named leftover, report open item #2).
 *
 * POST /groups/:slug/join used to announce a landed join to the group
 * owner through the bell-only local helper. It now rides the one event
 * door (notifyUserEvent): the bell still always lands, and the ping
 * obeys the owner's "social" preference — a join is a social
 * interaction, so the default (social OFF) means bell-only, exactly
 * the old visible behaviour, until the owner turns social pings on.
 *
 * Exactly-once is structural, riding the family's existing gate (no
 * second counter): group_members' primary key is (group_id, user_id)
 * and the join route refuses an existing member with a 409 before
 * inserting, so the notify line runs exactly once per landed join row.
 * A replayed join dies at the 409 long before the notify line.
 *
 * Proven here at the composition level (the route handler's DB path is
 * covered by the community suites): event shape is byte-identical to
 * the old bell (kind/title/body/link preserved), owner addressing, and
 * the real notifyUserEvent's prefs gate.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  __setGroupJoinEventNotifier,
  buildGroupJoinEvent,
  notifyGroupJoined,
} from "../community";
import {
  notifyUserEvent,
  PUSH_CATEGORY_DEFAULTS,
  type NotifyDeps,
  type PushPreferenceMap,
  type UserEventInput,
} from "../../lib/push-events";

const SOCIAL_ON: PushPreferenceMap = { money: true, messages: true, live: true, mentions: true, social: true };
/** The shipped defaults: every category on except social. */
const DEFAULTS: PushPreferenceMap = { ...PUSH_CATEGORY_DEFAULTS };

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

const JOIN = {
  ownerUserId: "owner-1",
  joinerName: "Kai",
  groupName: "Beat Makers",
  groupSlug: "beat-makers",
};

afterEach(() => {
  __setGroupJoinEventNotifier(null);
});

describe("buildGroupJoinEvent", () => {
  it("preserves the old bell exactly: kind, title, body, link — under the social category", () => {
    expect(buildGroupJoinEvent(JOIN)).toEqual({
      userId: "owner-1",
      category: "social",
      kind: "group_join",
      title: `🦈 Kai joined your group "Beat Makers"`,
      body: "Your crew is growing — give them a shout.",
      link: "/groups/beat-makers",
    });
  });
});

describe("notifyGroupJoined", () => {
  it("social on: fires bell + ping, addressed to the group owner, exactly once", async () => {
    const legs = fakeLegs(SOCIAL_ON);
    __setGroupJoinEventNotifier(async (input) => notifyUserEvent(input, legs.deps));
    await notifyGroupJoined(JOIN);
    expect(legs.bells).toHaveLength(1);
    expect(legs.bells[0]).toMatchObject({ userId: "owner-1", category: "social", kind: "group_join" });
    expect(legs.pushes).toHaveLength(1);
    expect(legs.pushes[0]!.userId).toBe("owner-1");
  });

  it("shipped defaults (social off): bell lands, ping silent — the old visible behaviour", async () => {
    const legs = fakeLegs(DEFAULTS);
    __setGroupJoinEventNotifier(async (input) => notifyUserEvent(input, legs.deps));
    await notifyGroupJoined(JOIN);
    expect(legs.bells).toHaveLength(1);
    expect(legs.pushes).toHaveLength(0);
  });

  it("a failing notifier never breaks the join that landed", async () => {
    __setGroupJoinEventNotifier(async () => {
      throw new Error("down");
    });
    await expect(notifyGroupJoined(JOIN)).resolves.toBeUndefined();
  });
});
