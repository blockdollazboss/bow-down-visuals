/**
 * Court gatherings (UPGRADE-PROGRAM 3.6, migration 0313) — the
 * royal_court kind on the palace events backbone.
 *
 * Pinned contract:
 * - the booking rule: the Royal Court Chamber only, house/admin
 *   only (the drop precedent) — enforced at the route off
 *   bookingRuleFor; this file pins the rule + the payload shape.
 * - the payload is an optional occasion line ({ note? }), trimmed
 *   and capped like office hours' agenda; anything else sent along
 *   is dropped, and who is honored is NEVER payload.
 * - at the hour the scheduler flips the row live and heralds the
 *   court palace-wide exactly once (kind "king", aimed at the
 *   Chamber), the Front Row presented from the store's fire-time
 *   read — an unseated court heralds the gathering alone, a failed
 *   honors read never blocks or fakes the presentation.
 * - the kind seizes no room state: slot end just closes the row,
 *   a cancelled gathering releases nothing, and a live row is
 *   never re-driven (no second herald).
 */
import { describe, it, expect } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import { WorldPalace } from "../world-palace";
import { type WorldIdentity } from "../world-room";
import {
  WorldEventScheduler,
  bookingRuleFor,
  buildCourtGatheringAnnouncement,
  sanitizeEventPayload,
  type WorldEventStore,
} from "../world-events";
import { COURT_CHAMBER_ROOM_ID } from "../world-court-season";

const CHAMBER = COURT_CHAMBER_ROOM_ID;
const T0 = 1_700_000_000_000;

interface FakeSocket extends WsClientSocket {
  sent: any[];
  closedWith: { code?: number; reason?: string } | null;
}

function fakeSocket(): FakeSocket {
  const s: FakeSocket = {
    readyState: 1,
    sent: [],
    closedWith: null,
    send(data: string) {
      s.sent.push(JSON.parse(data));
    },
    close(code?: number, reason?: string) {
      s.closedWith = { code, reason };
      s.readyState = 3;
    },
    terminate() {
      s.readyState = 3;
    },
    ping() {},
    on() {
      return s;
    },
  };
  return s;
}

const member = (name: string): WorldIdentity => ({
  userId: `user-${name}`,
  displayName: name,
  avatarUrl: null,
  profileSlug: name.toLowerCase(),
});

type Row = Record<string, any>;

function courtRow(partial: Row = {}): Row {
  return {
    id: "evt-court-1",
    kind: "royal_court",
    roomId: CHAMBER,
    hostUserId: "user-Host",
    title: "The Week's Honors",
    startsAt: new Date(T0 - 60_000),
    endsAt: new Date(T0 + 30 * 60_000),
    payload: {},
    status: "scheduled",
    createdAt: new Date(T0 - 3600_000),
    ...partial,
  };
}

function makeStore(
  rows: Row[],
  frontRowNames: string[] | Error | null = [],
): WorldEventStore & { rows: Row[] } {
  const store: WorldEventStore & { rows: Row[] } = {
    rows,
    async listOpenEvents() {
      return rows.filter((r) => ["scheduled", "live", "cancelled"].includes(r.status)) as never;
    },
    async setStatus(id, status) {
      const r = rows.find((x) => x.id === id);
      if (r) r.status = status;
    },
    async hostProfile(userId) {
      if (userId === "user-Host") return { displayName: "Host", slug: "host" };
      return null;
    },
  };
  if (frontRowNames !== null) {
    store.courtFrontRowNames = async () => {
      if (frontRowNames instanceof Error) throw frontRowNames;
      return frontRowNames;
    };
  }
  return store;
}

function makePalace() {
  return new WorldPalace(new RoomHub(), {
    resolveScreenVideo: async () => null,
    resolveJukeboxTrack: async () => null,
    resolveStageStream: async () => null,
    claimWorldDrop: async () => ({ ok: true as const }),
  });
}

function makeScheduler(palace: WorldPalace, store: WorldEventStore) {
  return new WorldEventScheduler({
    palace,
    store,
    resolveScreenVideo: async () => null,
    resolveJukeboxTrack: async () => null,
  });
}

/** A member standing in the Chamber hears what the palace hears. */
function chamberWitness(palace: WorldPalace): FakeSocket {
  const s = fakeSocket();
  expect(palace.enterHall(s, member("Witness"))).toBe(true);
  palace.handleFrame(
    s,
    JSON.stringify({ type: "room.enter", roomId: CHAMBER, x: 16.5, z: -13.5 }),
    T0,
  );
  s.sent = [];
  return s;
}

function announcements(s: FakeSocket): any[] {
  return s.sent.filter((m) => m.type === "palace.announce");
}

describe("royal_court — the booking rule + payload", () => {
  it("books the Royal Court Chamber only, house/admin only", () => {
    expect(bookingRuleFor("royal_court")).toEqual({
      requiredRoomId: CHAMBER,
      privilege: "admin",
      roomKind: "palace",
    });
  });

  it("the payload is the occasion line only — trimmed, capped, optional", () => {
    expect(sanitizeEventPayload("royal_court", {})).toEqual({ ok: true, payload: {} });
    expect(sanitizeEventPayload("royal_court", { note: "  The week's honors.  " })).toEqual({
      ok: true,
      payload: { note: "The week's honors." },
    });
    const long = sanitizeEventPayload("royal_court", { note: "x".repeat(300) });
    expect(long.ok).toBe(true);
    if (long.ok) expect((long.payload["note"] as string).length).toBe(140);
    /* Claims about who is honored never ride the payload. */
    expect(
      sanitizeEventPayload("royal_court", { note: "N", honoree: "user-x", frontRow: ["A"] }),
    ).toEqual({ ok: true, payload: { note: "N" } });
    expect(sanitizeEventPayload("royal_court", null)).toEqual({ ok: true, payload: {} });
    expect(sanitizeEventPayload("royal_court", { note: 42 })).toEqual({ ok: true, payload: {} });
  });
});

