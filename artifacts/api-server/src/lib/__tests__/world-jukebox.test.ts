/**
 * The Music Hall jukebox (lib/world-room, jukeboxEnabled rooms).
 *
 * Drives a jukebox room the way routes/world.ts does: fake sockets,
 * frames in, frames out. Pinned contract:
 * - the welcome carries the jukebox (idle = no current, empty queue);
 *   rooms without the jukebox carry nothing and refuse its frames.
 * - adds are members-only and id-only: the injected resolver
 *   re-verifies the published track; a refused pick changes nothing
 *   and answers jukebox.denied. First add to an idle box starts it.
 * - playback rides ONE server anchor (the watch-party math): pause
 *   freezes the stamped position; a finished song hands over to the
 *   queue LAZILY — no timers — carrying its overshoot forward.
 * - transport belongs to the song's adder (or the host); anyone
 *   else's hands are refused honestly. Removing works on your own
 *   queued songs, never on the song that's playing.
 * - the queue is capped; an emptied room resets the box.
 */
import { describe, it, expect } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import {
  WorldRoom,
  JUKEBOX_QUEUE_CAP,
  type WorldIdentity,
  type WorldJukeboxTrackRef,
} from "../world-room";
import { WorldPalace } from "../world-palace";

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

const member = (name: string, admin = false): WorldIdentity => ({
  userId: `user-${name}`,
  displayName: name,
  avatarUrl: null,
  profileSlug: name.toLowerCase(),
  admin,
});
const guest: WorldIdentity = { userId: null, displayName: "Guest", avatarUrl: null, profileSlug: null };

const T0 = 1_000_000;
const TRACKS: Record<string, WorldJukeboxTrackRef> = {
  "track:short": {
    id: "track:short",
    title: "Short One",
    url: "https://example.test/short.mp3",
    durationSec: 10,
    creatorName: "Alpha",
    artworkUrl: null,
  },
  "track:long": {
    id: "track:long",
    title: "Long One",
    url: "https://example.test/long.mp3",
    durationSec: 300,
    creatorName: "Beta",
    artworkUrl: null,
  },
  "track:endless": {
    id: "track:endless",
    title: "No Duration Known",
    url: "https://example.test/endless.mp3",
    durationSec: 0,
    creatorName: "Alpha",
    artworkUrl: null,
  },
};

function jukeboxRoom() {
  return new WorldRoom(
    new RoomHub(),
    {
      resolveJukeboxTrack: async (_userId, trackId) => TRACKS[trackId] ?? null,
    },
    {
      roomId: "world:music-hall",
      name: "Music Hall",
      bounds: { minX: -27.8, maxX: -13.0, minZ: -8.4, maxZ: 2.9 },
      spawn: { x: -16.5, z: -2 },
      jukeboxEnabled: true,
    },
  );
}

const flush = () => new Promise<void>((r) => setImmediate(r));

function frame(room: WorldRoom, socket: FakeSocket, payload: unknown, now = T0) {
  room.handleFrame(socket, JSON.stringify(payload), now);
}

function lastJukebox(socket: FakeSocket): any {
  return socket.sent.filter((m) => m.type === "jukebox.state").pop()?.jukebox;
}

