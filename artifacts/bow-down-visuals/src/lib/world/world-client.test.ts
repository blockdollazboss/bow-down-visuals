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
  formatLockDuration,
  defaultWorldSocketUrl,
  worldGuestSessionId,
  newWorldGuestSessionId,
  WORLD_REPLACED_CLOSE_CODE,
  WORLD_LOCKED_OUT_CLOSE_CODE,
  WORLD_DOOR_LOCKED_CLOSE_CODE,
  WORLD_CONNECT_MAX_ATTEMPTS,
  WORLD_FIRST_WELCOME_WATCHDOG_MS,
  WORLD_WELCOME_WATCHDOG_MS,
  WORLD_KEEPALIVE_INTERVAL_MS,
  WORLD_LIVENESS_TIMEOUT_MS,
  type WorldLockRefusal,
  type WorldSocketLike,
  type WorldStatus,
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

  it("a dropped socket mid-visit is NOT an instant error — the quiet reconnect opens instead", async () => {
    const { client, socket } = await inside();
    socket.onclose?.({ code: 1006 });
    // The hall stays up: still inside, reconnect flagged, no card.
    expect(client.status).toBe("inside");
    expect(client.reconnecting).toBe(true);
    // The reconnect attempt runs (the shared fake stands in for the
    // new socket) and its welcome ends the interlude in place.
    await new Promise((r) => setTimeout(r, 0));
    socket.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(client.status).toBe("inside");
    expect(client.reconnecting).toBe(false);
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
  it("peer.character carries a set voice profile through (0142 G4 x loop identity merge); unset stays absent", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [{ ...OTHER }]);
    const PROFILE = { pitchSemitones: -4, formantRatio: 0.9, formantGainDb: 2, eq: [] };
    socket.receive({
      type: "peer.character",
      peerId: "w-self",
      character: { id: "char-voiced", name: "Voiced", portraitUrl: "https://img.example/v.png", loopUrl: null, voiceProfile: PROFILE },
    });
    expect(client.self?.character?.voiceProfile).toEqual(PROFILE);
    // A malformed profile degrades to absent, never a crash or a junk shape.
    socket.receive({
      type: "peer.character",
      peerId: "w-self",
      character: { id: "char-voiced", name: "Voiced", portraitUrl: "https://img.example/v.png", loopUrl: null, voiceProfile: { nope: true } },
    });
    expect(client.self?.character).toEqual({ id: "char-voiced", name: "Voiced", portraitUrl: "https://img.example/v.png", loopUrl: null });
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
    expect(worldOverlay("replaced")).toBe("replaced");
    expect(worldOverlay("locked-out")).toBe("locked-out");
    expect(worldOverlay("door-locked")).toBe("door-locked");
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

describe("the first connect — bounded retry + welcome watchdog", () => {
  /* Timers driven by hand: the retry engine's delays are asserted,
   * not waited out. Insertion order stands in for due order — the
   * engine never has two timers racing (watchdog OR backoff). */
  function manualTimers() {
    let nextId = 1;
    const timers = new Map<number, { fn: () => void; ms: number }>();
    return {
      setTimer: (fn: () => void, ms: number) => {
        const id = nextId++;
        timers.set(id, { fn, ms });
        return id;
      },
      clearTimer: (handle: unknown) => {
        timers.delete(handle as number);
      },
      pendingDelays: () => [...timers.values()].map((t) => t.ms),
      /* The next timer's callback WITHOUT firing it — for tests
       * that simulate a callback already queued in the event loop
       * when its clear landed (the "late watchdog" race). */
      peekNextFn: () => [...timers.values()][0]?.fn,
      fireNext: () => {
        const first = [...timers.entries()][0];
        if (!first) return null;
        timers.delete(first[0]);
        first[1].fn();
        return first[1].ms;
      },
    };
  }

  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  function makeRetryClient() {
    const timers = manualTimers();
    const sockets: FakeSocket[] = [];
    const statuses: WorldStatus[] = [];
    const client = new WorldClient({
      getAccessToken: async () => "token-abc",
      socketUrl: (token) => `ws://hall/api/world/ws${token ? `?token=${token}` : ""}`,
      openSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    client.onStatus = (s) => statuses.push(s);
    return { client, sockets, timers, statuses };
  }

  it("a failed first attempt retries quietly — status never leaves connecting, no error flashes", async () => {
    const { client, sockets, timers, statuses } = makeRetryClient();
    await client.connect();
    expect(sockets).toHaveLength(1);
    // The FIRST attempt arms the long, wake-tolerant window.
    expect(timers.pendingDelays()).toEqual([WORLD_FIRST_WELCOME_WATCHDOG_MS]);

    sockets[0]!.onerror?.();
    expect(client.status).toBe("connecting");
    expect(timers.pendingDelays()).toEqual([1_000]); // backoff before attempt 2

    expect(timers.fireNext()).toBe(1_000);
    await flush();
    expect(sockets).toHaveLength(2);

    sockets[1]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(client.status).toBe("inside");
    expect(statuses).toEqual(["inside"]); // connecting → inside, nothing between
    // The watchdog is spent with the welcome; the only timer left
    // is the session keepalive.
    expect(timers.pendingDelays()).toEqual([WORLD_KEEPALIVE_INTERVAL_MS]);
  });

  it("a CLEAN close (1000) during connect retries too — it no longer strands a bare dead room", async () => {
    const { client, sockets, timers } = makeRetryClient();
    await client.connect();
    sockets[0]!.onclose?.({ code: 1000 });
    expect(client.status).toBe("connecting"); // NOT "closed" — worldOverlay("closed") is no card at all
    expect(worldOverlay(client.status)).toBe("connecting");

    timers.fireNext();
    await flush();
    expect(sockets).toHaveLength(2);
    sockets[1]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(client.status).toBe("inside");
  });

  it("a hung handshake is failed by the watchdog and retried, not spun on forever", async () => {
    const { client, sockets, timers } = makeRetryClient();
    await client.connect();
    // The socket neither opens a welcome nor closes — it just hangs.
    // The first attempt hangs for its full (long) window before the
    // watchdog retires it.
    expect(timers.fireNext()).toBe(WORLD_FIRST_WELCOME_WATCHDOG_MS);
    expect(client.status).toBe("connecting");
    expect(sockets[0]!.readyState).toBe(3); // the watchdog retired it
    expect(timers.pendingDelays()).toEqual([1_000]);

    timers.fireNext();
    await flush();
    expect(sockets).toHaveLength(2);
    // Attempt 2 of a FIRST connect arms the LONG window too: the
    // slow tail is per-open, not per-sequence (opens measured at
    // 55.8 s on a warm box), so a later attempt is exactly as
    // likely to be mid-wake as the first.
    expect(timers.pendingDelays()).toEqual([WORLD_FIRST_WELCOME_WATCHDOG_MS]);
    sockets[1]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(client.status).toBe("inside");
  });

  it("a slow first handshake inside the wake window still gets in — the watchdog does not kill a waking host", async () => {
    const { client, sockets, timers } = makeRetryClient();
    await client.connect();
    // The first-connect window strictly outlasts the re-connect
    // window: a host that answers at, say, 25 s (a real staging
    // wake, measured 2026-10-17) is inside this one and past the
    // short one.
    expect(WORLD_FIRST_WELCOME_WATCHDOG_MS).toBeGreaterThan(WORLD_WELCOME_WATCHDOG_MS);
    expect(timers.pendingDelays()).toEqual([WORLD_FIRST_WELCOME_WATCHDOG_MS]);
    // No timer fires; the welcome simply arrives late — and lands.
    sockets[0]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(client.status).toBe("inside");
    // Watchdog spent with the welcome; the keepalive remains.
    expect(timers.pendingDelays()).toEqual([WORLD_KEEPALIVE_INTERVAL_MS]);
  });

  it("the budget is bounded: after the last attempt fails, the honest error lands", async () => {
    const { client, sockets, timers, statuses } = makeRetryClient();
    await client.connect();

    sockets[0]!.onerror?.();
    expect(timers.pendingDelays()).toEqual([1_000]);
    timers.fireNext();
    await flush();

    sockets[1]!.onclose?.({ code: 1006 });
    expect(timers.pendingDelays()).toEqual([2_000]); // the backoff grows
    timers.fireNext();
    await flush();

    expect(sockets).toHaveLength(WORLD_CONNECT_MAX_ATTEMPTS);
    sockets[2]!.onerror?.();
    expect(client.status).toBe("error");
    expect(statuses).toEqual(["error"]);
    expect(timers.pendingDelays()).toEqual([]); // nothing left scheduled
    expect(sockets).toHaveLength(WORLD_CONNECT_MAX_ATTEMPTS); // and no 4th socket
  });

  it("once inside, the ENTRY budget is spent — but a drop opens a quiet reconnect, not a card", async () => {
    const { client, sockets, timers } = makeRetryClient();
    await client.connect();
    sockets[0]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(client.status).toBe("inside");
    expect(timers.pendingDelays()).toEqual([WORLD_KEEPALIVE_INTERVAL_MS]);

    sockets[0]!.onclose?.({ code: 1006 });
    // No error, no ejection: still inside, the interlude flagged,
    // and the first reconnect attempt already armed — with the
    // LONG window (the host may be mid-restart).
    expect(client.status).toBe("inside");
    expect(client.reconnecting).toBe(true);
    expect(timers.pendingDelays()).toEqual([WORLD_FIRST_WELCOME_WATCHDOG_MS]);
    await flush();
    expect(sockets).toHaveLength(2);

    sockets[1]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(client.status).toBe("inside");
    expect(client.reconnecting).toBe(false);
    expect(timers.pendingDelays()).toEqual([WORLD_KEEPALIVE_INTERVAL_MS]);
  });

  it("a clean close mid-visit re-enters quietly too — a draining host is a drop, not a deliberate leave", async () => {
    const { client, sockets } = makeRetryClient();
    await client.connect();
    sockets[0]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    sockets[0]!.onclose?.({ code: 1005 });
    // Deliberate leaves go through disconnect() (which nulls the
    // socket first, so this handler never runs for them). A clean
    // close from the wire mid-visit is the host letting go —
    // the quiet reconnect treats it like any other drop.
    expect(client.status).toBe("inside");
    expect(client.reconnecting).toBe(true);
  });

  it("disconnect during the backoff cancels the retry — leaving means leaving", async () => {
    const { client, sockets, timers } = makeRetryClient();
    await client.connect();
    sockets[0]!.onerror?.();
    expect(timers.pendingDelays()).toEqual([1_000]);

    client.disconnect();
    expect(client.status).toBe("closed");
    expect(timers.pendingDelays()).toEqual([]);
    await flush();
    expect(sockets).toHaveLength(1); // the scheduled attempt never opened
  });

  it("room_full during connect stays terminal — no retry against a full hall", async () => {
    const { client, sockets, timers } = makeRetryClient();
    await client.connect();
    sockets[0]!.receive({ type: "room_full", cap: 30 });
    expect(client.status).toBe("full");
    expect(timers.pendingDelays()).toEqual([]); // watchdog cleared with the verdict
    sockets[0]!.onclose?.({ code: 4429 });
    expect(client.status).toBe("full");
    expect(sockets).toHaveLength(1);
  });

  it("slow opens on attempts 2 and 3 of a first connect also land inside the long window", async () => {
    const { client, sockets, timers } = makeRetryClient();
    await client.connect();

    // Attempt 1 hangs its whole (long) window.
    expect(timers.fireNext()).toBe(WORLD_FIRST_WELCOME_WATCHDOG_MS);
    expect(timers.pendingDelays()).toEqual([1_000]);
    timers.fireNext();
    await flush();
    expect(sockets).toHaveLength(2);
    // Attempt 2 arms the LONG window, not the short one — the
    // measured slow tail is per-open (55.8 s on a warm box), so a
    // second or third open is exactly as likely to ride it.
    expect(timers.pendingDelays()).toEqual([WORLD_FIRST_WELCOME_WATCHDOG_MS]);
    expect(timers.fireNext()).toBe(WORLD_FIRST_WELCOME_WATCHDOG_MS);
    expect(timers.pendingDelays()).toEqual([2_000]);
    timers.fireNext();
    await flush();
    expect(sockets).toHaveLength(3);
    expect(timers.pendingDelays()).toEqual([WORLD_FIRST_WELCOME_WATCHDOG_MS]);

    // The third open lands late but inside its window — and the
    // welcome that follows it (the server answered in milliseconds
    // once the handshake completed) brings the client in.
    sockets[2]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(client.status).toBe("inside");
    expect(timers.pendingDelays()).toEqual([WORLD_KEEPALIVE_INTERVAL_MS]);
  });

  it("an ENTRY sequence after an established session still fast-fails at the short window", async () => {
    const { client, sockets, timers } = makeRetryClient();
    await client.connect();
    sockets[0]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(client.status).toBe("inside");

    // A drop quietly reconnects and lands again (long windows —
    // the host may be mid-restart; see the longevity describe).
    sockets[0]!.onclose?.({ code: 1006 });
    await flush();
    expect(sockets).toHaveLength(2);
    sockets[1]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(client.status).toBe("inside");
    expect(client.reconnecting).toBe(false);

    // A deliberate connect() on the same client is an ENTRY
    // sequence after establishment — a RE-connect in the join-fix
    // sense: the host demonstrably woke for the earlier session,
    // so every attempt arms the SHORT window and a hang fails
    // fast. The quiet reconnect's long windows do not leak into it.
    await client.connect();
    expect(sockets).toHaveLength(3);
    expect(timers.pendingDelays()).toEqual([WORLD_WELCOME_WATCHDOG_MS]);
    expect(timers.fireNext()).toBe(WORLD_WELCOME_WATCHDOG_MS);
    expect(timers.pendingDelays()).toEqual([1_000]);
    timers.fireNext();
    await flush();
    expect(sockets).toHaveLength(4);
    expect(timers.pendingDelays()).toEqual([WORLD_WELCOME_WATCHDOG_MS]);
    sockets[3]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(client.status).toBe("inside");
  });

  it("a hung token fetch fails the attempt inside its window — and its late resolution opens nothing", async () => {
    const timers = manualTimers();
    const sockets: FakeSocket[] = [];
    let resolveStale!: (v: string | null) => void;
    const staleToken = new Promise<string | null>((r) => {
      resolveStale = r;
    });
    let tokenCalls = 0;
    const client = new WorldClient({
      getAccessToken: () => {
        tokenCalls += 1;
        return tokenCalls === 1 ? staleToken : Promise.resolve("token-abc");
      },
      socketUrl: (token) => `ws://hall/api/world/ws${token ? `?token=${token}` : ""}`,
      openSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    // connect() parks on the token fetch — it is NOT awaited yet.
    const connectPromise = client.connect();
    await flush();
    // No socket was ever constructed, yet a watchdog IS running:
    // it was armed before the fetch, so the fetch shares the
    // attempt's window instead of hanging outside any timer.
    expect(sockets).toHaveLength(0);
    expect(timers.pendingDelays()).toEqual([WORLD_FIRST_WELCOME_WATCHDOG_MS]);

    expect(timers.fireNext()).toBe(WORLD_FIRST_WELCOME_WATCHDOG_MS);
    expect(client.status).toBe("connecting"); // failed attempt, budget remains
    expect(timers.pendingDelays()).toEqual([1_000]);

    // The hung fetch finally resolves — into a retired generation.
    // Its continuation must open nothing.
    resolveStale("token-late");
    await connectPromise;
    await flush();
    expect(sockets).toHaveLength(0);

    // The scheduled retry fetches a fresh token and opens.
    timers.fireNext();
    await flush();
    expect(sockets).toHaveLength(1);
    sockets[0]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(client.status).toBe("inside");
  });

  it("a token fetch that hangs on every attempt exhausts the budget into the honest error", async () => {
    const timers = manualTimers();
    let opened = 0;
    const client = new WorldClient({
      getAccessToken: () => new Promise<string | null>(() => undefined), // never resolves
      socketUrl: () => "ws://hall/api/world/ws",
      openSocket: () => {
        opened += 1;
        return new FakeSocket();
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    void client.connect();
    await flush();
    // Attempt 1: watchdog, backoff, attempt 2: watchdog, backoff,
    // attempt 3: watchdog — then the budget is spent.
    expect(timers.fireNext()).toBe(WORLD_FIRST_WELCOME_WATCHDOG_MS);
    expect(timers.fireNext()).toBe(1_000);
    expect(timers.pendingDelays()).toEqual([WORLD_FIRST_WELCOME_WATCHDOG_MS]);
    expect(timers.fireNext()).toBe(WORLD_FIRST_WELCOME_WATCHDOG_MS);
    expect(timers.fireNext()).toBe(2_000);
    expect(timers.pendingDelays()).toEqual([WORLD_FIRST_WELCOME_WATCHDOG_MS]);
    expect(timers.fireNext()).toBe(WORLD_FIRST_WELCOME_WATCHDOG_MS);
    expect(client.status).toBe("error");
    expect(opened).toBe(0); // no socket was ever constructed
    expect(timers.pendingDelays()).toEqual([]);
  });

  it("a guest (null token) pays nothing for the covered fetch — one watchdog, plain guest URL", async () => {
    const timers = manualTimers();
    const sockets: FakeSocket[] = [];
    let seenUrl = "";
    const client = new WorldClient({
      getAccessToken: async () => null,
      socketUrl: (token) => {
        seenUrl = `ws://hall/api/world/ws${token ? `?token=${token}` : ""}`;
        return seenUrl;
      },
      openSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    await client.connect();
    expect(seenUrl).toBe("ws://hall/api/world/ws"); // no token param, as before
    expect(sockets).toHaveLength(1);
    expect(timers.pendingDelays()).toEqual([WORLD_FIRST_WELCOME_WATCHDOG_MS]); // the one watchdog, nothing extra
  });

  it("a welcome after a fully exhausted sequence still lands the client — no latch on the error state", async () => {
    const { client, sockets, timers, statuses } = makeRetryClient();
    await client.connect();
    sockets[0]!.onerror?.();
    timers.fireNext();
    await flush();
    sockets[1]!.onerror?.();
    timers.fireNext();
    await flush();
    sockets[2]!.onerror?.();
    expect(client.status).toBe("error");
    expect(timers.pendingDelays()).toEqual([]);

    // A later sequence (the page's Re-enter path, driven here on
    // the same client — the stricter case) starts clean, and its
    // welcome flips the client to inside: the exhausted sequence
    // left nothing behind that could discard or ignore it.
    await client.connect();
    expect(client.status).toBe("connecting");
    expect(sockets).toHaveLength(4);
    sockets[3]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(client.status).toBe("inside");
    expect(statuses).toEqual(["error", "connecting", "inside"]);
    expect(timers.pendingDelays()).toEqual([WORLD_KEEPALIVE_INTERVAL_MS]);
  });

  it("a watchdog callback that outlives its attempt cannot re-error a live session", async () => {
    const { client, sockets, timers } = makeRetryClient();
    await client.connect();
    // Capture the watchdog callback as if it were already queued
    // in the event loop — then the welcome lands and clears it.
    const lateWatchdog = timers.peekNextFn();
    expect(lateWatchdog).toBeDefined();
    sockets[0]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(client.status).toBe("inside");
    expect(timers.pendingDelays()).toEqual([WORLD_KEEPALIVE_INTERVAL_MS]);

    // The stale callback fires anyway: it must do nothing — no
    // error, no retired socket, no new attempt.
    lateWatchdog!();
    expect(client.status).toBe("inside");
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.readyState).toBe(1); // never closed by the stale timer
    expect(timers.pendingDelays()).toEqual([WORLD_KEEPALIVE_INTERVAL_MS]);
  });

  it("a retired attempt's late close cannot fail the attempt that replaced it", async () => {
    const { client, sockets, timers } = makeRetryClient();
    await client.connect();
    sockets[0]!.onerror?.();
    timers.fireNext();
    await flush();
    expect(sockets).toHaveLength(2);

    // Attempt 1's socket reports its close only now — the identity
    // guard discards it; attempt 2 keeps its full window.
    sockets[0]!.onclose?.({ code: 1006 });
    expect(client.status).toBe("connecting");
    expect(timers.pendingDelays()).toEqual([WORLD_FIRST_WELCOME_WATCHDOG_MS]);

    sockets[1]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(client.status).toBe("inside");
  });
});

describe("the Music Hall jukebox", () => {
  const JUKEBOX = {
    current: {
      entry: {
        entryId: "j1",
        track: {
          id: "track:1",
          title: "Song One",
          url: "https://example.test/one.mp3",
          durationSec: 30,
          creatorName: "Me",
          artworkUrl: null,
        },
        addedByPeerId: "w-self",
        addedByName: "Me",
      },
      playback: { playing: true, positionSec: 4 },
    },
    queue: [],
  };
  const MUSIC_ROOM = { id: "world:music-hall", name: "Music Hall" };

  it("the welcome carries the jukebox in the Music Hall; other rooms clear it", async () => {
    const { client, socket } = makeClient();
    await client.connect();
    socket.receive({ type: "welcome", peerId: SELF.peerId, room: MUSIC_ROOM, you: SELF, peers: [], jukebox: JUKEBOX });
    expect(client.jukebox).toEqual(JUKEBOX);
    // A doorway transfer's welcome (no jukebox field) clears it —
    // the music does not follow you out of the Music Hall.
    socket.receive({
      type: "welcome",
      peerId: SELF.peerId,
      room: { id: "world:treasury", name: "Treasury" },
      you: SELF,
      peers: [],
    });
    expect(client.jukebox).toBeNull();
  });

  it("jukebox.state updates the mirror and fires onJukebox; denials reach onJukeboxDenied", async () => {
    const { client, socket } = await inside();
    const seen: unknown[] = [];
    client.onJukebox = (jb) => seen.push(jb);
    socket.receive({ type: "jukebox.state", jukebox: JUKEBOX });
    expect(client.jukebox).toEqual(JUKEBOX);
    expect(seen).toEqual([JUKEBOX]);
    let denied = "";
    client.onJukeboxDenied = (reason) => {
      denied = reason;
    };
    socket.receive({ type: "jukebox.denied", reason: "queue-full" });
    expect(denied).toBe("queue-full");
  });

  it("the senders frame the four jukebox intents; a guest client sends none of them", async () => {
    const { client, socket } = await inside();
    socket.sent = [];
    client.jukeboxAdd("track:1");
    client.jukeboxPlayPause(false);
    client.jukeboxSkip();
    client.jukeboxRemove("j1");
    expect(socket.sent).toEqual([
      { type: "jukebox.add", trackId: "track:1" },
      { type: "jukebox.playpause", playing: false },
      { type: "jukebox.skip" },
      { type: "jukebox.remove", entryId: "j1" },
    ]);

    const guestRun = await inside({ t: 0 }, { ...SELF, guest: true });
    guestRun.socket.sent = [];
    guestRun.client.jukeboxAdd("track:1");
    guestRun.client.jukeboxSkip();
    expect(guestRun.socket.sent).toEqual([]);
  });
});

describe("world events — slate, first-play moment, drop spectacles", () => {
  const DROP = {
    eventId: "evt-drop",
    title: "Courtyard Drop",
    roomId: "world:courtyard",
    roomName: "Courtyard",
    amountVb: 200,
    claimCap: 2,
    claimsLeft: 2,
  };

  it("directory entries carry their booked slate through untouched", async () => {
    const { client, socket } = await inside();
    const rooms: unknown[] = [];
    client.onDirectory = (r) => rooms.push(r);
    const slate = [
      {
        id: "evt-1",
        kind: "stage_show",
        title: "Big Night",
        hostName: "Host",
        startsAt: "2026-10-17T20:00:00.000Z",
        endsAt: "2026-10-17T21:00:00.000Z",
        status: "live",
      },
    ];
    socket.receive({
      type: "palace.directory",
      rooms: [
        { id: "world:kings-hall", name: "The King's Hall", count: 2, members: ["A", "B"], live: true, events: slate },
        { id: "world:music-hall", name: "Music Hall", count: 0, members: [], live: false },
      ],
    });
    expect(client.directory[0]?.events).toEqual(slate);
    expect(client.directory[1]?.events).toBeUndefined();
    expect(rooms).toHaveLength(1);
  });

  it("the screen's booked event rides screen.state into the mirror", async () => {
    const { client, socket } = await inside();
    socket.receive({
      type: "screen.state",
      screen: {
        mode: "video",
        holder: { peerId: "event:evt-1", name: "Host", slug: "host" },
        title: "Booked Film",
        streamId: null,
        video: null,
        playback: { playing: true, positionSec: 3 },
        notice: "LIVE: Big Night by Host",
        event: { id: "evt-1", title: "Big Night", hostName: "Host" },
      },
    });
    expect(client.screen?.event).toEqual({ id: "evt-1", title: "Big Night", hostName: "Host" });
  });

  it("jukebox.nowplaying lands the first-play moment; a party rides jukebox.state", async () => {
    const { client, socket } = await inside();
    const moments: unknown[] = [];
    client.onNowPlaying = (m) => moments.push(m);
    socket.receive({
      type: "jukebox.nowplaying",
      moment: { entryId: "j9", trackId: "track:9", title: "Fresh One", creatorName: "New Artist", addedByName: "Host" },
    });
    expect(client.nowPlaying).toMatchObject({ title: "Fresh One", creatorName: "New Artist" });
    expect(moments).toHaveLength(1);
    socket.receive({
      type: "jukebox.state",
      jukebox: {
        current: null,
        queue: [],
        party: { eventId: "evt-p", title: "Album Night", hostName: "Host" },
      },
    });
    expect(client.jukebox?.party).toEqual({ eventId: "evt-p", title: "Album Night", hostName: "Host" });
  });

  it("drop frames: welcome snapshot, landed herald, witnessed claim, sweep, denial — and the claim intent", async () => {
    const { client, socket } = await inside();
    // The welcome snapshot: a drop already standing in the room.
    socket.receive({
      type: "welcome",
      peerId: SELF.peerId,
      room: { id: "world:courtyard", name: "Courtyard" },
      you: SELF,
      peers: [],
      drop: DROP,
    });
    expect(client.drop).toEqual(DROP);

    const landed: unknown[] = [];
    const claimed: unknown[] = [];
    client.onDropLanded = (d) => landed.push(d);
    client.onDropClaimed = (claim, dropState) => claimed.push({ claim, dropState });
    socket.receive({ type: "drop.landed", kind: "drop", title: DROP.title, roomId: DROP.roomId, roomName: DROP.roomName, drop: DROP });
    expect(landed).toEqual([DROP]);

    socket.receive({
      type: "drop.claimed",
      drop: { ...DROP, claimsLeft: 1 },
      claim: { name: "Alpha", amountVb: 200 },
    });
    expect(claimed).toEqual([{ claim: { name: "Alpha", amountVb: 200 }, dropState: { ...DROP, claimsLeft: 1 } }]);
    expect(client.drop?.claimsLeft).toBe(1);

    socket.receive({ type: "drop.state", drop: null });
    expect(client.drop).toBeNull();

    let denied = "";
    client.onDropDenied = (r) => {
      denied = r;
    };
    socket.receive({ type: "drop.denied", reason: "claimed-out" });
    expect(denied).toBe("claimed-out");

    socket.sent = [];
    client.claimDrop();
    expect(socket.sent).toEqual([{ type: "drop.claim" }]);

    const guestRun = await inside({ t: 0 }, { ...SELF, guest: true });
    guestRun.socket.sent = [];
    guestRun.client.claimDrop();
    expect(guestRun.socket.sent).toEqual([]);
  });
});

describe("session longevity — keepalive + the quiet reconnect", () => {
  /* Same hand-driven timers as the connect engine's harness, plus
   * the injected clock the liveness window reads. */
  function manualTimers() {
    let nextId = 1;
    const timers = new Map<number, { fn: () => void; ms: number }>();
    return {
      setTimer: (fn: () => void, ms: number) => {
        const id = nextId++;
        timers.set(id, { fn, ms });
        return id;
      },
      clearTimer: (handle: unknown) => {
        timers.delete(handle as number);
      },
      pendingDelays: () => [...timers.values()].map((t) => t.ms),
      fireNext: () => {
        const first = [...timers.entries()][0];
        if (!first) return null;
        timers.delete(first[0]);
        first[1].fn();
        return first[1].ms;
      },
    };
  }

  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  function makeLongClient() {
    const timers = manualTimers();
    const nowRef = { t: 0 };
    const sockets: FakeSocket[] = [];
    const statuses: WorldStatus[] = [];
    const reconnectEvents: boolean[] = [];
    const roomsChanged: string[] = [];
    const client = new WorldClient({
      getAccessToken: async () => "token-abc",
      socketUrl: (token) => `ws://hall/api/world/ws${token ? `?token=${token}` : ""}`,
      openSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      now: () => nowRef.t,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    client.onStatus = (s) => statuses.push(s);
    client.onReconnectingChange = (r) => reconnectEvents.push(r);
    client.onRoomChanged = (room) => roomsChanged.push(room.id);
    return { client, sockets, timers, statuses, reconnectEvents, roomsChanged, nowRef };
  }

  async function land(h: ReturnType<typeof makeLongClient>) {
    await h.client.connect();
    h.sockets[0]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(h.client.status).toBe("inside");
  }

  it("pings on the keepalive cadence while inside — and only while inside", async () => {
    const h = makeLongClient();
    await h.client.connect();
    // No keepalive before the welcome: the entry watchdog owns the
    // connecting phase.
    expect(h.timers.pendingDelays()).toEqual([WORLD_FIRST_WELCOME_WATCHDOG_MS]);

    h.sockets[0]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(h.client.status).toBe("inside");
    expect(h.timers.pendingDelays()).toEqual([WORLD_KEEPALIVE_INTERVAL_MS]);

    h.nowRef.t += WORLD_KEEPALIVE_INTERVAL_MS;
    expect(h.timers.fireNext()).toBe(WORLD_KEEPALIVE_INTERVAL_MS);
    expect(h.sockets[0]!.sent).toContainEqual({ type: "ping" });
    expect(h.timers.pendingDelays()).toEqual([WORLD_KEEPALIVE_INTERVAL_MS]); // re-armed

    // The pong answers the liveness clock (any inbound frame does).
    h.sockets[0]!.receive({ type: "pong" });
    h.nowRef.t += WORLD_KEEPALIVE_INTERVAL_MS;
    h.timers.fireNext();
    expect(h.sockets[0]!.sent.filter((f) => f.type === "ping")).toHaveLength(2);
    expect(h.client.status).toBe("inside");
  });

  it("any inbound frame feeds the liveness clock — a busy room is its own proof of life", async () => {
    const h = makeLongClient();
    await land(h);
    // Past the liveness timeout on the clock, but a frame lands
    // first: the tick must ping, not declare the path dead.
    h.nowRef.t += WORLD_LIVENESS_TIMEOUT_MS + 1_000;
    h.sockets[0]!.receive({ type: "peer.move", peerId: "w-other", x: 1, y: 0, z: 1, rotY: 0 });
    expect(h.timers.fireNext()).toBe(WORLD_KEEPALIVE_INTERVAL_MS);
    expect(h.sockets[0]!.sent).toContainEqual({ type: "ping" });
    expect(h.client.reconnecting).toBe(false);
    expect(h.client.status).toBe("inside");
  });

  it("silence past the liveness window is a dead path: the zombie socket is retired and the client re-enters quietly", async () => {
    const h = makeLongClient();
    await land(h);
    // No pong, no traffic, nothing — past three missed cycles.
    h.nowRef.t += WORLD_LIVENESS_TIMEOUT_MS + 1_000;
    expect(h.timers.fireNext()).toBe(WORLD_KEEPALIVE_INTERVAL_MS);
    // The socket was never closed BY the server — the client
    // retired it itself (its close event is identity-guarded into
    // silence) and opened the quiet reconnect instead.
    expect(h.sockets[0]!.readyState).toBe(3);
    expect(h.client.status).toBe("inside");
    expect(h.client.reconnecting).toBe(true);
    await flush();
    expect(h.sockets).toHaveLength(2);
    h.sockets[1]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(h.client.status).toBe("inside");
    expect(h.client.reconnecting).toBe(false);
    expect(h.reconnectEvents).toEqual([true, false]);
  });

  it("a drop while inside re-enters quietly: no error status ever shows, and the landing re-homes the page", async () => {
    const h = makeLongClient();
    await land(h);
    h.sockets[0]!.onclose?.({ code: 1006 });
    expect(h.client.status).toBe("inside");
    expect(h.client.reconnecting).toBe(true);
    await flush();
    expect(h.sockets).toHaveLength(2);
    h.sockets[1]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(h.client.status).toBe("inside");
    expect(h.client.reconnecting).toBe(false);
    expect(h.statuses).not.toContain("error");
    expect(h.reconnectEvents).toEqual([true, false]);
    // The session is new even though the room is the same: the
    // page tears the dead socket's voice mesh down via the same
    // re-home a doorway transfer fires.
    expect(h.roomsChanged).toEqual(["world:kings-hall"]);
  });

  it("reconnect attempts ride the LONG windows — a host mid-restart gets first-connect patience", async () => {
    const h = makeLongClient();
    await land(h);
    h.sockets[0]!.onclose?.({ code: 1006 });
    await flush();
    expect(h.sockets).toHaveLength(2);
    expect(h.timers.pendingDelays()).toEqual([WORLD_FIRST_WELCOME_WATCHDOG_MS]); // NOT the 20 s window
    // Attempt 1 hangs (host still restarting): the watchdog fails
    // it inside the long window, the backoff is the usual one.
    expect(h.timers.fireNext()).toBe(WORLD_FIRST_WELCOME_WATCHDOG_MS);
    expect(h.timers.pendingDelays()).toEqual([1_000]);
    expect(h.client.status).toBe("inside");
    expect(h.client.reconnecting).toBe(true);
    h.timers.fireNext();
    await flush();
    expect(h.sockets).toHaveLength(3);
    expect(h.timers.pendingDelays()).toEqual([WORLD_FIRST_WELCOME_WATCHDOG_MS]);
    h.sockets[2]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(h.client.status).toBe("inside");
    expect(h.client.reconnecting).toBe(false);
  });

  it("genuinely exhausted patience lands the honest card: 3 failed reconnect attempts → error", async () => {
    const h = makeLongClient();
    await land(h);
    h.sockets[0]!.onclose?.({ code: 1006 });
    await flush();
    h.sockets[1]!.onerror?.();
    expect(h.timers.pendingDelays()).toEqual([1_000]);
    h.timers.fireNext();
    await flush();
    h.sockets[2]!.onclose?.({ code: 1006 });
    expect(h.timers.pendingDelays()).toEqual([2_000]);
    h.timers.fireNext();
    await flush();
    expect(h.sockets).toHaveLength(1 + WORLD_CONNECT_MAX_ATTEMPTS);
    h.sockets[3]!.onerror?.();
    expect(h.client.status).toBe("error");
    expect(h.client.reconnecting).toBe(false);
    expect(h.reconnectEvents).toEqual([true, false]);
    expect(h.timers.pendingDelays()).toEqual([]); // nothing left running
  });

  it("room_full during a reconnect stays terminal — no retry against a full hall, no stuck reconnecting flag", async () => {
    const h = makeLongClient();
    await land(h);
    h.sockets[0]!.onclose?.({ code: 1006 });
    await flush();
    h.sockets[1]!.receive({ type: "room_full", cap: 30 });
    expect(h.client.status).toBe("full");
    expect(h.client.reconnecting).toBe(false);
    h.sockets[1]!.onclose?.({ code: 4429 });
    expect(h.client.status).toBe("full");
    expect(h.timers.pendingDelays()).toEqual([]);
  });

  it("disconnect during a reconnect cancels it — leaving means leaving, mid-interlude too", async () => {
    const h = makeLongClient();
    await land(h);
    h.sockets[0]!.onclose?.({ code: 1006 });
    await flush();
    expect(h.sockets).toHaveLength(2);
    expect(h.client.reconnecting).toBe(true);
    h.client.disconnect();
    expect(h.client.status).toBe("closed");
    expect(h.client.reconnecting).toBe(false);
    expect(h.timers.pendingDelays()).toEqual([]);
    await flush();
    expect(h.sockets).toHaveLength(2); // nothing further opened
  });

  it("a second drop after a landed reconnect reconnects again — the patience is per-drop, not per-client", async () => {
    const h = makeLongClient();
    await land(h);
    h.sockets[0]!.onclose?.({ code: 1006 });
    await flush();
    h.sockets[1]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(h.client.reconnecting).toBe(false);
    h.sockets[1]!.onclose?.({ code: 1006 });
    expect(h.client.status).toBe("inside");
    expect(h.client.reconnecting).toBe(true);
    await flush();
    expect(h.sockets).toHaveLength(3);
    h.sockets[2]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(h.client.status).toBe("inside");
    expect(h.reconnectEvents).toEqual([true, false, true, false]);
  });
});

describe("stars + witnessed moments (THE-GAME §5(a))", () => {
  it("welcome installs the peer records' stars — members carry them, guests don't", async () => {
    const selfStars = { ...SELF, stars: 4 };
    const otherStars = { ...OTHER, stars: 2 };
    const { client } = await inside({ t: 0 }, selfStars, [otherStars]);
    expect(client.self?.stars).toBe(4);
    expect(client.peers.get("w-other")?.stars).toBe(2);
  });

  it("celebrate intents send bare moment.celebrate frames — no facts ride them", async () => {
    const { client, socket } = await inside();
    socket.sent = [];
    client.celebrateQuest();
    client.celebrateLevelup();
    expect(socket.sent).toEqual([
      { type: "moment.celebrate", kind: "quest" },
      { type: "moment.celebrate", kind: "levelup" },
    ]);
  });

  it("a guest client never sends a celebrate intent", async () => {
    const guestSelf = { ...SELF, peerId: "w-guest", displayName: "Guest", guest: true, profileSlug: null };
    const { client, socket } = await inside({ t: 0 }, guestSelf, []);
    socket.sent = [];
    client.celebrateQuest();
    client.celebrateLevelup();
    expect(socket.sent).toEqual([]);
  });

  it("a quest moment reaches onMoment with the server's content and lands as lastMoment", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    const seen: unknown[] = [];
    client.onMoment = (m) => seen.push(m);
    socket.receive({
      type: "peer.moment",
      moment: { kind: "quest", peerId: "w-other", name: "Other", questName: "Export a video", rewardVb: 120 },
    });
    expect(seen).toEqual([
      { kind: "quest", peerId: "w-other", name: "Other", questName: "Export a video", rewardVb: 120 },
    ]);
    expect(client.lastMoment).toEqual(seen[0]);
    /* A quest moment never restars anyone. */
    expect(client.peers.get("w-other")?.stars).toBeUndefined();
  });

  it("a levelup moment restars the achiever's peer record — and my own record when it's me", async () => {
    const { client, socket } = await inside({ t: 0 }, { ...SELF, stars: 2 }, [{ ...OTHER, stars: 1 }]);
    const seen: unknown[] = [];
    client.onMoment = (m) => seen.push(m);

    socket.receive({
      type: "peer.moment",
      moment: { kind: "levelup", peerId: "w-other", name: "Other", stars: 5 },
    });
    expect(client.peers.get("w-other")?.stars).toBe(5);
    expect(client.self?.stars).toBe(2);

    socket.receive({
      type: "peer.moment",
      moment: { kind: "levelup", peerId: "w-self", name: "Me", stars: 3 },
    });
    expect(client.self?.stars).toBe(3);
    expect(seen).toHaveLength(2);
  });

  it("malformed moments are not moments: no callback, no restar, no lastMoment", async () => {
    const { client, socket } = await inside({ t: 0 }, { ...SELF, stars: 2 }, [OTHER]);
    const seen: unknown[] = [];
    client.onMoment = (m) => seen.push(m);
    socket.receive({ type: "peer.moment", moment: { kind: "quest", peerId: "w-other", name: "Other", rewardVb: 120 } });
    socket.receive({ type: "peer.moment", moment: { kind: "levelup", peerId: "w-other", name: "Other", stars: 99 } });
    socket.receive({ type: "peer.moment", moment: { kind: "jackpot", peerId: "w-other", name: "Other" } });
    socket.receive({ type: "peer.moment", moment: null });
    expect(seen).toEqual([]);
    expect(client.lastMoment).toBeNull();
    expect(client.peers.get("w-other")?.stars).toBeUndefined();
  });
});

describe("presence truth — guest session id + the replaced state", () => {
  const LOC = { protocol: "https:", host: "hall.test" };

  it("the socket URL carries the guest id only for guests — a member's token stands alone", () => {
    expect(defaultWorldSocketUrl(LOC, null, "tab-session-1")).toBe(
      "wss://hall.test/api/world/ws?guest=tab-session-1",
    );
    const memberUrl = defaultWorldSocketUrl(LOC, "tok en", "tab-session-1");
    expect(memberUrl.startsWith("wss://hall.test/api/world/ws?")).toBe(true);
    expect(memberUrl).toContain("tok%20en"); // the token, encoded
    expect(memberUrl).not.toContain("guest="); // members carry no guest id
    expect(defaultWorldSocketUrl(LOC, null)).toBe("wss://hall.test/api/world/ws");
    expect(defaultWorldSocketUrl(LOC, null, null)).toBe("wss://hall.test/api/world/ws");
  });

  it("the tab's guest session id is stable across calls and shaped for the server's gate", () => {
    const a = worldGuestSessionId();
    const b = worldGuestSessionId();
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it("fresh guest ids are unique and in-shape", () => {
    const a = newWorldGuestSessionId();
    const b = newWorldGuestSessionId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(b).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it("replaced flips status to replaced — and the 4414 close behind it can't stomp it", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    socket.receive({ type: "replaced" });
    expect(client.status).toBe("replaced");
    socket.onclose?.({ code: WORLD_REPLACED_CLOSE_CODE });
    expect(client.status).toBe("replaced");
    expect(worldOverlay(client.status)).toBe("replaced");
    expect(worldOverlay("replaced")).toBe("replaced");
  });

  it("a bare 4414 close — frame lost on the way out — still lands on replaced, never on error or a reconnect", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    socket.onclose?.({ code: WORLD_REPLACED_CLOSE_CODE });
    expect(client.status).toBe("replaced");
  });

  it("replaced is terminal: no keepalive, no quiet reconnect, no second socket — the tab war cannot start", async () => {
    let nextId = 1;
    const timers = new Map<number, { fn: () => void; ms: number }>();
    const sockets: FakeSocket[] = [];
    const statuses: WorldStatus[] = [];
    const client = new WorldClient({
      getAccessToken: async () => "token-abc",
      socketUrl: (token) => `ws://hall/api/world/ws${token ? `?token=${token}` : ""}`,
      openSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      now: () => 0,
      setTimer: (fn, ms) => {
        const id = nextId++;
        timers.set(id, { fn, ms });
        return id;
      },
      clearTimer: (handle) => {
        timers.delete(handle as number);
      },
    });
    client.onStatus = (s) => statuses.push(s);
    await client.connect();
    sockets[0]!.receive({ type: "welcome", peerId: SELF.peerId, you: SELF, peers: [] });
    expect(client.status).toBe("inside");
    expect(timers.size).toBe(1); // the keepalive

    sockets[0]!.receive({ type: "replaced" });
    expect(client.status).toBe("replaced");
    // The one pending keepalive tick fires into a non-inside
    // status and dies without pinging or re-arming (the same
    // self-termination the removed state relies on).
    const pending = [...timers.values()];
    expect(pending).toHaveLength(1);
    timers.clear();
    pending[0]!.fn();
    expect(timers.size).toBe(0);
    expect(sockets[0]!.sent.filter((f) => f.type === "ping")).toEqual([]);
    sockets[0]!.onclose?.({ code: WORLD_REPLACED_CLOSE_CODE });
    await new Promise((r) => setTimeout(r, 0));
    expect(sockets).toHaveLength(1); // no reconnect socket ever opened
    expect(client.reconnecting).toBe(false);
    expect(statuses).not.toContain("error");
    expect(client.status).toBe("replaced");
  });
});

describe("locks — the honest cards (4415 person / 4416 door)", () => {
  /* Timers driven by hand, same idiom as the retry describes:
   * a lock's terminality is asserted against the timer queue —
   * no watchdog, no backoff, no second socket may survive it. */
  function manualTimers() {
    let nextId = 1;
    const timers = new Map<number, { fn: () => void; ms: number }>();
    return {
      setTimer: (fn: () => void, ms: number) => {
        const id = nextId++;
        timers.set(id, { fn, ms });
        return id;
      },
      clearTimer: (handle: unknown) => {
        timers.delete(handle as number);
      },
      pendingDelays: () => [...timers.values()].map((t) => t.ms),
    };
  }

  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  function makeLockClient() {
    const timers = manualTimers();
    const sockets: FakeSocket[] = [];
    const statuses: WorldStatus[] = [];
    const client = new WorldClient({
      getAccessToken: async () => "token-abc",
      socketUrl: (token) => `ws://hall/api/world/ws${token ? `?token=${token}` : ""}`,
      openSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    client.onStatus = (s) => statuses.push(s);
    return { client, sockets, timers, statuses };
  }

  const UNTIL_ISO = "2027-01-01T01:00:00.000Z";

  it("a person lock at entry lands on the locked-out card — frame first, the 4415 close behind it can't stomp it into an error", async () => {
    const { client, sockets, timers, statuses } = makeLockClient();
    await client.connect();
    expect(timers.pendingDelays()).toEqual([WORLD_FIRST_WELCOME_WATCHDOG_MS]);

    sockets[0]!.receive({
      type: "room.locked",
      kind: "person",
      roomId: "world:kings-hall",
      name: "The King's Hall",
      until: UNTIL_ISO,
    });
    expect(client.status).toBe("locked-out");
    expect(worldOverlay(client.status)).toBe("locked-out");
    /* The refusal rides the client with the server's own until —
     * parsed, never invented. */
    expect(client.lockRefusal).toEqual({
      kind: "person",
      roomId: "world:kings-hall",
      name: "The King's Hall",
      untilMs: Date.parse(UNTIL_ISO),
    });
    /* Terminal: the watchdog is gone and no backoff stands — the
     * retry budget is not burned against a door that would only
     * refuse again. */
    expect(timers.pendingDelays()).toEqual([]);

    sockets[0]!.onclose?.({ code: WORLD_LOCKED_OUT_CLOSE_CODE });
    await flush();
    expect(client.status).toBe("locked-out");
    expect(client.lockRefusal?.untilMs).toBe(Date.parse(UNTIL_ISO));
    expect(sockets).toHaveLength(1); // no retry socket ever opened
    expect(statuses).not.toContain("error");
  });

  it("a door lock at entry lands on the door-locked card, with no until — door locks carry no expiry", async () => {
    const { client, sockets, timers, statuses } = makeLockClient();
    await client.connect();
    sockets[0]!.receive({
      type: "room.locked",
      kind: "door",
      roomId: "world:music-hall",
      name: "Music Hall",
    });
    expect(client.status).toBe("door-locked");
    expect(worldOverlay(client.status)).toBe("door-locked");
    expect(client.lockRefusal).toEqual({
      kind: "door",
      roomId: "world:music-hall",
      name: "Music Hall",
      untilMs: null,
    });
    expect(timers.pendingDelays()).toEqual([]);

    sockets[0]!.onclose?.({ code: WORLD_DOOR_LOCKED_CLOSE_CODE });
    await flush();
    expect(client.status).toBe("door-locked");
    expect(sockets).toHaveLength(1);
    expect(statuses).not.toContain("error");
  });

  it("a bare 4415 close — frame lost on the way out — still lands on locked-out, never on error or a retry", async () => {
    const { client, sockets, timers, statuses } = makeLockClient();
    await client.connect();
    sockets[0]!.onclose?.({ code: WORLD_LOCKED_OUT_CLOSE_CODE });
    await flush();
    expect(client.status).toBe("locked-out");
    /* No frame, no until: the refusal stands with the code's own
     * kind and NO time — the card shows no remaining line rather
     * than inventing one. */
    expect(client.lockRefusal?.kind).toBe("person");
    expect(client.lockRefusal?.untilMs).toBeNull();
    expect(timers.pendingDelays()).toEqual([]);
    expect(sockets).toHaveLength(1);
    expect(statuses).not.toContain("error");
  });

  it("a bare 4416 close lands on door-locked", async () => {
    const { client, sockets, statuses } = makeLockClient();
    await client.connect();
    sockets[0]!.onclose?.({ code: WORLD_DOOR_LOCKED_CLOSE_CODE });
    await flush();
    expect(client.status).toBe("door-locked");
    expect(client.lockRefusal?.kind).toBe("door");
    expect(statuses).not.toContain("error");
  });

  it("a person lock slamming mid-visit is an ejection, not a drop: no quiet reconnect to the same shut door", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    expect(client.status).toBe("inside");
    socket.onclose?.({ code: WORLD_LOCKED_OUT_CLOSE_CODE });
    expect(client.status).toBe("locked-out");
    expect(client.reconnecting).toBe(false);
  });

  it("a doorway transfer refused by a lock keeps my place: status stays inside, the page hears it via onRoomLocked", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    const heard: WorldLockRefusal[] = [];
    client.onRoomLocked = (info) => heard.push(info);

    socket.receive({
      type: "room.locked",
      kind: "person",
      roomId: "world:music-hall",
      name: "Music Hall",
      until: UNTIL_ISO,
    });
    expect(client.status).toBe("inside");
    expect(heard).toEqual([
      { kind: "person", roomId: "world:music-hall", name: "Music Hall", untilMs: Date.parse(UNTIL_ISO) },
    ]);
    expect(client.lockRefusal?.kind).toBe("person");

    socket.receive({ type: "room.locked", kind: "door", roomId: "world:game-rooms", name: "Game Rooms" });
    expect(client.status).toBe("inside");
    expect(heard[1]).toEqual({ kind: "door", roomId: "world:game-rooms", name: "Game Rooms", untilMs: null });
  });

  it("a malformed room.locked frame is ignored — no kind, no card", async () => {
    const { client, sockets, statuses } = makeLockClient();
    await client.connect();
    sockets[0]!.receive({ type: "room.locked", kind: "banana", roomId: "world:kings-hall" });
    expect(client.status).toBe("connecting");
    expect(client.lockRefusal).toBeNull();
    expect(statuses).not.toContain("locked-out");
    expect(statuses).not.toContain("door-locked");
  });

  it("a person lock whose until is malformed keeps the card but drops the time — never a guessed one", async () => {
    const { client, sockets } = makeLockClient();
    await client.connect();
    sockets[0]!.receive({
      type: "room.locked",
      kind: "person",
      roomId: "world:kings-hall",
      name: "The King's Hall",
      until: "whenever",
    });
    expect(client.status).toBe("locked-out");
    expect(client.lockRefusal?.untilMs).toBeNull();
  });

  it("formatLockDuration speaks the largest whole unit, in the visitor's own grammar", () => {
    expect(formatLockDuration(42 * 60_000, "en")).toBe("42 minutes");
    expect(formatLockDuration(60_000, "en")).toBe("1 minute");
    expect(formatLockDuration(90 * 60_000, "en")).toBe("90 minutes");
    expect(formatLockDuration(5 * 3_600_000, "en")).toBe("5 hours");
    expect(formatLockDuration(3 * 86_400_000, "en")).toBe("3 days");
    /* A lock at (or past) its end never reads zero or negative. */
    expect(formatLockDuration(0, "en")).toBe("1 minute");
    expect(formatLockDuration(-5_000, "en")).toBe("1 minute");
    /* Other locales carry their own unit grammar via Intl. */
    expect(formatLockDuration(42 * 60_000, "de")).toBe("42 Minuten");
    expect(formatLockDuration(42 * 60_000, "ja")).toContain("42");
    expect(formatLockDuration(42 * 60_000, "ko")).toContain("42");
  });
});

describe("palace announcements (Ring 3)", () => {
  it("a palace.announce lands normalized on client.announce and fires onAnnounce", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    const heard: unknown[] = [];
    client.onAnnounce = (a) => heard.push(a);
    socket.receive({
      type: "palace.announce",
      announce: {
        kind: "drop",
        text: "Shark Drop just landed in Music Hall — 250 VB a claim, first come.",
        roomId: "world:music-hall",
        roomName: "Music Hall",
        amountVb: 250,
        at: 123_456,
      },
    });
    expect(client.announce).toEqual({
      kind: "drop",
      text: "Shark Drop just landed in Music Hall — 250 VB a claim, first come.",
      roomId: "world:music-hall",
      roomName: "Music Hall",
      amountVb: 250,
      at: 123_456,
    });
    expect(heard).toHaveLength(1);
  });

  it("a malformed announcement (unknown kind, empty text) is dropped, never presented", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    const heard: unknown[] = [];
    client.onAnnounce = (a) => heard.push(a);
    socket.receive({ type: "palace.announce", announce: { kind: "fireworks", text: "boom", at: 1 } });
    socket.receive({ type: "palace.announce", announce: { kind: "drop", text: "", at: 1 } });
    socket.receive({ type: "palace.announce", announce: "not an object" });
    expect(client.announce).toBeNull();
    expect(heard).toEqual([]);
  });

  it("an announce.denied fires onAnnounceDenied and changes nothing else", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    let denied = 0;
    client.onAnnounceDenied = () => denied++;
    socket.receive({ type: "announce.denied" });
    expect(denied).toBe(1);
    expect(client.announce).toBeNull();
    expect(client.status).toBe("inside");
  });

  it("herald sends only for an admin self, trimmed + capped; members and blanks send nothing", async () => {
    const plain = await inside({ t: 0 }, SELF, [OTHER]);
    expect(plain.client.herald("Court at eight.")).toBe(false);
    expect(plain.socket.sent).toEqual([]);

    const admin = await inside({ t: 0 }, { ...SELF, admin: true }, [OTHER]);
    expect(admin.client.herald("   ")).toBe(false);
    expect(admin.client.herald("  Court at eight.  ")).toBe(true);
    expect(admin.socket.sent).toEqual([{ type: "announce.herald", text: "Court at eight." }]);
    admin.socket.sent = [];
    expect(admin.client.herald("x".repeat(200))).toBe(true);
    expect(admin.socket.sent[0].text).toHaveLength(140);
  });
});

describe("the King's daily moment (Ring 3)", () => {
  const MOMENT = { date: "2026-10-17", claimDeadlineMs: 9_999_999, claimed: false };

  it("king.state sets the standing moment and fires onKingMoment; a malformed state reads as no moment", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    const seen: unknown[] = [];
    client.onKingMoment = (m) => seen.push(m);
    socket.receive({ type: "king.state", kingMoment: MOMENT });
    expect(client.kingMoment).toEqual(MOMENT);
    socket.receive({ type: "king.state", kingMoment: { date: 42 } });
    expect(client.kingMoment).toBeNull();
    socket.receive({ type: "king.state", kingMoment: MOMENT });
    socket.receive({ type: "king.state", kingMoment: null });
    expect(client.kingMoment).toBeNull();
    expect(seen).toEqual([MOMENT, null, MOMENT, null]);
  });

  it("a same-day broadcast never un-claims me — my answered copy wins", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    socket.receive({ type: "king.state", kingMoment: { ...MOMENT, claimed: true } });
    expect(client.kingMoment?.claimed).toBe(true);
    socket.receive({ type: "king.state", kingMoment: MOMENT });
    expect(client.kingMoment?.claimed).toBe(true);
  });

  it("king.claimed + king.denied reach their handlers with server truth", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    const claims: unknown[] = [];
    const denied: string[] = [];
    client.onKingClaimed = (c) => claims.push(c);
    client.onKingDenied = (r) => denied.push(r);
    socket.receive({ type: "king.claimed", claim: { name: "Nova", amountVb: 25 } });
    socket.receive({ type: "king.claimed", claim: { name: "Nova" } });
    socket.receive({ type: "king.denied", reason: "pool" });
    socket.receive({ type: "king.denied" });
    expect(claims).toEqual([{ name: "Nova", amountVb: 25 }]);
    expect(denied).toEqual(["pool", "error"]);
  });

  it("claimKingGift sends for a member inside; a guest sends nothing", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    client.claimKingGift();
    expect(socket.sent).toEqual([{ type: "king.claim" }]);

    const guestRun = await inside({ t: 0 }, { ...SELF, guest: true }, [OTHER]);
    guestRun.client.claimKingGift();
    expect(guestRun.socket.sent).toEqual([]);
  });
});

describe("stage tips from seats (Ring 3, item 3.3)", () => {
  it("stage.tipped + stage.tip.denied reach their handlers with server truth", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    const tipped: unknown[] = [];
    const denied: string[] = [];
    client.onStageTipped = (t) => tipped.push(t);
    client.onStageTipDenied = (r) => denied.push(r);
    socket.receive({
      type: "stage.tipped",
      tip: { name: "Fan", performerName: "Star", amountVb: 250 },
    });
    socket.receive({ type: "stage.tipped", tip: { name: "Fan" } });
    socket.receive({ type: "stage.tip.denied", reason: "insufficient" });
    socket.receive({ type: "stage.tip.denied" });
    expect(tipped).toEqual([{ name: "Fan", performerName: "Star", amountVb: 250 }]);
    expect(denied).toEqual(["insufficient", "error"]);
  });

  it("tipStage sends for a member inside with a whole amount; guests and bad amounts send nothing", async () => {
    const { client, socket } = await inside({ t: 0 }, SELF, [OTHER]);
    client.tipStage(250);
    expect(socket.sent).toEqual([{ type: "stage.tip", amountVb: 250 }]);
    socket.sent = [];
    client.tipStage(100.5);
    client.tipStage(0);
    client.tipStage(-100);
    expect(socket.sent).toEqual([]);

    const guestRun = await inside({ t: 0 }, { ...SELF, guest: true }, [OTHER]);
    guestRun.client.tipStage(250);
    expect(guestRun.socket.sent).toEqual([]);
  });
});
