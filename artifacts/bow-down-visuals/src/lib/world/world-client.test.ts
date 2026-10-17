/**
 * The World — presence client tests (lib/world/world-client).
 *
 * Drives WorldClient with a fake socket, exactly the way the world
 * page does (deps injected, frames pushed in, frames asserted out):
 * - welcome installs self + the snapshot; joins/moves/leaves keep the
 *   peer map honest; own join frames never duplicate self
 * - room_full flips status to "full" (and a later close can't stomp it
 *   into a generic error)
 * - move sends throttle to ~10/s against the injected clock
 * - say is member-only — a guest client's say() sends nothing
 * - voice signal frames route to onSignal with the sender stamped;
 *   voice.state reaches onVoiceState without self in the list, while
 *   the client counts itself in voice from that moment
 * - worldOverlay maps statuses to the page's honest overlays
 */
import { describe, it, expect } from "vitest";
import {
  WorldClient,
  worldOverlay,
  defaultWorldSocketUrl,
  type WorldSocketLike,
} from "./world-client";

class FakeSocket implements WorldSocketLike {
  readyState = 1;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
  receive(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const SELF = {
  peerId: "w-self",
  displayName: "Me",
  avatarUrl: null,
  profileSlug: "me",
  tint: "#d4af37",
  guest: false,
  voice: false,
  voiceOff: false,
  voiceDeaf: false,
  admin: false,
  hostMuted: false,
  character: null,
  action: null,
  x: 0,
  y: 0,
  z: 9.5,
  rotY: 0,
};
const OTHER = { ...SELF, peerId: "w-other", displayName: "Other", profileSlug: "other", x: 2, z: 4 };

function makeClient(nowRef = { t: 0 }) {
  const socket = new FakeSocket();
  const client = new WorldClient({
    getAccessToken: async () => "token-abc",
    socketUrl: (token) => `ws://hall/api/world/ws${token ? `?token=${token}` : ""}`,
    openSocket: () => socket,
    now: () => nowRef.t,
  });
  return { client, socket };
}

async function inside(nowRef = { t: 0 }, self = SELF, peers: unknown[] = []) {
  const { client, socket } = makeClient(nowRef);
  await client.connect();
  socket.receive({ type: "welcome", peerId: self.peerId, you: self, peers });
  return { client, socket };
}

describe("connection + roster", () => {
  it("builds the socket URL with the session token", async () => {
    let seenUrl = "";
    const socket = new FakeSocket();
    const client = new WorldClient({
      getAccessToken: async () => "tok123",
      socketUrl: (token) => {
        seenUrl = defaultWorldSocketUrl({ protocol: "https:", host: "hall.example" }, token);
        return seenUrl;
      },
      openSocket: () => socket,
    });
    await client.connect();
    expect(seenUrl).toBe("wss://hall.example/api/world/ws?token=tok123");
  });

  it("welcome installs self and the snapshot, status → inside", async () => {
    const { client } = await inside({ t: 0 }, SELF, [OTHER]);
    expect(client.status).toBe("inside");
    expect(client.self?.peerId).toBe("w-self");
    expect(client.peers.get("w-other")?.displayName).toBe("Other");
    expect(client.isGuest).toBe(false);
  });

  it("joins, moves and leaves keep the peer map honest; self-join is ignored", async () => {
    const { client, socket } = await inside();
    const joined: string[] = [];
    client.onPeerJoin = (p) => joined.push(p.peerId);

    socket.receive({ type: "peer.join", peer: OTHER });
    expect(client.peers.has("w-other")).toBe(true);
    expect(joined).toEqual(["w-other"]);

    socket.receive({ type: "peer.join", peer: { ...OTHER, peerId: "w-self" } });
    expect(client.peers.has("w-self")).toBe(false);

    socket.receive({ type: "peer.move", peerId: "w-other", x: -3, y: 0, z: -8, rotY: 1.5 });
    const moved = client.peers.get("w-other")!;
    expect([moved.x, moved.z, moved.rotY]).toEqual([-3, -8, 1.5]);

    const left: string[] = [];
    client.onPeerLeave = (id) => left.push(id);
    socket.receive({ type: "peer.leave", peerId: "w-other" });
    expect(client.peers.has("w-other")).toBe(false);
    expect(left).toEqual(["w-other"]);
  });

  it("room_full flips status to full — and the close that follows can't stomp it", async () => {
    const { client, socket } = makeClient();
    await client.connect();
    socket.receive({ type: "room_full", cap: 30 });
    expect(client.status).toBe("full");
    socket.onclose?.({ code: 4429 });
    expect(client.status).toBe("full");
  });

  it("a dropped socket mid-visit is an error state, not a silent freeze", async () => {
    const { client, socket } = await inside();
    socket.onclose?.({ code: 1006 });
    expect(client.status).toBe("error");
  });
});

describe("outbound frames", () => {
  it("sendMove throttles to ~10/s on the injected clock", async () => {
    const nowRef = { t: 1_000 };
    const { client, socket } = await inside(nowRef);
    client.sendMove(1, 1, 0);
    nowRef.t = 1_050;
    client.sendMove(2, 2, 0); // inside the window — dropped
    nowRef.t = 1_150;
    client.sendMove(3, 3, 0);
    const moves = socket.sent.filter((f) => f.type === "move");
    expect(moves.map((m: any) => m.x)).toEqual([1, 3]);
  });

  it("a member's say goes out trimmed; empty says never leave", async () => {
    const { client, socket } = await inside();
    expect(client.say("  the hall is open  ")).toBe(true);
    expect(socket.sent).toContainEqual({ type: "say", body: "the hall is open" });
    expect(client.say("   ")).toBe(false);
    expect(socket.sent.filter((f) => f.type === "say")).toHaveLength(1);
  });

  it("a guest client's say() sends nothing — look-only starts client-side", async () => {
    const guestSelf = { ...SELF, peerId: "w-guest", guest: true, displayName: "Guest" };
    const { client, socket } = await inside({ t: 0 }, guestSelf);
    expect(client.isGuest).toBe(true);
    expect(client.say("let me talk")).toBe(false);
    expect(socket.sent).toEqual([]);
    client.joinVoice(); // also a no-op for guests
    expect(socket.sent).toEqual([]);
  });
});

describe("voice plumbing", () => {
  it("voice.state hands the mesh the existing members and counts self as in voice", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [{ ...OTHER, voice: true }]);
    expect(client.voicePeerIds.has("w-other")).toBe(true); // from the welcome snapshot

    const states: string[][] = [];
    client.onVoiceState = (ids) => states.push(ids);
    client.joinVoice();
    expect(socket.sent).toContainEqual({ type: "voice.join" });
    socket.receive({ type: "voice.state", voicePeerIds: ["w-other"] });
    expect(states).toEqual([["w-other"]]);
    expect(client.inVoice).toBe(true);
  });

  it("signals route to onSignal stamped with the sender", async () => {
    const { client, socket } = await inside();
    const got: Array<{ from: string; data: unknown }> = [];
    client.onSignal = (from, data) => got.push({ from, data });
    socket.receive({ type: "voice.signal", from: "w-other", data: { kind: "offer", sdp: "v=0" } });
    expect(got).toEqual([{ from: "w-other", data: { kind: "offer", sdp: "v=0" } }]);

    client.sendSignal("w-other", { kind: "answer", sdp: "v=1" });
    expect(socket.sent).toContainEqual({ type: "voice.signal", to: "w-other", data: { kind: "answer", sdp: "v=1" } });
  });

  it("voice notices surface full + guest-denied distinctly", async () => {
    const { client, socket } = await inside();
    const notices: string[] = [];
    client.onVoiceNotice = (n) => notices.push(n);
    socket.receive({ type: "voice.full", cap: 12 });
    socket.receive({ type: "voice.denied", reason: "guests" });
    expect(notices).toEqual(["full", "denied-guest"]);
  });

  it("a voice peer leaving voice drops out of the voice set and notifies", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [{ ...OTHER, voice: true }]);
    const leftVoice: string[] = [];
    client.onVoicePeerLeft = (id) => leftVoice.push(id);
    socket.receive({ type: "voice.left", peerId: "w-other" });
    expect(client.voicePeerIds.has("w-other")).toBe(false);
    expect(client.peers.get("w-other")?.voice).toBe(false);
    expect(leftVoice).toEqual(["w-other"]);
  });
});