describe("the jukebox", () => {
  it("the welcome carries an honestly idle jukebox", () => {
    const room = jukeboxRoom();
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    const welcome = a.sent.find((m) => m.type === "welcome");
    expect(welcome.jukebox).toEqual({ current: null, queue: [] });
  });

  it("a room without the jukebox carries none and refuses its frames", async () => {
    const room = new WorldRoom(new RoomHub(), {}, { roomId: "world:game-rooms", name: "Game Rooms" });
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    const welcome = a.sent.find((m) => m.type === "welcome");
    expect(welcome.jukebox).toBeUndefined();
    frame(room, a, { type: "jukebox.add", trackId: "track:short" });
    await flush();
    expect(a.sent.filter((m) => m.type === "jukebox.state")).toEqual([]);
  });

  it("the first add starts the song; later adds queue in order", async () => {
    const room = jukeboxRoom();
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    frame(room, a, { type: "jukebox.add", trackId: "track:short" });
    await flush();
    let jb = lastJukebox(a);
    expect(jb.current.entry.track.id).toBe("track:short");
    expect(jb.current.entry.addedByName).toBe("Alpha");
    expect(jb.current.playback).toEqual({ playing: true, positionSec: 0 });
    expect(jb.queue).toEqual([]);

    frame(room, a, { type: "jukebox.add", trackId: "track:long" }, T0 + 1000);
    await flush();
    jb = lastJukebox(a);
    expect(jb.current.entry.track.id).toBe("track:short");
    expect(jb.queue).toHaveLength(1);
    expect(jb.queue[0].track.id).toBe("track:long");
  });

  it("guests can listen but never add; an unverifiable pick is refused and changes nothing", async () => {
    const room = jukeboxRoom();
    const g = fakeSocket();
    room.attach(g, guest);
    frame(room, g, { type: "jukebox.add", trackId: "track:short" });
    await flush();
    expect(g.sent.filter((m) => m.type === "jukebox.denied").pop()?.reason).toBe("guests");
    expect(room.jukeboxBroadcast(T0)).toEqual({ current: null, queue: [] });

    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    frame(room, a, { type: "jukebox.add", trackId: "track:forged" });
    await flush();
    expect(a.sent.filter((m) => m.type === "jukebox.denied").pop()?.reason).toBe("unplayable");
    expect(room.jukeboxBroadcast(T0)).toEqual({ current: null, queue: [] });
  });

  it("pause freezes the stamped position; only the adder (or the host) works the transport", async () => {
    const room = jukeboxRoom();
    const a = fakeSocket();
    const b = fakeSocket();
    const host = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    room.attach(host, member("King", true));
    frame(room, a, { type: "jukebox.add", trackId: "track:long" });
    await flush();

    // Beta didn't add it — her pause is refused, honestly.
    frame(room, b, { type: "jukebox.playpause", playing: false }, T0 + 5000);
    expect(b.sent.filter((m) => m.type === "jukebox.denied").pop()?.reason).toBe("not-yours");
    expect(room.jukeboxBroadcast(T0 + 5000).current.playback.playing).toBe(true);

    // Alpha pauses at 5s in; the position stays 5s however late you ask.
    frame(room, a, { type: "jukebox.playpause", playing: false }, T0 + 5000);
    const frozen = room.jukeboxBroadcast(T0 + 60_000);
    expect(frozen.current.playback).toEqual({ playing: false, positionSec: 5 });

    // The host can always work the transport.
    frame(room, host, { type: "jukebox.playpause", playing: true }, T0 + 70_000);
    const resumed = room.jukeboxBroadcast(T0 + 75_000);
    expect(resumed.current.playback).toEqual({ playing: true, positionSec: 10 });
  });

  it("a finished song hands over lazily, carrying its overshoot into the next", async () => {
    const room = jukeboxRoom();
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    frame(room, a, { type: "jukebox.add", trackId: "track:short" }); // 10s
    await flush();
    frame(room, a, { type: "jukebox.add", trackId: "track:long" }, T0);
    await flush();
    // 12.5s later the short song is done and the long one is 2.5s in.
    const jb = room.jukeboxBroadcast(T0 + 12_500);
    expect(jb.current.entry.track.id).toBe("track:long");
    expect(jb.current.playback.playing).toBe(true);
    expect(jb.current.playback.positionSec).toBeCloseTo(2.5, 5);
    expect(jb.queue).toEqual([]);
    // And when the queue runs dry the box settles back to idle.
    const done = room.jukeboxBroadcast(T0 + 12_500 + 400_000);
    expect(done).toEqual({ current: null, queue: [] });
  });

  it("a song with no known duration never auto-advances", async () => {
    const room = jukeboxRoom();
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    frame(room, a, { type: "jukebox.add", trackId: "track:endless" });
    await flush();
    frame(room, a, { type: "jukebox.add", trackId: "track:short" }, T0);
    await flush();
    const jb = room.jukeboxBroadcast(T0 + 999_000);
    expect(jb.current.entry.track.id).toBe("track:endless");
    expect(jb.queue).toHaveLength(1);
  });

  it("skip hands over in the same playing state; removing works on your own queued songs only", async () => {
    const room = jukeboxRoom();
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    frame(room, a, { type: "jukebox.add", trackId: "track:long" });
    await flush();
    frame(room, b, { type: "jukebox.add", trackId: "track:short" }, T0);
    await flush();
    const queuedId = room.jukeboxBroadcast(T0).queue[0].entryId;

    // Alpha can't pull Beta's queued song; Beta can.
    frame(room, a, { type: "jukebox.remove", entryId: queuedId }, T0);
    expect(a.sent.filter((m) => m.type === "jukebox.denied").pop()?.reason).toBe("not-yours");
    frame(room, b, { type: "jukebox.remove", entryId: queuedId }, T0);
    expect(room.jukeboxBroadcast(T0).queue).toEqual([]);

    // Pause, re-queue, skip: the next song starts paused at zero.
    frame(room, b, { type: "jukebox.add", trackId: "track:short" }, T0);
    await flush();
    frame(room, a, { type: "jukebox.playpause", playing: false }, T0 + 1000);
    frame(room, a, { type: "jukebox.skip" }, T0 + 1000);
    const jb = room.jukeboxBroadcast(T0 + 5000);
    expect(jb.current.entry.track.id).toBe("track:short");
    expect(jb.current.playback).toEqual({ playing: false, positionSec: 0 });
  });

  it("the queue is capped — a full box refuses the next add honestly", async () => {
    const room = jukeboxRoom();
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    for (let i = 0; i < JUKEBOX_QUEUE_CAP; i++) {
      frame(room, a, { type: "jukebox.add", trackId: "track:long" }, T0);
      await flush();
    }
    expect(room.jukeboxBroadcast(T0).queue.length + 1).toBe(JUKEBOX_QUEUE_CAP);
    frame(room, a, { type: "jukebox.add", trackId: "track:long" }, T0);
    await flush();
    expect(a.sent.filter((m) => m.type === "jukebox.denied").pop()?.reason).toBe("queue-full");
  });

  it("an emptied room resets the box; a song outlives its adder while anyone stays", async () => {
    const room = jukeboxRoom();
    const a = fakeSocket();
    const b = fakeSocket();
    room.attach(a, member("Alpha"));
    room.attach(b, member("Beta"));
    frame(room, a, { type: "jukebox.add", trackId: "track:long" });
    await flush();
    room.detach(a); // the adder leaves; Beta still hears it play
    expect(room.jukeboxBroadcast(T0 + 1000).current?.entry.track.id).toBe("track:long");
    room.detach(b); // the room empties — the box resets
    expect(room.jukeboxBroadcast(T0 + 1000)).toEqual({ current: null, queue: [] });
  });
});

