/**
 * Wire tests for Party Games (routes/party + lib/party-rooms +
 * lib/live-ws). The REAL gateway runs on a bare http server with REAL
 * ws clients — admission, host control, a full trivia match, a full
 * Court Battle, the room cap, host migration, and the server's refusal
 * to trust client-sent scores are all exercised over the wire. Only
 * token verification and identity resolution are injected.
 *
 * The engine's clock/timers are real but the rounds are short
 * (questionMs 2.5s, pickMs 1.2s) so a whole match takes seconds.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { LiveWsGateway, RoomHub } from "../../lib/live-ws";
import { PartyRooms, type PartyMatchResult } from "../../lib/party-rooms";
import { PARTY_QUESTIONS } from "../../lib/party-questions";
import { registerPartyWs } from "../party";

const HOST = "00000000-0000-4000-8000-0000000000h1".replace("h", "a");
const GUEST = "00000000-0000-4000-8000-0000000000g2".replace("g", "b");
const THIRD = "00000000-0000-4000-8000-0000000000t3".replace("t", "c");

const TOKENS: Record<string, { userId: string; email: string }> = {
  "tok-host": { userId: HOST, email: "host@palace.test" },
  "tok-guest": { userId: GUEST, email: "guest@palace.test" },
  "tok-third": { userId: THIRD, email: "third@palace.test" },
};
const NAMES: Record<string, string> = { [HOST]: "Host Royal", [GUEST]: "Guest Gold", [THIRD]: "Third Voice" };

let server: Server;
let gateway: LiveWsGateway;
let rooms: PartyRooms;
let port = 0;
const matchResults: PartyMatchResult[] = [];
const clients: WebSocket[] = [];

/* Deterministic rng so question order is stable run to run. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/** Wait for the Nth frame matching pred — repeated frame types
 *  (reveal, pick.begin) accumulate, and find() would return a stale
 *  earlier round's frame. */
