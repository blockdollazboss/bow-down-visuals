/**
 * Cloud Operator Phase 2, Lane G — the automatic duties, tested
 * against the real modules with an in-memory duties store (the
 * house scheduler-test shape: drive the class directly, no
 * intervals), the real contest announcer hook, the real
 * CourtSeasonScheduler, and — for the default store — the shared
 * fake db over the real tables.
 *
 * The pins (owner law, Oct 20 — "he managed the peace in the room"):
 *  - a duty NEVER punishes: the flag scan's only mutations are one
 *    content_reports row + one audit row; nothing else is touched
 *  - every firing writes an operator_actions row with channel
 *    'automatic'; a suppressed firing (switch off, dedupe, cap)
 *    writes nothing and does nothing
 *  - master + per-duty switches still their duties independently
 *  - caps hold: one reminder per event, one herald per decision /
 *    settling, duty announcements stand a palace-ear interval
 *    apart, one flag per member per window
 *  - heralds announce only what the settlement already decided:
 *    contest winners the host named, the court's frozen standings
 *  - the court SETTLEMENT is never gated — the gate governs only
 *    the sound of its herald
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const HOUSE = "00000000-0000-4000-8000-000000000001";
const HOST = "00000000-0000-4000-8000-0000000000a1";
const MEMBER = "00000000-0000-4000-8000-0000000000b1";
const R1 = "00000000-0000-4000-8000-0000000000c1";
const R2 = "00000000-0000-4000-8000-0000000000c2";
const R3 = "00000000-0000-4000-8000-0000000000c3";

const h = vi.hoisted(() => ({ fake: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("../../routes/__tests__/_reach-fake-db");
  const fake = createFakeDb(
    {
      operatorActions: actual.operatorActionsTable,
      contentReports: actual.contentReportsTable,
      worldEvents: actual.worldEventsTable,
      creatorProfiles: actual.creatorProfilesTable,
    },
    { contentReports: [["reporterUserId", "targetType", "targetId"]] },
    {
      contentReports: (row: any) =>
        row.status === "new" || row.status === "reviewing",
    },
  );
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import {
  OperatorDuties,
  heraldContestWinners,
  gateCourtSeasonHerald,
  operatorDutiesEnabled,
  operatorDutyEnabled,
  DUTY_TOOL_IDS,
  type OperatorDutiesStore,
} from "../operator-duties";
import {
  registerWorldContestAnnouncer,
  contestWinnersAnnouncement,
} from "../world-contests";
import {
  CourtSeasonScheduler,
  seasonSpan,
  type CourtSeasonStore,
} from "../world-court-season";
import type { PalaceAnnouncement } from "../world-room";

/* ── Env control ────────────────────────────────────────────────────── */

const DUTY_ENVS = [
  "OPERATOR_DUTIES_ENABLED",
  "OPERATOR_DUTY_HOST_REMINDERS_ENABLED",
  "OPERATOR_DUTY_WINNER_HERALDS_ENABLED",
  "OPERATOR_DUTY_TROUBLE_FLAGGING_ENABLED",
];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const name of DUTY_ENVS) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
  registerWorldContestAnnouncer(null);
});

afterEach(() => {
  for (const name of DUTY_ENVS) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
  registerWorldContestAnnouncer(null);
});

/* ── The in-memory duties store ─────────────────────────────────────── */

