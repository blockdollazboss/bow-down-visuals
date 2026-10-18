/**
 * The World — stars on the peer record + witnessed moments
 * (lib/world-room, THE-GAME §5(a)).
 *
 * Pinned contract:
 * - The peer record carries a member's Creator Level `stars` (door-
 *   resolved on the identity); guests carry NO stars field at all.
 * - `moment.celebrate` is a bare intent: the server verifies the win
 *   against its own rails before broadcasting `peer.moment` —
 *   a quest claim must be recorded within MOMENT_QUEST_WINDOW_MS
 *   and its name + reward come from the recorded claim (QUEST_DEFS),
 *   never from the client; a levelup reads the CURRENT stars from
 *   the level rails and broadcasts only an increase over the
 *   session's announced high-water mark (dedupe, no replay spam).
 * - Guests' celebrate intents are dropped (resolver never called).
 * - At most one moment per peer per MOMENT_MIN_INTERVAL_MS.
 * - A levelup restars the peer record itself (late joiners + doorway
 *   transfers carry the new rank; the transfer also carries the
 *   dedupe mark so the moment can't replay in the next room).
 */
import { describe, it, expect, vi } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import {
  WorldRoom,
  MOMENT_MIN_INTERVAL_MS,
  MOMENT_QUEST_WINDOW_MS,
  type WorldIdentity,
  type WorldQuestClaimFact,
} from "../world-room";

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

const member = (name: string, stars?: number): WorldIdentity => ({
  userId: `user-${name}`,
  displayName: name,
  avatarUrl: null,
  profileSlug: name.toLowerCase(),
  ...(typeof stars === "number" ? { stars } : {}),
});
const guest = (): WorldIdentity => ({ userId: null, displayName: "Guest", avatarUrl: null, profileSlug: null });

function frame(socket: FakeSocket, room: WorldRoom, payload: unknown, now?: number) {
  room.handleFrame(socket, JSON.stringify(payload), now);
}

const flush = () => new Promise<void>((r) => setImmediate(r));

const NOW = 1_000_000;

function claimFact(over: Partial<WorldQuestClaimFact> = {}): WorldQuestClaimFact {
  return {
    questKey: "export-video",
    questName: "Export a video",
    rewardVb: 120,
    claimedAtMs: NOW - 30_000,
    ...over,
  };
}

describe("stars on the peer record", () => {
  it("a member's stars ride the welcome, the snapshot and peer.join; a guest has no stars field", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    const g = fakeSocket();

    room.attach(a, member("Alpha", 4));
    const welcomeA = a.sent.find((m) => m.type === "welcome");
    expect(welcomeA.you.stars).toBe(4);

    room.attach(b, member("Beta", 2));
    const welcomeB = b.sent.find((m) => m.type === "welcome");
    expect(welcomeB.you.stars).toBe(2);
    expect(welcomeB.peers.find((p: any) => p.displayName === "Alpha").stars).toBe(4);
    const joinSeenByA = a.sent.find((m) => m.type === "peer.join" && m.peer.displayName === "Beta");
    expect(joinSeenByA.peer.stars).toBe(2);

    room.attach(g, guest());
    const welcomeG = g.sent.find((m) => m.type === "welcome");
    expect(welcomeG.you.guest).toBe(true);
    expect("stars" in welcomeG.you).toBe(false);
    const guestJoinSeenByA = a.sent.find((m) => m.type === "peer.join" && m.peer.guest === true);
    expect("stars" in guestJoinSeenByA.peer).toBe(false);
    /* The guest's snapshot of the members still shows THEIR stars —
     * guests see the game (the aspiration is the advertisement). */
    expect(welcomeG.peers.find((p: any) => p.displayName === "Alpha").stars).toBe(4);
  });

  it("a member whose door resolution found no stars carries no stars field", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    const welcome = a.sent.find((m) => m.type === "welcome");
    expect("stars" in welcome.you).toBe(false);
  });

  it("an out-of-range stars value on the identity is never carried", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    room.attach(a, member("Alpha", 99));
    const welcome = a.sent.find((m) => m.type === "welcome");
    expect("stars" in welcome.you).toBe(false);
  });
});