describe("the jukebox, asked from another room (item 47)", () => {
  /** A Create Wing room wired to a Music Hall room the way
   *  WorldPalace wires them: the wing has no jukebox of its own,
   *  its asks forward to the hall's one authority. */
  function wingAndHall() {
    const hall = jukeboxRoom();
    const wing = new WorldRoom(
      new RoomHub(),
      {},
      {
        roomId: "world:create-wing",
        name: "Create Wing",
        bounds: { minX: 13.0, maxX: 27.8, minZ: -8.4, maxZ: 2.9 },
        spawn: { x: 16.5, z: -2 },
      },
    );
    wing.onJukeboxForward = (add, now) => hall.acceptForwardedJukeboxAdd(add, now);
    return { hall, wing };
  }

  it("a Song Desk publish in the Create Wing lands on the Music Hall jukebox", async () => {
    const { hall, wing } = wingAndHall();
    const a = fakeSocket();
    wing.attach(a, member("Alpha"));
    frame(wing, a, { type: "jukebox.add", trackId: "track:short" });
    await flush();
    const jb = hall.jukeboxBroadcast(T0);
    expect(jb.current?.entry.track.id).toBe("track:short");
    expect(jb.current?.entry.addedByName).toBe("Alpha");
    expect(jb.current?.playback.playing).toBe(true);
    // The cross-room entry carries the adder's account id, so the
    // transport hand is theirs when they walk into the Music Hall.
    expect(jb.current?.entry.addedByUserId).toBe("user-Alpha");
    // Nothing was denied, and the wing itself runs no box.
    expect(a.sent.filter((m) => m.type === "jukebox.denied")).toEqual([]);
    expect(a.sent.find((m) => m.type === "welcome").jukebox).toBeUndefined();
  });

  it("a forwarded add queues behind the song on now, in order", async () => {
    const { hall, wing } = wingAndHall();
    const inHall = fakeSocket();
    hall.attach(inHall, member("Beta"));
    frame(hall, inHall, { type: "jukebox.add", trackId: "track:long" });
    await flush();
    const a = fakeSocket();
    wing.attach(a, member("Alpha"));
    frame(wing, a, { type: "jukebox.add", trackId: "track:short" });
    await flush();
    const jb = hall.jukeboxBroadcast(T0);
    expect(jb.current?.entry.track.id).toBe("track:long");
    expect(jb.queue.map((e) => e.track.id)).toEqual(["track:short"]);
  });

  it("denials travel back to the room the asker stands in", async () => {
    const { hall, wing } = wingAndHall();
    const g = fakeSocket();
    wing.attach(g, guest);
    frame(wing, g, { type: "jukebox.add", trackId: "track:short" });
    await flush();
    expect(g.sent.filter((m) => m.type === "jukebox.denied").pop()?.reason).toBe("guests");

    const a = fakeSocket();
    wing.attach(a, member("Alpha"));
    frame(wing, a, { type: "jukebox.add", trackId: "track:forged" });
    await flush();
    expect(a.sent.filter((m) => m.type === "jukebox.denied").pop()?.reason).toBe("unplayable");
    expect(hall.jukeboxBroadcast(T0)).toEqual({ current: null, queue: [] });
  });

  it("the forwarded adder drives the transport from inside the Music Hall, even on a fresh peer", async () => {
    /* Real-clock base: attach() stamps its welcome from Date.now(),
       so a fake epoch would advance the box past the song — the
       production palace runs one clock throughout, and so does this
       scenario. */
    const R0 = Date.now();
    const { hall, wing } = wingAndHall();
    const a = fakeSocket();
    wing.attach(a, member("Alpha"));
    frame(wing, a, { type: "jukebox.add", trackId: "track:long" }, R0);
    await flush();
    // Alpha walks over (a new attach = a new peerId) and pauses her
    // own song: account authority, not peerId luck.
    const walked = fakeSocket();
    hall.attach(walked, member("Alpha"));
    frame(hall, walked, { type: "jukebox.playpause", playing: false }, R0 + 4000);
    expect(walked.sent.filter((m) => m.type === "jukebox.denied")).toEqual([]);
    expect(hall.jukeboxBroadcast(R0 + 4000).current?.playback).toEqual({
      playing: false,
      positionSec: 4,
    });
    // A stranger's hand is still refused.
    const b = fakeSocket();
    hall.attach(b, member("Beta"));
    frame(hall, b, { type: "jukebox.playpause", playing: true }, R0 + 5000);
    expect(b.sent.filter((m) => m.type === "jukebox.denied").pop()?.reason).toBe("not-yours");
  });

  it("the palace wires the forwarding itself: a Create Wing frame lands in its Music Hall", async () => {
    const palace = new WorldPalace(new RoomHub(), {
      resolveJukeboxTrack: async (_userId, trackId) => TRACKS[trackId] ?? null,
    });
    const wing = palace.room("world:create-wing")!;
    const hall = palace.room("world:music-hall")!;
    const a = fakeSocket();
    wing.attach(a, member("Alpha"));
    palace.handleFrame(a, JSON.stringify({ type: "jukebox.add", trackId: "track:short" }), T0);
    await flush();
    expect(hall.jukeboxBroadcast(T0).current?.entry.track.id).toBe("track:short");
    expect(hall.jukeboxBroadcast(T0).current?.entry.addedByUserId).toBe("user-Alpha");
  });
});
