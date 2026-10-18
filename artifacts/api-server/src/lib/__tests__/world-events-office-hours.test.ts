/**
 * Office Hours in the scheduler + booking-rule helpers
 * (UPGRADE-PROGRAM 3.7, stack-20 #17).
 *
 * Pinned contract:
 * - an office_hours session takes NOTHING over: across its whole
 *   lifecycle the tick calls no room method at all (no screen
 *   seize, no jukebox takeover, no drop landing) — the status flip
 *   scheduled → live → done is the whole effect, because the room
 *   simply stands open for its booked hours;
 * - a session whose window passed while it was still "scheduled"
 *   (a restart ate its hour) ends honestly as done, never live;
 * - a cancelled live session stays cancelled and still touches no
 *   room state;
 * - the payload sanitizer keeps exactly the agenda line (trimmed,
 *   capped), and the booking rule anchors the kind to the host's
 *   own creator room for members.
 *
 * Harness mirrors world-events.test.ts: a real WorldPalace (never
 * entered — no sockets) + a fake event store, with spies on every
 * WorldRoom takeover/release method.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { RoomHub } from "../live-ws";
import { WorldPalace } from "../world-palace";
import { WorldRoom } from "../world-room";
import {
  WorldEventScheduler,
  bookingRuleFor,
  sanitizeEventPayload,
  type WorldEventStore,
} from "../world-events";

const T0 = 1_700_000_000_000;

type Row = Record<string, any>;

function eventRow(partial: Row): Row {
  return {
    id: "evt-oh-1",
    kind: "office_hours",
    roomId: "creator:host",
    hostUserId: "user-Host",
    title: "Office hours — ask me anything",
    startsAt: new Date(T0 - 60_000),
    endsAt: new Date(T0 + 30 * 60_000),
    payload: { note: "Mixing questions welcome" },
    status: "scheduled",
    createdAt: new Date(T0 - 3600_000),
    ...partial,
  };
}

function makeStore(rows: Row[]): WorldEventStore & { rows: Row[] } {
  return {
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
}

function makeScheduler(store: WorldEventStore) {
  const palace = new WorldPalace(new RoomHub(), {
    resolveScreenVideo: async () => null,
    resolveJukeboxTrack: async () => null,
    resolveStageStream: async () => null,
    claimWorldDrop: async () => ({ ok: true as const }),
  });
  return new WorldEventScheduler({
    palace,
    store,
    resolveScreenVideo: async () => null,
    resolveJukeboxTrack: async () => null,
  });
}

const ROOM_TOUCHES = [
  "beginScheduledShow",
  "endScheduledShow",
  "beginListeningParty",
  "endListeningParty",
  "landDrop",
  "endDrop",
] as const;

function spyOnRoomTouches() {
  return ROOM_TOUCHES.map((m) => vi.spyOn(WorldRoom.prototype, m as never));
}

function expectNoRoomTouches(spies: ReturnType<typeof spyOnRoomTouches>) {
  for (const s of spies) expect(s).not.toHaveBeenCalled();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the office-hours lifecycle — the flip is the whole effect", () => {
  it("a due session goes live, stays live across ticks, and ends done — touching no room", async () => {
    const spies = spyOnRoomTouches();
    const store = makeStore([eventRow({})]);
    const scheduler = makeScheduler(store);

    await scheduler.tick(T0);
    expect(store.rows[0]!.status).toBe("live");

    await scheduler.tick(T0 + 10 * 60_000);
    expect(store.rows[0]!.status).toBe("live");

    await scheduler.tick(T0 + 31 * 60_000);
    expect(store.rows[0]!.status).toBe("done");

    expectNoRoomTouches(spies);
  });

  it("a session that hasn't started stays scheduled and silent", async () => {
    const spies = spyOnRoomTouches();
    const store = makeStore([
      eventRow({ startsAt: new Date(T0 + 3600_000), endsAt: new Date(T0 + 2 * 3600_000) }),
    ]);
    const scheduler = makeScheduler(store);

    await scheduler.tick(T0);
    expect(store.rows[0]!.status).toBe("scheduled");
    expectNoRoomTouches(spies);
  });

  it("a missed session (window gone while scheduled) ends as done — never shown live", async () => {
    const spies = spyOnRoomTouches();
    const store = makeStore([
      eventRow({ startsAt: new Date(T0 - 2 * 3600_000), endsAt: new Date(T0 - 3600_000) }),
    ]);
    const scheduler = makeScheduler(store);

    await scheduler.tick(T0);
    expect(store.rows[0]!.status).toBe("done");
    expectNoRoomTouches(spies);
  });

  it("a cancelled live session stays cancelled and releases nothing (there is nothing to release)", async () => {
    const spies = spyOnRoomTouches();
    const store = makeStore([eventRow({ status: "cancelled" })]);
    const scheduler = makeScheduler(store);

    await scheduler.tick(T0);
    expect(store.rows[0]!.status).toBe("cancelled");
    expectNoRoomTouches(spies);
  });
});

describe("booking helpers — office hours", () => {
  it("the rule anchors the kind to the host's own creator room, for any member", () => {
    expect(bookingRuleFor("office_hours")).toEqual({
      requiredRoomId: null,
      privilege: "member",
      roomKind: "own-creator-room",
    });
    /* The palace kinds keep their palace anchoring. */
    expect(bookingRuleFor("stage_show").roomKind).toBe("palace");
    expect(bookingRuleFor("listening_party").roomKind).toBe("palace");
    expect(bookingRuleFor("drop").roomKind).toBe("palace");
  });

  it("the payload is exactly the agenda line: trimmed, capped, unknown keys dropped", () => {
    expect(sanitizeEventPayload("office_hours", { note: "  Bring your demos  ", junk: 1 })).toEqual({
      ok: true,
      payload: { note: "Bring your demos" },
    });
    expect(sanitizeEventPayload("office_hours", { note: "x".repeat(200) })).toEqual({
      ok: true,
      payload: { note: "x".repeat(140) },
    });
    expect(sanitizeEventPayload("office_hours", {})).toEqual({ ok: true, payload: {} });
    expect(sanitizeEventPayload("office_hours", { note: 42 })).toEqual({ ok: true, payload: {} });
    expect(sanitizeEventPayload("office_hours", null)).toEqual({ ok: true, payload: {} });
  });
});