describe("witnessed quest moments", () => {
  it("broadcasts a verified claim with ALL content from the server's records", async () => {
    const findRecentQuestClaim = vi.fn(async () => claimFact());
    const room = new WorldRoom(new RoomHub(), { findRecentQuestClaim });
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha", 3));
    room.attach(b, member("Beta", 1));
    a.sent = [];
    b.sent = [];

    frame(a, room, { type: "moment.celebrate", kind: "quest" }, NOW);
    await flush();

    expect(findRecentQuestClaim).toHaveBeenCalledWith("user-Alpha", NOW - MOMENT_QUEST_WINDOW_MS);
    const momentA = a.sent.find((m) => m.type === "peer.moment");
    const momentB = b.sent.find((m) => m.type === "peer.moment");
    /* The achiever witnesses their own moment too (the broadcast is
     * room-wide, sender included — unlike peer.join/move). */
    expect(momentA).toBeTruthy();
    expect(momentB.moment).toEqual({
      kind: "quest",
      peerId: momentA.moment.peerId,
      name: "Alpha",
      questName: "Export a video",
      rewardVb: 120,
    });
    /* No balance, no progress detail rides a moment. */
    expect(Object.keys(momentB.moment).sort()).toEqual(["kind", "name", "peerId", "questName", "rewardVb"]);
  });

  it("refuses when no claim is on record", async () => {
    const findRecentQuestClaim = vi.fn(async () => null);
    const room = new WorldRoom(new RoomHub(), { findRecentQuestClaim });
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha", 3));
    room.attach(b, member("Beta", 1));
    a.sent = [];
    b.sent = [];

    frame(a, room, { type: "moment.celebrate", kind: "quest" }, NOW);
    await flush();
    expect(a.sent.filter((m) => m.type === "peer.moment")).toEqual([]);
    expect(b.sent.filter((m) => m.type === "peer.moment")).toEqual([]);
  });

  it("refuses a claim outside the freshness window even if the finder returns one", async () => {
    const findRecentQuestClaim = vi.fn(async () =>
      claimFact({ claimedAtMs: NOW - MOMENT_QUEST_WINDOW_MS - 1 }),
    );
    const room = new WorldRoom(new RoomHub(), { findRecentQuestClaim });
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha", 3));
    room.attach(b, member("Beta", 1));
    b.sent = [];

    frame(a, room, { type: "moment.celebrate", kind: "quest" }, NOW);
    await flush();
    expect(b.sent.filter((m) => m.type === "peer.moment")).toEqual([]);
  });

  it("one claim, one moment: a re-sent intent inside the window does not re-announce the same claim", async () => {
    const findRecentQuestClaim = vi.fn(async () => claimFact());
    const room = new WorldRoom(new RoomHub(), { findRecentQuestClaim });
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha", 3));
    room.attach(b, member("Beta", 1));
    b.sent = [];

    frame(a, room, { type: "moment.celebrate", kind: "quest" }, NOW);
    await flush();
    frame(a, room, { type: "moment.celebrate", kind: "quest" }, NOW + MOMENT_MIN_INTERVAL_MS + 1);
    await flush();
    expect(b.sent.filter((m) => m.type === "peer.moment")).toHaveLength(1);
  });

  it("rate-limits: a second (different) claim inside the interval is not witnessed until the slot frees", async () => {
    let current = claimFact();
    const findRecentQuestClaim = vi.fn(async () => current);
    const room = new WorldRoom(new RoomHub(), { findRecentQuestClaim });
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha", 3));
    room.attach(b, member("Beta", 1));
    b.sent = [];

    frame(a, room, { type: "moment.celebrate", kind: "quest" }, NOW);
    await flush();
    current = claimFact({ questKey: "generate-song", questName: "Generate a song", rewardVb: 80, claimedAtMs: NOW + 500 });
    frame(a, room, { type: "moment.celebrate", kind: "quest" }, NOW + 1_000);
    await flush();
    expect(b.sent.filter((m) => m.type === "peer.moment")).toHaveLength(1);

    frame(a, room, { type: "moment.celebrate", kind: "quest" }, NOW + MOMENT_MIN_INTERVAL_MS);
    await flush();
    const moments = b.sent.filter((m) => m.type === "peer.moment");
    expect(moments).toHaveLength(2);
    expect(moments[1].moment.questName).toBe("Generate a song");
  });
});

