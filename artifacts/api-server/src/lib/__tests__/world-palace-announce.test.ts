/**
 * The palace announce channel (lib/world-palace + lib/world-room,
 * Ring 3, THE-GAME §5(b)).
 *
 * Pinned contract:
 * - `palace.announce` is ONE frame shape delivered to every occupied
 *   room at once, stamped with the server time. Empty rooms get
 *   nothing (there is nobody to hear it).
 * - Room moments cross the walls through the room's onAnnounce hook:
 *   a drop landing in the Music Hall is heralded in the hall (and
 *   everywhere else); a level rising in any room is heralded
 *   palace-wide with the server-read stars; a show starting —
 *   booked or walk-in — is heralded with its title + host.
 * - The room-scoped frames are untouched: drop.landed still speaks
 *   only to the room the chest fell in (claiming stays local), and
 *   peer.moment still witnesses to the room first.
 * - The host's herald (announce.herald) is registry-intercepted and
 *   host-verified: a member or guest attempt answers the sender
 *   alone with announce.denied and the palace never speaks; the
 *   text is trimmed + capped at HERALD_MAX_CHARS; heralds are
 *   rate-limited per host (HERALD_MIN_INTERVAL_MS).
 */
import { describe, it, expect } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import { WorldPalace, HERALD_MAX_CHARS, HERALD_MIN_INTERVAL_MS } from "../world-palace";
import { WORLD_ROOM_ID, type WorldIdentity } from "../world-room";

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

const member = (name: string, over: Partial<WorldIdentity> = {}): WorldIdentity => ({
  userId: `user-${name}`,
  displayName: name,
  avatarUrl: null,
  profileSlug: name.toLowerCase(),
  ...over,
});
const guest = (): WorldIdentity => ({
  userId: null,
  displayName: "Guest",
  avatarUrl: null,
  profileSlug: null,
});

const MUSIC = "world:music-hall";
const COURTYARD = "world:courtyard";

function frame(palace: WorldPalace, socket: FakeSocket, payload: unknown, now?: number) {
  palace.handleFrame(socket, JSON.stringify(payload), now);
}

function walkTo(palace: WorldPalace, socket: FakeSocket, roomId: string) {
  frame(palace, socket, { type: "room.enter", roomId });
}

const flush = () => new Promise<void>((r) => setImmediate(r));

function announces(socket: FakeSocket): any[] {
  return socket.sent.filter((m) => m.type === "palace.announce").map((m) => m.announce);
}

describe("palace.announce delivery", () => {
  it("reaches every occupied room once, stamped; empty rooms are skipped silently", () => {
    const palace = new WorldPalace(new RoomHub());
    const a = fakeSocket();
    const b = fakeSocket();
    palace.enterHall(a, member("Alpha"));
    palace.enterHall(b, member("Beta"));
    walkTo(palace, b, MUSIC);
    a.sent = [];
    b.sent = [];

    palace.announce({ kind: "herald", text: "Court is called.", name: "The King" });

    for (const s of [a, b]) {
      const got = announces(s);
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({ kind: "herald", text: "Court is called.", name: "The King" });
      expect(typeof got[0].at).toBe("number");
    }
  });
});

describe("room moments cross the walls", () => {
  it("a drop landing in the Music Hall is heralded palace-wide; claiming stays room-scoped", () => {
    const palace = new WorldPalace(new RoomHub(), {
      claimWorldDrop: async () => ({ ok: true as const }),
    });
    const inHall = fakeSocket();
    const inMusic = fakeSocket();
    palace.enterHall(inHall, member("Alpha"));
    palace.enterHall(inMusic, member("Beta"));
    walkTo(palace, inMusic, MUSIC);
    inHall.sent = [];
    inMusic.sent = [];

    const landed = palace
      .room(MUSIC)!
      .landDrop({ eventId: "evt-1", title: "Shark Drop", amountVb: 250, claimCap: 5 });
    expect(landed).toBe(true);

    const hallHeard = announces(inHall);
    expect(hallHeard).toHaveLength(1);
    expect(hallHeard[0]).toMatchObject({
      kind: "drop",
      roomId: MUSIC,
      roomName: "Music Hall",
      amountVb: 250,
    });
    expect(hallHeard[0].text).toContain("Music Hall");
    // The room itself still gets its claim surface, and ONLY the room.
    expect(inMusic.sent.some((m) => m.type === "drop.landed")).toBe(true);
    expect(inHall.sent.some((m) => m.type === "drop.landed")).toBe(false);
  });

  it("a level rising in the Courtyard is heralded palace-wide with the server-read stars", async () => {
    const palace = new WorldPalace(new RoomHub(), {
      resolveStars: async () => 5,
    });
    const inHall = fakeSocket();
    const riser = fakeSocket();
    palace.enterHall(inHall, member("Alpha"));
    palace.enterHall(riser, member("Riser", { stars: 2 }));
    walkTo(palace, riser, COURTYARD);
    inHall.sent = [];

    frame(palace, riser, { type: "moment.celebrate", kind: "levelup" }, 1_000_000);
    await flush();

    const heard = announces(inHall);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ kind: "levelup", name: "Riser", stars: 5, roomId: COURTYARD });
    // The room's own witnessed moment still fired in the room itself
    // (the room broadcast includes the riser standing in it).
    expect(riser.sent.some((m) => m.type === "peer.moment")).toBe(true);
  });

  it("a booked stage show starting is heralded palace-wide", () => {
    const palace = new WorldPalace(new RoomHub());
    const inMusic = fakeSocket();
    palace.enterHall(inMusic, member("Beta"));
    walkTo(palace, inMusic, MUSIC);
    inMusic.sent = [];

    const started = palace.room(WORLD_ROOM_ID)!.beginScheduledShow({
      eventId: "evt-show",
      hostUserId: "user-Host",
      hostName: "Host",
      hostSlug: "host",
      title: "Friday Live",
      content: { kind: "reel" },
    });
    expect(started).toBe(true);

    const heard = announces(inMusic);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ kind: "show", name: "Host", roomId: WORLD_ROOM_ID });
    expect(heard[0].text).toContain("Friday Live");
  });

  it("a walk-in show starting is heralded once; the holder re-claiming mid-show is not", async () => {
    const palace = new WorldPalace(new RoomHub(), {
      resolveStageStream: async (userId: string, streamId: string) => ({
        streamId,
        title: "My Stream",
        performerName: "Alpha",
        performerSlug: "alpha",
      }),
    });
    const inMusic = fakeSocket();
    const performer = fakeSocket();
    palace.enterHall(inMusic, member("Beta"));
    walkTo(palace, inMusic, MUSIC);
    palace.enterHall(performer, member("Alpha"));
    /* The stage is the hall's — admission lands on the plaza
     * (Phase 1), so the performer walks in before claiming it. */
    walkTo(palace, performer, WORLD_ROOM_ID);
    inMusic.sent = [];

    frame(palace, performer, { type: "stage.live", streamId: "s1" }, 2_000_000);
    await flush();
    expect(announces(inMusic)).toHaveLength(1);
    expect(announces(inMusic)[0]).toMatchObject({ kind: "show", name: "Alpha" });

    /* Same holder, second claim (a setlist change): no new herald. */
    frame(palace, performer, { type: "stage.live", streamId: "s2" }, 2_001_000);
    await flush();
    expect(announces(inMusic)).toHaveLength(1);
  });
});

