/**
 * The World — presence protocol tests (lib/world-room).
 *
 * Drives WorldRoom exactly the way routes/world.ts does: fake sockets
 * with the WsClientSocket surface, JSON frames in, JSON frames out.
 * Pinned contract:
 * - join → welcome snapshot (self + everyone already inside); others
 *   get peer.join. Disconnect → peer.leave despawn broadcast.
 * - presence cap 30: the 31st arrival gets an honest room_full frame
 *   and a 4429 close — nobody is silently queued or ghosted in.
 * - move sync broadcasts to everyone EXCEPT the mover, is throttled
 *   server-side to ~10/s per peer, and positions clamp to the hall.
 * - say: members only (guests are look-only), paced, trimmed, capped.
 * - voice: members only, mesh cap 12 with voice.full, signaling relays
 *   ONLY between two voice members and carries the sender's peerId.
 * - characters: members only, id-only picks resolved + ownership-
 *   verified by the injected resolver; refused picks change nothing;
 *   a superseded resolution never lands; null clears for the room.
 */
import { describe, it, expect } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import {
  WorldRoom,
  tintForKey,
  WORLD_TINTS,
  WORLD_PRESENCE_CAP,
  WORLD_VOICE_CAP,
  HALL_BOUNDS,
  type WorldIdentity,
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

const member = (name: string): WorldIdentity => ({
  userId: `user-${name}`,
  displayName: name,
  avatarUrl: null,
  profileSlug: name.toLowerCase(),
});
const guest = (): WorldIdentity => ({ userId: null, displayName: "Guest", avatarUrl: null, profileSlug: null });

function frame(socket: FakeSocket, room: WorldRoom, payload: unknown, now?: number) {
  room.handleFrame(socket, JSON.stringify(payload), now);
}

function types(socket: FakeSocket): string[] {
  return socket.sent.map((m) => m.type as string);
}

describe("join / leave", () => {
  it("welcomes the joiner with a snapshot and announces them to the room", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();

    expect(room.attach(a, member("Alpha"))).toBe(true);
    const welcomeA = a.sent.find((m) => m.type === "welcome");
    expect(welcomeA.peers).toEqual([]);
    expect(welcomeA.you.displayName).toBe("Alpha");
    expect(welcomeA.you.guest).toBe(false);

    expect(room.attach(b, member("Beta"))).toBe(true);
    const welcomeB = b.sent.find((m) => m.type === "welcome");
    expect(welcomeB.peers.map((p: any) => p.displayName)).toEqual(["Alpha"]);
    expect(welcomeB.peerId).not.toBe(welcomeA.peerId);

    const joinSeenByA = a.sent.find((m) => m.type === "peer.join");
    expect(joinSeenByA.peer.displayName).toBe("Beta");
    expect(joinSeenByA.peer.peerId).toBe(welcomeB.peerId);
  });

  it("guests join as labeled guests", () => {
    const room = new WorldRoom(new RoomHub());
    const g = fakeSocket();
    room.attach(g, guest());
    const welcome = g.sent.find((m) => m.type === "welcome");
    expect(welcome.you.guest).toBe(true);
    expect(welcome.you.displayName).toBe("Guest");
  });

  it("despawns on detach — peer.leave to the room, voice.left first if they were in voice", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    frame(b, room, { type: "voice.join" });
    a.sent = [];
    room.detach(b);
    expect(types(a)).toEqual(["voice.left", "peer.leave"]);
    expect(room.size()).toBe(1);
    // A second detach is a no-op (close + error can both fire).
    room.detach(b);
    expect(types(a)).toEqual(["voice.left", "peer.leave"]);
  });

  it("refuses the 31st arrival with room_full + close 4429", () => {
    const room = new WorldRoom(new RoomHub());
    for (let i = 0; i < WORLD_PRESENCE_CAP; i++) {
      expect(room.attach(fakeSocket(), member(`M${i}`))).toBe(true);
    }
    const late = fakeSocket();
    expect(room.attach(late, member("Late"))).toBe(false);
    expect(late.sent).toEqual([{ type: "room_full", cap: WORLD_PRESENCE_CAP }]);
    expect(late.closedWith?.code).toBe(4429);
    expect(room.size()).toBe(WORLD_PRESENCE_CAP);
  });
});