describe("vault characters — walk in as", () => {
  const NOVA = { id: "char-nova", name: "Nova", portraitUrl: "https://img.example/nova.png" };

  it("a pick made before entry is sent the moment the welcome lands", async () => {
    const { client, socket } = makeClient();
    client.setCharacter(NOVA.id);
    await client.connect();
    expect(socket.sent.find((m) => m.type === "character")).toBeUndefined();
    socket.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(socket.sent).toContainEqual({ type: "character", characterId: NOVA.id });
  });

  it("picks and clears while inside go straight out; guests never send", async () => {
    const { client, socket } = await inside();
    client.setCharacter(NOVA.id);
    expect(socket.sent).toContainEqual({ type: "character", characterId: NOVA.id });
    client.setCharacter(null);
    expect(socket.sent).toContainEqual({ type: "character", characterId: null });

    const guestSelf = { ...SELF, peerId: "w-guest", guest: true, displayName: "Guest" };
    const g = await inside({ t: 0 }, guestSelf);
    g.client.setCharacter(NOVA.id);
    expect(g.socket.sent.find((m) => m.type === "character")).toBeUndefined();
  });

  it("peer.character frames update the roster and notify; snapshot characters ride the welcome", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [{ ...OTHER, character: NOVA }]);
    expect(client.peers.get("w-other")?.character).toEqual(NOVA);

    const seen: Array<[string, unknown]> = [];
    client.onPeerCharacter = (peerId, character) => seen.push([peerId, character]);
    const REY = { id: "char-rey", name: "Rey", portraitUrl: "https://img.example/rey.png", loopUrl: null };
    socket.receive({ type: "peer.character", peerId: "w-other", character: REY });
    expect(client.peers.get("w-other")?.character).toEqual(REY);
    socket.receive({ type: "peer.character", peerId: "w-other", character: null });
    expect(client.peers.get("w-other")?.character).toBeNull();
    expect(seen).toEqual([["w-other", REY], ["w-other", null]]);

    // A malformed character payload degrades to null, never a crash.
    socket.receive({ type: "peer.character", peerId: "w-other", character: { nope: true } });
    expect(client.peers.get("w-other")?.character).toBeNull();
  });

  it("peer.character accepts a video-only ref (loop, no portrait) and refuses a ref with neither", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [{ ...OTHER }]);
    const LIVING = { id: "char-vid", name: "Vid", portraitUrl: null, loopUrl: "https://vid.example/vid.mp4" };
    socket.receive({ type: "peer.character", peerId: "w-other", character: LIVING });
    expect(client.peers.get("w-other")?.character).toEqual(LIVING);
    socket.receive({
      type: "peer.character",
      peerId: "w-other",
      character: { id: "char-empty", name: "Empty", portraitUrl: null, loopUrl: null },
    });
    expect(client.peers.get("w-other")?.character).toBeNull();
    // An older payload that carries no loopUrl field at all still parses.
    socket.receive({
      type: "peer.character",
      peerId: "w-other",
      character: { id: "char-old", name: "Old", portraitUrl: "https://img.example/old.png" },
    });
    expect(client.peers.get("w-other")?.character).toEqual({
      id: "char-old",
      name: "Old",
      portraitUrl: "https://img.example/old.png",
      loopUrl: null,
    });
  });
});