async function waitForNth(client: Client, pred: (m: any) => boolean, n: number, ms = 6000): Promise<any> {
  const start = Date.now();
  for (;;) {
    const hits = client.messages.filter(pred);
    if (hits.length >= n) return hits[n - 1];
    if (Date.now() - start > ms) throw new Error(`timed out waiting for frame #${n}`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

function answerIndexFor(prompt: string): number {
  const q = PARTY_QUESTIONS.find((x) => x.prompt === prompt);
  if (!q) throw new Error(`unknown prompt: ${prompt}`);
  return q.answer;
}
function wrongIndexFor(prompt: string): number {
  return (answerIndexFor(prompt) + 1) % 4;
}

function joinRoom(token: string, code: string): Client {
  return connect(`/api/party/ws?token=${token}&code=${code}`);
}

beforeAll(async () => {
  rooms = new PartyRooms(new RoomHub(), {
    rng: mulberry32(42),
    questionMs: 2500,
    pickMs: 1200,
    onMatchEnd: (r) => matchResults.push(r),
  });
  gateway = new LiveWsGateway();
  registerPartyWs(gateway, {
    verifyToken: async (token) => TOKENS[token] ?? null,
    resolveIdentity: async (userId) => ({
      userId,
      displayName: NAMES[userId] ?? "Creator",
      avatarUrl: null,
      profileSlug: null,
    }),
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
      ws.terminate();
    } catch {
      /* already gone */
    }
  }
  gateway.dispose();
  await new Promise((r) => server.close(r));
});

/* ─── Admission ─────────────────────────────────────────────────────── */

describe("party admission", () => {
  it("refuses guests: no token → auth_required + 4401", async () => {
    const room = rooms.createRoom(
      { userId: HOST, displayName: "Host Royal", avatarUrl: null, profileSlug: null },
      { game: "trivia" },
    );
    const c = connect(`/api/party/ws?code=${room.code}`);
    const err = await waitFor(c, (m) => m.type === "error");
    expect(err.code).toBe("auth_required");
    expect(await c.closed).toBe(4401);
  });

  it("refuses an unknown room code → no_room + 4404", async () => {
    const c = joinRoom("tok-host", "ZZZZZZ");
    const err = await waitFor(c, (m) => m.type === "error");
    expect(err.code).toBe("no_room");
    expect(await c.closed).toBe(4404);
  });

  it("caps a trivia room at 8 seated players", async () => {
    // Seats are per-user and the wire tokens cover 3 users, so drive
    // the cap through the manager's own admission with fake sockets —
    // the exact code path the gateway handler calls.
    const mgr = new PartyRooms(new RoomHub(), {});
    const r = mgr.createRoom(
      { userId: "u0", displayName: "U0", avatarUrl: null, profileSlug: null },
      { game: "trivia" },
    );
    const fakeSocket = () => {
      const s: any = {
        readyState: 1,
        sent: [] as string[],
        closedWith: null as number | null,
        send: (d: string) => s.sent.push(d),
        close: (code?: number) => {
          s.closedWith = code ?? null;
        },
        terminate: () => undefined,
        ping: () => undefined,
        on: () => undefined,
      };
      return s;
    };
    let admitted = 0;
    for (let i = 0; i < 8; i++) {
      const ok = mgr.attach(fakeSocket(), r.code, {
        userId: `u${i}`,
        displayName: `U${i}`,
        avatarUrl: null,
        profileSlug: null,
      });
      if (ok) admitted++;
    }
    expect(admitted).toBe(8);
    const ninth = fakeSocket();
    const ok9 = mgr.attach(ninth, r.code, {
      userId: "u9",
      displayName: "U9",
      avatarUrl: null,
      profileSlug: null,
    });
    expect(ok9).toBe(false);
    expect(JSON.parse(ninth.sent[0]).type).toBe("room_full");
    expect(ninth.closedWith).toBe(4429);
  });
});

/* ─── Trivia: a full match over the wire ────────────────────────────── */

describe("party trivia match", () => {
  it("plays lobby → questions → podium, server-scored, answers never leaked early", async () => {
    matchResults.length = 0;
    const room = rooms.createRoom(
      { userId: HOST, displayName: "Host Royal", avatarUrl: null, profileSlug: null },
      { game: "trivia" },
    );
    const host = joinRoom("tok-host", room.code);
    const guest = joinRoom("tok-guest", room.code);
    const hostWelcome = await waitFor(host, (m) => m.type === "welcome");
    expect(hostWelcome.you.isHost).toBe(true);
    await waitFor(guest, (m) => m.type === "welcome");

    // Only the host runs the room.
    guest.send({ type: "start", rounds: 5 });
    const notHost = await waitFor(guest, (m) => m.type === "error" && m.code === "not_host");
    expect(notHost.message).toMatch(/host/i);

    host.send({ type: "start", rounds: 5 });
    await waitFor(host, (m) => m.type === "game.started" && m.total === 5);

    let hostScore = 0;
    let guestScore = 0;
    for (let round = 1; round <= 5; round++) {
      const q = await waitFor(host, (m) => m.type === "question" && m.index === round);
      // The question frame must NEVER carry the answer.
      expect(q).not.toHaveProperty("answer");
      expect(q.choices).toHaveLength(4);
      const correct = answerIndexFor(q.prompt);

      if (round === 1) {
        // Guest answers fast + correct, WITH a forged score field the
        // server must ignore. Host answers slowly + correct.
        guest.send({ type: "answer", choice: correct, score: 999_999, points: 999_999 });
        await new Promise((r) => setTimeout(r, 400));
        host.send({ type: "answer", choice: correct });
      } else {
        host.send({ type: "answer", choice: correct });
        guest.send({ type: "answer", choice: wrongIndexFor(q.prompt) });
      }
      const reveal = await waitForNth(host, (m) => m.type === "reveal", round);
      expect(reveal.answer).toBe(correct);
      const hostResult = reveal.results.find((r: any) => r.peerId === hostWelcome.you.peerId);
      const guestResult = reveal.results.find((r: any) => r.peerId !== hostWelcome.you.peerId);
      if (round === 1) {
        expect(guestResult.correct).toBe(true);
        expect(hostResult.correct).toBe(true);
        // Speed scoring: the fast answer earns strictly more, and no
        // score can exceed the 1000/round server cap despite the forge.
        expect(guestResult.points).toBeGreaterThan(hostResult.points);
        expect(guestResult.points).toBeLessThanOrEqual(1000);
        guestScore += guestResult.points;
        hostScore += hostResult.points;
      } else {
        expect(hostResult.correct).toBe(true);
        expect(guestResult.correct).toBe(false);
        expect(guestResult.points).toBe(0);
        hostScore += hostResult.points;
      }
      host.send({ type: "next" });
    }

    const podium = await waitFor(host, (m) => m.type === "podium");
    expect(podium.draw).toBe(false);
    expect(podium.winnerPeerIds).toEqual([hostWelcome.you.peerId]);
    const top = podium.standings[0];
    expect(top.score).toBe(hostScore);
    expect(top.score).toBeLessThanOrEqual(5000);
    expect(guestScore).toBeGreaterThan(0);

    // The match was recorded exactly once, placements server-decided.
    expect(matchResults).toHaveLength(1);
    const rec = matchResults[0]!;
    expect(rec.game).toBe("trivia");
    expect(rec.players.find((p) => p.userId === HOST)).toMatchObject({ placement: 1, won: true, score: hostScore });
    expect(rec.players.find((p) => p.userId === GUEST)).toMatchObject({ placement: 2, won: false });

    host.ws.close();
    guest.ws.close();
  });

  it("an early host end before any reveal records nothing", async () => {
    matchResults.length = 0;
    const room = rooms.createRoom(
      { userId: HOST, displayName: "Host Royal", avatarUrl: null, profileSlug: null },
      { game: "trivia" },
    );
    const host = joinRoom("tok-host", room.code);
    const guest = joinRoom("tok-guest", room.code);
    await waitFor(host, (m) => m.type === "welcome");
    await waitFor(guest, (m) => m.type === "welcome");
    host.send({ type: "start", rounds: 5 });
    await waitFor(host, (m) => m.type === "question");
    host.send({ type: "end" });
    await waitFor(host, (m) => m.type === "podium");
    expect(matchResults).toHaveLength(0);
    host.ws.close();
    guest.ws.close();
  });

  it("host migration: the crown passes when the host disconnects", async () => {
    const room = rooms.createRoom(
      { userId: HOST, displayName: "Host Royal", avatarUrl: null, profileSlug: null },
      { game: "trivia" },
    );
    const host = joinRoom("tok-host", room.code);
    const guest = joinRoom("tok-guest", room.code);
    const guestWelcome = await waitFor(guest, (m) => m.type === "welcome");
    await waitFor(host, (m) => m.type === "welcome");
    host.ws.close();
    const changed = await waitFor(guest, (m) => m.type === "host.changed");
    expect(changed.peerId).toBe(guestWelcome.you.peerId);
    // The new host can actually run the room now.
    guest.send({ type: "start", rounds: 5 });
    await waitFor(guest, (m) => m.type === "game.started");
    guest.ws.close();
  });

  it("an oversized frame is ignored and the seat survives", async () => {
    const room = rooms.createRoom(
      { userId: HOST, displayName: "Host Royal", avatarUrl: null, profileSlug: null },
      { game: "trivia" },
    );
    const host = joinRoom("tok-host", room.code);
    await waitFor(host, (m) => m.type === "welcome");
    host.ws.send("x".repeat(9000));
    await new Promise((r) => setTimeout(r, 150));
    expect(host.ws.readyState).toBe(WebSocket.OPEN);
    // A valid frame afterwards still works: start fails honestly
    // (needs 2 players) instead of the seat being wedged.
    host.send({ type: "start", rounds: 5 });
    const err = await waitFor(host, (m) => m.type === "error" && m.code === "not_enough_players");
    expect(err).toBeTruthy();
    host.ws.close();
  });
});

/* ─── Court Battle: a full duel over the wire ───────────────────────── */

describe("party court battle duel", () => {
  it("alternating picks, fastest-correct wins rounds, first to 3 takes the crown", async () => {
    matchResults.length = 0;
    const room = rooms.createRoom(
      { userId: HOST, displayName: "Host Royal", avatarUrl: null, profileSlug: null },
      { game: "duel" },
    );
    const host = joinRoom("tok-host", room.code);
    const guest = joinRoom("tok-guest", room.code);
    const hostWelcome = await waitFor(host, (m) => m.type === "welcome");
    const guestWelcome = await waitFor(guest, (m) => m.type === "welcome");

    // A duel seats exactly two — a third player is refused.
    const third = joinRoom("tok-third", room.code);
    const full = await waitFor(third, (m) => m.type === "room_full");
    expect(full.cap).toBe(2);
    expect(await third.closed).toBe(4429);

    host.send({ type: "start" });
    const expectedPickers = [guestWelcome.you.peerId, hostWelcome.you.peerId, guestWelcome.you.peerId];
    for (let round = 1; round <= 3; round++) {
      const pick = await waitForNth(host, (m) => m.type === "pick.begin", round);
      // Picks alternate, starting with the challenger.
      expect(pick.pickerPeerId).toBe(expectedPickers[round - 1]);
      const pickerClient = pick.pickerPeerId === guestWelcome.you.peerId ? guest : host;
      pickerClient.send({ type: "pick", category: "music" });
      const q = await waitFor(host, (m) => m.type === "question" && m.index === round);
      expect(q.category).toBe("music");
      // Guest answers correctly at once; host answers wrong.
      guest.send({ type: "answer", choice: answerIndexFor(q.prompt) });
      host.send({ type: "answer", choice: wrongIndexFor(q.prompt) });
      const reveal = await waitForNth(host, (m) => m.type === "reveal", round);
      expect(reveal.roundWinnerPeerId).toBe(guestWelcome.you.peerId);
      host.send({ type: "next" });
    }

    const podium = await waitFor(host, (m) => m.type === "podium");
    expect(podium.winnerPeerIds).toEqual([guestWelcome.you.peerId]);
    expect(podium.standings[0].roundsWon).toBe(3);

    expect(matchResults).toHaveLength(1);
    expect(matchResults[0]!.game).toBe("duel");
    expect(matchResults[0]!.players.find((p) => p.userId === GUEST)).toMatchObject({
      placement: 1,
      won: true,
      roundsWon: 3,
    });
    expect(matchResults[0]!.players.find((p) => p.userId === HOST)).toMatchObject({ placement: 2, won: false });

    host.ws.close();
    guest.ws.close();
  });
});