describe("move sync", () => {
  it("broadcasts to everyone except the mover, clamped to the hall", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    a.sent = [];
    b.sent = [];

    frame(a, room, { type: "move", x: 999, z: -999, rotY: 1.25 }, 10_000);
    expect(a.sent).toEqual([]); // no echo
    const move = b.sent.find((m) => m.type === "peer.move");
    expect(move.x).toBe(HALL_BOUNDS.maxX);
    expect(move.z).toBe(HALL_BOUNDS.minZ);
    expect(move.rotY).toBeCloseTo(1.25);
  });

  it("throttles a peer to ~10 moves a second server-side", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    b.sent = [];

    frame(a, room, { type: "move", x: 1, z: 1, rotY: 0 }, 1_000);
    frame(a, room, { type: "move", x: 2, z: 2, rotY: 0 }, 1_050); // 50ms later — dropped
    frame(a, room, { type: "move", x: 3, z: 3, rotY: 0 }, 1_200); // 200ms later — through
    const moves = b.sent.filter((m) => m.type === "peer.move");
    expect(moves.map((m: any) => m.x)).toEqual([1, 3]);
  });

  it("ignores garbage frames without dying", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    room.handleFrame(a, "not json{{{", 5_000);
    room.handleFrame(a, JSON.stringify({ type: "move", x: "north", z: null }), 6_000);
    room.handleFrame(a, JSON.stringify({ type: "teleport" }), 7_000);
    const dto = room.peerFor(a);
    expect(dto).not.toBeNull();
    expect(Number.isFinite(dto!.x)).toBe(true);
    expect(Number.isFinite(dto!.z)).toBe(true);
  });
});

describe("say (room text)", () => {
  it("members speak to the whole room including themselves; guests cannot", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const g = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(g, guest());
    a.sent = [];
    g.sent = [];

    frame(a, room, { type: "say", body: "  the hall is open  " }, 1_000);
    const said = a.sent.find((m) => m.type === "peer.say");
    expect(said.body).toBe("the hall is open");
    expect(g.sent.some((m) => m.type === "peer.say")).toBe(true);

    frame(g, room, { type: "say", body: "let me in" }, 2_000);
    expect(a.sent.filter((m) => m.type === "peer.say")).toHaveLength(1);
  });

  it("paces say frames and caps their length", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    b.sent = [];
    frame(a, room, { type: "say", body: "x".repeat(500) }, 1_000);
    frame(a, room, { type: "say", body: "too fast" }, 1_100);
    const says = b.sent.filter((m) => m.type === "peer.say");
    expect(says).toHaveLength(1);
    expect(says[0].body).toHaveLength(300);
  });
});

