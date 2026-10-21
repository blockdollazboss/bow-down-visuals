/**
 * World Events (Ring 2, 3.1/3.2/3.4 + THE-GAME §5(a)) — the room
 * authority + scheduler harness.
 *
 * Drives a real WorldPalace the way routes/world.ts does (fake
 * sockets, frames in, frames out) with a fake event store + the
 * route layer's resolvers faked at the same seams production uses.
 * Pinned contract:
 * - a due stage_show takes the Throne Hall screen with its booked
 *   video (synced anchor, holder = host, screen carries the event —
 *   late joiners read "LIVE: <title> by <host>"); slot end releases
 *   the stage back to the Reel. A "live" show opens the stage for
 *   its host: their stage.live lands, their stage.end closes the
 *   event row early. A walk-in show is never hijacked by a booking.
 * - a due listening_party takes the Music Hall jukebox with the
 *   party's queue in order under the host's name; open adds are
 *   refused while it runs; party end returns open queueing (idle).
 * - a due drop lands IN its room (room-scoped herald), members in
 *   the room claim first-come through the injected drop rails;
 *   guests, repeat claims and post-cap claims are refused; a failed
 *   payout rolls the reservation back; claims are witnessed in-room
 *   with server name + amount.
 * - a song starting on the jukebox fires the §5(a) now-playing
 *   moment, once per start, naming the song + its creator.
 * - the tick keeps the palace directory's per-room slate fresh.
 */
import { describe, it, expect } from "vitest";
import { RoomHub, type WsClientSocket } from "../live-ws";
import { WorldPalace } from "../world-palace";
import {
  WorldRoom,
  WORLD_ROOM_ID,
  type WorldIdentity,
  type WorldJukeboxTrackRef,
  type WorldScreenVideoRef,
} from "../world-room";
import { WorldEventScheduler, MUSIC_HALL_ROOM_ID, type WorldEventStore } from "../world-events";

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

const MUSIC = MUSIC_HALL_ROOM_ID;
const COURTYARD = "world:courtyard";
const T0 = 1_700_000_000_000;

const VIDEO: WorldScreenVideoRef = {
  id: "video:11111111-1111-4111-8111-111111111111",
  title: "Booked Film",
  url: "https://example.test/film.mp4",
  mediaKind: "file",
  creatorName: "Host",
};
const TRACKS: Record<string, WorldJukeboxTrackRef> = {
  "track:one": { id: "track:one", title: "First Song", url: "https://example.test/1.mp3", durationSec: 120, creatorName: "Host", artworkUrl: null },
  "track:two": { id: "track:two", title: "Second Song", url: "https://example.test/2.mp3", durationSec: 120, creatorName: "Guest Star", artworkUrl: null },
};

type Row = Record<string, any>;