describe("witnessed level-up moments", () => {
  it("broadcasts an increase from the level rails, restars the peer record, and dedupes the replay", async () => {
    let rails = 3;
    const resolveStars = vi.fn(async () => rails);
    const room = new WorldRoom(new RoomHub(), { resolveStars });
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha", 2));
    room.attach(b, member("Beta", 1));
    a.sent = [];
    b.sent = [];

    frame(a, room, { type: "moment.celebrate", kind: "levelup" }, NOW);
    await flush();
    const moment = b.sent.find((m) => m.type === "peer.moment");
    expect(moment.moment).toEqual({ kind: "levelup", peerId: moment.moment.peerId, name: "Alpha", stars: 3 });
    /* The record itself restarred: the room's own read of the peer
     * (and any late joiner's snapshot) carries the new rank. */
    expect(room.peerFor(a)?.stars).toBe(3);

    /* Same level again (rails unchanged): no replay. */
    frame(a, room, { type: "moment.celebrate", kind: "levelup" }, NOW + MOMENT_MIN_INTERVAL_MS);
    await flush();
    expect(b.sent.filter((m) => m.type === "peer.moment")).toHaveLength(1);

    /* A further rise IS news. */
    rails = 5;
    frame(a, room, { type: "moment.celebrate", kind: "levelup" }, NOW + 2 * MOMENT_MIN_INTERVAL_MS);
    await flush();
    const moments = b.sent.filter((m) => m.type === "peer.moment");
    expect(moments).toHaveLength(2);
    expect(moments[1].moment.stars).toBe(5);
    expect(room.peerFor(a)?.stars).toBe(5);
  });

  it("refuses when the rails read at or below the announced mark, or no level is recorded", async () => {
    let rails: number | null = 2;
    const resolveStars = vi.fn(async () => rails);
    const room = new WorldRoom(new RoomHub(), { resolveStars });
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha", 2));
    room.attach(b, member("Beta", 1));
    b.sent = [];

    /* Rails read the join level itself — nothing rose. */
    frame(a, room, { type: "moment.celebrate", kind: "levelup" }, NOW);
    await flush();
    expect(b.sent.filter((m) => m.type === "peer.moment")).toEqual([]);

    /* No level on record at all. */
    rails = null;
    frame(a, room, { type: "moment.celebrate", kind: "levelup" }, NOW + MOMENT_MIN_INTERVAL_MS);
    await flush();
    expect(b.sent.filter((m) => m.type === "peer.moment")).toEqual([]);
    expect(room.peerFor(a)?.stars).toBe(2);
  });

  it("carries the restarred record + the dedupe mark across a doorway transfer", async () => {
    const resolveStars = vi.fn(async () => 4);
    const hub = new RoomHub();
    const roomA = new WorldRoom(hub, { resolveStars });
    const roomB = new WorldRoom(hub, { resolveStars }, { roomId: "world:music-hall", name: "Music Hall" });
    const a = fakeSocket();
    roomA.attach(a, member("Alpha", 2));
    frame(a, roomA, { type: "moment.celebrate", kind: "levelup" }, NOW);
    await flush();
    expect(roomA.peerFor(a)?.stars).toBe(4);

    const state = roomA.peekTransferState(a)!;
    expect(state.identity.stars).toBe(4);
    expect(state.announcedStars).toBe(4);
    roomA.detach(a);
    a.sent = [];
    expect(
      roomB.attach(a, state.identity, {
        peerId: state.peerId,
        character: state.character,
        voiceOff: state.voiceOff,
        voiceDeaf: state.voiceDeaf,
        announcedStars: state.announcedStars,
      }),
    ).toBe(true);
    const welcome = a.sent.find((m) => m.type === "welcome");
    expect(welcome.you.stars).toBe(4);

    /* The same level in the new room is NOT re-announced — the
     * session already witnessed it. */
    const watcher = fakeSocket();
    roomB.attach(watcher, member("Watcher", 1));
    watcher.sent = [];
    frame(a, roomB, { type: "moment.celebrate", kind: "levelup" }, NOW + MOMENT_MIN_INTERVAL_MS);
    await flush();
    expect(watcher.sent.filter((m) => m.type === "peer.moment")).toEqual([]);
  });
});

describe("guests never star", () => {
  it("drops a guest's celebrate intents without touching the rails", async () => {
    const findRecentQuestClaim = vi.fn(async () => claimFact());
    const resolveStars = vi.fn(async () => 6);
    const room = new WorldRoom(new RoomHub(), { findRecentQuestClaim, resolveStars });
    const g = fakeSocket();
    const b = fakeSocket();
    room.attach(g, guest());
    room.attach(b, member("Beta", 1));
    b.sent = [];

    frame(g, room, { type: "moment.celebrate", kind: "quest" }, NOW);
    frame(g, room, { type: "moment.celebrate", kind: "levelup" }, NOW + MOMENT_MIN_INTERVAL_MS);
    await flush();
    expect(findRecentQuestClaim).not.toHaveBeenCalled();
    expect(resolveStars).not.toHaveBeenCalled();
    expect(b.sent.filter((m) => m.type === "peer.moment")).toEqual([]);
  });

  it("ignores unknown kinds and intents in a room with no moment rails wired", async () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha", 3));
    room.attach(b, member("Beta", 1));
    b.sent = [];
    frame(a, room, { type: "moment.celebrate", kind: "jackpot" }, NOW);
    frame(a, room, { type: "moment.celebrate", kind: "quest" }, NOW + MOMENT_MIN_INTERVAL_MS);
    await flush();
    expect(b.sent.filter((m) => m.type === "peer.moment")).toEqual([]);
  });
});