describe("voice mesh membership + signaling", () => {
  it("voice.join announces to the room and answers with the current mesh", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));

    frame(a, room, { type: "voice.join" });
    const stateA = a.sent.find((m) => m.type === "voice.state");
    expect(stateA.voicePeerIds).toEqual([]);
    expect(b.sent.some((m) => m.type === "voice.joined")).toBe(true);

    frame(b, room, { type: "voice.join" });
    const stateB = b.sent.find((m) => m.type === "voice.state");
    const aId = a.sent.find((m) => m.type === "welcome").peerId;
    expect(stateB.voicePeerIds).toEqual([aId]);
    expect(room.voiceSize()).toBe(2);
  });

  it("guests are denied voice, honestly", () => {
    const room = new WorldRoom(new RoomHub());
    const g = fakeSocket();
    room.attach(g, guest());
    frame(g, room, { type: "voice.join" });
    expect(g.sent.find((m) => m.type === "voice.denied")?.reason).toBe("guests");
    expect(room.voiceSize()).toBe(0);
  });

  it("the 13th voice join gets voice.full — the mesh cap is real", () => {
    const room = new WorldRoom(new RoomHub());
    const sockets: FakeSocket[] = [];
    for (let i = 0; i < WORLD_VOICE_CAP; i++) {
      const s = fakeSocket();
      sockets.push(s);
      room.attach(s, member(`V${i}`));
      frame(s, room, { type: "voice.join" });
    }
    expect(room.voiceSize()).toBe(WORLD_VOICE_CAP);
    const late = fakeSocket();
    room.attach(late, member("LateVoice"));
    frame(late, room, { type: "voice.join" });
    expect(late.sent.some((m) => m.type === "voice.full" && m.cap === WORLD_VOICE_CAP)).toBe(true);
    expect(room.voiceSize()).toBe(WORLD_VOICE_CAP);
  });

  it("relays signaling only between two voice members, stamped with the sender", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    const c = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    room.attach(c, member("Quiet")); // never joins voice
    const aId = a.sent.find((m) => m.type === "welcome").peerId;
    const bId = b.sent.find((m) => m.type === "welcome").peerId;
    const cId = c.sent.find((m) => m.type === "welcome").peerId;
    frame(a, room, { type: "voice.join" });
    frame(b, room, { type: "voice.join" });
    a.sent = [];
    b.sent = [];
    c.sent = [];

    frame(a, room, { type: "voice.signal", to: bId, data: { kind: "offer", sdp: "v=0…" } });
    const relayed = b.sent.find((m) => m.type === "voice.signal");
    expect(relayed.from).toBe(aId);
    expect(relayed.data).toEqual({ kind: "offer", sdp: "v=0…" });

    // A non-voice member can't be signaled, and can't signal.
    frame(a, room, { type: "voice.signal", to: cId, data: { kind: "offer" } });
    frame(c, room, { type: "voice.signal", to: aId, data: { kind: "offer" } });
    expect(c.sent.some((m) => m.type === "voice.signal")).toBe(false);
    expect(a.sent.some((m) => m.type === "voice.signal")).toBe(false);
  });

  it("voice.leave leaves the mesh and stops signaling", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    const bId = b.sent.find((m) => m.type === "welcome").peerId;
    frame(a, room, { type: "voice.join" });
    frame(b, room, { type: "voice.join" });
    frame(a, room, { type: "voice.leave" });
    expect(room.voiceSize()).toBe(1);
    expect(b.sent.some((m) => m.type === "voice.left")).toBe(true);
    b.sent = [];
    frame(a, room, { type: "voice.signal", to: bId, data: { kind: "offer" } });
    expect(b.sent.some((m) => m.type === "voice.signal")).toBe(false);
  });
});