describe("royal_court — the herald text (pure)", () => {
  it("calls the court, names the occasion, presents the Front Row in seat order", () => {
    const a = buildCourtGatheringAnnouncement({
      title: "The Week's Honors",
      note: "Streaks and standings, told by the King.",
      hostName: "Host",
      frontRowNames: ["Ana", "Bo", "Cy"],
    });
    expect(a.kind).toBe("king");
    expect(a.roomId).toBe(CHAMBER);
    expect(a.roomName).toBe("Royal Court Chamber");
    expect(a.name).toBe("Host");
    expect(a.text).toBe(
      "Court is called in Royal Court Chamber — “The Week's Honors”, called by Host. " +
        "Streaks and standings, told by the King. " +
        "The Front Row is presented: Ana, Bo and Cy.",
    );
  });

  it("an unseated court is omitted, never padded; two names join plainly", () => {
    const empty = buildCourtGatheringAnnouncement({
      title: "Court",
      note: null,
      hostName: "Host",
      frontRowNames: [],
    });
    expect(empty.text).toBe("Court is called in Royal Court Chamber — “Court”, called by Host.");
    const two = buildCourtGatheringAnnouncement({
      title: "Court",
      note: null,
      hostName: "Host",
      frontRowNames: ["Ana", "Bo"],
    });
    expect(two.text).toContain("The Front Row is presented: Ana and Bo.");
    const one = buildCourtGatheringAnnouncement({
      title: "Court",
      note: null,
      hostName: "Host",
      frontRowNames: ["  Ana  ", ""],
    });
    expect(one.text).toContain("The Front Row is presented: Ana.");
  });
});

describe("royal_court — the scheduler", () => {
  it("at the hour: the row flips live and the palace is heralded exactly once", async () => {
    const palace = makePalace();
    const store = makeStore(
      [courtRow({ payload: { note: "The week's honors, told aloud." } })],
      ["Ana", "Bo"],
    );
    const scheduler = makeScheduler(palace, store);
    const witness = chamberWitness(palace);

    await scheduler.tick(T0);
    expect(store.rows[0]!.status).toBe("live");
    const heard = announcements(witness);
    expect(heard).toHaveLength(1);
    expect(heard[0].announce.kind).toBe("king");
    expect(heard[0].announce.roomId).toBe(CHAMBER);
    expect(heard[0].announce.text).toBe(
      "Court is called in Royal Court Chamber — “The Week's Honors”, called by Host. " +
        "The week's honors, told aloud. " +
        "The Front Row is presented: Ana and Bo.",
    );

    /* Still live on the next tick: never re-driven, never re-heralded. */
    await scheduler.tick(T0 + 60_000);
    expect(announcements(witness)).toHaveLength(1);
    expect(store.rows[0]!.status).toBe("live");

    /* Slot end closes the row; nothing is released, nothing sounds. */
    await scheduler.tick(T0 + 31 * 60_000);
    expect(store.rows[0]!.status).toBe("done");
    expect(announcements(witness)).toHaveLength(1);
  });

  it("an unseated court still gathers — the herald names the gathering alone", async () => {
    const palace = makePalace();
    const store = makeStore([courtRow()], []);
    const scheduler = makeScheduler(palace, store);
    const witness = chamberWitness(palace);

    await scheduler.tick(T0);
    expect(store.rows[0]!.status).toBe("live");
    const heard = announcements(witness);
    expect(heard).toHaveLength(1);
    expect(heard[0].announce.text).toBe(
      "Court is called in Royal Court Chamber — “The Week's Honors”, called by Host.",
    );
  });

  it("a failed honors read heralds the gathering without the presentation", async () => {
    const palace = makePalace();
    const store = makeStore([courtRow()], new Error("db down"));
    const scheduler = makeScheduler(palace, store);
    const witness = chamberWitness(palace);

    await scheduler.tick(T0);
    expect(store.rows[0]!.status).toBe("live");
    const heard = announcements(witness);
    expect(heard).toHaveLength(1);
    expect(heard[0].announce.text).not.toContain("Front Row is presented");
  });

  it("a store without the honors read still heralds (presentation omitted)", async () => {
    const palace = makePalace();
    const store = makeStore([courtRow()], null);
    const scheduler = makeScheduler(palace, store);
    const witness = chamberWitness(palace);

    await scheduler.tick(T0);
    expect(store.rows[0]!.status).toBe("live");
    expect(announcements(witness)).toHaveLength(1);
  });

  it("a cancelled gathering sounds nothing and closes quietly", async () => {
    const palace = makePalace();
    const store = makeStore([courtRow({ status: "cancelled" })], ["Ana"]);
    const scheduler = makeScheduler(palace, store);
    const witness = chamberWitness(palace);

    await scheduler.tick(T0);
    expect(announcements(witness)).toHaveLength(0);
  });

  it("a gathering whose slot passed unstarted ends honestly — never heralded late", async () => {
    const palace = makePalace();
    const store = makeStore(
      [courtRow({ startsAt: new Date(T0 - 3600_000), endsAt: new Date(T0 - 60_000) })],
      ["Ana"],
    );
    const scheduler = makeScheduler(palace, store);
    const witness = chamberWitness(palace);

    await scheduler.tick(T0);
    expect(store.rows[0]!.status).toBe("done");
    expect(announcements(witness)).toHaveLength(0);
  });
});
