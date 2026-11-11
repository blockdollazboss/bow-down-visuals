/**
 * Wire tests for Crownfall Run ONLINE (routes/crownfall +
 * lib/crownfall-rooms + lib/live-ws). The REAL gateway runs on a bare
 * http server with REAL ws clients — guest refusal, a full two-player
 * co-op floor over the wire (refereed kill, coin claim, party door,
 * wipe), and the room-full refusal are exercised end to end. Only
 * token verification and identity resolution are injected.
 *
 * These tests prove the protocol and the referee. They do NOT prove
 * live multiplayer feels right with two real accounts on staging —
 * that verdict needs the owner's two-account play test.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { LiveWsGateway, RoomHub } from "../../lib/live-ws";
import { CrownfallRooms, type CrownfallIdentity } from "../../lib/crownfall-rooms";
import { registerCrownfallWs } from "../crownfall";

const HOST = "00000000-0000-4000-8000-0000000000a1";
const GUEST = "00000000-0000-4000-8000-0000000000b2";
const THIRD = "00000000-0000-4000-8000-0000000000c3";
const FOURTH = "00000000-0000-4000-8000-0000000000d4";
const FIFTH = "00000000-0000-4000-8000-0000000000e5";

const TOKENS: Record<string, { userId: string; email: string }> = {
  "tok-host": { userId: HOST, email: "host@palace.test" },
  "tok-guest": { userId: GUEST, email: "guest@palace.test" },
  "tok-third": { userId: THIRD, email: "third@palace.test" },
  "tok-fourth": { userId: FOURTH, email: "fourth@palace.test" },
  "tok-fifth": { userId: FIFTH, email: "fifth@palace.test" },
};
const NAMES: Record<string, string> = {
  [HOST]: "Host Royal",
  [GUEST]: "Guest Gold",
  [THIRD]: "Third Voice",
  [FOURTH]: "Fourth Bell",
  [FIFTH]: "Fifth Wheel",
};

let server: Server;
let gateway: LiveWsGateway;
let rooms: CrownfallRooms;
let port = 0;
const clients: WebSocket[] = [];

interface Client {
  ws: WebSocket;
  messages: any[];
  closed: Promise<number>;
  send: (frame: unknown) => void;
}

function connect(path: string): Client {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  clients.push(ws);
  const messages: any[] = [];
  ws.on("message", (data) => {
    try {
      messages.push(JSON.parse(data.toString()));
    } catch {
      /* non-JSON frames aren't part of this protocol */
    }
  });
  const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
  return { ws, messages, closed, send: (f) => ws.send(JSON.stringify(f)) };
}

async function waitFor(client: Client, pred: (m: any) => boolean, ms = 5000): Promise<any> {
  const start = Date.now();
  for (;;) {
    const hit = client.messages.find(pred);
    if (hit) return hit;
    if (Date.now() - start > ms) throw new Error("timed out waiting for frame");
    await new Promise((r) => setTimeout(r, 15));
  }
}

function joinRoom(token: string, code: string): Client {
  return connect(`/api/arcade/crownfall/ws?token=${token}&code=${code}`);
}

function identity(userId: string): CrownfallIdentity {
  return { userId, displayName: NAMES[userId] ?? "Creator", avatarUrl: null, profileSlug: null };
}

beforeAll(async () => {
  rooms = new CrownfallRooms(new RoomHub(), {});
  gateway = new LiveWsGateway();
  registerCrownfallWs(gateway, {
    verifyToken: async (token) => TOKENS[token] ?? null,
    resolveIdentity: async (userId) => identity(userId),
    rooms,
  });
  server = createServer();
  gateway.attach(server);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const ws of clients) {
    try {
      ws.close();
    } catch {
      /* already gone */
    }
  }
  await new Promise((r) => server.close(r));
});