describe("vault characters (walk in as)", () => {
  const flush = () => new Promise<void>((r) => setImmediate(r));
  const NOVA = { id: "char-nova", name: "Nova", portraitUrl: "https://img.example/nova.png" };

  function roomWithResolver(resolveCharacter: (userId: string, id: string) => Promise<typeof NOVA | null>) {
    return new WorldRoom(new RoomHub(), { resolveCharacter });
  }

  it("resolves a member's pick and broadcasts the character to the whole room", async () => {
    const room = roomWithResolver(async (userId, id) => {
      expect(userId).toBe("user-Alpha");
      return id === NOVA.id ? NOVA : null;
    });
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    a.sent = [];
    b.sent = [];

    frame(a, room, { type: "character", characterId: NOVA.id });
    await flush();

    const seenByB = b.sent.find((m) => m.type === "peer.character");
    expect(seenByB.character).toEqual(NOVA);
    // The picker hears its own confirmation too (broadcast includes self).
    expect(a.sent.some((m) => m.type === "peer.character")).toBe(true);
    expect(room.peerFor(a)?.character).toEqual(NOVA);

    // A late joiner's welcome snapshot already carries the character.
    const c = fakeSocket();
    room.attach(c, member("Gamma"));
    const welcomeC = c.sent.find((m) => m.type === "welcome");
    expect(welcomeC.peers.find((p: any) => p.displayName === "Alpha")?.character).toEqual(NOVA);
  });

  it("refused picks (resolver says no) change nothing and broadcast nothing", async () => {
    const room = roomWithResolver(async () => null);
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    b.sent = [];
    frame(a, room, { type: "character", characterId: "not-mine" });
    await flush();
    expect(b.sent.some((m) => m.type === "peer.character")).toBe(false);
    expect(room.peerFor(a)?.character).toBeNull();
  });

  it("guests cannot pick a character", async () => {
    let called = false;
    const room = roomWithResolver(async () => {
      called = true;
      return NOVA;
    });
    const g = fakeSocket();
    room.attach(g, guest());
    frame(g, room, { type: "character", characterId: NOVA.id });
    await flush();
    expect(called).toBe(false);
    expect(room.peerFor(g)?.character).toBeNull();
  });

  it("a null pick clears the character for the whole room", async () => {
    const room = roomWithResolver(async () => NOVA);
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    frame(a, room, { type: "character", characterId: NOVA.id });
    await flush();
    b.sent = [];
    frame(a, room, { type: "character", characterId: null });
    const cleared = b.sent.find((m) => m.type === "peer.character");
    expect(cleared.character).toBeNull();
    expect(room.peerFor(a)?.character).toBeNull();
  });

  it("a superseded pick never lands after a newer one", async () => {
    const pending = new Map<string, (v: typeof NOVA | null) => void>();
    const room = roomWithResolver(
      (userId, id) => new Promise((resolve) => pending.set(id, resolve)),
    );
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    const SLOW = { id: "char-slow", name: "Slow", portraitUrl: "https://img.example/slow.png" };
    frame(a, room, { type: "character", characterId: SLOW.id });
    frame(a, room, { type: "character", characterId: NOVA.id });
    // The newer pick resolves first; the stale one resolves after.
    pending.get(NOVA.id)?.(NOVA);
    await flush();
    pending.get(SLOW.id)?.(SLOW);
    await flush();
    expect(room.peerFor(a)?.character).toEqual(NOVA);
    const broadcasts = b.sent.filter((m) => m.type === "peer.character");
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].character).toEqual(NOVA);
  });

  it("without an injected resolver, picks are inert", async () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    frame(a, room, { type: "character", characterId: NOVA.id });
    await flush();
    expect(room.peerFor(a)?.character).toBeNull();
  });
});

describe("house palace guards (walk in as)", () => {
  const flush = () => new Promise<void>((r) => setImmediate(r));
  const MALE = { id: "house:palace-guard", name: "Palace Guard", portraitUrl: "/world/default-character.png" };
  const FEMALE = {
    id: "house:palace-guard-female",
    name: "Palace Guard — Female",
    portraitUrl: "/world/default-character-female.png",
  };

  it("resolves a guard pick in the room — the vault resolver is never consulted", async () => {
    let resolverCalls = 0;
    const room = new WorldRoom(new RoomHub(), {
      resolveCharacter: async () => {
        resolverCalls++;
        return null;
      },
    });
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    b.sent = [];

    frame(a, room, { type: "character", characterId: MALE.id });
    await flush();

    expect(resolverCalls).toBe(0);
    expect(b.sent.find((m) => m.type === "peer.character")?.character).toEqual(MALE);
    expect(room.peerFor(a)?.character).toEqual(MALE);

    // A late joiner's welcome snapshot already carries the guard.
    const c = fakeSocket();
    room.attach(c, member("Gamma"));
    const welcomeC = c.sent.find((m) => m.type === "welcome");
    expect(welcomeC.peers.find((p: any) => p.displayName === "Alpha")?.character).toEqual(MALE);
  });

  it("the female guard resolves the same way — with no resolver injected at all", async () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    frame(a, room, { type: "character", characterId: FEMALE.id });
    await flush();
    expect(room.peerFor(a)?.character).toEqual(FEMALE);
  });

  it("guests cannot pick a guard either", async () => {
    const room = new WorldRoom(new RoomHub());
    const g = fakeSocket();
    room.attach(g, guest());
    frame(g, room, { type: "character", characterId: MALE.id });
    await flush();
    expect(room.peerFor(g)?.character).toBeNull();
  });

  it("a guard pick beats a vault resolution still in flight", async () => {
    const pending = new Map<string, (v: typeof NOVA | null) => void>();
    const room = new WorldRoom(new RoomHub(), {
      resolveCharacter: (userId, id) => new Promise((resolve) => pending.set(id, resolve)),
    });
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    frame(a, room, { type: "character", characterId: "char-slow" });
    frame(a, room, { type: "character", characterId: FEMALE.id });
    // The guard landed at once; the slow vault pick resolves after
    // and must not resurrect over it.
    expect(room.peerFor(a)?.character).toEqual(FEMALE);
    pending.get("char-slow")?.({ id: "char-slow", name: "Slow", portraitUrl: "https://img.example/slow.png" });
    await flush();
    expect(room.peerFor(a)?.character).toEqual(FEMALE);
  });

  it("clearing the pick clears the guard for the whole room", async () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    frame(a, room, { type: "character", characterId: MALE.id });
    await flush();
    b.sent = [];
    frame(a, room, { type: "character", characterId: null });
    expect(b.sent.find((m) => m.type === "peer.character")?.character).toBeNull();
    expect(room.peerFor(a)?.character).toBeNull();
  });
});