let seq = 0;
const nextId = () =>
  `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

class FakeDutiesStore implements OperatorDutiesStore {
  events: any[] = [];
  profiles = new Map<string, { id: string; displayName: string; slug: string | null }>();
  actions: any[] = [];
  reports: any[] = [];
  /** Every mutating call, in order — the "touches nothing else" log. */
  mutations: string[] = [];

  async listOpenEvents() {
    return this.events;
  }
  async hostProfile(userId: string) {
    const p = this.profiles.get(userId);
    return p ? { displayName: p.displayName, slug: p.slug } : null;
  }
  async actionsSince(since: Date) {
    return this.actions.filter((a) => new Date(a.createdAt) >= since);
  }
  async actionsFor(toolId: string, target: string) {
    return this.actions.filter((a) => a.toolId === toolId && a.target === target);
  }
  async insertAction(row: any) {
    this.mutations.push("insertAction");
    this.actions.push({ id: nextId(), createdAt: new Date(), ...row });
  }
  async reportsSince(since: Date) {
    return this.reports.filter((r) => new Date(r.createdAt) >= since);
  }
  async memberProfile(userId: string) {
    const p = this.profiles.get(userId);
    return p ? { id: p.id, displayName: p.displayName } : null;
  }
  async findOpenReport(reporterUserId: string, targetType: string, targetId: string) {
    return (
      this.reports.find(
        (r) =>
          r.reporterUserId === reporterUserId &&
          r.targetType === targetType &&
          r.targetId === targetId &&
          (r.status === "new" || r.status === "reviewing"),
      ) ?? null
    );
  }
  async insertReport(values: any) {
    /* Mirror the partial unique index: one OPEN report per
       (reporter, target) — a duplicate insert is refused. */
    if (await this.findOpenReport(values.reporterUserId, values.targetType, values.targetId)) {
      return null;
    }
    this.mutations.push("insertReport");
    const row = { id: nextId(), status: "new", createdAt: new Date(), ...values };
    this.reports.push(row);
    return row;
  }

  seedAction(row: any) {
    this.actions.push({ id: nextId(), createdAt: new Date(), result: "done", ...row });
  }
  seedReport(row: any) {
    this.reports.push({
      id: nextId(),
      status: "new",
      createdAt: new Date(),
      targetType: "post",
      targetId: nextId(),
      targetSummary: "",
      note: null,
      ...row,
    });
  }
}

function fakePalace() {
  const announcements: PalaceAnnouncement[] = [];
  return {
    announcements,
    palace: {
      announce: (a: PalaceAnnouncement) => {
        announcements.push(a);
      },
    },
  };
}

function makeEvent(partial: any = {}) {
  return {
    id: nextId(),
    kind: "stage_show",
    roomId: "world:kings-hall",
    hostUserId: HOST,
    title: "Friday Night Live",
    startsAt: new Date(Date.now() + 10 * 60_000),
    endsAt: new Date(Date.now() + 70 * 60_000),
    payload: {},
    status: "scheduled",
    createdAt: new Date(),
    ...partial,
  };
}

/* ── The switches ───────────────────────────────────────────────────── */

describe("the duty switches", () => {
  it("default on — master and every duty", () => {
    expect(operatorDutiesEnabled()).toBe(true);
    expect(operatorDutyEnabled("host_reminders")).toBe(true);
    expect(operatorDutyEnabled("winner_heralds")).toBe(true);
    expect(operatorDutyEnabled("trouble_flagging")).toBe(true);
  });

  it("the master switch stills every duty at once", () => {
    process.env["OPERATOR_DUTIES_ENABLED"] = "off";
    expect(operatorDutiesEnabled()).toBe(false);
    expect(operatorDutyEnabled("host_reminders")).toBe(false);
    expect(operatorDutyEnabled("winner_heralds")).toBe(false);
    expect(operatorDutyEnabled("trouble_flagging")).toBe(false);
  });

  it("a per-duty switch stills only its own duty", () => {
    process.env["OPERATOR_DUTY_TROUBLE_FLAGGING_ENABLED"] = "0";
    expect(operatorDutyEnabled("trouble_flagging")).toBe(false);
    expect(operatorDutyEnabled("host_reminders")).toBe(true);
    expect(operatorDutyEnabled("winner_heralds")).toBe(true);
  });
});

/* ── Duty 1: host reminders ─────────────────────────────────────────── */

describe("host reminders", () => {
  it("fires once for an event starting inside the lead window, audited as automatic", async () => {
    const store = new FakeDutiesStore();
    const event = makeEvent();
    store.events.push(event);
    store.profiles.set(HOST, { id: nextId(), displayName: "Hostess", slug: "hostess" });
    const { palace, announcements } = fakePalace();
    const duties = new OperatorDuties({ palace, store });

    const fired = await duties.runHostReminders(new Date());
    expect(fired).toBe(1);
    expect(announcements).toHaveLength(1);
    expect(announcements[0]!.kind).toBe("show");
    expect(announcements[0]!.text).toContain("Friday Night Live");
    expect(announcements[0]!.text.length).toBeLessThanOrEqual(140);

    expect(store.actions).toHaveLength(1);
    const row = store.actions[0];
    expect(row.channel).toBe("automatic");
    expect(row.toolId).toBe(DUTY_TOOL_IDS.hostReminder);
    expect(row.userId).toBe(HOST);
    expect(row.target).toBe(`event:${event.id}`);
    expect(row.result).toBe("done");
    expect(row.tier).toBe(0);
    expect(row.priceCharged).toBeNull();

    /* And never twice for the same event. */
    const again = await duties.runHostReminders(new Date());
    expect(again).toBe(0);
    expect(announcements).toHaveLength(1);
  });

  it("stays silent for an event beyond the lead window", async () => {
    const store = new FakeDutiesStore();
    store.events.push(makeEvent({ startsAt: new Date(Date.now() + 2 * 3600_000) }));
    const { palace, announcements } = fakePalace();
    const duties = new OperatorDuties({ palace, store });
    expect(await duties.runHostReminders(new Date())).toBe(0);
    expect(announcements).toHaveLength(0);
    expect(store.actions).toHaveLength(0);
  });

  it("stays silent for contests (their start is their creation) and for live/cancelled events", async () => {
    const store = new FakeDutiesStore();
    store.events.push(makeEvent({ kind: "contest" }));
    store.events.push(makeEvent({ status: "live" }));
    store.events.push(makeEvent({ status: "cancelled" }));
    const { palace, announcements } = fakePalace();
    const duties = new OperatorDuties({ palace, store });
    expect(await duties.runHostReminders(new Date())).toBe(0);
    expect(announcements).toHaveLength(0);
  });

  it("is silent when its switch — or the master — is off, and writes nothing", async () => {
    const store = new FakeDutiesStore();
    store.events.push(makeEvent());
    const { palace, announcements } = fakePalace();
    const duties = new OperatorDuties({ palace, store });

    process.env["OPERATOR_DUTY_HOST_REMINDERS_ENABLED"] = "false";
    expect(await duties.runHostReminders(new Date())).toBe(0);

    delete process.env["OPERATOR_DUTY_HOST_REMINDERS_ENABLED"];
    process.env["OPERATOR_DUTIES_ENABLED"] = "0";
    expect(await duties.runHostReminders(new Date())).toBe(0);

    expect(announcements).toHaveLength(0);
    expect(store.actions).toHaveLength(0);
  });

  it("holds the palace-ear cap: two events in one window sound one reminder per interval", async () => {
    const store = new FakeDutiesStore();
    const first = makeEvent({ title: "First Show" });
    const second = makeEvent({
      title: "Second Show",
      startsAt: new Date(Date.now() + 12 * 60_000),
    });
    store.events.push(first, second);
    const { palace, announcements } = fakePalace();
    const duties = new OperatorDuties({ palace, store });

    expect(await duties.runHostReminders(new Date())).toBe(1);
    expect(announcements).toHaveLength(1);
    expect(announcements[0]!.text).toContain("First Show");

    /* Same minute: the shared interval still stands — silent. */
    expect(await duties.runHostReminders(new Date())).toBe(0);
    expect(announcements).toHaveLength(1);

    /* Age the first firing past the interval: the second event
       (still inside its lead window) now sounds. */
    store.actions[0].createdAt = new Date(Date.now() - 61_000);
    expect(await duties.runHostReminders(new Date())).toBe(1);
    expect(announcements).toHaveLength(2);
    expect(announcements[1]!.text).toContain("Second Show");
  });
});

/* ── Duty 2a: contest winner heralds ────────────────────────────────── */

const CONTEST = { id: "", hostUserId: HOST, title: "Beat Battle Royale" };
const WINNERS = [
  { id: "w1", entryId: "e1", userId: MEMBER, place: 1, winnerName: "Nova", workKind: "track" as const, workTitle: "Midnight Run", decidedAt: new Date().toISOString() },
  { id: "w2", entryId: "e2", userId: R1, place: 2, winnerName: "Pax", workKind: "video" as const, workTitle: "Roof Tops", decidedAt: new Date().toISOString() },
];

function contestAnnouncement() {
  const a = contestWinnersAnnouncement(
    { title: CONTEST.title, roomId: "world:music-hall" },
    WINNERS,
  );
  expect(a).not.toBeNull();
  return a!;
}

describe("contest winner heralds", () => {
  it("announces the winners the host decided, exactly once, audited", async () => {
    const store = new FakeDutiesStore();
    const spoken: PalaceAnnouncement[] = [];
    registerWorldContestAnnouncer((a) => spoken.push(a));
    const contest = { ...CONTEST, id: nextId() };
    const announcement = contestAnnouncement();

    const fired = await heraldContestWinners({ contest, winners: WINNERS, announcement, store });
    expect(fired).toBe(true);
    expect(spoken).toEqual([announcement]);

    expect(store.actions).toHaveLength(1);
    const row = store.actions[0];
    expect(row.channel).toBe("automatic");
    expect(row.toolId).toBe(DUTY_TOOL_IDS.winnerHerald);
    expect(row.userId).toBe(HOST);
    expect(row.target).toBe(`contest:${contest.id}`);
    expect(row.summary).toContain("Nova takes first");

    /* The decision stands once — a repeat hook call stays silent. */
    const again = await heraldContestWinners({ contest, winners: WINNERS, announcement, store });
    expect(again).toBe(false);
    expect(spoken).toHaveLength(1);
  });

  it("is silent when the herald switch is off — the Winners' Circle rows still stand", async () => {
    const store = new FakeDutiesStore();
    const spoken: PalaceAnnouncement[] = [];
    registerWorldContestAnnouncer((a) => spoken.push(a));
    process.env["OPERATOR_DUTY_WINNER_HERALDS_ENABLED"] = "off";
    const fired = await heraldContestWinners({
      contest: { ...CONTEST, id: nextId() },
      winners: WINNERS,
      announcement: contestAnnouncement(),
      store,
    });
    expect(fired).toBe(false);
    expect(spoken).toHaveLength(0);
    expect(store.actions).toHaveLength(0);
  });

  it("does not audit a herald the palace never spoke (announcer unwired)", async () => {
    const store = new FakeDutiesStore();
    registerWorldContestAnnouncer(null);
    const fired = await heraldContestWinners({
      contest: { ...CONTEST, id: nextId() },
      winners: WINNERS,
      announcement: contestAnnouncement(),
      store,
    });
    expect(fired).toBe(false);
    expect(store.actions).toHaveLength(0);
  });

  it("yields to the palace-ear cap when another duty just announced", async () => {
    const store = new FakeDutiesStore();
    store.seedAction({
      toolId: DUTY_TOOL_IDS.hostReminder,
      target: "event:whatever",
      userId: HOST,
      channel: "automatic",
    });
    const spoken: PalaceAnnouncement[] = [];
    registerWorldContestAnnouncer((a) => spoken.push(a));
    const fired = await heraldContestWinners({
      contest: { ...CONTEST, id: nextId() },
      winners: WINNERS,
      announcement: contestAnnouncement(),
      store,
    });
    expect(fired).toBe(false);
    expect(spoken).toHaveLength(0);
    expect(store.actions).toHaveLength(1); // only the seeded row
  });
});

/* ── Duty 2b: the Court Season herald gate ──────────────────────────── */

describe("the court season herald gate", () => {
  const season = seasonSpan(1);

  it("allows the settling herald once and audits it under the house", async () => {
    const store = new FakeDutiesStore();
    const outcome = { standings: [{ displayName: "Nova" }] };
    expect(await gateCourtSeasonHerald({ season, outcome, store })).toBe(true);
    expect(store.actions).toHaveLength(1);
    const row = store.actions[0];
    expect(row.channel).toBe("automatic");
    expect(row.toolId).toBe(DUTY_TOOL_IDS.winnerHerald);
    expect(row.userId).toBe(HOUSE);
    expect(row.target).toBe(`season:${season.seasonKey}`);
    expect(row.summary).toContain("Nova leads the court");

    /* One season, one herald — the gate dedupes behind the
       settlement row's own once-only record. */
    expect(await gateCourtSeasonHerald({ season, outcome, store })).toBe(false);
    expect(store.actions).toHaveLength(1);
  });

  it("refuses when the herald switch is off, and writes nothing", async () => {
    const store = new FakeDutiesStore();
    process.env["OPERATOR_DUTY_WINNER_HERALDS_ENABLED"] = "0";
    expect(
      await gateCourtSeasonHerald({
        season,
        outcome: { standings: [{ displayName: "Nova" }] },
        store,
      }),
    ).toBe(false);
    expect(store.actions).toHaveLength(0);
  });

  it("through the real scheduler: the settlement lands either way — the gate governs only the sound", async () => {
    class FakeCourtStore implements CourtSeasonStore {
      settlements = new Map<string, any>();
      async getSettlement(key: string) {
        return this.settlements.get(key) ?? null;
      }
      async listSettlements() {
        return [...this.settlements.values()];
      }
      async markSettled(row: any) {
        if (this.settlements.has(row.seasonKey)) return false;
        this.settlements.set(row.seasonKey, row);
        return true;
      }
      async seasonStandings() {
        return [
          {
            userId: MEMBER,
            displayName: "Nova",
            slug: "nova",
            counts: {
              publishedTracks: 2, publishedVideos: 0, exports: 0,
              followers: 0, streamsHosted: 0, tipsReceived: 0,
              sales: 0, membershipsSold: 0,
            },
          },
        ];
      }
      async lifetimeRank() {
        return { stars: 3, title: "Gangster" };
      }
    }

    const seasonOne = seasonSpan(1);
    const nov = new Date("2026-11-02T00:00:00.000Z").getTime();

    /* Duty on: settles AND heralds, with the audit row written. */
    const dutiesStore = new FakeDutiesStore();
    const onPalace = fakePalace();
    const onStore = new FakeCourtStore();
    const onScheduler = new CourtSeasonScheduler({
      palace: onPalace.palace,
      store: onStore as any,
      heraldGate: ({ season: s, outcome }) =>
        gateCourtSeasonHerald({ season: s, outcome, store: dutiesStore }),
    });
    await onScheduler.tick(nov);
    expect(onStore.settlements.has(seasonOne.seasonKey)).toBe(true);
    expect(onPalace.announcements).toHaveLength(1);
    expect(onPalace.announcements[0]!.kind).toBe("king");
    expect(dutiesStore.actions).toHaveLength(1);
    expect(dutiesStore.actions[0].target).toBe(`season:${seasonOne.seasonKey}`);

    /* Duty off: the season still settles — silently. */
    process.env["OPERATOR_DUTY_WINNER_HERALDS_ENABLED"] = "off";
    const offPalace = fakePalace();
    const offStore = new FakeCourtStore();
    const offScheduler = new CourtSeasonScheduler({
      palace: offPalace.palace,
      store: offStore as any,
      heraldGate: ({ season: s, outcome }) =>
        gateCourtSeasonHerald({ season: s, outcome, store: dutiesStore }),
    });
    await offScheduler.tick(nov);
    expect(offStore.settlements.has(seasonOne.seasonKey)).toBe(true);
    expect(offPalace.announcements).toHaveLength(0);
  });
});

/* ── Duty 3: trouble flagging ───────────────────────────────────────── */

function seedPile(store: FakeDutiesStore, member: string, reporters: string[], reasons: string[]) {
  reporters.forEach((reporter, i) => {
    store.seedReport({
      reporterUserId: reporter,
      targetOwnerUserId: member,
      reason: reasons[i % reasons.length],
      createdAt: new Date(Date.now() - 3600_000),
    });
  });
}

describe("trouble flagging", () => {
  it("files exactly one operator flag when three members report the same member — and touches nothing else", async () => {
    const store = new FakeDutiesStore();
    const profileId = nextId();
    store.profiles.set(MEMBER, { id: profileId, displayName: "Trouble", slug: "trouble" });
    seedPile(store, MEMBER, [R1, R2, R3], ["spam", "spam", "harassment"]);
    const { palace } = fakePalace();
    const duties = new OperatorDuties({ palace, store });

    const filed = await duties.runTroubleFlagScan(new Date());
    expect(filed).toBe(1);

    const flag = store.reports.find((r) => r.reporterUserId === HOUSE);
    expect(flag).toBeTruthy();
    expect(flag.targetType).toBe("profile");
    expect(flag.targetId).toBe(profileId);
    expect(flag.targetOwnerUserId).toBe(MEMBER);
    expect(flag.reason).toBe("spam"); // the pile's plurality
    expect(flag.note).toContain("3 members reported this member");
    expect(flag.note).toContain("no automatic action was taken");
    expect(flag.status).toBe("new");

    /* The ceiling, proven: the scan's ONLY mutations are the flag
       row and the audit row. No mute, no removal, no state change
       anywhere near the member. */
    expect(store.mutations).toEqual(["insertReport", "insertAction"]);

    expect(store.actions).toHaveLength(1);
    const row = store.actions[0];
    expect(row.channel).toBe("automatic");
    expect(row.toolId).toBe(DUTY_TOOL_IDS.troubleFlag);
    expect(row.userId).toBe(HOUSE);
    expect(row.target).toBe(`member:${MEMBER}`);

    /* One flag per member per window: a second scan files nothing,
       even with the pile still standing. */
    expect(await duties.runTroubleFlagScan(new Date())).toBe(0);
    expect(store.reports.filter((r) => r.reporterUserId === HOUSE)).toHaveLength(1);
  });

  it("stays silent below three distinct reporters", async () => {
    const store = new FakeDutiesStore();
    store.profiles.set(MEMBER, { id: nextId(), displayName: "Loud", slug: "loud" });
    seedPile(store, MEMBER, [R1, R2], ["spam", "spam"]);
    /* A third REPORT from an existing reporter is not a third voice. */
    store.seedReport({
      reporterUserId: R1,
      targetOwnerUserId: MEMBER,
      reason: "spam",
      createdAt: new Date(Date.now() - 1800_000),
    });
    const duties = new OperatorDuties({ palace: fakePalace().palace, store });
    expect(await duties.runTroubleFlagScan(new Date())).toBe(0);
    expect(store.reports.some((r) => r.reporterUserId === HOUSE)).toBe(false);
    expect(store.actions).toHaveLength(0);
  });

  it("ignores reports outside the window and never counts the operator's own flags", async () => {
    const store = new FakeDutiesStore();
    store.profiles.set(MEMBER, { id: nextId(), displayName: "Old News", slug: "old" });
    /* Two fresh member reports + one stale + the house's own old
       flag: distinct member voices inside the window = 2. */
    seedPile(store, MEMBER, [R1, R2], ["spam", "harassment"]);
    store.seedReport({
      reporterUserId: R3,
      targetOwnerUserId: MEMBER,
      reason: "spam",
      createdAt: new Date(Date.now() - 25 * 3600_000),
    });
    store.seedReport({
      reporterUserId: HOUSE,
      targetOwnerUserId: MEMBER,
      targetType: "profile",
      reason: "spam",
      createdAt: new Date(Date.now() - 3600_000),
    });
    const duties = new OperatorDuties({ palace: fakePalace().palace, store });
    expect(await duties.runTroubleFlagScan(new Date())).toBe(0);
    expect(store.actions).toHaveLength(0);
  });

  it("does not re-flag inside the window even after a moderator closes the first flag", async () => {
    const store = new FakeDutiesStore();
    store.profiles.set(MEMBER, { id: nextId(), displayName: "Repeat", slug: "repeat" });
    seedPile(store, MEMBER, [R1, R2, R3], ["harassment", "harassment", "spam"]);
    const duties = new OperatorDuties({ palace: fakePalace().palace, store });
    expect(await duties.runTroubleFlagScan(new Date())).toBe(1);

    /* The human works the queue fast and dismisses the flag. */
    const flag = store.reports.find((r) => r.reporterUserId === HOUSE)!;
    flag.status = "dismissed";

    expect(await duties.runTroubleFlagScan(new Date())).toBe(0);
    expect(store.reports.filter((r) => r.reporterUserId === HOUSE)).toHaveLength(1);
  });

  it("stays silent when the flag switch is off, and for a member with no profile to point at", async () => {
    const store = new FakeDutiesStore();
    seedPile(store, MEMBER, [R1, R2, R3], ["spam", "spam", "spam"]);
    const duties = new OperatorDuties({ palace: fakePalace().palace, store });

    /* No creator profile seeded for MEMBER: nowhere honest to
       point the queue — no flag. */
    expect(await duties.runTroubleFlagScan(new Date())).toBe(0);

    store.profiles.set(MEMBER, { id: nextId(), displayName: "Now", slug: "now" });
    process.env["OPERATOR_DUTY_TROUBLE_FLAGGING_ENABLED"] = "0";
    expect(await duties.runTroubleFlagScan(new Date())).toBe(0);
    expect(store.reports.some((r) => r.reporterUserId === HOUSE)).toBe(false);
    expect(store.actions).toHaveLength(0);
  });
});

/* ── The default store, against the real tables (fake db) ───────────── */

describe("the db-backed store end to end", () => {
  beforeEach(() => {
    h.fake.clear();
  });

  it("a tick reminds and flags through the real table shapes, all rows 'automatic'", async () => {
    const eventId = "00000000-0000-4000-8000-0000000000e1";
    const hostProfileId = "00000000-0000-4000-8000-0000000000e2";
    const memberProfileId = "00000000-0000-4000-8000-0000000000e3";
    const now = Date.now();

    h.fake.seed("creatorProfiles", [
      { id: hostProfileId, userId: HOST, displayName: "Hostess", slug: "hostess" },
      { id: memberProfileId, userId: MEMBER, displayName: "Trouble", slug: "trouble" },
    ]);
    h.fake.seed("worldEvents", [
      {
        id: eventId,
        kind: "stage_show",
        roomId: "world:kings-hall",
        hostUserId: HOST,
        title: "Friday Night Live",
        startsAt: new Date(now + 10 * 60_000),
        endsAt: new Date(now + 70 * 60_000),
        payload: {},
        status: "scheduled",
        createdAt: new Date(now),
      },
    ]);
    for (const [i, reporter] of [R1, R2, R3].entries()) {
      h.fake.seed("contentReports", [
        {
          reporterUserId: reporter,
          targetType: "post",
          targetId: `00000000-0000-4000-8000-0000000000f${i}`,
          targetOwnerUserId: MEMBER,
          targetSummary: "a loud post",
          reason: "spam",
          note: null,
          status: "new",
          createdAt: new Date(now - 3600_000),
        },
      ]);
    }

    const { palace, announcements } = fakePalace();
    const duties = new OperatorDuties({ palace }); // default store
    await duties.tick(now);

    expect(announcements).toHaveLength(1);

    const actions = h.fake.store("operatorActions").rows;
    expect(actions).toHaveLength(2);
    expect(actions.every((a: any) => a.channel === "automatic")).toBe(true);
    expect(actions.map((a: any) => a.toolId).sort()).toEqual(
      [DUTY_TOOL_IDS.hostReminder, DUTY_TOOL_IDS.troubleFlag].sort(),
    );

    const reports = h.fake.store("contentReports").rows;
    const flag = reports.find((r: any) => r.reporterUserId === HOUSE);
    expect(flag).toBeTruthy();
    expect(flag.targetType).toBe("profile");
    expect(flag.targetId).toBe(memberProfileId);
    expect(flag.targetOwnerUserId).toBe(MEMBER);

    /* A second tick fires nothing new: the trail is the memory. */
    await duties.tick(now + 30_000);
    expect(announcements).toHaveLength(1);
    expect(h.fake.store("operatorActions").rows).toHaveLength(2);
    expect(
      h.fake.store("contentReports").rows.filter((r: any) => r.reporterUserId === HOUSE),
    ).toHaveLength(1);
  });
});
