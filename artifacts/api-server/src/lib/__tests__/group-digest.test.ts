/**
 * group-digest.test.ts — per-group activity digest: prefs contract,
 * aggregation correctness, opt-out, empty-window silence, exactly-once,
 * and the opt-in email channel (never recorded unless the rail
 * confirms the send), against in-memory stores (sound-prefs pattern).
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_GROUP_DIGEST_PREFS,
  buildDigestContent,
  getGroupDigestPrefs,
  isDigestDue,
  runGroupDigestSweep,
  setGroupDigestPrefs,
  totalActivity,
  __resetGroupDigestThrottle,
  type DigestMembership,
  type GroupActivity,
  type GroupDigestPrefsStore,
  type GroupDigestPrefsWire,
  type GroupDigestStore,
} from "../group-digest";

const DAY = 24 * 3600_000;
const NOW = new Date("2026-10-26T12:00:00.000Z");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const USER_C = "33333333-3333-4333-8333-333333333333";
const GROUP_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GROUP_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/* ── In-memory prefs store ─────────────────────────────────────────── */
function memoryPrefsStore(): GroupDigestPrefsStore & { rows: Map<string, GroupDigestPrefsWire> } {
  const rows = new Map<string, GroupDigestPrefsWire>();
  return {
    rows,
    async getRow(userId) {
      const r = rows.get(userId);
      return r ? { ...r } : null;
    },
    async upsertRow(userId, prefs) {
      rows.set(userId, { ...prefs });
    },
  };
}

/* ── In-memory digest store over raw events ────────────────────────── */
interface RawEvent {
  groupId: string;
  kind: "post" | "thread" | "reply" | "join";
  authorUserId: string;
  at: Date;
  body?: string;
  likeCount?: number;
}

interface SentNotification { userId: string; title: string; body: string; link: string }
interface Delivery { userId: string; groupId: string; periodStart: Date; periodEnd: Date; channels: string }

function memoryDigestStore(memberships: DigestMembership[], events: RawEvent[]) {
  const notifications: SentNotification[] = [];
  const deliveries: Delivery[] = [];
  const store: GroupDigestStore = {
    async listMemberships() {
      return memberships.map((m) => ({ ...m }));
    },
    async aggregate(groupId, recipientUserId, since, until) {
      const inWindow = events.filter(
        (e) =>
          e.groupId === groupId &&
          e.authorUserId !== recipientUserId &&
          e.at >= since &&
          e.at < until,
      );
      const posts = inWindow.filter((e) => e.kind === "post");
      const top = [...posts].sort(
        (a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0) || b.at.getTime() - a.at.getTime(),
      )[0];
      return {
        newPosts: posts.length,
        newThreads: inWindow.filter((e) => e.kind === "thread").length,
        newReplies: inWindow.filter((e) => e.kind === "reply").length,
        newMembers: inWindow.filter((e) => e.kind === "join").length,
        topPost: top ? { body: top.body ?? "", likeCount: top.likeCount ?? 0 } : null,
      };
    },
    async lastDeliveryEnd(userId, groupId) {
      const mine = deliveries
        .filter((d) => d.userId === userId && d.groupId === groupId)
        .sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime());
      return mine[0]?.periodEnd ?? null;
    },
    async claimAndNotify(input) {
      const dupe = deliveries.some(
        (d) =>
          d.userId === input.userId &&
          d.groupId === input.groupId &&
          d.periodEnd.getTime() === input.periodEnd.getTime(),
      );
      if (dupe) return false;
      deliveries.push({
        userId: input.userId,
        groupId: input.groupId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        channels: "notification",
      });
      notifications.push({ userId: input.userId, title: input.title, body: input.body, link: input.link });
      return true;
    },
    async setDeliveryChannels(userId, groupId, periodEnd, channels) {
      const d = deliveries.find(
        (x) => x.userId === userId && x.groupId === groupId && x.periodEnd.getTime() === periodEnd.getTime(),
      );
      if (d) d.channels = channels;
    },
  };
  return { store, notifications, deliveries };
}

