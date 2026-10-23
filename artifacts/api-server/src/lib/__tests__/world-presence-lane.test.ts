/**
 * PRESENCE lane (Stack-100 #2 items 61–62) — regression pins + the
 * stale-counter fix, on the REAL WorldPalace with fake sockets.
 *
 * Item 61 (PINNED — facet claim stale): the facet said the 90 s ghost
 * sweep "runs on the directory request path". In the shipped tree the
 * sweep is a 15 s interval (WORLD_PRESENCE_SWEEP_MS) started once at
 * WS registration (routes/world.ts calls palace.startPresenceSweeper())
 * and the 90 s figure is the staleness WINDOW (WORLD_PEER_STALE_MS).
 * These tests lock that decoupling: with fake timers, a ghost is
 * reaped by the interval alone — no directory(), no snapshot, no
 * request of any kind in between — and a source pin keeps the
 * directory route from ever (re)acquiring a sweep.
 *
 * Item 62 (FIXED here): the directory/total counters used to read raw
 * room.size()/memberNames() — ghosts counted until a sweep happened
 * to run — while presenceSnapshot already excluded them. The counters
 * now derive from room.presentPeers(now), computed live at call time.
 * These tests lock the agreement: before any sweep runs, a ghost is
 * absent from directory, total and snapshot alike, while its peer row
 * (and its chair against the admission cap) still exists.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { RoomHub, type WsClientSocket } from "../live-ws";
import { WorldPalace, WORLD_PRESENCE_SWEEP_MS, WORLD_PLAZA_ROOM_ID } from "../world-palace";
import { WORLD_PEER_STALE_MS, type WorldIdentity } from "../world-room";

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

/** The peer's actual silence stamp — the reference the sweeper and
 *  presentPeers both read (the snapshot suite's lesson: never a
 *  wall-clock sample taken before the attach). */