describe("the voice switch — setVoiceOff + peer.voiceoff", () => {
  it("flips while inside go straight out; a flip made before entry rides the welcome", async () => {
    const { client, socket } = makeClient();
    client.setVoiceOff(true);
    await client.connect();
    expect(socket.sent.find((m) => m.type === "voice.off")).toBeUndefined();
    socket.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(socket.sent).toContainEqual({ type: "voice.off", off: true });

    client.setVoiceOff(false);
    expect(socket.sent).toContainEqual({ type: "voice.off", off: false });
  });

  it("guests never send the switch — they have no voice to switch", async () => {
    const guestSelf = { ...SELF, peerId: "w-guest", guest: true, displayName: "Guest" };
    const { client, socket } = await inside({ t: 0 }, guestSelf);
    client.setVoiceOff(true);
    expect(socket.sent.find((m) => m.type === "voice.off")).toBeUndefined();
  });

  it("peer.voiceoff updates the roster (and self) and notifies for the name plates", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    const seen: Array<[string, boolean]> = [];
    client.onPeerVoiceOff = (peerId, off) => seen.push([peerId, off]);

    socket.receive({ type: "peer.voiceoff", peerId: "w-other", off: true });
    expect(client.peers.get("w-other")?.voiceOff).toBe(true);
    socket.receive({ type: "peer.voiceoff", peerId: "w-self", off: true });
    expect(client.self?.voiceOff).toBe(true);
    expect(seen).toEqual([
      ["w-other", true],
      ["w-self", true],
    ]);
  });

  it("the welcome snapshot carries who's already voice-off", async () => {
    const { client } = await inside({ t: 0 }, SELF, [{ ...OTHER, voiceOff: true }]);
    expect(client.peers.get("w-other")?.voiceOff).toBe(true);
  });
});

