/**
 * Stack 400 lane s400-world-presence (census B-24) — Creator Rooms
 * occupant-count derivation pins.
 *
 * The two occupantCount reads in routes/world.ts (the Creator
 * Rooms directory and one room's data) must derive from the room's
 * PRESENT peers — presentPeers() (stale = silent past
 * WORLD_PEER_STALE_MS, the same truth the palace directory,
 * presenceSnapshot and totalPopulation already tell) — never the
 * raw size(), which counts frame-silent ghosts until the sweep
 * buries them.
 *
 * The derivation is pinned two ways:
 *   1. Lib level: a creator room materialized the way the HTTP
 *      reads materialize it (palace.noteCreatorRoom) reports a
 *      stale peer through size() (the admission count, unchanged)
 *      but never through the present count the reads now use —
 *      while the walker is still standing in it, and still after
 *      the sweeper reaps the ghost.
 *   2. Source pins: both route reads keep the presentPeers().length
 *      form and neither falls back to the raw size().
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RoomHub, type WsClientSocket } from "../live-ws";
import { WorldPalace } from "../world-palace";
import { WORLD_PEER_STALE_MS, type WorldIdentity, type WorldRoom } from "../world-room";

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

const guest = (session: string): WorldIdentity => ({
  userId: null,
  displayName: "Guest",
  avatarUrl: null,
  profileSlug: null,
  guestSessionId: session,
});

function frame(palace: WorldPalace, socket: FakeSocket, payload: unknown, now?: number) {
  palace.handleFrame(socket, JSON.stringify(payload), now);
}

/** Judge presence at an explicit instant — the derivation the reads
 * perform (presentPeers().length), pinned against the same clock
 * the routes' own server shares with every read in production,
 * where Date.now() IS the world clock. */
function occupantCount(room: WorldRoom, now: number): number {
  return room.presentPeers(now).length;
}

describe("Creator Rooms occupantCount — present peers, never ghosts", () => {
  it("a frame-silent ghost does not count, while it stands and after the sweep", () => {
    const palace = new WorldPalace(new RoomHub());
    const room = palace.noteCreatorRoom("nova-reyes", "Nova Reyes");

    /* A member and a guest stand in the creator room. Room peers are
     * attached directly (the way presenceSnapshot's suite builds its
     * world). Attach stamps lastSeenAt from the wall clock at attach
     * time — both peers, a hair apart — so the scenario clock starts
     * at the LATER of the two stamps and every probe below is exact
     * arithmetic against the same references the sweeper uses. */
    const host = fakeSocket();
    const visitor = fakeSocket();
    room.attach(host, member("Nova"));
    room.attach(visitor, guest("tab-1"));
    const stamps = (
      room as unknown as { peers: Map<unknown, { lastSeenAt: number }> }
    ).peers;
    const T0 = Math.max(...[...stamps.values()].map((p) => p.lastSeenAt));

    expect(room.size()).toBe(2);
    expect(occupantCount(room, T0)).toBe(2);
    /* Probed through the palace's own directory path too — the same
     * instant, the same room: a creator room with people home lists
     * with the present count, exactly what the HTTP directory read
     * now reports. */
    const dirEntry = palace.directory(T0).find((e) => e.id === "creator:nova-reyes");
    expect(dirEntry?.count).toBe(2);

    /* The visitor goes frame-silent past the boundary while the
     * host stays alive on keepalive pings alone (any frame stamps
     * lastSeenAt; a ping never trips the move throttle, so the
     * ping's own timestamp lands). The ghost still STANDS in the
     * room — size(), the admission count, is unchanged until the
     * sweep — but the occupant count the reads report must not
     * include it. (The room-level judge is what the palace's own
     * directory and totalPopulation do with the same value —
     * presentPeers(now).length at lines 723/748/766 of
     * world-palace.ts.) */
    const T2 = T0 + WORLD_PEER_STALE_MS + 1;
    frame(palace, host, { type: "ping" }, T2);
    expect(room.size()).toBe(2);
    expect(occupantCount(room, T2)).toBe(1);
    /* The palace directory, at the same instant, drops the ghost
     * from this room's count too (present.length === 1 — the room
     * still lists because the host is home; its count is the truth
     * the fixed reads now match). */
    const dirEntry2 = palace.directory(T2).find((e) => e.id === "creator:nova-reyes");
    expect(dirEntry2?.count).toBe(1);

    /* Later still, the host keeps pinging, so only the ghost stays
     * stale at the read's instant — and the sweeper's reap does not
     * change the truthful count either: size() finally drops, the
     * occupant count was already right. */
    const T3 = T2 + 60_000;
    frame(palace, host, { type: "ping" }, T3);
    expect(occupantCount(room, T3)).toBe(1);
    expect(room.sweepStalePeers(T3)).toBe(1);
    expect(room.size()).toBe(1);
    expect(occupantCount(room, T3)).toBe(1);
  });
});

describe("routes/world.ts — both occupantCount reads keep the present form (B-24)", () => {
  const src = readFileSync(join(__dirname, "../../routes/world.ts"), "utf8");

  it("the Creator Rooms directory read derives from presentPeers().length", () => {
    expect(src).toContain(
      "occupantCount: activePalace?.creatorRoom(p.slug)?.presentPeers().length ?? 0",
    );
    expect(src).not.toContain("creatorRoom(p.slug)?.size()");
  });

  it("the one-room data read derives from presentPeers().length", () => {
    expect(src).toContain("occupantCount: room?.presentPeers().length ?? 0");
    expect(src).not.toContain("occupantCount: room?.size()");
  });
});

describe("guest-connection breakdown — the B-25 label's data (owner ruling, Nov 11, 2026)", () => {
  it("the palace directory splits a creator room's count into people + guest connections", () => {
    const palace = new WorldPalace(new RoomHub());
    const room = palace.noteCreatorRoom("nova-reyes", "Nova Reyes");
    /* The host (a member = a person) and ONE guest standing in
     * the room from TWO tabs — two per-tab sessions, two guest
     * peers. The count is 3; the honest label is 1 person +
     * 2 connections. */
    room.attach(fakeSocket(), member("Nova"));
    room.attach(fakeSocket(), guest("tab-1"));
    room.attach(fakeSocket(), guest("tab-2"));
    const stamps = (
      room as unknown as { peers: Map<unknown, { lastSeenAt: number }> }
    ).peers;
    const T0 = Math.max(...[...stamps.values()].map((p) => p.lastSeenAt));

    const entry = palace.directory(T0).find((e) => e.id === "creator:nova-reyes");
    expect(entry?.count).toBe(3);
    expect(entry?.guestConnections).toBe(2);
  });

  it("both Creator Rooms reads break out guest connections from the same present peers", () => {
    const src = readFileSync(join(__dirname, "../../routes/world.ts"), "utf8");
    expect(src).toContain(
      "guestConnections: activePalace?.creatorRoom(p.slug)?.presentPeers().filter((p) => p.guest).length ?? 0",
    );
    expect(src).toContain(
      "guestConnections: room?.presentPeers().filter((p) => p.guest).length ?? 0",
    );
  });
});