describe("the voice switch (voice.off)", () => {
  it("flags the peer in the DTO and broadcasts peer.voiceoff to the room", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    const bId = b.sent.find((m) => m.type === "welcome").peerId;

    frame(a, room, { type: "voice.off", off: true });
    const seenByB = b.sent.find((m) => m.type === "peer.voiceoff");
    expect(seenByB).toMatchObject({ peerId: expect.any(String), off: true });
    expect(room.peerFor(a)?.voiceOff).toBe(true);
    // The sender hears its own flip back (plates settle from one source).
    expect(a.sent.some((m) => m.type === "peer.voiceoff" && m.off === true)).toBe(true);
    expect(bId).toBeTruthy();

    // A late joiner's snapshot carries the flag from the first frame.
    const c = fakeSocket();
    room.attach(c, member("Cara"));
    const snap = c.sent.find((m) => m.type === "welcome");
    expect(snap.peers.find((p: any) => p.displayName === "Alpha")?.voiceOff).toBe(true);
    expect(snap.peers.find((p: any) => p.displayName === "Beta")?.voiceOff).toBe(false);
  });

  it("switching off while in voice leaves the mesh first, then flags", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    frame(a, room, { type: "voice.join" });
    expect(room.voiceSize()).toBe(1);
    b.sent.length = 0;

    frame(a, room, { type: "voice.off", off: true });
    expect(room.voiceSize()).toBe(0);
    expect(types(b)).toEqual(["voice.left", "peer.voiceoff"]);
    // And signaling is closed to them now — they're out of the mesh.
    frame(b, room, { type: "voice.join" });
    frame(a, room, { type: "voice.signal", to: "nobody", data: { kind: "offer" } });
    expect(room.peerFor(a)?.voice).toBe(false);
  });

  it("switching back on clears the flag without joining voice", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    frame(a, room, { type: "voice.off", off: true });
    b.sent.length = 0;

    frame(a, room, { type: "voice.off", off: false });
    expect(room.peerFor(a)?.voiceOff).toBe(false);
    expect(room.peerFor(a)?.voice).toBe(false);
    expect(types(b)).toEqual(["peer.voiceoff"]);
    expect(b.sent[0]).toMatchObject({ off: false });
  });

  it("a redundant flip broadcasts nothing; guests can't flip at all", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const g = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(g, guest());
    a.sent.length = 0;
    g.sent.length = 0;

    frame(a, room, { type: "voice.off", off: false }); // already on
    expect(a.sent).toEqual([]);
    frame(g, room, { type: "voice.off", off: true }); // guest — ignored
    expect(room.peerFor(g)?.voiceOff).toBe(false);
    expect(types(a)).toEqual([]);
  });
});