describe("deafen — setVoiceDeaf + peer.voicedeaf", () => {
  it("flips while inside go straight out; a deafen chosen before entry rides the welcome", async () => {
    const { client, socket } = makeClient();
    client.setVoiceDeaf(true);
    await client.connect();
    expect(socket.sent.find((m) => m.type === "voice.deaf")).toBeUndefined();
    socket.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(socket.sent).toContainEqual({ type: "voice.deaf", deaf: true });

    client.setVoiceDeaf(false);
    expect(socket.sent).toContainEqual({ type: "voice.deaf", deaf: false });
  });

  it("guests never send deafen — they have no voice to deafen", async () => {
    const guestSelf = { ...SELF, peerId: "w-guest", guest: true, displayName: "Guest" };
    const { client, socket } = await inside({ t: 0 }, guestSelf);
    client.setVoiceDeaf(true);
    expect(socket.sent.find((m) => m.type === "voice.deaf")).toBeUndefined();
  });

  it("peer.voicedeaf updates the roster (and self) and notifies for the name plates", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    const seen: Array<[string, boolean]> = [];
    client.onPeerVoiceDeaf = (peerId, deaf) => seen.push([peerId, deaf]);

    socket.receive({ type: "peer.voicedeaf", peerId: "w-other", deaf: true });
    expect(client.peers.get("w-other")?.voiceDeaf).toBe(true);
    socket.receive({ type: "peer.voicedeaf", peerId: "w-self", deaf: true });
    expect(client.self?.voiceDeaf).toBe(true);
    expect(seen).toEqual([
      ["w-other", true],
      ["w-self", true],
    ]);
  });

  it("the welcome snapshot carries who's already deafened", async () => {
    const { client } = await inside({ t: 0 }, SELF, [{ ...OTHER, voiceDeaf: true }]);
    expect(client.peers.get("w-other")?.voiceDeaf).toBe(true);
  });
});

describe("worldOverlay — the page's honest states", () => {
  it("maps statuses to overlays", () => {
    expect(worldOverlay("connecting")).toBe("connecting");
    expect(worldOverlay("full")).toBe("room-full");
    expect(worldOverlay("error")).toBe("error");
    expect(worldOverlay("inside")).toBeNull();
    expect(worldOverlay("closed")).toBeNull();
    expect(worldOverlay("removed")).toBe("removed");
  });
});