describe("the host's herald", () => {
  const NOW = 5_000_000;

  it("an admin's herald speaks to the whole palace with their name on it", () => {
    const palace = new WorldPalace(new RoomHub());
    const king = fakeSocket();
    const inMusic = fakeSocket();
    palace.enterHall(king, member("King", { admin: true }));
    palace.enterHall(inMusic, member("Beta"));
    walkTo(palace, inMusic, MUSIC);
    inMusic.sent = [];

    frame(palace, king, { type: "announce.herald", text: "  Court gathers at eight.  " }, NOW);

    const heard = announces(inMusic);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ kind: "herald", text: "Court gathers at eight.", name: "King" });
  });

  it("a member's herald is denied to them alone; the palace never speaks", () => {
    const palace = new WorldPalace(new RoomHub());
    const m = fakeSocket();
    const other = fakeSocket();
    palace.enterHall(m, member("Alpha"));
    palace.enterHall(other, member("Beta"));
    m.sent = [];
    other.sent = [];

    frame(palace, m, { type: "announce.herald", text: "I am the king now" }, NOW);

    expect(m.sent.filter((x) => x.type === "announce.denied")).toHaveLength(1);
    expect(announces(m)).toHaveLength(0);
    expect(announces(other)).toHaveLength(0);
    expect(other.sent.filter((x) => x.type === "announce.denied")).toHaveLength(0);
  });

  it("a guest's herald is denied", () => {
    const palace = new WorldPalace(new RoomHub());
    const g = fakeSocket();
    palace.enterHall(g, guest());
    g.sent = [];
    frame(palace, g, { type: "announce.herald", text: "hello palace" }, NOW);
    expect(g.sent.filter((x) => x.type === "announce.denied")).toHaveLength(1);
    expect(announces(g)).toHaveLength(0);
  });

  it("herald text is capped, blank text is denied, and heralds are rate-limited per host", () => {
    const palace = new WorldPalace(new RoomHub());
    const king = fakeSocket();
    const ear = fakeSocket();
    palace.enterHall(king, member("King", { admin: true }));
    palace.enterHall(ear, member("Beta"));
    ear.sent = [];
    king.sent = [];

    frame(palace, king, { type: "announce.herald", text: "   " }, NOW);
    expect(king.sent.filter((x) => x.type === "announce.denied")).toHaveLength(1);
    expect(announces(ear)).toHaveLength(0);

    const long = "x".repeat(HERALD_MAX_CHARS + 60);
    frame(palace, king, { type: "announce.herald", text: long }, NOW + 1);
    expect(announces(ear)).toHaveLength(1);
    expect(announces(ear)[0].text).toHaveLength(HERALD_MAX_CHARS);

    /* Too soon after the last herald: denied, palace silent. */
    frame(palace, king, { type: "announce.herald", text: "Again!" }, NOW + 2);
    expect(announces(ear)).toHaveLength(1);
    expect(king.sent.filter((x) => x.type === "announce.denied")).toHaveLength(2);

    /* After the interval, the herald speaks again. */
    frame(palace, king, { type: "announce.herald", text: "Later." }, NOW + HERALD_MIN_INTERVAL_MS + 2);
    expect(announces(ear)).toHaveLength(2);
    expect(announces(ear)[1].text).toBe("Later.");
  });
});