function lastSeenAt(palace: WorldPalace): number {
  const peers = (
    palace.plazaRoom as unknown as { peers: Map<unknown, { lastSeenAt: number }> }
  ).peers;
  return [...peers.values()][0]!.lastSeenAt;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("item 61 — the sweep runs on its own tick, not on traffic", () => {
  it("reaps a ghost on the interval with zero directory/snapshot calls", () => {
    vi.useFakeTimers();
    const palace = new WorldPalace(new RoomHub());
    const ghost = fakeSocket();
    expect(palace.enterHall(ghost, member("Ghost"))).toBe(true);
    expect(palace.plazaRoom.size()).toBe(1);

    palace.startPresenceSweeper();
    /* No directory(), no presenceSnapshot(), no frame — nothing but
     * the clock moving past the stale window plus one sweep tick.
     * (The attach happened at the fake "now"; advancing beyond
     * STALE + one tick must bury the ghost on interval alone.) */
    vi.advanceTimersByTime(WORLD_PEER_STALE_MS + WORLD_PRESENCE_SWEEP_MS + 1);
    expect(palace.plazaRoom.size()).toBe(0);
    expect(ghost.readyState).toBe(3);
    palace.dispose();
  });

  it("does not reap a live peer on the tick — frames keep it present", () => {
    vi.useFakeTimers();
    const palace = new WorldPalace(new RoomHub());
    const live = fakeSocket();
    expect(palace.enterHall(live, member("Live"))).toBe(true);
    palace.startPresenceSweeper();
    /* Half the stale window passes; the peer pings (the client's
     * ~25 s cadence); another half window + a tick passes — the
     * peer is well inside its window and must survive the sweep. */
    vi.advanceTimersByTime(WORLD_PEER_STALE_MS / 2);
    palace.handleFrame(live, JSON.stringify({ type: "ping" }), Date.now());
    vi.advanceTimersByTime(WORLD_PEER_STALE_MS / 2 + WORLD_PRESENCE_SWEEP_MS + 1);
    expect(palace.plazaRoom.size()).toBe(1);
    palace.dispose();
  });

  it("the production wiring starts the sweeper at registration, and the directory route never sweeps", () => {
    const routes = readFileSync(new URL("../../routes/world.ts", import.meta.url), "utf8");
    expect(routes).toContain("palace.startPresenceSweeper()");
    /* The directory handler's own slice: from its route line to the
     * next route — it may READ the directory, never run or start a
     * sweep (the coupling the facet feared must stay impossible). */
    const start = routes.indexOf('router.get("/world/directory"');
    expect(start).toBeGreaterThan(-1);
    const handler = routes.slice(start, routes.indexOf("router.", start + 10));
    expect(handler).not.toContain("sweep");
    expect(handler).not.toContain("startPresenceSweeper");
    /* And the sweeper itself is the interval the palace owns. */
    const palaceSrc = readFileSync(new URL("../world-palace.ts", import.meta.url), "utf8");
    expect(palaceSrc).toContain("setInterval(() => this.sweepStalePeers(), WORLD_PRESENCE_SWEEP_MS)");
    expect(WORLD_PRESENCE_SWEEP_MS).toBe(15_000);
  });
});

describe("item 62 — counters are live present-peer reads, never stale", () => {
  it("a ghost is absent from directory + total + snapshot before any sweep runs", () => {
    const palace = new WorldPalace(new RoomHub());
    const ghost = fakeSocket();
    const live = fakeSocket();
    expect(palace.enterHall(ghost, member("Ghost"))).toBe(true);
    expect(palace.enterHall(live, member("Live"))).toBe(true);
    const t0 = lastSeenAt(palace);
    /* Keep only "Live" fresh: a ping at t0 + window stamps it; the
     * ghost stays silent from its attach stamp. */
    palace.handleFrame(live, JSON.stringify({ type: "ping" }), t0 + WORLD_PEER_STALE_MS);
    const now = t0 + WORLD_PEER_STALE_MS + 1;

    /* No sweep has run: both peer rows still stand in the room… */
    expect(palace.plazaRoom.size()).toBe(2);
    /* …but every reported counter already tells the truth. */
    const entry = palace.directory(now).find((r) => r.id === WORLD_PLAZA_ROOM_ID)!;
    expect(entry.count).toBe(1);
    expect(entry.members).toEqual(["Live"]);
    expect(palace.totalPopulation(now)).toBe(1);
    const snap = palace.presenceSnapshot(now);
    expect(snap.total).toBe(1);
    expect(snap.rooms.find((r) => r.id === WORLD_PLAZA_ROOM_ID)!.count).toBe(entry.count);
  });

  it("fresh peers count exactly as before (no behaviour change on the live path)", () => {
    const palace = new WorldPalace(new RoomHub());
    expect(palace.enterHall(fakeSocket(), member("Ana"))).toBe(true);
    expect(palace.enterHall(fakeSocket(), member("Bo"))).toBe(true);
    const entry = palace.directory().find((r) => r.id === WORLD_PLAZA_ROOM_ID)!;
    expect(entry.count).toBe(2);
    expect(entry.members).toEqual(["Ana", "Bo"]);
    expect(palace.totalPopulation()).toBe(2);
  });

  it("the directory is recomputed per call — a later call sees a peer who went silent", () => {
    const palace = new WorldPalace(new RoomHub());
    expect(palace.enterHall(fakeSocket(), member("Ana"))).toBe(true);
    const t0 = lastSeenAt(palace);
    expect(palace.directory(t0).find((r) => r.id === WORLD_PLAZA_ROOM_ID)!.count).toBe(1);
    /* Same palace, same peer row, no sweep, no detach — the counter
     * moved because it is a live read, not captured state. */
    expect(
      palace.directory(t0 + WORLD_PEER_STALE_MS + 1).find((r) => r.id === WORLD_PLAZA_ROOM_ID)!.count,
    ).toBe(0);
    expect(palace.plazaRoom.size()).toBe(1);
  });
});
