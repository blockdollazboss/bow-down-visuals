/**
 * Crownfall Run ONLINE — room client tests (lib/crownfall-net).
 *
 * Drives CrownfallClient with a fake socket, exactly the way the
 * lobby does (deps injected, frames pushed in, frames asserted out):
 * - welcome installs self + room state; a welcome carrying a live run
 *   hands the game a resync directive; refusals (room_full, auth,
 *   no_room) land on the honest statuses
 * - run.started installs the shared seed + a start directive that is
 *   consumed exactly once; run.ended clears `started` so the game can
 *   never spin up a phantom local run from its death screen
 * - the roster registers once per floor and re-arms on floor.begin;
 *   the door intent fires once per floor; King state throttles to
 *   ~15 Hz; relayed state builds remote Kings — never for our own seat
 * - the client sends intents only (damage numbers, coin claims) —
 *   tallies arrive from the server's players frames, never from us
 */
import { describe, it, expect } from "vitest";
import {
  CrownfallClient,
  crownfallOverlay,
  defaultCrownfallSocketUrl,
  isCrownfallRoomCode,
  normalizeCrownfallCode,
  type CrownfallSocketLike,
} from "./crownfall-net";

class FakeSocket implements CrownfallSocketLike {
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

const HOST = {
  peerId: "p-host",
  displayName: "Host Royal",
  avatarUrl: null,
  profileSlug: "host-royal",
  isHost: true,
  connected: true,
  alive: false,
  down: false,
  purse: 0,
  kills: 0,
};
const GUEST = { ...HOST, peerId: "p-guest", displayName: "Guest Gold", isHost: false };

function makeClient(nowRef?: { t: number }) {
  const socket = new FakeSocket();
  const client = new CrownfallClient({
    getAccessToken: async () => "tok-1",
    socketUrl: (token, code) => `ws://test/${code}?token=${token}`,
    openSocket: () => socket,
    now: nowRef ? () => nowRef.t : undefined,
  });
  return { client, socket };
}

async function inside(nowRef?: { t: number }) {
  const { client, socket } = makeClient(nowRef);
  await client.connect("abc234");
  socket.receive({
    type: "welcome",
    code: "ABC234",
    you: HOST,
    room: { name: "Host Royal's Run", phase: "lobby", players: [HOST, GUEST], depth: 1, maxPlayers: 4 },
    run: null,
  });
  return { client, socket };
}

function startRun(socket: FakeSocket) {
  socket.receive({ type: "run.started", seed: 424242, depth: 1, players: [HOST, GUEST] });
}

describe("crownfall-net: addressing", () => {
  it("builds the socket URL on the shared gateway path", () => {
    expect(defaultCrownfallSocketUrl({ protocol: "https:", host: "x.test" }, "tok", "ABC234")).toBe(
      "wss://x.test/api/arcade/crownfall/ws?token=tok&code=ABC234",
    );
    expect(defaultCrownfallSocketUrl({ protocol: "http:", host: "x.test" }, null, "ABC234")).toBe(
      "ws://x.test/api/arcade/crownfall/ws?code=ABC234",
    );
  });

  it("validates room codes against the server alphabet", () => {
    expect(isCrownfallRoomCode("abc234")).toBe(true);
    expect(isCrownfallRoomCode("ABC23")).toBe(false);
    expect(isCrownfallRoomCode("ABCI34")).toBe(false); // I is not in the alphabet
    expect(normalizeCrownfallCode(" abc234 ")).toBe("ABC234");
  });

  it("maps statuses to honest overlays", () => {
    expect(crownfallOverlay("inside")).toBeNull();
    expect(crownfallOverlay("full")).toBe("room-full");
    expect(crownfallOverlay("auth")).toBe("auth");
    expect(crownfallOverlay("connecting")).toBe("connecting");
  });
});

describe("crownfall-net: room state", () => {
  it("welcome installs self, room and roster", async () => {
    const { client } = await inside();
    expect(client.status).toBe("inside");
    expect(client.code).toBe("ABC234");
    expect(client.roomName).toBe("Host Royal's Run");
    expect(client.self?.peerId).toBe("p-host");
    expect(client.isHost).toBe(true);
    expect(client.players).toHaveLength(2);
    expect(client.started).toBe(false);
    expect(client.takeStartDirective()).toBeNull();
  });

  it("a welcome onto a live run hands the game a resync directive", async () => {
    const { client, socket } = makeClient();
    await client.connect("ABC234");
    socket.receive({
      type: "welcome",
      code: "ABC234",
      you: { ...HOST, alive: true },
      room: { name: "Run", phase: "playing", players: [HOST], depth: 3, maxPlayers: 4 },
      run: {
        seed: 777,
        depth: 3,
        floor: { depth: 3, foes: [{ id: 0, hp: 0, maxHp: 26, down: true }], coinsTaken: ["f3:p0"], coinsLive: [] },
      },
    });
    expect(client.started).toBe(true);
    expect(client.seed).toBe(777);
    const dir = client.takeStartDirective();
    expect(dir?.resync).toBe(true);
    expect(dir?.depth).toBe(3);
    expect(dir?.snapshot?.foes[0]?.down).toBe(true);
    expect(client.takeStartDirective()).toBeNull();
  });

  it("refusals land on honest statuses", async () => {
    const { client, socket } = makeClient();
    await client.connect("ABC234");
    socket.receive({ type: "room_full", cap: 4 });
    expect(client.status).toBe("full");

    const second = makeClient();
    await second.client.connect("ABC234");
    second.socket.receive({ type: "error", code: "auth_required", message: "Sign in" });
    expect(second.client.status).toBe("auth");

    const third = makeClient();
    await third.client.connect("ABC234");
    third.socket.receive({ type: "error", code: "already_started", message: "Started" });
    expect(third.client.status).toBe("no-room");
  });

  it("only the host's start intent reaches the wire", async () => {
    const { client, socket } = await inside();
    client.start();
    expect(socket.sent.filter((f) => f.type === "start")).toHaveLength(1);

    const guestSide = makeClient();
    await guestSide.client.connect("ABC234");
    guestSide.socket.receive({
      type: "welcome",
      code: "ABC234",
      you: GUEST,
      room: { name: "Run", phase: "lobby", players: [HOST, GUEST], depth: 1, maxPlayers: 4 },
      run: null,
    });
    guestSide.client.start();
    expect(guestSide.socket.sent.filter((f) => f.type === "start")).toHaveLength(0);
  });
});

describe("crownfall-net: the game bridge", () => {
  it("run.started installs the seed and a one-shot directive; run.ended revokes started", async () => {
    const { client, socket } = await inside();
    startRun(socket);
    expect(client.started).toBe(true);
    expect(client.seed).toBe(424242);
    const dir = client.takeStartDirective();
    expect(dir).toEqual({ seed: 424242, depth: 1, snapshot: null, resync: false });
    expect(client.takeStartDirective()).toBeNull();

    socket.receive({ type: "run.ended", reason: "wipe", players: [HOST, GUEST] });
    expect(client.started).toBe(false);
    expect(client.roomPhase).toBe("lobby");
    expect(client.drainEvents().map((e) => e.kind)).toEqual(["runEnded"]);
  });

  it("registers the roster once per floor and re-arms on floor.begin", async () => {
    const { client, socket } = await inside();
    startRun(socket);
    const foes = [{ id: 0, type: "chaser", elite: false, maxHp: 26 }];
    expect(client.needsRoster(1)).toBe(true);
    client.sendRoster(1, foes, 3);
    client.sendRoster(1, foes, 3);
    expect(socket.sent.filter((f) => f.type === "foe.roster")).toHaveLength(1);
    expect(client.needsRoster(1)).toBe(false);

    socket.receive({ type: "floor.begin", depth: 2, seed: 424242 });
    expect(client.needsRoster(2)).toBe(true);
    expect(client.drainEvents().map((e) => e.kind)).toEqual(["floorBegin"]);
  });

  it("sends intents only — damage, claims, door, down — and reads tallies from the server", async () => {
    const { client, socket } = await inside();
    startRun(socket);
    client.reportHit(2, 13.6, 100.2, 200.7);
    expect(socket.sent.find((f) => f.type === "foe.hit")).toEqual({
      type: "foe.hit", foeId: 2, dmg: 14, x: 100, y: 201,
    });
    client.claimCoin("f1:p0");
    expect(socket.sent.find((f) => f.type === "coin.take")).toEqual({ type: "coin.take", coinId: "f1:p0" });
    client.notifyDoor(1);
    client.notifyDoor(1);
    expect(socket.sent.filter((f) => f.type === "door.enter")).toHaveLength(1);
    client.notifyLocalDown();
    expect(socket.sent.find((f) => f.type === "player.down")).toBeTruthy();
    // No tally of ours ever crosses the wire.
    expect(socket.sent.some((f) => "score" in f || "purse" in f || "kills" in f)).toBe(false);

    // Tallies arrive from the server's players frames.
    socket.receive({ type: "players", players: [{ ...HOST, purse: 3, kills: 2 }, GUEST] });
    expect(client.myPurse).toBe(3);
    expect(client.myKills).toBe(2);
  });

  it("throttles King state to ~15 Hz and builds remote Kings from relays", async () => {
    const nowRef = { t: 10_000 };
    const { client, socket } = await inside(nowRef);
    startRun(socket);
    const state = { x: 1, y: 2, faceX: 0, faceY: 1, hp: 90, maxhp: 100, firing: false, down: false, away: false };
    client.maybeSendState(state);
    client.maybeSendState(state);
    nowRef.t += 70;
    client.maybeSendState(state);
    expect(socket.sent.filter((f) => f.type === "state")).toHaveLength(2);

    socket.receive({ type: "state", peerId: "p-guest", x: 300, y: 400, faceX: 1, faceY: 0, hp: 55, maxhp: 100, firing: true, down: false, away: false });
    const king = client.remoteKings.get("p-guest");
    expect(king?.displayName).toBe("Guest Gold");
    expect(king?.x).toBe(300);
    // Our own relayed state (never sent by the server, but belt and
    // braces) does not create a ghost of ourselves.
    socket.receive({ type: "state", peerId: "p-host", x: 1, y: 1, faceX: 0, faceY: 1, hp: 1, maxhp: 100, firing: false, down: false, away: false });
    expect(client.remoteKings.has("p-host")).toBe(false);
    // Stale Kings are pruned.
    nowRef.t += 5_000;
    client.pruneRemoteKings();
    expect(client.remoteKings.size).toBe(0);
  });

  it("queues referee events for the game to drain exactly once", async () => {
    const { client, socket } = await inside();
    startRun(socket);
    socket.receive({ type: "foe.down", foeId: 1, byPeerId: "p-guest", x: 10, y: 20 });
    socket.receive({ type: "coin.spawn", coinId: "f1:d0", x: 10, y: 20, kind: "crown", onlyPeerId: null });
    socket.receive({ type: "floor.cleared", depth: 1 });
    const events = client.drainEvents();
    expect(events.map((e) => e.kind)).toEqual(["foeDown", "coinSpawn", "floorCleared"]);
    expect(client.drainEvents()).toEqual([]);
    expect(client.roomPhase).toBe("cleared");
  });
});
