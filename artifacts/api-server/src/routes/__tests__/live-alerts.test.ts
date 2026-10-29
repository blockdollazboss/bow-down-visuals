/**
 * Go-live alert fan-out tests (lib/live-alerts):
 * one in-app notification per follower per stream, deep link to the
 * watch page, and a second fan-out for the same stream notifying
 * nobody twice (the deliveries ledger is the dedupe gate). Push is
 * mocked to count attempts without sending anything.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const CREATOR = "00000000-0000-4000-8000-0000000000aa";
const FAN1 = "00000000-0000-4000-8000-0000000000bb";
const FAN2 = "00000000-0000-4000-8000-0000000000cc";
const PROFILE = "11111111-1111-4111-8111-111111111111";
const STREAM = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  follows: [] as Array<Record<string, unknown>>,
  deliveries: [] as Array<Record<string, unknown>>,
  notifications: [] as Array<Record<string, unknown>>,
  prefs: [] as Array<Record<string, unknown>>,
  pushCalls: [] as string[],
}));

const dialect = new PgDialect();
function parseEq(cond: unknown): Array<[string, unknown]> {
  const q = dialect.sqlToQuery(cond as never);
  const out: Array<[string, unknown]> = [];
  for (const m of q.sql.matchAll(/"(\w+)" = \$(\d+)/g)) out.push([m[1], q.params[Number(m[2]) - 1]]);
  return out;
}
function matches(row: Record<string, unknown>, cond: unknown): boolean {
  const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  return parseEq(cond).every(
    ([col, val]) => String(row[col] ?? row[camel(col)] ?? "") === String(val ?? ""),
  );
}

vi.mock("../../lib/push", () => ({
  sendPushToUser: async (userId: string) => {
    h.pushCalls.push(userId);
    return { sent: 1, pruned: 0, failed: 0, skippedReason: null };
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { followsTable, notificationsTable, liveGoLiveDeliveriesTable, pushNotificationPrefsTable } = actual;
  const tableOf = (t: unknown) =>
    t === followsTable
      ? "follows"
      : t === notificationsTable
        ? "notifications"
        : t === liveGoLiveDeliveriesTable
          ? "deliveries"
          : t === pushNotificationPrefsTable
            ? "prefs"
            : "?";
  const rowsOf = (kind: string) =>
    kind === "follows"
      ? h.follows
      : kind === "notifications"
        ? h.notifications
        : kind === "prefs"
          ? h.prefs
          : h.deliveries;

  const db = {
    select: (fields?: Record<string, { name: string }>) => ({
      from: (table: unknown) => {
        const kind = tableOf(table);
        let cond: unknown;
        const run = () => {
          const rows = rowsOf(kind).filter((r) => (cond ? matches(r, cond) : true));
          if (!fields) return rows.map((r) => ({ ...r }));
          const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
          return rows.map((r) => {
            const out: Record<string, unknown> = {};
            for (const [key, col] of Object.entries(fields)) out[key] = r[camel(col.name)] ?? r[col.name] ?? null;
            return out;
          });
        };
        const self: any = {
          where: (c: unknown) => {
            cond = c;
            return self;
          },
          limit: () => self,
          then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
        };
        return self;
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const kind = tableOf(table);
        const self: any = {
          onConflictDoNothing: () => self,
          returning: async () => {
            if (kind === "deliveries") {
              const dupe = h.deliveries.some(
                (d) => d.stream_id === values.stream_id && d.follower_user_id === values.follower_user_id,
              );
              if (dupe) return [];
              const row = { ...values, created_at: new Date() };
              h.deliveries.push(row);
              return [row];
            }
            const row = { id: `row-${rowsOf(kind).length + 1}`, created_at: new Date(), ...values };
            rowsOf(kind).push(row);
            return [row];
          },
          then: (res: any, rej: any) => {
            if (kind === "notifications") {
              const row = { id: `row-${h.notifications.length + 1}`, createdAt: new Date(), ...values };
              h.notifications.push(row);
            }
            return Promise.resolve([]).then(res, rej);
          },
        };
        return self;
      },
    }),
  };
  return { ...actual, db };
});

import { fanOutGoLiveAlerts } from "../../lib/live-alerts";

const stream = { id: STREAM, user_id: CREATOR, profile_id: PROFILE, title: "Friday Night Live" } as any;
const creator = { displayName: "King Live", slug: "king" };

beforeEach(() => {
  h.follows = [
    { followerUserId: FAN1, profileId: PROFILE },
    { followerUserId: FAN2, profileId: PROFILE },
    { followerUserId: CREATOR, profileId: PROFILE }, // self-follow rows never alert the creator
  ];
  h.deliveries = [];
  h.notifications = [];
  h.prefs = [];
  h.pushCalls = [];
});

describe("fanOutGoLiveAlerts", () => {
  it("notifies each follower once, with honest copy and the watch-page link", async () => {
    const result = await fanOutGoLiveAlerts(stream, creator);
    expect(result.followers).toBe(2);
    expect(result.notified).toBe(2);
    /* +1 push since push wiring #9: the streamer's self-confirmation. */
    expect(result.pushSent).toBe(3);
    const followerNotes = h.notifications.filter((n) => n.userId !== CREATOR);
    expect(followerNotes).toHaveLength(2);
    for (const n of followerNotes) {
      expect(n).toMatchObject({
        kind: "live",
        title: "King Live is live: Friday Night Live",
        link: `/live/${STREAM}`,
      });
    }
    expect(h.pushCalls.sort()).toEqual([CREATOR, FAN1, FAN2].sort());
  });

  it("a second fan-out for the same stream notifies nobody again", async () => {
    await fanOutGoLiveAlerts(stream, creator);
    const second = await fanOutGoLiveAlerts(stream, creator);
    expect(second.notified).toBe(0);
    expect(second.alreadyDelivered).toBe(2);
    expect(second.selfNotified).toBe(false);
    expect(h.notifications).toHaveLength(3);
    expect(h.pushCalls).toHaveLength(3);
  });

  it("a follower with live push switched off still gets the bell row, never the ping", async () => {
    h.prefs = [
      {
        userId: FAN2,
        moneyEnabled: true,
        messagesEnabled: true,
        liveEnabled: false,
        mentionsEnabled: true,
        socialEnabled: false,
      },
    ];
    const result = await fanOutGoLiveAlerts(stream, creator);
    expect(result.notified).toBe(2);
    /* FAN1's ping + the streamer's self-confirm ping (no prefs row =
       defaults, live on). FAN2's ping is the only one silenced. */
    expect(result.pushSent).toBe(2);
    expect(h.notifications).toHaveLength(3);
    expect(h.pushCalls.sort()).toEqual([CREATOR, FAN1].sort());
  });

  it("a creator with no followers still gets their own confirmation — and only that", async () => {
    h.follows = [];
    const result = await fanOutGoLiveAlerts(stream, creator);
    expect(result).toMatchObject({ followers: 0, notified: 0, selfNotified: true });
    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0]).toMatchObject({ userId: CREATOR, kind: "live" });
  });
});

