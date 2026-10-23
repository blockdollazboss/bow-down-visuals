/**
 * WorldPalace.presenceSnapshot — the truthful headcount behind the
 * Cloud Operator's Tier-0 "who's in the palace" tool, tested on the
 * REAL palace + rooms with fake sockets.
 *
 * The discipline being pinned (presence truth law):
 *  - a peer the staleness sweep would reap (silent past
 *    WORLD_PEER_STALE_MS) is NEVER counted — the snapshot asks at a
 *    later `now` and the ghost is already gone from the count, even
 *    though no sweep has run
 *  - one person is one count: the same identity on two sockets
 *    dedupes by presence key, in its room and palace-wide
 *  - guests count (they are present), by their tab session key
 *  - a connection with no identity key counts once, as itself
 *  - creator rooms join only while someone is home (the directory's
 *    own rule); the palace rooms always list
 */
import { describe, it, expect } from "vitest";
import { WorldPalace } from "../world-palace";
import { RoomHub } from "../live-ws";
import { WORLD_PEER_STALE_MS, type WorldIdentity } from "../world-room";

function fakeSocket(): any {
  return { send: () => {}, close: () => {}, terminate: () => {} };
}

function member(userId: string, displayName: string): WorldIdentity {
  return { userId, displayName, avatarUrl: null, profileSlug: null };
}

function guest(sessionId: string, displayName: string): WorldIdentity {
  return { userId: null, displayName, avatarUrl: null, profileSlug: null, guestSessionId: sessionId };
}

function newPalace(): WorldPalace {
  return new WorldPalace(new RoomHub(), {});
}

describe("WorldPalace.presenceSnapshot", () => {
  it("counts fresh peers per room and palace-wide, with names", () => {
    const palace = newPalace();
    palace.hallRoom.attach(fakeSocket(), member("u-a", "Ana"));
    palace.hallRoom.attach(fakeSocket(), member("u-b", "Bo"));
    palace.room("world:music-hall")!.attach(fakeSocket(), guest("g-1", "Cy the Guest"));

    const snap = palace.presenceSnapshot();
    expect(snap.total).toBe(3);
    const hall = snap.rooms.find((r) => r.id === "world:kings-hall")!;
    expect(hall.count).toBe(2);
    expect(hall.members).toEqual(expect.arrayContaining(["Ana", "Bo"]));
    const music = snap.rooms.find((r) => r.id === "world:music-hall")!;
    expect(music.count).toBe(1);
    expect(music.members).toEqual(["Cy the Guest"]);
    // the thirteen palace rooms always list, empty ones at zero
    // (thirteen since item 35 added the Boardwalk district;
    // twelve was item 34's Ateliers count)
    expect(snap.rooms).toHaveLength(13);
    expect(snap.rooms.find((r) => r.id === "world:treasury")!.count).toBe(0);
  });

  it("never counts a ghost the sweeper would reap", () => {
    const palace = newPalace();
    palace.hallRoom.attach(fakeSocket(), member("u-a", "Ana"));
    /* Measure from the peer's ACTUAL silence stamp — the one attach()
     * wrote — never a wall-clock sample taken before the attach. The
     * old sample-first version raced the clock tick: when attach
     * landed 1 ms after the sample, the "past the window" probe below
     * still found the peer exactly AT the boundary (age == STALE,
     * which presentPeers counts) and the ghost was counted. Deriving
     * t0 from the stamp makes both probes exact arithmetic against
     * the same reference the sweeper itself uses. */
    const peers = (
      palace.hallRoom as unknown as {
        peers: Map<unknown, { lastSeenAt: number }>;
      }
    ).peers;
    const t0 = [...peers.values()][0]!.lastSeenAt;
    // Just inside the stale window: still present.
    expect(palace.presenceSnapshot(t0 + WORLD_PEER_STALE_MS).total).toBe(1);
    // Past it: the peer is a ghost awaiting burial — the count drops
    // it even though no sweep has run and the peer row still exists.
    const snap = palace.presenceSnapshot(t0 + WORLD_PEER_STALE_MS + 1);
    expect(snap.total).toBe(0);
    expect(snap.rooms.find((r) => r.id === "world:kings-hall")!.count).toBe(0);
    expect(palace.hallRoom.size()).toBe(1); // the row lingers until the sweep — the snapshot told the truth anyway
  });

  it("one person, one count: the same identity on two sockets dedupes", () => {
    const palace = newPalace();
    palace.hallRoom.attach(fakeSocket(), member("u-a", "Ana"));
    palace.hallRoom.attach(fakeSocket(), member("u-a", "Ana")); // second tab, never evicted at this layer
    palace.hallRoom.attach(fakeSocket(), guest("g-1", "Guest"));
    palace.hallRoom.attach(fakeSocket(), guest("g-1", "Guest")); // same tab reconnecting

    const snap = palace.presenceSnapshot();
    expect(snap.total).toBe(2);
    expect(snap.rooms.find((r) => r.id === "world:kings-hall")!.count).toBe(2);
  });

  it("a connection with no identity key counts once, as itself", () => {
    const palace = newPalace();
    palace.hallRoom.attach(fakeSocket(), { userId: null, displayName: "Probe", avatarUrl: null, profileSlug: null });
    const snap = palace.presenceSnapshot();
    expect(snap.total).toBe(1);
    expect(snap.rooms.find((r) => r.id === "world:kings-hall")!.members).toEqual(["Probe"]);
  });

  it("an empty palace reads zero everywhere", () => {
    const snap = newPalace().presenceSnapshot();
    expect(snap.total).toBe(0);
    expect(snap.rooms.every((r) => r.count === 0)).toBe(true);
  });
});