describe("deafen (voice.deaf)", () => {
  it("flags the peer in the DTO and broadcasts peer.voicedeaf to the room", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));

    frame(a, room, { type: "voice.deaf", deaf: true });
    const seenByB = b.sent.find((m) => m.type === "peer.voicedeaf");
    expect(seenByB).toMatchObject({ peerId: expect.any(String), deaf: true });
    expect(room.peerFor(a)?.voiceDeaf).toBe(true);
    expect(room.peerFor(a)?.voiceOff).toBe(false);
    // The sender hears its own flip back (plates settle from one source).
    expect(a.sent.some((m) => m.type === "peer.voicedeaf" && m.deaf === true)).toBe(true);

    // A late joiner's snapshot carries the flag from the first frame.
    const c = fakeSocket();
    room.attach(c, member("Cara"));
    const snap = c.sent.find((m) => m.type === "welcome");
    expect(snap.peers.find((p: any) => p.displayName === "Alpha")?.voiceDeaf).toBe(true);
    expect(snap.peers.find((p: any) => p.displayName === "Beta")?.voiceDeaf).toBe(false);
  });

  it("deafening does NOT leave the mesh — membership is untouched, no voice.left", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    frame(a, room, { type: "voice.join" });
    frame(b, room, { type: "voice.join" });
    expect(room.voiceSize()).toBe(2);
    b.sent.length = 0;

    frame(a, room, { type: "voice.deaf", deaf: true });
    expect(room.voiceSize()).toBe(2);
    expect(room.peerFor(a)?.voice).toBe(true);
    expect(types(b)).toEqual(["peer.voicedeaf"]);

    // And lifting it is just the flag flipping back — still in voice.
    frame(a, room, { type: "voice.deaf", deaf: false });
    expect(room.peerFor(a)?.voiceDeaf).toBe(false);
    expect(room.peerFor(a)?.voice).toBe(true);
    expect(room.voiceSize()).toBe(2);
  });

  it("voice-off clears a standing deafen: the room hears undeaf, then off", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    frame(a, room, { type: "voice.join" });
    frame(a, room, { type: "voice.deaf", deaf: true });
    b.sent.length = 0;

    frame(a, room, { type: "voice.off", off: true });
    expect(room.peerFor(a)?.voiceDeaf).toBe(false);
    expect(room.peerFor(a)?.voiceOff).toBe(true);
    expect(room.voiceSize()).toBe(0);
    expect(types(b)).toEqual(["voice.left", "peer.voicedeaf", "peer.voiceoff"]);
    expect(b.sent.find((m) => m.type === "peer.voicedeaf")).toMatchObject({ deaf: false });
  });

  it("a redundant deafen broadcasts nothing; guests can't deafen at all", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const g = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(g, guest());
    a.sent.length = 0;
    g.sent.length = 0;

    frame(a, room, { type: "voice.deaf", deaf: false }); // already hearing
    expect(a.sent).toEqual([]);
    frame(g, room, { type: "voice.deaf", deaf: true }); // guest — ignored
    expect(room.peerFor(g)?.voiceDeaf).toBe(false);
    expect(types(a)).toEqual([]);
  });
});

