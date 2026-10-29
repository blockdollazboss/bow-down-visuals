/**
 * Mention → device-push wiring (push families #8).
 *
 * The one mention insert site (post creation in routes/social.ts)
 * swaps from the bell-only helper to the event door: bell always
 * lands, the ping obeys the mentioned creator's "mentions"
 * preference. Exactly-once is structural — extractMentions dedupes
 * handles per post and the caller excludes the author, so a post can
 * mention a creator at most once. Proven here at the composition
 * level through the real notifyUserEvent with fake legs.
 */
import { afterEach, describe, expect, it } from "vitest";
import { __setMentionEventNotifier, notifyMention } from "../social";
import {
  notifyUserEvent,
  type NotifyDeps,
  type PushPreferenceMap,
  type UserEventInput,
} from "../../lib/push-events";

const ON: PushPreferenceMap = { money: true, messages: true, live: true, mentions: true, social: false };
const MENTIONS_OFF: PushPreferenceMap = { ...ON, mentions: false };

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
  __setMentionEventNotifier(null);
});

describe("notifyMention", () => {
  it("fires bell + ping under the mentions category, addressed to the mentioned creator", async () => {
    const legs = fakeLegs(ON);
    __setMentionEventNotifier(async (input) => notifyUserEvent(input, legs.deps));
    await notifyMention("mentioned-1", "Kai mentioned you 📣", "check this out", "/post/abc");
    expect(legs.bells[0]).toMatchObject({ userId: "mentioned-1", category: "mentions", kind: "mention", link: "/post/abc" });
    expect(legs.pushes).toHaveLength(1);
    expect(legs.pushes[0]!.userId).toBe("mentioned-1");
  });

  it("mentions-off: bell lands, ping silent", async () => {
    const legs = fakeLegs(MENTIONS_OFF);
    __setMentionEventNotifier(async (input) => notifyUserEvent(input, legs.deps));
    await notifyMention("mentioned-1", "Kai mentioned you 📣", "", "/post/abc");
    expect(legs.bells).toHaveLength(1);
    expect(legs.pushes).toHaveLength(0);
  });

  it("a failing notifier never breaks the post write path", async () => {
    __setMentionEventNotifier(async () => {
      throw new Error("down");
    });
    await expect(notifyMention("m", "t", "b", "/post/x")).resolves.toBeUndefined();
  });
});
