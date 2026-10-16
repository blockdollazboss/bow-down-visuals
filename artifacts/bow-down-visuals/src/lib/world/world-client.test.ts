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
  character: null,
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
    const REY = { id: "char-rey", name: "Rey", portraitUrl: "https://img.example/rey.png" };
    socket.receive({ type: "peer.character", peerId: "w-other", character: REY });
    expect(client.peers.get("w-other")?.character).toEqual(REY);
    socket.receive({ type: "peer.character", peerId: "w-other", character: null });
    expect(client.peers.get("w-other")?.character).toBeNull();
    expect(seen).toEqual([["w-other", REY], ["w-other", null]]);

    // A malformed character payload degrades to null, never a crash.
    socket.receive({ type: "peer.character", peerId: "w-other", character: { nope: true } });
    expect(client.peers.get("w-other")?.character).toBeNull();
  });
});

describe("worldOverlay — the page's honest states", () => {
  it("maps statuses to overlays", () => {
    expect(worldOverlay("connecting")).toBe("connecting");
    expect(worldOverlay("full")).toBe("room-full");
    expect(worldOverlay("error")).toBe("error");
    expect(worldOverlay("inside")).toBeNull();
    expect(worldOverlay("closed")).toBeNull();
  });
});