function membership(userId: string, joinedDaysAgo: number, groupId = GROUP_1): DigestMembership {
  return {
    groupId,
    groupSlug: groupId === GROUP_1 ? "beat-makers" : "video-lab",
    groupName: groupId === GROUP_1 ? "Beat Makers" : "Video Lab",
    userId,
    joinedAt: new Date(NOW.getTime() - joinedDaysAgo * DAY),
  };
}

function ev(kind: RawEvent["kind"], authorUserId: string, daysAgo: number, extra: Partial<RawEvent> = {}): RawEvent {
  return { groupId: GROUP_1, kind, authorUserId, at: new Date(NOW.getTime() - daysAgo * DAY), ...extra };
}

beforeEach(() => {
  __resetGroupDigestThrottle();
});

/* ── Prefs ─────────────────────────────────────────────────────────── */
describe("group digest prefs", () => {
  it("no row yet: the default — on, weekly, bell only (email OFF)", async () => {
    const store = memoryPrefsStore();
    const prefs = await getGroupDigestPrefs(store, USER_A);
    expect(prefs).toEqual(DEFAULT_GROUP_DIGEST_PREFS);
    expect(prefs).toEqual({ enabled: true, frequency: "weekly", email_enabled: false });
  });

  it("a patch merges — sibling switches keep their values", async () => {
    const store = memoryPrefsStore();
    await setGroupDigestPrefs(store, USER_A, { frequency: "daily" });
    const after = await setGroupDigestPrefs(store, USER_A, { email_enabled: true });
    expect(after).toEqual({ enabled: true, frequency: "daily", email_enabled: true });
  });

  it("accounts are isolated", async () => {
    const store = memoryPrefsStore();
    await setGroupDigestPrefs(store, USER_A, { enabled: false });
    expect((await getGroupDigestPrefs(store, USER_B)).enabled).toBe(true);
    expect((await getGroupDigestPrefs(store, USER_A)).enabled).toBe(false);
  });
});

/* ── Pure aggregation / content / due rules ────────────────────────── */
describe("digest content + due rules", () => {
  const empty: GroupActivity = { newPosts: 0, newThreads: 0, newReplies: 0, newMembers: 0, topPost: null };

  it("zero activity builds nothing — empty groups send nothing", () => {
    expect(totalActivity(empty)).toBe(0);
    expect(buildDigestContent("Beat Makers", "weekly", empty)).toBeNull();
  });

  it("counts render with correct singular/plural and the top post line", () => {
    const c = buildDigestContent("Beat Makers", "weekly", {
      newPosts: 1, newThreads: 2, newReplies: 1, newMembers: 3,
      topPost: { body: "my new beat tape is out", likeCount: 7 },
    });
    expect(c?.title).toBe("Beat Makers — your weekly digest");
    expect(c?.body).toContain("1 new post");
    expect(c?.body).toContain("2 new forum threads");
    expect(c?.body).toContain("1 forum reply");
    expect(c?.body).toContain("3 new members");
    expect(c?.body).toContain("“my new beat tape is out” (7 likes)");
  });

  it("a top post with zero likes earns no 'most liked' line", () => {
    const c = buildDigestContent("Beat Makers", "daily", {
      ...empty, newPosts: 1, topPost: { body: "hi", likeCount: 0 },
    });
    expect(c?.title).toContain("daily");
    expect(c?.body).not.toContain("Most liked");
  });

  it("due only after a full window: daily 24h, weekly 7d", () => {
    const since = new Date(NOW.getTime() - DAY + 60_000);
    expect(isDigestDue(NOW, since, "daily")).toBe(false);
    expect(isDigestDue(NOW, new Date(NOW.getTime() - DAY), "daily")).toBe(true);
    expect(isDigestDue(NOW, new Date(NOW.getTime() - 6 * DAY), "weekly")).toBe(false);
    expect(isDigestDue(NOW, new Date(NOW.getTime() - 7 * DAY), "weekly")).toBe(true);
  });
});