describe("go-live self-confirmation (push wiring #9)", () => {
  it("the streamer gets a 'You're live' bell + ping, exactly once across repeat fires", async () => {
    const first = await fanOutGoLiveAlerts(stream, creator);
    expect(first.selfNotified).toBe(true);
    const self = h.notifications.find((n) => n.userId === CREATOR);
    expect(self).toMatchObject({
      kind: "live",
      title: "You're live: Friday Night Live",
      link: `/live/${STREAM}`,
    });
    expect(h.pushCalls.filter((u) => u === CREATOR)).toHaveLength(1);
    const second = await fanOutGoLiveAlerts(stream, creator);
    expect(second.selfNotified).toBe(false);
    expect(h.notifications.filter((n) => n.userId === CREATOR)).toHaveLength(1);
    expect(h.pushCalls.filter((u) => u === CREATOR)).toHaveLength(1);
  });

  it("a streamer with live push off gets the self bell but no self ping", async () => {
    h.prefs = [
      {
        userId: CREATOR,
        moneyEnabled: true,
        messagesEnabled: true,
        liveEnabled: false,
        mentionsEnabled: true,
        socialEnabled: false,
      },
    ];
    const result = await fanOutGoLiveAlerts(stream, creator);
    expect(result.selfNotified).toBe(true);
    expect(h.notifications.some((n) => n.userId === CREATOR)).toBe(true);
    expect(h.pushCalls).not.toContain(CREATOR);
    expect(h.pushCalls.sort()).toEqual([FAN1, FAN2].sort());
  });
});