describe("crownfall ws: admission", () => {
  it("refuses guests — no token, no seat (the World access law)", async () => {
    const dto = rooms.createRoom(identity(HOST), {});
    const anon = connect(`/api/arcade/crownfall/ws?code=${dto.code}`);
    const err = await waitFor(anon, (m) => m.type === "error");
    expect(err.code).toBe("auth_required");
    await expect(anon.closed).resolves.toBe(4401);

    const forged = joinRoom("tok-nobody", dto.code);
    await waitFor(forged, (m) => m.type === "error" && m.code === "auth_required");
    await expect(forged.closed).resolves.toBe(4401);
  });

  it("refuses the fifth seat at a full table", async () => {
    const dto = rooms.createRoom(identity(HOST), {});
    const seated = [
      joinRoom("tok-host", dto.code),
      joinRoom("tok-guest", dto.code),
      joinRoom("tok-third", dto.code),
      joinRoom("tok-fourth", dto.code),
    ];
    for (const c of seated) await waitFor(c, (m) => m.type === "welcome");
    const fifth = joinRoom("tok-fifth", dto.code);
    const full = await waitFor(fifth, (m) => m.type === "room_full");
    expect(full.cap).toBe(4);
    await expect(fifth.closed).resolves.toBe(4429);
    for (const c of seated) c.ws.close();
  });
});

describe("crownfall ws: a co-op floor over the wire", () => {
  it("plays floor 1 end to end: refereed kill, coin claim, party door, wipe", async () => {
    const dto = rooms.createRoom(identity(HOST), { name: "Wire Room" });
    const host = joinRoom("tok-host", dto.code);
    const guest = joinRoom("tok-guest", dto.code);
    const hostWelcome = await waitFor(host, (m) => m.type === "welcome");
    const guestWelcome = await waitFor(guest, (m) => m.type === "welcome");
    expect(hostWelcome.room.name).toBe("Wire Room");
    const hostPeer = hostWelcome.you.peerId;
    const guestPeer = guestWelcome.you.peerId;
    expect(hostWelcome.you.displayName).toBe("Host Royal");

    // Host starts; both learn the shared seed.
    host.send({ type: "start" });
    const started = await waitFor(guest, (m) => m.type === "run.started");
    expect(started.seed).toBeGreaterThan(0);
    expect(started.depth).toBe(1);

    // Host registers the floor roster; guest's bolts do the killing.
    host.send({
      type: "foe.roster",
      depth: 1,
      foes: [{ id: 0, type: "chaser", elite: false, maxHp: 26 }],
      placed: 2,
    });
    guest.send({ type: "foe.hit", foeId: 0, dmg: 26, x: 200, y: 200 });
    const down = await waitFor(host, (m) => m.type === "foe.down");
    expect(down.byPeerId).toBe(guestPeer);
    await waitFor(host, (m) => m.type === "floor.cleared");

    // Guest claims a placed crown; the purse is theirs alone.
    guest.send({ type: "coin.take", coinId: "f1:p0" });
    const taken = await waitFor(host, (m) => m.type === "coin.taken");
    expect(taken.byPeerId).toBe(guestPeer);
    expect(taken.purse).toBe(1);

    // King state relays to the other screen, stamped by the server.
    host.send({ type: "state", x: 300, y: 400, faceX: 1, faceY: 0, hp: 90, maxhp: 100, firing: false, down: false, away: false });
    const relayed = await waitFor(guest, (m) => m.type === "state");
    expect(relayed.peerId).toBe(hostPeer);
    expect(relayed.x).toBe(300);

    // The party descends only when both have walked through.
    host.send({ type: "door.enter" });
    guest.send({ type: "door.enter" });
    const begin = await waitFor(host, (m) => m.type === "floor.begin");
    expect(begin.depth).toBe(2);

    // Floor 2 wipes the party: the run ends and receipts exist.
    host.send({ type: "player.down" });
    guest.send({ type: "player.down" });
    const ended = await waitFor(host, (m) => m.type === "run.ended");
    expect(ended.reason).toBe("wipe");
    const receipt = rooms.getReceipt(GUEST, dto.code);
    expect(receipt?.playerCount).toBe(2);
    expect(receipt?.coins).toBe(1);
    expect(receipt?.depth).toBe(2);

    host.ws.close();
    guest.ws.close();
  });
});