describe("the stage + screen", () => {
  const flush = () => new Promise<void>((r) => setImmediate(r));
  const videoRef = {
    id: "video:v1",
    title: "Big Video",
    url: "https://cdn.example/v.mp4",
    mediaKind: "file" as const,
    creatorName: "Alpha",
  };
  const stageRoom = () =>
    new WorldRoom(new RoomHub(), {
      resolveStageStream: async (userId, streamId) =>
        streamId === "stream-1"
          ? {
              streamId,
              title: "Friday Set",
              performerName: userId.replace("user-", ""),
              performerSlug: userId.replace("user-", "").toLowerCase(),
            }
          : null,
      resolveScreenVideo: async (_userId, videoId) => (videoId === "video:v1" ? videoRef : null),
    });
  const king = (): WorldIdentity => ({ ...member("King"), admin: true });
  const lastScreen = (s: FakeSocket) => [...s.sent].reverse().find((m) => m.type === "screen.state")?.screen;

  it("a verified live claim takes the stage and every screen follows; a late joiner's welcome carries it", async () => {
    const room = stageRoom();
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Bravo"));
    a.sent.length = 0;
    b.sent.length = 0;

    frame(a, room, { type: "stage.live", streamId: "stream-1" });
    await flush();
    expect(lastScreen(b)?.mode).toBe("live");
    expect(lastScreen(b)?.holder?.name).toBe("Alpha");
    expect(lastScreen(b)?.streamId).toBe("stream-1");
    expect(room.stageStreamId()).toBe("stream-1");

    const late = fakeSocket();
    room.attach(late, member("Late"));
    const welcome = late.sent.find((m) => m.type === "welcome");
    expect(welcome?.screen?.mode).toBe("live");
    expect(welcome?.screen?.holder?.name).toBe("Alpha");
  });

  it("a refused verification changes nothing — no claim, no broadcast", async () => {
    const room = stageRoom();
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Bravo"));
    b.sent.length = 0;
    frame(a, room, { type: "stage.live", streamId: "someone-elses" });
    await flush();
    expect(types(b)).toEqual([]);
    expect(room.screenBroadcast().holder).toBeNull();
    expect(room.screenBroadcast().mode).toBe("reel");
  });

  it("one hand on the screen: a non-holder is denied, the holder drives play/pause off the server stamp", async () => {
    const room = stageRoom();
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Bravo"));
    frame(a, room, { type: "stage.video", videoId: "video:v1" }, 1_000);
    await flush();
    expect(room.screenBroadcast(null, 11_000).playback).toEqual({ playing: true, positionSec: 10 });

    b.sent.length = 0;
    frame(b, room, { type: "screen.playpause", playing: false, positionSec: 3 }, 12_000);
    frame(b, room, { type: "stage.end" }, 12_000);
    frame(b, room, { type: "stage.video", videoId: "video:v1" }, 12_000);
    await flush();
    expect(types(b)).toEqual(["screen.denied", "screen.denied", "screen.denied"]);
    expect(room.screenBroadcast().holder?.name).toBe("Alpha");

    frame(a, room, { type: "screen.playpause", playing: false, positionSec: 42 }, 13_000);
    expect(room.screenBroadcast(null, 99_000).playback).toEqual({ playing: false, positionSec: 42 });
  });

  it("the holder can park the screen on the Reel without giving up the stage, then end the show", async () => {
    const room = stageRoom();
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Bravo"));
    frame(a, room, { type: "stage.live", streamId: "stream-1" });
    await flush();
    frame(a, room, { type: "screen.reel" });
    expect(lastScreen(b)?.mode).toBe("reel");
    expect(lastScreen(b)?.holder?.name).toBe("Alpha");
    frame(a, room, { type: "stage.end" });
    expect(lastScreen(b)?.holder).toBeNull();
    expect(room.screenBroadcast().holder).toBeNull();
  });

  it("the holder leaving releases the stage — no orphaned show", async () => {
    const room = stageRoom();
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Bravo"));
    frame(a, room, { type: "stage.live", streamId: "stream-1" });
    await flush();
    b.sent.length = 0;
    room.detach(a);
    expect(lastScreen(b)?.mode).toBe("reel");
    expect(lastScreen(b)?.holder).toBeNull();
    expect(lastScreen(b)?.notice).toContain("Alpha");
    expect(room.screenBroadcast().holder).toBeNull();
  });

  it("guests never take the stage", async () => {
    const room = stageRoom();
    const g = fakeSocket();
    const b = fakeSocket();
    room.attach(g, guest());
    room.attach(b, member("Bravo"));
    b.sent.length = 0;
    frame(g, room, { type: "stage.live", streamId: "stream-1" });
    await flush();
    expect(types(b)).toEqual([]);
    expect(room.screenBroadcast().holder).toBeNull();
  });
});