function eventRow(partial: Row): Row {
  return {
    id: "evt-1",
    kind: "stage_show",
    roomId: WORLD_ROOM_ID,
    hostUserId: "user-Host",
    title: "Host's Big Night",
    startsAt: new Date(T0 - 60_000),
    endsAt: new Date(T0 + 30 * 60_000),
    payload: { contentRef: VIDEO.id },
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

interface ClaimCall { userId: string; amountVb: number; eventId: string }

function makePalace(claimResult: { ok: true } | { ok: false; reason: "budget" | "error" } = { ok: true }) {
  const claimCalls: ClaimCall[] = [];
  const palace = new WorldPalace(new RoomHub(), {
    resolveScreenVideo: async (_u, id) => (id === VIDEO.id ? VIDEO : null),
    resolveJukeboxTrack: async (_u, id) => TRACKS[id] ?? null,
    resolveStageStream: async (userId, streamId) =>
      streamId === "stream:host"
        ? { streamId, title: "Host Live", performerName: "Host", performerSlug: "host" }
        : null,
    claimWorldDrop: async (userId, amountVb, eventId) => {
      claimCalls.push({ userId, amountVb, eventId });
      return claimResult;
    },
  });
  return { palace, claimCalls };
}

function enter(palace: WorldPalace, socket: FakeSocket, id: WorldIdentity): void {
  expect(palace.enterHall(socket, id)).toBe(true);
}
function frame(palace: WorldPalace, socket: FakeSocket, payload: unknown, now = T0): void {
  palace.handleFrame(socket, JSON.stringify(payload), now);
}
function walkTo(palace: WorldPalace, socket: FakeSocket, roomId: string): void {
  frame(palace, socket, { type: "room.enter", roomId, x: -16.5, z: -2 });
}
const flush = () => new Promise<void>((r) => setImmediate(r));

describe("stage shows (3.1)", () => {
  it("a due video show takes the screen; late joiners see LIVE + the event; slot end returns the Reel", async () => {
    const { palace } = makePalace();
    const store = makeStore([eventRow({})]);
    const scheduler = new WorldEventScheduler({
      palace,
      store,
      resolveScreenVideo: async (_u, id) => (id === VIDEO.id ? VIDEO : null),
      resolveJukeboxTrack: async (_u, id) => TRACKS[id] ?? null,
    });
    const fan = fakeSocket();
    enter(palace, fan, member("Fan"));

    await scheduler.tick(T0);
    expect(store.rows[0]!.status).toBe("live");
    const hall = palace.room(WORLD_ROOM_ID)!;
    const screen = hall.screenBroadcast(null, T0);
    expect(screen.mode).toBe("video");
    expect(screen.holder?.name).toBe("Host");
    expect(screen.event).toEqual({ id: "evt-1", title: "Host's Big Night", hostName: "Host" });
    // The fan inside got the LIVE notice on the state broadcast.
    const state = fan.sent.filter((m) => m.type === "screen.state").pop();
    expect(state.screen.notice).toBe("LIVE: Host's Big Night by Host");
    // The directory slate carries tonight's show for the hall.
    const hallEntry = palace.directory().find((r) => r.id === WORLD_ROOM_ID);
    expect(hallEntry?.events?.[0]).toMatchObject({ id: "evt-1", status: "live", title: "Host's Big Night" });

    // A late joiner's welcome carries the show.
    const late = fakeSocket();
    enter(palace, late, member("Late"));
    const welcome = late.sent.find((m) => m.type === "welcome");
    expect(welcome.screen.event).toEqual({ id: "evt-1", title: "Host's Big Night", hostName: "Host" });
    expect(welcome.screen.mode).toBe("video");

    // Slot end: stage releases, screen returns to the Reel, row done.
    await scheduler.tick(T0 + 31 * 60_000);
    expect(store.rows[0]!.status).toBe("done");
    const after = hall.screenBroadcast(null, T0 + 31 * 60_000);
    expect(after.mode).toBe("reel");
    expect(after.holder).toBeNull();
    expect(after.event).toBeUndefined();
  });

  it("a 'live' show opens the stage for its host — their stream lands, their stage.end closes the event", async () => {
    const { palace } = makePalace();
    const store = makeStore([eventRow({ id: "evt-live", payload: { contentRef: "live" } })]);
    const scheduler = new WorldEventScheduler({
      palace,
      store,
      resolveScreenVideo: async () => null,
      resolveJukeboxTrack: async (_u, id) => TRACKS[id] ?? null,
    });
    await scheduler.tick(T0);
    expect(store.rows[0]!.status).toBe("live");
    const hall = palace.room(WORLD_ROOM_ID)!;
    expect(hall.scheduledShowEventId()).toBe("evt-live");
    // Stage is held for the host even before they walk in.
    expect(hall.stageHeld()).toBe(true);

    const host = fakeSocket();
    enter(palace, host, member("Host"));
    // Someone else cannot drive the booked screen.
    const other = fakeSocket();
    enter(palace, other, member("Other"));
    frame(palace, other, { type: "screen.reel" });
    expect(other.sent.filter((m) => m.type === "screen.denied")).toHaveLength(1);

    // The host's own live claim takes the screen.
    frame(palace, host, { type: "stage.live", streamId: "stream:host" });
    await flush();
    expect(hall.screenBroadcast(null, T0).mode).toBe("live");
    expect(hall.screenBroadcast(null, T0).event?.id).toBe("evt-live");

    // Ending early through the existing stage controls closes the row.
    frame(palace, host, { type: "stage.end" });
    await flush();
    expect(store.rows[0]!.status).toBe("done");
    expect(hall.scheduledShowEventId()).toBeNull();
    expect(hall.stageHeld()).toBe(false);
  });

  it("a booking never hijacks a walk-in show; it starts once the stage frees", async () => {
    const { palace } = makePalace();
    const store = makeStore([eventRow({})]);
    const scheduler = new WorldEventScheduler({
      palace,
      store,
      resolveScreenVideo: async (_u, id) => (id === VIDEO.id ? VIDEO : null),
      resolveJukeboxTrack: async (_u, id) => TRACKS[id] ?? null,
    });
    const walker = fakeSocket();
    enter(palace, walker, member("Walker"));
    frame(palace, walker, { type: "stage.video", videoId: VIDEO.id });
    await flush();
    const hall = palace.room(WORLD_ROOM_ID)!;
    expect(hall.stageHeld()).toBe(true);

    await scheduler.tick(T0);
    expect(store.rows[0]!.status).toBe("scheduled"); // not started, not lost
    expect(hall.scheduledShowEventId()).toBeNull();

    frame(palace, walker, { type: "stage.end" });
    await scheduler.tick(T0 + 1000);
    expect(store.rows[0]!.status).toBe("live");
    expect(hall.scheduledShowEventId()).toBe("evt-1");
  });

  it("a cancelled live show releases the stage on the next tick", async () => {
    const { palace } = makePalace();
    const store = makeStore([eventRow({ status: "live" })]);
    const scheduler = new WorldEventScheduler({
      palace,
      store,
      resolveScreenVideo: async (_u, id) => (id === VIDEO.id ? VIDEO : null),
      resolveJukeboxTrack: async (_u, id) => TRACKS[id] ?? null,
    });
    // Drive it onto the stage first (room carries it), then cancel.
    await scheduler.tick(T0);
    const hall = palace.room(WORLD_ROOM_ID)!;
    expect(hall.scheduledShowEventId()).toBe("evt-1");
    store.rows[0]!.status = "cancelled";
    await scheduler.tick(T0 + 5000);
    expect(hall.scheduledShowEventId()).toBeNull();
    expect(hall.screenBroadcast(null, T0 + 5000).mode).toBe("reel");
  });
});

describe("listening parties (3.2)", () => {
  it("the jukebox takes the party queue in order under the host's name; open adds wait; end returns open queueing", async () => {
    const { palace } = makePalace();
    const store = makeStore([
      eventRow({
        id: "evt-party",
        kind: "listening_party",
        roomId: MUSIC,
        title: "Album Night",
        payload: { trackIds: ["track:one", "track:two"], playlistId: null },
      }),
    ]);
    const scheduler = new WorldEventScheduler({
      palace,
      store,
      resolveScreenVideo: async () => null,
      resolveJukeboxTrack: async (_u, id) => TRACKS[id] ?? null,
    });
    const listener = fakeSocket();
    enter(palace, listener, member("Listener"));
    walkTo(palace, listener, MUSIC);
    listener.sent = [];

    await scheduler.tick(T0);
    expect(store.rows[0]!.status).toBe("live");
    const music = palace.room(MUSIC)!;
    const jb = music.jukeboxBroadcast(T0);
    expect(jb.current?.entry.track.id).toBe("track:one");
    expect(jb.current?.entry.addedByName).toBe("Host");
    expect(jb.queue.map((e) => e.track.id)).toEqual(["track:two"]);
    expect(jb.party).toEqual({ eventId: "evt-party", title: "Album Night", hostName: "Host" });
    // The room heard it start — the §5(a) moment names song + creator.
    const moment = listener.sent.filter((m) => m.type === "jukebox.nowplaying").pop();
    expect(moment?.moment).toMatchObject({ title: "First Song", creatorName: "Host" });

    // Open adds are refused while the party owns the queue.
    frame(palace, listener, { type: "jukebox.add", trackId: "track:two" }, T0 + 1000);
    await flush();
    expect(listener.sent.filter((m) => m.type === "jukebox.denied").pop()?.reason).toBe("listening-party");

    // Party end: jukebox honestly idle, open queueing restored.
    await scheduler.tick(T0 + 31 * 60_000);
    expect(store.rows[0]!.status).toBe("done");
    const after = music.jukeboxBroadcast(T0 + 31 * 60_000);
    expect(after.current).toBeNull();
    expect(after.queue).toEqual([]);
    expect(after.party).toBeUndefined();
    frame(palace, listener, { type: "jukebox.add", trackId: "track:one" }, T0 + 31 * 60_000);
    await flush();
    expect(music.jukeboxBroadcast(T0 + 31 * 60_000).current?.entry.track.id).toBe("track:one");
  });
});

describe("drop spectacles (3.4)", () => {
  function dropSetup(claimResult?: { ok: true } | { ok: false; reason: "budget" | "error" }) {
    const { palace, claimCalls } = makePalace(claimResult);
    const store = makeStore([
      eventRow({
        id: "evt-drop",
        kind: "drop",
        roomId: COURTYARD,
        hostUserId: "user-Admin",
        title: "Courtyard Drop",
        payload: { amountVb: 200, claimCap: 2 },
      }),
    ]);
    const scheduler = new WorldEventScheduler({
      palace,
      store,
      resolveScreenVideo: async () => null,
      resolveJukeboxTrack: async (_u, id) => TRACKS[id] ?? null,
    });
    return { palace, claimCalls, store, scheduler };
  }

  it("lands in its room with a herald; members in the room claim first-come, witnessed; guests and repeats refused", async () => {
    const { palace, claimCalls, scheduler } = dropSetup();
    const a = fakeSocket();
    enter(palace, a, member("Alpha"));
    walkTo(palace, a, COURTYARD);
    const b = fakeSocket();
    enter(palace, b, member("Beta"));
    walkTo(palace, b, COURTYARD);
    const g = fakeSocket();
    enter(palace, g, guest);
    walkTo(palace, g, COURTYARD);
    a.sent = []; b.sent = []; g.sent = [];

    await scheduler.tick(T0);
    // Herald moment, room-scoped and announcement-shaped.
    const landed = a.sent.filter((m) => m.type === "drop.landed").pop();
    expect(landed).toMatchObject({ kind: "drop", roomId: COURTYARD, drop: { amountVb: 200, claimsLeft: 2 } });
    // A member in ANOTHER room hears nothing — no palace-wide channel here.
    const hallPeer = fakeSocket();
    enter(palace, hallPeer, member("Hallgoer"));
    hallPeer.sent = [];
    await scheduler.tick(T0 + 1000);
    expect(hallPeer.sent.filter((m) => m.type === "drop.landed")).toHaveLength(0);

    // Guests watch; they don't claim.
    frame(palace, g, { type: "drop.claim" });
    expect(g.sent.filter((m) => m.type === "drop.denied").pop()?.reason).toBe("guests");
    expect(claimCalls).toHaveLength(0);

    // First claim: paid through the rails, witnessed by the room.
    frame(palace, a, { type: "drop.claim" });
    await flush();
    expect(claimCalls).toEqual([{ userId: "user-Alpha", amountVb: 200, eventId: "evt-drop" }]);
    const witnessed = b.sent.filter((m) => m.type === "drop.claimed").pop();
    expect(witnessed?.claim).toEqual({ name: "Alpha", amountVb: 200 });
    expect(witnessed?.drop.claimsLeft).toBe(1);

    // Repeat claim refused; second member takes the last claim.
    frame(palace, a, { type: "drop.claim" });
    expect(a.sent.filter((m) => m.type === "drop.denied").pop()?.reason).toBe("already-claimed");
    frame(palace, b, { type: "drop.claim" });
    await flush();
    expect(claimCalls).toHaveLength(2);

    // Cap exhausted: a third member in the room is refused honestly.
    const c = fakeSocket();
    enter(palace, c, member("Gamma"));
    walkTo(palace, c, COURTYARD);
    const welcome = c.sent.filter((m) => m.type === "welcome").pop(); // the courtyard transfer welcome
    expect(welcome.drop.claimsLeft).toBe(0); // the chest greets late joiners too
    frame(palace, c, { type: "drop.claim" });
    expect(c.sent.filter((m) => m.type === "drop.denied").pop()?.reason).toBe("claimed-out");
    expect(claimCalls).toHaveLength(2);

    // Slot end sweeps the chest.
    await scheduler.tick(T0 + 31 * 60_000);
    expect(c.sent.filter((m) => m.type === "drop.state").pop()?.drop).toBeNull();
    frame(palace, c, { type: "drop.claim" });
    expect(c.sent.filter((m) => m.type === "drop.denied").pop()?.reason).toBe("no-drop");
  });

  it("a budget refusal rolls the reservation back — the claim stays for the next member", async () => {
    const { palace, scheduler } = dropSetup({ ok: false, reason: "budget" });
    const a = fakeSocket();
    enter(palace, a, member("Alpha"));
    walkTo(palace, a, COURTYARD);
    await scheduler.tick(T0);
    frame(palace, a, { type: "drop.claim" });
    await flush();
    expect(a.sent.filter((m) => m.type === "drop.denied").pop()?.reason).toBe("budget");
    const room = palace.room(COURTYARD)!;
    expect(room.dropBroadcast()?.claimsLeft).toBe(2);
    // And the same member may try again (not marked as claimed).
    frame(palace, a, { type: "drop.claim" });
    await flush();
    expect(a.sent.filter((m) => m.type === "drop.denied")).toHaveLength(2);
  });

  it("a member standing in ANOTHER room can't claim the chest — the claim surface is the room it fell in", async () => {
    const { palace, claimCalls, scheduler } = dropSetup();
    const inRoom = fakeSocket();
    enter(palace, inRoom, member("Alpha"));
    walkTo(palace, inRoom, COURTYARD);
    const inHall = fakeSocket();
    enter(palace, inHall, member("Hallgoer")); // stays in the King's Hall
    await scheduler.tick(T0);

    // The palace heard the herald, but the Hall holds no chest:
    // the claim is refused as no-drop and the rails never move.
    inHall.sent = [];
    frame(palace, inHall, { type: "drop.claim" });
    await flush();
    expect(inHall.sent.filter((m) => m.type === "drop.denied").pop()?.reason).toBe("no-drop");
    expect(claimCalls).toHaveLength(0);

    // The chest stands untouched for the room it fell in.
    expect(palace.room(COURTYARD)!.dropBroadcast()?.claimsLeft).toBe(2);
    frame(palace, inRoom, { type: "drop.claim" });
    await flush();
    expect(claimCalls).toEqual([{ userId: "user-Alpha", amountVb: 200, eventId: "evt-drop" }]);
  });
});

describe("the first-play moment (§5(a))", () => {
  it("fires once per song start on the open jukebox, naming song + creator; transport doesn't re-fire it", async () => {
    const room = new WorldRoom(
      new RoomHub(),
      { resolveJukeboxTrack: async (_u, id) => TRACKS[id] ?? null },
      { roomId: MUSIC, name: "Music Hall", jukeboxEnabled: true },
    );
    const a = fakeSocket();
    room.attach(a, member("Alpha"));
    a.sent = [];
    const T = T0;
    room.handleFrame(a, JSON.stringify({ type: "jukebox.add", trackId: "track:one" }), T);
    await flush();
    const moments = a.sent.filter((m) => m.type === "jukebox.nowplaying");
    expect(moments).toHaveLength(1);
    expect(moments[0].moment).toMatchObject({ title: "First Song", creatorName: "Host", addedByName: "Alpha" });

    room.handleFrame(a, JSON.stringify({ type: "jukebox.playpause", playing: false }), T + 1000);
    room.handleFrame(a, JSON.stringify({ type: "jukebox.playpause", playing: true }), T + 2000);
    expect(a.sent.filter((m) => m.type === "jukebox.nowplaying")).toHaveLength(1);

    room.handleFrame(a, JSON.stringify({ type: "jukebox.add", trackId: "track:two" }), T + 3000);
    await flush();
    room.handleFrame(a, JSON.stringify({ type: "jukebox.skip" }), T + 4000);
    const after = a.sent.filter((m) => m.type === "jukebox.nowplaying");
    expect(after).toHaveLength(2);
    expect(after[1].moment).toMatchObject({ title: "Second Song", creatorName: "Guest Star" });
  });
});

describe("contests (2.24) — the scheduler flips status only", () => {
  function contestRow(partial: Row): Row {
    return eventRow({
      kind: "contest",
      roomId: MUSIC,
      title: "Best Hook in the Palace",
      payload: { theme: "A hook that stops the scroll" },
      ...partial,
    });
  }
  function makeScheduler(palace: WorldPalace, store: ReturnType<typeof makeStore>) {
    return new WorldEventScheduler({
      palace,
      store,
      resolveScreenVideo: async () => null,
      resolveJukeboxTrack: async () => null,
    });
  }

  it("a due contest goes live at its window and done at its deadline — and never touches the room", async () => {
    const { palace } = makePalace();
    const store = makeStore([contestRow({})]);
    const scheduler = makeScheduler(palace, store);

    await scheduler.tick(T0);
    expect(store.rows[0]!.status).toBe("live");
    /* No room state was driven: no scheduled show on the hall's
     * stage, no drop anywhere, no listening party in the hall. */
    const hall = palace.room(WORLD_ROOM_ID)!;
    expect(hall.scheduledShowEventId()).toBeNull();
    expect(hall.activeDropEventId()).toBeNull();
    const music = palace.room(MUSIC)!;
    expect(music.listeningPartyEventId()).toBeNull();
    expect(music.activeDropEventId()).toBeNull();

    await scheduler.tick(T0 + 31 * 60_000);
    expect(store.rows[0]!.status).toBe("done");
  });

  it("a contest whose window passed while the palace slept ends done, never live", async () => {
    const { palace } = makePalace();
    const store = makeStore([
      contestRow({ startsAt: new Date(T0 - 7200_000), endsAt: new Date(T0 - 60_000) }),
    ]);
    const scheduler = makeScheduler(palace, store);
    await scheduler.tick(T0);
    expect(store.rows[0]!.status).toBe("done");
  });

  it("a cancelled contest releases nothing and stays cancelled", async () => {
    const { palace } = makePalace();
    const store = makeStore([contestRow({ status: "cancelled" })]);
    const scheduler = makeScheduler(palace, store);
    await scheduler.tick(T0);
    expect(store.rows[0]!.status).toBe("cancelled");
    expect(palace.room(MUSIC)!.activeDropEventId()).toBeNull();
  });
});