/* ── The sweep ─────────────────────────────────────────────────────── */
describe("group digest sweep", () => {
  it("aggregates a week of other members' activity into one bell digest per group", async () => {
    const prefs = memoryPrefsStore();
    const { store, notifications, deliveries } = memoryDigestStore(
      [membership(USER_A, 30)],
      [
        ev("post", USER_B, 2, { body: "new beat tape", likeCount: 9 }),
        ev("post", USER_C, 1, { body: "second post", likeCount: 2 }),
        ev("thread", USER_B, 3),
        ev("reply", USER_C, 3),
        ev("reply", USER_B, 2),
        ev("join", USER_C, 4),
      ],
    );
    const s = await runGroupDigestSweep({ force: true, deps: { prefsStore: prefs, store, now: NOW } });
    expect(s).toMatchObject({ error: false, sent: 1, emailed: 0, checked: 1 });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ userId: USER_A, link: "/groups/beat-makers" });
    expect(notifications[0].title).toBe("Beat Makers — your weekly digest");
    expect(notifications[0].body).toContain("2 new posts");
    expect(notifications[0].body).toContain("1 new forum thread");
    expect(notifications[0].body).toContain("2 forum replies");
    expect(notifications[0].body).toContain("1 new member");
    expect(notifications[0].body).toContain("“new beat tape” (9 likes)");
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].channels).toBe("notification");
  });

  it("opt-out is honored: enabled=false sends nothing, ever", async () => {
    const prefs = memoryPrefsStore();
    await setGroupDigestPrefs(prefs, USER_A, { enabled: false });
    const { store, notifications, deliveries } = memoryDigestStore(
      [membership(USER_A, 30)],
      [ev("post", USER_B, 1, { body: "loud", likeCount: 5 })],
    );
    const s = await runGroupDigestSweep({ force: true, deps: { prefsStore: prefs, store, now: NOW } });
    expect(s.sent).toBe(0);
    expect(notifications).toHaveLength(0);
    expect(deliveries).toHaveLength(0);
  });

  it("empty group sends nothing and does NOT advance the high-water mark", async () => {
    const prefs = memoryPrefsStore();
    const world = memoryDigestStore([membership(USER_A, 30)], []);
    const s1 = await runGroupDigestSweep({ force: true, deps: { prefsStore: prefs, store: world.store, now: NOW } });
    expect(s1.sent).toBe(0);
    expect(world.deliveries).toHaveLength(0);
    // Activity arrives later; the next digest still covers it in full.
    const world2 = memoryDigestStore(
      [membership(USER_A, 30)],
      [ev("post", USER_B, 0.5, { body: "late drop", likeCount: 1 })],
    );
    world2.deliveries.push(...world.deliveries);
    const later = new Date(NOW.getTime() + DAY);
    const s2 = await runGroupDigestSweep({ force: true, deps: { prefsStore: prefs, store: world2.store, now: later } });
    expect(s2.sent).toBe(1);
    expect(world2.notifications[0].body).toContain("1 new post");
  });

  it("the member's OWN activity alone sends nothing", async () => {
    const prefs = memoryPrefsStore();
    const { store, notifications } = memoryDigestStore(
      [membership(USER_A, 30)],
      [ev("post", USER_A, 1, { body: "mine", likeCount: 50 }), ev("thread", USER_A, 1)],
    );
    const s = await runGroupDigestSweep({ force: true, deps: { prefsStore: prefs, store, now: NOW } });
    expect(s.sent).toBe(0);
    expect(notifications).toHaveLength(0);
  });

  it("frequency gates the window: joined 2 days ago — weekly silent, daily sends", async () => {
    const prefs = memoryPrefsStore();
    const events = [ev("post", USER_B, 1, { body: "fresh", likeCount: 3 })];
    const weekly = memoryDigestStore([membership(USER_A, 2)], events);
    const s1 = await runGroupDigestSweep({ force: true, deps: { prefsStore: prefs, store: weekly.store, now: NOW } });
    expect(s1.sent).toBe(0);

    await setGroupDigestPrefs(prefs, USER_A, { frequency: "daily" });
    const daily = memoryDigestStore([membership(USER_A, 2)], events);
    const s2 = await runGroupDigestSweep({ force: true, deps: { prefsStore: prefs, store: daily.store, now: NOW } });
    expect(s2.sent).toBe(1);
    expect(daily.notifications[0].title).toContain("daily");
  });

  it("a brand-new member is never instantly spammed", async () => {
    const prefs = memoryPrefsStore();
    await setGroupDigestPrefs(prefs, USER_A, { frequency: "daily" });
    const { store, notifications } = memoryDigestStore(
      [membership(USER_A, 0.04)], // joined ~1 hour ago
      [ev("post", USER_B, 0.02, { body: "busy group", likeCount: 4 })],
    );
    const s = await runGroupDigestSweep({ force: true, deps: { prefsStore: prefs, store, now: NOW } });
    expect(s.sent).toBe(0);
    expect(notifications).toHaveLength(0);
  });

  it("activity from BEFORE the member joined is not counted", async () => {
    const prefs = memoryPrefsStore();
    await setGroupDigestPrefs(prefs, USER_A, { frequency: "daily" });
    const { store, notifications } = memoryDigestStore(
      [membership(USER_A, 2)],
      [
        ev("post", USER_B, 5, { body: "ancient", likeCount: 99 }), // before join
        ev("post", USER_B, 1, { body: "recent", likeCount: 1 }),
      ],
    );
    const s = await runGroupDigestSweep({ force: true, deps: { prefsStore: prefs, store, now: NOW } });
    expect(s.sent).toBe(1);
    expect(notifications[0].body).toContain("1 new post");
    expect(notifications[0].body).not.toContain("ancient");
  });

  it("exactly once: an immediate second pass sends nothing again", async () => {
    const prefs = memoryPrefsStore();
    const { store, notifications, deliveries } = memoryDigestStore(
      [membership(USER_A, 30)],
      [ev("post", USER_B, 2, { body: "once", likeCount: 5 })],
    );
    const deps = { prefsStore: prefs, store, now: NOW };
    expect((await runGroupDigestSweep({ force: true, deps })).sent).toBe(1);
    expect((await runGroupDigestSweep({ force: true, deps })).sent).toBe(0);
    expect(notifications).toHaveLength(1);
    expect(deliveries).toHaveLength(1);
    // And the ledger itself refuses a duplicate claim for the same period.
    const again = await store.claimAndNotify({
      userId: USER_A, groupId: GROUP_1,
      periodStart: new Date(NOW.getTime() - 7 * DAY), periodEnd: NOW,
      title: "dupe", body: "dupe", link: "/groups/beat-makers",
    });
    expect(again).toBe(false);
    expect(notifications).toHaveLength(1);
  });

  it("per-group: a member of two active groups gets one digest per group", async () => {
    const prefs = memoryPrefsStore();
    const events = [
      ev("post", USER_B, 1, { body: "g1", likeCount: 1 }),
      { ...ev("post", USER_C, 1, { body: "g2", likeCount: 1 }), groupId: GROUP_2 },
    ];
    const { store, notifications } = memoryDigestStore(
      [membership(USER_A, 30, GROUP_1), membership(USER_A, 30, GROUP_2)],
      events,
    );
    const s = await runGroupDigestSweep({ force: true, deps: { prefsStore: prefs, store, now: NOW } });
    expect(s.sent).toBe(2);
    expect(notifications.map((n) => n.link).sort()).toEqual(["/groups/beat-makers", "/groups/video-lab"]);
  });

  it("email: opt-in + configured + rail-confirmed send is recorded as notification+email", async () => {
    const prefs = memoryPrefsStore();
    await setGroupDigestPrefs(prefs, USER_A, { email_enabled: true });
    const { store, deliveries } = memoryDigestStore(
      [membership(USER_A, 30)],
      [ev("post", USER_B, 1, { body: "mail me", likeCount: 2 })],
    );
    const sentMail: unknown[] = [];
    const s = await runGroupDigestSweep({
      force: true,
      deps: {
        prefsStore: prefs, store, now: NOW,
        emailConfigured: () => true,
        resolveEmail: async () => "member@example.com",
        sendEmailFn: async (opts) => { sentMail.push(opts); return { sent: true, id: "re_1" }; },
      },
    });
    expect(s).toMatchObject({ sent: 1, emailed: 1 });
    expect(sentMail).toHaveLength(1);
    expect(deliveries[0].channels).toBe("notification+email");
  });

  it("email: without a provider key the rail is never claimed — ledger stays 'notification'", async () => {
    const prefs = memoryPrefsStore();
    await setGroupDigestPrefs(prefs, USER_A, { email_enabled: true });
    const { store, deliveries } = memoryDigestStore(
      [membership(USER_A, 30)],
      [ev("post", USER_B, 1, { body: "bell only", likeCount: 2 })],
    );
    let calls = 0;
    const s = await runGroupDigestSweep({
      force: true,
      deps: {
        prefsStore: prefs, store, now: NOW,
        emailConfigured: () => false, // RESEND_API_KEY absent (production email sender fails closed)
        resolveEmail: async () => "member@example.com",
        sendEmailFn: async () => { calls++; return { sent: false, reason: "no-provider" }; },
      },
    });
    expect(s).toMatchObject({ sent: 1, emailed: 0 });
    expect(calls).toBe(0);
    expect(deliveries[0].channels).toBe("notification");
  });

  it("email: a failed send is not recorded as emailed", async () => {
    const prefs = memoryPrefsStore();
    await setGroupDigestPrefs(prefs, USER_A, { email_enabled: true });
    const { store, deliveries } = memoryDigestStore(
      [membership(USER_A, 30)],
      [ev("post", USER_B, 1, { body: "will fail", likeCount: 2 })],
    );
    const s = await runGroupDigestSweep({
      force: true,
      deps: {
        prefsStore: prefs, store, now: NOW,
        emailConfigured: () => true,
        resolveEmail: async () => "member@example.com",
        sendEmailFn: async () => ({ sent: false, reason: "provider-error" }),
      },
    });
    expect(s).toMatchObject({ sent: 1, emailed: 0 });
    expect(deliveries[0].channels).toBe("notification");
  });

  it("email: not opted in means no email attempt even when configured", async () => {
    const prefs = memoryPrefsStore(); // default email_enabled=false
    const { store } = memoryDigestStore(
      [membership(USER_A, 30)],
      [ev("post", USER_B, 1, { body: "quiet", likeCount: 2 })],
    );
    let calls = 0;
    const s = await runGroupDigestSweep({
      force: true,
      deps: {
        prefsStore: prefs, store, now: NOW,
        emailConfigured: () => true,
        resolveEmail: async () => "member@example.com",
        sendEmailFn: async () => { calls++; return { sent: true }; },
      },
    });
    expect(s).toMatchObject({ sent: 1, emailed: 0 });
    expect(calls).toBe(0);
  });

  it("fails closed: unreadable prefs abort the pass and send nothing", async () => {
    const brokenPrefs: GroupDigestPrefsStore = {
      async getRow() { throw new Error("relation group_digest_prefs does not exist"); },
      async upsertRow() { /* unreachable */ },
    };
    const { store, notifications } = memoryDigestStore(
      [membership(USER_A, 30)],
      [ev("post", USER_B, 1, { body: "never sent", likeCount: 2 })],
    );
    const s = await runGroupDigestSweep({ force: true, deps: { prefsStore: brokenPrefs, store, now: NOW } });
    expect(s.error).toBe(true);
    expect(s.sent).toBe(0);
    expect(notifications).toHaveLength(0);
  });
});