describe("the stage + screen", () => {
  const REEL = {
    mode: "reel",
    holder: null,
    title: null,
    streamId: null,
    video: null,
    playback: null,
    notice: null,
  };

  it("the welcome installs the screen state (late joiners land on the show)", async () => {
    const { client, socket } = makeClient();
    await client.connect();
    const live = {
      ...REEL,
      mode: "live",
      holder: { peerId: "w-other", name: "Other", slug: "other" },
      title: "Friday Set",
      streamId: "stream-1",
    };
    socket.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [OTHER], screen: live });
    expect(client.screen?.mode).toBe("live");
    expect(client.screen?.holder?.name).toBe("Other");
  });

  it("screen.state updates the state and fires onScreen; screen.denied reaches its handler", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    const seen: string[] = [];
    client.onScreen = (s) => seen.push(s.mode);
    socket.receive({
      type: "screen.state",
      screen: {
        ...REEL,
        mode: "video",
        holder: { peerId: "w-self", name: "Me", slug: "me" },
        title: "My Video",
        video: { id: "video:v1", title: "My Video", url: "https://x/v.mp4", mediaKind: "file", creatorName: "Me" },
        playback: { playing: true, positionSec: 12 },
      },
    });
    expect(client.screen?.mode).toBe("video");
    expect(client.screen?.playback?.positionSec).toBe(12);
    expect(seen).toEqual(["video"]);

    const denied: Array<string | null> = [];
    client.onScreenDenied = (name) => denied.push(name);
    socket.receive({ type: "screen.denied", holderName: "Other" });
    expect(denied).toEqual(["Other"]);
  });

  it("the remote's sends ride the wire with the right frames (members only)", async () => {
    const { client, socket } = await inside();
    client.takeStageLive("stream-9");
    client.playStageVideo("video:v1");
    client.screenReel();
    client.screenPlayPause(false, 33);
    client.endStage();
    expect(socket.sent).toEqual([
      { type: "stage.live", streamId: "stream-9" },
      { type: "stage.video", videoId: "video:v1" },
      { type: "screen.reel" },
      { type: "screen.playpause", playing: false, positionSec: 33 },
      { type: "stage.end" },
    ]);

    const guestRun = await inside({ t: 0 }, { ...SELF, guest: true }, []);
    guestRun.client.takeStageLive("stream-9");
    guestRun.client.playStageVideo("video:v1");
    guestRun.client.endStage();
    expect(guestRun.socket.sent).toEqual([]);
  });
});

describe("host actions", () => {
  it("admin sends ride only for an admin self; the server re-checks anyway", async () => {
    const plain = await inside({ t: 0 }, SELF, [OTHER]);
    plain.client.adminMute("w-other", true);
    plain.client.adminRemove("w-other");
    expect(plain.socket.sent).toEqual([]);

    const admin = await inside({ t: 0 }, { ...SELF, admin: true }, [OTHER]);
    admin.client.adminMute("w-other", true);
    admin.client.adminRemove("w-other");
    expect(admin.socket.sent).toEqual([
      { type: "admin.mute", peerId: "w-other", muted: true },
      { type: "admin.remove", peerId: "w-other" },
    ]);
  });

  it("peer.hostmute marks the roster; my own mute fires onHostMuted", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    const mine: boolean[] = [];
    client.onHostMuted = (m) => mine.push(m);
    socket.receive({ type: "peer.hostmute", peerId: "w-other", muted: true });
    expect(client.peers.get("w-other")?.hostMuted).toBe(true);
    expect(mine).toEqual([]);
    socket.receive({ type: "peer.hostmute", peerId: "w-self", muted: true });
    expect(client.self?.hostMuted).toBe(true);
    expect(mine).toEqual([true]);
  });

  it("a host-muted join refusal reads as denied-host, not denied-guest", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    const notices: string[] = [];
    client.onVoiceNotice = (n) => notices.push(n);
    socket.receive({ type: "voice.denied", reason: "host" });
    socket.receive({ type: "voice.denied", reason: "guests" });
    expect(notices).toEqual(["denied-host", "denied-guest"]);
  });

  it("removed flips status to removed — and the close behind it can't stomp it", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    socket.receive({ type: "removed", reason: "host" });
    expect(client.status).toBe("removed");
    socket.onclose?.({ code: 4413 });
    expect(client.status).toBe("removed");
    expect(worldOverlay(client.status)).toBe("removed");
  });
});