describe("host authority", () => {
  const flush = () => new Promise<void>((r) => setImmediate(r));
  const king = (): WorldIdentity => ({ ...member("King"), admin: true });
  const stageRoom = () =>
    new WorldRoom(new RoomHub(), {
      resolveStageStream: async (userId, streamId) =>
        streamId === "stream-1"
          ? {
              streamId,
              title: "Friday Set",
              performerName: userId.replace("user-", ""),
              performerSlug: userId.replace("user-", "").toLowerCase(),
            }
          : null,
    });
  const lastScreen = (s: FakeSocket) => [...s.sent].reverse().find((m) => m.type === "screen.state")?.screen;

  it("the host takes the stage instantly, announced honestly", async () => {
    const room = stageRoom();
    const a = fakeSocket();
    const k = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(k, king());
    frame(a, room, { type: "stage.live", streamId: "stream-1" });
    await flush();
    expect(room.screenBroadcast().holder?.name).toBe("Alpha");
    frame(k, room, { type: "stage.live", streamId: "stream-1" });
    await flush();
    expect(lastScreen(a)?.holder?.name).toBe("King");
    expect(lastScreen(a)?.notice).toBe("The host took the stage.");
  });

  it("the host can end someone else's show", async () => {
    const room = stageRoom();
    const a = fakeSocket();
    const k = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(k, king());
    frame(a, room, { type: "stage.live", streamId: "stream-1" });
    await flush();
    frame(k, room, { type: "stage.end" });
    expect(room.screenBroadcast().holder).toBeNull();
    expect(lastScreen(a)?.notice).toBe("The host ended the show.");
  });

  it("host mute drops the member from the mesh and voice.join refuses them until lifted", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const k = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(k, king());
    const alphaId = room.peerFor(a)!.peerId;
    frame(a, room, { type: "voice.join" });
    expect(room.peerFor(a)?.voice).toBe(true);

    a.sent.length = 0;
    frame(k, room, { type: "admin.mute", peerId: alphaId, muted: true });
    expect(room.peerFor(a)?.voice).toBe(false);
    expect(room.peerFor(a)?.hostMuted).toBe(true);
    expect(types(a)).toContain("voice.left");
    expect(types(a)).toContain("peer.hostmute");

    a.sent.length = 0;
    frame(a, room, { type: "voice.join" });
    expect(a.sent).toEqual([{ type: "voice.denied", reason: "host" }]);

    frame(k, room, { type: "admin.mute", peerId: alphaId, muted: false });
    frame(a, room, { type: "voice.join" });
    expect(room.peerFor(a)?.voice).toBe(true);
  });

  it("host removal: the honest frame, the despawn, the 4413 close", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const k = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(k, king());
    room.attach(b, member("Bravo"));
    const alphaId = room.peerFor(a)!.peerId;
    a.sent.length = 0;
    b.sent.length = 0;
    frame(k, room, { type: "admin.remove", peerId: alphaId });
    expect(a.sent[0]).toEqual({ type: "removed", reason: "host" });
    expect(a.closedWith).toEqual({ code: 4413, reason: "removed_by_host" });
    expect(room.peerFor(a)).toBeNull();
    expect(types(b)).toContain("peer.leave");
  });

  it("non-hosts are refused host actions — and told so", () => {
    const room = new WorldRoom(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Bravo"));
    const bravoId = room.peerFor(b)!.peerId;
    a.sent.length = 0;
    frame(a, room, { type: "admin.mute", peerId: bravoId, muted: true });
    frame(a, room, { type: "admin.remove", peerId: bravoId });
    expect(a.sent).toEqual([{ type: "admin.denied" }, { type: "admin.denied" }]);
    expect(room.peerFor(b)?.hostMuted).toBe(false);
    expect(b.closedWith).toBeNull();
  });
});

describe("tints", () => {
  it("are stable per key and always from the house palette", () => {
    expect(tintForKey("hall-member")).toBe(tintForKey("hall-member"));
    for (const key of ["a", "some-creator", "thy-cheat-code", "user-123"]) {
      expect(WORLD_TINTS).toContain(tintForKey(key));
    }
  });
});