describe("the palace (multi-room)", () => {
  it("the welcome names the room I'm standing in", async () => {
    const { client, socket } = makeClient();
    await client.connect();
    socket.receive({
      type: "welcome",
      peerId: SELF.peerId,
      room: { id: "world:kings-hall", name: "The King's Hall" },
      you: SELF,
      peers: [],
    });
    expect(client.room).toEqual({ id: "world:kings-hall", name: "The King's Hall" });
  });

  it("enterRoom sends the crossing point; the same room is a no-op", async () => {
    const { client, socket } = await inside();
    socket.receive({
      type: "welcome",
      peerId: SELF.peerId,
      room: { id: "world:kings-hall", name: "The King's Hall" },
      you: SELF,
      peers: [],
    });
    socket.sent = [];
    client.enterRoom("world:kings-hall", { x: 0, z: 0, rotY: 0 });
    expect(socket.sent).toEqual([]);
    client.enterRoom("world:music-hall", { x: -14.3, z: -2, rotY: -1.5 });
    expect(socket.sent).toEqual([
      { type: "room.enter", roomId: "world:music-hall", x: -14.3, z: -2, rotY: -1.5 },
    ]);
  });

  it("a transfer welcome re-homes the client: new room, fresh peers, voice cleared, onRoomChanged fires", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [{ ...OTHER, voice: true }]);
    expect(client.voicePeerIds.has(OTHER.peerId)).toBe(true);
    const changes: string[] = [];
    client.onRoomChanged = (room) => changes.push(room.id);
    socket.receive({
      type: "welcome",
      peerId: SELF.peerId,
      room: { id: "world:music-hall", name: "Music Hall" },
      you: { ...SELF, x: -15, z: -2 },
      peers: [],
    });
    expect(changes).toEqual(["world:music-hall"]);
    expect(client.room?.id).toBe("world:music-hall");
    expect(client.peers.size).toBe(0);
    expect(client.voicePeerIds.size).toBe(0);
    // Still inside — a transfer is not a reconnect.
    expect(client.status).toBe("inside");
  });

  it("a repeat welcome in the same room does not fire onRoomChanged", async () => {
    const { client, socket } = await inside();
    let fired = 0;
    client.onRoomChanged = () => fired++;
    socket.receive({
      type: "welcome",
      peerId: SELF.peerId,
      room: { id: "world:kings-hall", name: "The King's Hall" },
      you: SELF,
      peers: [],
    });
    expect(fired).toBe(0);
  });

  it("directory frames land on state and the handler", async () => {
    const { client, socket } = await inside();
    const seen: number[] = [];
    client.onDirectory = (rooms) => seen.push(rooms.length);
    socket.receive({
      type: "palace.directory",
      rooms: [
        { id: "world:kings-hall", name: "The King's Hall", count: 2, members: ["Me", "Other"], live: true },
        { id: "world:music-hall", name: "Music Hall", count: 0, members: [], live: false },
      ],
    });
    expect(seen).toEqual([2]);
    expect(client.directory[0]?.live).toBe(true);
    expect(client.directory[0]?.count).toBe(2);
  });

  it("room.unavailable reaches its handler with the honest cap", async () => {
    const { client, socket } = await inside();
    const refusals: Array<{ name: string; cap: number }> = [];
    client.onRoomUnavailable = (info) => refusals.push(info);
    socket.receive({ type: "room.unavailable", roomId: "world:music-hall", name: "Music Hall", cap: 30 });
    expect(refusals).toEqual([{ roomId: "world:music-hall", name: "Music Hall", cap: 30 }]);
  });
});

describe("avatar actions", () => {
  it("performAction is a plain setter — the page resolves toggle presses", async () => {
    const { client, socket } = await inside();
    socket.sent = [];
    client.performAction("bow");
    expect(socket.sent).toEqual([{ type: "action", action: "bow" }]);
    expect(client.self?.action).toBe("bow");
    client.performAction("dance");
    expect(client.self?.action).toBe("dance");
    // Stopping is an explicit null (the page sends it when a held
    // toggle is pressed again) — never a re-send side effect.
    client.performAction(null);
    expect(socket.sent[socket.sent.length - 1]).toEqual({ type: "action", action: null });
    expect(client.self?.action).toBeNull();
  });

  it("peer.action frames land on the peer and fire the handler", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    const seen: Array<[string, string | null]> = [];
    client.onPeerAction = (peerId, action) => seen.push([peerId, action]);
    socket.receive({ type: "peer.action", peerId: OTHER.peerId, action: "dance" });
    expect(client.peers.get(OTHER.peerId)?.action).toBe("dance");
    socket.receive({ type: "peer.action", peerId: OTHER.peerId, action: null });
    expect(client.peers.get(OTHER.peerId)?.action).toBeNull();
    expect(seen).toEqual([
      [OTHER.peerId, "dance"],
      [OTHER.peerId, null],
    ]);
  });

  it("a guest can perform — actions are presence, and the client sends them", async () => {
    const guestSelf = { ...SELF, guest: true };
    const { client, socket } = await inside({ t: 0 }, guestSelf, []);
    socket.sent = [];
    client.performAction("wave");
    expect(socket.sent).toEqual([{ type: "action", action: "wave" }]);
  });
});
