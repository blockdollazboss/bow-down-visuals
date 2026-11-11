/**
 * Crownfall Run ONLINE — room manager, multiplayer caps, HTTP routes.
 *
 *  - The manager (lib/crownfall-rooms.ts) is driven directly with
 *    fake sockets: the 30-room site cap, the 4-player room cap and
 *    its honest refusal, join/leave/empty-close, host migration, and
 *    the full floor-sync state machine (roster → refereed damage →
 *    kill credit → server-rolled drops → first-claim coins →
 *    floor cleared → party door → next floor → revive → wipe →
 *    receipts).
 *  - The caps (lib/arcade-rules.ts): the party pacing bound
 *    decomposes the solo 4,000 ms floor (2,300 crossing + 1,700 of
 *    killing split across the party); P = 1 is the solo bound exactly;
 *    foe/coin bounds never scale with party size.
 *  - The HTTP layer (routes/crownfall.ts + the receipt seam in
 *    routes/arcade.ts): room create/list/get, the 429 at the cap,
 *    and a score that only validates because a run RECEIPT vouches
 *    for the party size — the same score without a receipt, or with
 *    an inflated claimed partySize, is refused.
 *
 * No credits module is imported anywhere in the Crownfall stack —
 * online Crownfall carries no Visual Bucs, so there is nothing to fake.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";
const FOURTH = "44444444-4444-4444-8444-444444444444";
const FIFTH = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => ({
  fake: null as any,
  userId: "",
  names: new Map<string, string>(),
}));
h.userId = ME;

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        in: async (_col: string, ids: string[]) => ({
          data: ids
            .filter((id) => h.names.has(id))
            .map((id) => ({ id, display_name: h.names.get(id) })),
        }),
      }),
    }),
  }),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    creatorProfiles: actual.creatorProfilesTable,
    arcadeScores: actual.arcadeScoresTable,
    retentionPrefs: actual.retentionPrefsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import crownfallRouter, { crownfallRooms } from "../crownfall";
import arcadeRouter from "../arcade";
import { RoomHub, type WsClientSocket } from "../../lib/live-ws";
import {
  CrownfallRooms,
  CrownfallRoomCapError,
  CROWNFALL_MAX_ROOMS,
  crownfallMaxFoeHp,
  sanitizeRoomName,
  type CrownfallIdentity,
} from "../../lib/crownfall-rooms";
import { crownfallMinFloorMs, maxPlausibleScore, validateArcadeScore } from "../../lib/arcade-rules";

/* ─── Fakes + helpers ──────────────────────────────────────────────── */

interface FakeSocket {
  socket: WsClientSocket;
  sent: Record<string, any>[];
  closeCode: number | null;
  frames: (type: string) => Record<string, any>[];
  last: (type: string) => Record<string, any> | undefined;
}

function fakeSocket(): FakeSocket {
  const sent: Record<string, any>[] = [];
  const fake: FakeSocket = {
    sent,
    closeCode: null,
    socket: null as unknown as WsClientSocket,
    frames: (type) => sent.filter((f) => f["type"] === type),
    last: (type) => [...sent].reverse().find((f) => f["type"] === type),
  };
  const raw: any = {
    readyState: 1,
    send(data: string) {
      sent.push(JSON.parse(data));
    },
    close(code?: number) {
      fake.closeCode = code ?? null;
      raw.readyState = 3;
    },
    terminate() {},
    ping() {},
    on() {
      return raw;
    },
  };
  fake.socket = raw as WsClientSocket;
  return fake;
}

function identity(userId: string, displayName: string): CrownfallIdentity {
  return { userId, displayName, avatarUrl: null, profileSlug: null };
}

function scriptedRng(values: number[], fallback = 0.99) {
  let i = 0;
  return () => (i < values.length ? values[i++]! : fallback);
}

function send(rooms: CrownfallRooms, s: FakeSocket, frame: unknown, now?: number) {
  rooms.handleFrame(s.socket, JSON.stringify(frame), now);
}

function joinRoom(rooms: CrownfallRooms, code: string, userId: string, name: string) {
  const s = fakeSocket();
  const ok = rooms.attach(s.socket, code, identity(userId, name));
  const peerId = s.last("welcome")?.["you"]?.peerId as string;
  return Object.assign(s, { ok, peerId });
}

/** Drive a 2-player room to a started run on floor 1. */
function startedRun(rng?: () => number) {
  const rooms = new CrownfallRooms(new RoomHub(), rng ? { rng } : {});
  const host = identity(ME, "Host Royal");
  const dto = rooms.createRoom(host, {});
  const a = joinRoom(rooms, dto.code, ME, "Host Royal");
  const b = joinRoom(rooms, dto.code, OTHER, "Guest Gold");
  send(rooms, a, { type: "start" });
  return { rooms, code: dto.code, a, b };
}

function rosterFrame(foes: { id: number; type: string; elite: boolean; maxHp: number }[], placed = 3, depth = 1) {
  return { type: "foe.roster", depth, foes, placed };
}

/* ─── The caps ─────────────────────────────────────────────────────── */

describe("crownfall: multiplayer score caps", () => {
  it("the party pacing bound decomposes the solo bound; P=1 is identical", () => {
    expect(crownfallMinFloorMs(1)).toBe(4_000);
    expect(crownfallMinFloorMs(2)).toBe(2_300 + 850);
    expect(crownfallMinFloorMs(3)).toBe(2_300 + 567);
    expect(crownfallMinFloorMs(4)).toBe(2_300 + 425);
    // Out-of-range party sizes clamp to the honest ends.
    expect(crownfallMinFloorMs(0)).toBe(4_000);
    expect(crownfallMinFloorMs(9)).toBe(crownfallMinFloorMs(4));
  });

  it("party size widens only the depth pacing — never the per-floor foe/coin economy", () => {
    // At 20 s: solo depth bound 6, party-of-2 depth bound 7.
    const solo = maxPlausibleScore("crownfall", 20_000);
    const duo = maxPlausibleScore("crownfall", 20_000, 2);
    expect(duo).toBeGreaterThan(solo);
    // The gap is exactly one extra floor's worth of the SHARED roster
    // (100 depth + 27 coins × 25 + 11 kills × 10 + the combo growth
    // from 66 → 77 max kills), not a doubling of the economy.
    const combo = (k: number) => (k * (k - 1)) / 2;
    expect(duo - solo).toBe(100 + 27 * 25 + 11 * 10 + (combo(77) - combo(66)));
    expect(maxPlausibleScore("crownfall", 20_000, 1)).toBe(solo);
  });

  it("validateArcadeScore rejects a malformed party size, ignores it for other games' math", () => {
    expect(validateArcadeScore({ game: "crownfall", score: 10, durationMs: 5_000, players: 0 }).ok).toBe(false);
    expect(validateArcadeScore({ game: "crownfall", score: 10, durationMs: 5_000, players: 5 }).ok).toBe(false);
    expect(validateArcadeScore({ game: "crownfall", score: 10, durationMs: 5_000, players: 2.5 }).ok).toBe(false);
    expect(validateArcadeScore({ game: "runner", score: 10, durationMs: 5_000, players: 4 }).ok).toBe(true);
    // Solo submissions (no players field) validate exactly as before.
    expect(validateArcadeScore({ game: "crownfall", score: 8_000, durationMs: 20_000 }).ok).toBe(false);
    expect(validateArcadeScore({ game: "crownfall", score: 8_000, durationMs: 20_000, players: 2 }).ok).toBe(true);
  });

  it("the roster sanity cap matches the client's own foe construction", () => {
    // Depth 1: chaser 26 → ceil(26 × 1.15) + 2; elite multiplies ×1.9 first.
    expect(crownfallMaxFoeHp(1, "chaser", false)).toBe(32);
    expect(crownfallMaxFoeHp(1, "chaser", true)).toBe(Math.ceil(26 * 1.9 * 1.15) + 2);
    expect(crownfallMaxFoeHp(5, "boss", false)).toBe(Math.ceil(330 * 1.15) + 2);
    expect(crownfallMaxFoeHp(1, "shooter", false)).toBeGreaterThanOrEqual(20);
  });

  it("room names sanitize to player-facing copy", () => {
    expect(sanitizeRoomName("  Friday   Descent  ")).toBe("Friday Descent");
    expect(sanitizeRoomName("")).toBeNull();
    expect(sanitizeRoomName(null)).toBeNull();
    expect(sanitizeRoomName("x".repeat(90))!.length).toBe(40);
  });
});

/* ─── Room lifecycle ───────────────────────────────────────────────── */

describe("crownfall rooms: lifecycle", () => {
  it("refuses the 31st room site-wide with the cap error", () => {
    let n = 0;
    const rooms = new CrownfallRooms(new RoomHub(), { rng: () => ((n += 0.031) % 0.99) + 0.005 });
    for (let i = 0; i < CROWNFALL_MAX_ROOMS; i++) {
      rooms.createRoom(identity(ME, "Host Royal"), {});
    }
    expect(rooms.roomCount()).toBe(30);
    expect(() => rooms.createRoom(identity(ME, "Host Royal"), {})).toThrow(CrownfallRoomCapError);
  });

  it("seats four players and refuses the fifth honestly", () => {
    const rooms = new CrownfallRooms(new RoomHub(), {});
    const dto = rooms.createRoom(identity(ME, "Host Royal"), { name: "Full House" });
    expect(dto.name).toBe("Full House");
    expect(dto.maxPlayers).toBe(4);
    joinRoom(rooms, dto.code, ME, "Host Royal");
    joinRoom(rooms, dto.code, OTHER, "Guest Gold");
    joinRoom(rooms, dto.code, THIRD, "Third Voice");
    joinRoom(rooms, dto.code, FOURTH, "Fourth Bell");
    const fifth = fakeSocket();
    const ok = rooms.attach(fifth.socket, dto.code, identity(FIFTH, "Fifth Wheel"));
    expect(ok).toBe(false);
    expect(fifth.last("room_full")?.["cap"]).toBe(4);
    expect(fifth.closeCode).toBe(4429);
    expect(rooms.getRoom(dto.code)?.players).toHaveLength(4);
  });

  it("refuses a join to a room that isn't open", () => {
    const rooms = new CrownfallRooms(new RoomHub(), {});
    const s = fakeSocket();
    expect(rooms.attach(s.socket, "ZZZZZZ", identity(ME, "Host Royal"))).toBe(false);
    expect(s.last("error")?.["code"]).toBe("no_room");
    expect(s.closeCode).toBe(4404);
  });

  it("a lobby detach frees the seat at once; the host's crown passes", () => {
    const rooms = new CrownfallRooms(new RoomHub(), {});
    const dto = rooms.createRoom(identity(ME, "Host Royal"), {});
    const a = joinRoom(rooms, dto.code, ME, "Host Royal");
    const b = joinRoom(rooms, dto.code, OTHER, "Guest Gold");
    rooms.detach(a.socket);
    const after = rooms.getRoom(dto.code);
    expect(after?.players).toHaveLength(1);
    expect(after?.players[0]?.peerId).toBe(b.peerId);
    expect(after?.players[0]?.isHost).toBe(true);
    expect(b.frames("host.changed")[0]?.["peerId"]).toBe(b.peerId);
    // And the freed chair can be taken again.
    expect(joinRoom(rooms, dto.code, THIRD, "Third Voice").ok).toBe(true);
  });

  it("empty rooms close on the sweep; an abandoned run still issues receipts", () => {
    const { rooms, code, a, b } = startedRun();
    // Both players vanish mid-run (seats kept for reconnect).
    rooms.detach(a.socket);
    rooms.detach(b.socket);
    const t0 = Date.now();
    rooms.sweep(t0 + 9 * 60_000);
    expect(rooms.roomCount()).toBe(1); // idle limit is 10 min mid-run
    rooms.sweep(t0 + 11 * 60_000);
    expect(rooms.roomCount()).toBe(0);
    // Receipts survive the room: the players did start the run.
    expect(rooms.getReceipt(ME, code)).not.toBeNull();
    expect(rooms.getReceipt(ME, code)?.playerCount).toBe(2);
  });

  it("a new player cannot join mid-run, but a seated player reconnects to a snapshot", () => {
    const { rooms, code, a, b } = startedRun();
    const late = fakeSocket();
    expect(rooms.attach(late.socket, code, identity(THIRD, "Third Voice"))).toBe(false);
    expect(late.last("error")?.["code"]).toBe("already_started");
    expect(late.closeCode).toBe(4409);

    // B drops and reconnects on a fresh socket: same seat, run snapshot.
    rooms.detach(b.socket);
    const b2 = joinRoom(rooms, code, OTHER, "Guest Gold");
    expect(b2.ok).toBe(true);
    expect(b2.peerId).toBe(b.peerId);
    const run = b2.last("welcome")?.["run"];
    expect(run?.seed).toBe(a.last("run.started")?.["seed"]);
    expect(run?.depth).toBe(1);
    void a;
  });
});

/* ─── The floor-sync state machine ─────────────────────────────────── */

describe("crownfall rooms: floor sync", () => {
  it("referees damage: kill credit goes to the threshold-crosser, HP sync is throttled", () => {
    const { rooms, a, b } = startedRun();
    send(rooms, a, rosterFrame([
      { id: 0, type: "shooter", elite: false, maxHp: 20 },
      { id: 1, type: "chaser", elite: false, maxHp: 26 },
    ]));
    // A chips the shooter: 20 → 15 (broadcast), → 10 (throttled), → 5 (broadcast).
    send(rooms, a, { type: "foe.hit", foeId: 0, dmg: 5, x: 100, y: 100 }, 10_000);
    send(rooms, a, { type: "foe.hit", foeId: 0, dmg: 5, x: 100, y: 100 }, 10_100);
    send(rooms, a, { type: "foe.hit", foeId: 0, dmg: 5, x: 100, y: 100 }, 10_200);
    const hpFrames = b.frames("foe.hp").filter((f) => f["foeId"] === 0);
    expect(hpFrames.map((f) => f["hp"])).toEqual([15, 5]);
    // B lands the crossing hit: B is credited, both screens see it.
    send(rooms, b, { type: "foe.hit", foeId: 0, dmg: 5, x: 100, y: 100 }, 10_300);
    expect(b.last("foe.down")?.["byPeerId"]).toBe(b.peerId);
    expect(a.last("foe.down")?.["foeId"]).toBe(0);
    const players = b.last("players")?.["players"] as any[];
    expect(players.find((p) => p.peerId === b.peerId)?.kills).toBe(1);
    expect(players.find((p) => p.peerId === a.peerId)?.kills).toBe(0);
    // A dead foe takes no more damage.
    const before = b.frames("foe.down").length;
    send(rooms, a, { type: "foe.hit", foeId: 0, dmg: 5, x: 100, y: 100 }, 10_400);
    expect(b.frames("foe.down")).toHaveLength(before);
  });

  it("clamps a forged one-shot to the per-hit ceiling", () => {
    // A solo room, walked to floor 5 where a 330 HP boss is plausible.
    const rooms = new CrownfallRooms(new RoomHub(), {});
    const dto = rooms.createRoom(identity(ME, "Host Royal"), {});
    const a = joinRoom(rooms, dto.code, ME, "Host Royal");
    const code = dto.code;
    send(rooms, a, { type: "start" });
    for (let d = 1; d <= 4; d++) {
      send(rooms, a, rosterFrame([{ id: 0, type: "shooter", elite: false, maxHp: Math.round(20 * (1 + (d - 1) * 0.22)) }], 0, d));
      send(rooms, a, { type: "foe.hit", foeId: 0, dmg: 200, x: 1, y: 1 });
      send(rooms, a, { type: "door.enter" });
    }
    expect(rooms.getRoom(code)?.depth).toBe(5);
    send(rooms, a, rosterFrame([{ id: 0, type: "boss", elite: false, maxHp: 330 }], 0, 5));
    send(rooms, a, { type: "foe.hit", foeId: 0, dmg: 99_999, x: 360, y: 170 });
    // Clamped to 200: the boss survives at 130 HP and the room hears it.
    expect(a.last("foe.hp")?.["hp"]).toBe(130);
    expect(a.frames("foe.down")).toHaveLength(4); // only the four floor-clearing kills
  });

  it("rejects a forged roster (too many foes / impossible HP) and accepts the next honest one", () => {
    const { rooms, a, b } = startedRun();
    const tooMany = Array.from({ length: 12 }, (_, i) => ({ id: i, type: "chaser", elite: false, maxHp: 26 }));
    send(rooms, a, rosterFrame(tooMany));
    send(rooms, a, { type: "foe.hit", foeId: 0, dmg: 5, x: 0, y: 0 });
    expect(b.frames("foe.hp")).toHaveLength(0);
    send(rooms, a, rosterFrame([{ id: 0, type: "chaser", elite: false, maxHp: 99_999 }]));
    send(rooms, a, { type: "foe.hit", foeId: 0, dmg: 5, x: 0, y: 0 });
    expect(b.frames("foe.hp")).toHaveLength(0);
    // The floor is still unregistered, so B's honest roster lands.
    send(rooms, b, rosterFrame([{ id: 0, type: "chaser", elite: false, maxHp: 26 }]));
    send(rooms, b, { type: "foe.hit", foeId: 0, dmg: 6, x: 0, y: 0 });
    expect(a.last("foe.hp")?.["hp"]).toBe(20);
  });

  it("rolls drops server-side: boss pays exactly two coins, first claim wins, purses stay personal", () => {
    const { rooms, a, b } = startedRun(scriptedRng([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.5]));
    // A depth-1 boss at its construction cap (132 HP) — deterministic drops.
    send(rooms, a, rosterFrame([{ id: 0, type: "boss", elite: false, maxHp: 132 }], 3));
    send(rooms, a, { type: "foe.hit", foeId: 0, dmg: 200, x: 360, y: 170 });
    const spawns = b.frames("coin.spawn");
    expect(spawns.map((f) => f["coinId"])).toEqual(["f1:d0", "f1:d1"]);
    expect(a.last("floor.cleared")?.["depth"]).toBe(1);
    // A placed crown: A claims it, B's later claim is a silent no-op.
    send(rooms, a, { type: "coin.take", coinId: "f1:p0" });
    expect(b.last("coin.taken")?.["byPeerId"]).toBe(a.peerId);
    expect(b.last("coin.taken")?.["purse"]).toBe(1);
    const takenCount = b.frames("coin.taken").length;
    send(rooms, b, { type: "coin.take", coinId: "f1:p0" });
    expect(b.frames("coin.taken")).toHaveLength(takenCount);
    // A drop coin goes to B: purses are per-player.
    send(rooms, b, { type: "coin.take", coinId: "f1:d0" });
    expect(a.last("coin.taken")?.["purse"]).toBe(1); // B's purse, as broadcast
    send(rooms, a, { type: "coin.take", coinId: "f1:d1" });
    const finalPlayers = b.last("players")?.["players"] as any[];
    expect(finalPlayers.find((p) => p.peerId === a.peerId)?.purse).toBe(2);
    expect(finalPlayers.find((p) => p.peerId === b.peerId)?.purse).toBe(1);
  });

  it("a hurt killer's heart is personal: only they see it, only they can claim it", () => {
    // rng: 6 code chars, seed, coin roll 0.9 (no coin), heart roll 0.05 (heart).
    const { rooms, a, b } = startedRun(scriptedRng([0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.5, 0.9, 0.05]));
    send(rooms, a, { type: "state", x: 360, y: 610, faceX: 0, faceY: -1, hp: 40, maxhp: 100, firing: false, down: false, away: false });
    send(rooms, a, rosterFrame([{ id: 0, type: "chaser", elite: false, maxHp: 26 }], 0));
    send(rooms, a, { type: "foe.hit", foeId: 0, dmg: 200, x: 200, y: 200 });
    const heart = a.frames("coin.spawn").find((f) => f["kind"] === "heart");
    expect(heart?.["onlyPeerId"]).toBe(a.peerId);
    expect(b.frames("coin.spawn").some((f) => f["kind"] === "heart")).toBe(false);
    send(rooms, b, { type: "coin.take", coinId: heart!["coinId"] });
    expect(a.frames("coin.taken")).toHaveLength(0);
    send(rooms, a, { type: "coin.take", coinId: heart!["coinId"] });
    expect(a.last("coin.taken")?.["byPeerId"]).toBe(a.peerId);
    // A heart is not a coin: the purse does not move.
    expect(a.last("coin.taken")?.["purse"]).toBe(0);
  });

  it("the party descends together; a down player spectates and revives on the new floor", () => {
    const { rooms, code, a, b } = startedRun();
    send(rooms, a, rosterFrame([{ id: 0, type: "chaser", elite: false, maxHp: 26 }], 0));
    send(rooms, a, { type: "foe.hit", foeId: 0, dmg: 200, x: 1, y: 1 });
    expect(b.last("floor.cleared")).toBeTruthy();
    // A alone at the door is not a party move.
    send(rooms, a, { type: "door.enter" });
    expect(b.frames("floor.begin")).toHaveLength(0);
    send(rooms, b, { type: "door.enter" });
    expect(a.last("floor.begin")?.["depth"]).toBe(2);

    // Floor 2: B falls. The fallen deal no damage and claim no coins.
    send(rooms, a, rosterFrame([{ id: 0, type: "chaser", elite: false, maxHp: 32 }], 1, 2));
    send(rooms, b, { type: "player.down" });
    expect(a.last("player.down")?.["peerId"]).toBe(b.peerId);
    send(rooms, b, { type: "foe.hit", foeId: 0, dmg: 200, x: 1, y: 1 });
    expect(a.frames("foe.down").filter((f) => f["foeId"] === 0 && f["byPeerId"] === b.peerId)).toHaveLength(0);
    // A finishes the floor alone; B doesn't block the door…
    send(rooms, a, { type: "foe.hit", foeId: 0, dmg: 200, x: 1, y: 1 });
    send(rooms, a, { type: "door.enter" });
    expect(b.last("floor.begin")?.["depth"]).toBe(3);
    // …and B is alive again on floor 3 (revive applied by the server
    // state machine; the 50% HP itself is applied client-side).
    const players = a.last("players")?.["players"] as any[];
    const bRow = players.find((p) => p.peerId === b.peerId);
    expect(bRow?.down).toBe(false);
    expect(bRow?.alive).toBe(true);
    expect(rooms.getRoom(code)?.depth).toBe(3);
  });

  it("a party wipe ends the run, issues receipts, and reopens the table", () => {
    const { rooms, code, a, b } = startedRun();
    send(rooms, a, rosterFrame([{ id: 0, type: "chaser", elite: false, maxHp: 26 }], 3));
    send(rooms, b, { type: "foe.hit", foeId: 0, dmg: 200, x: 1, y: 1 });
    send(rooms, b, { type: "coin.take", coinId: "f1:p1" });
    send(rooms, a, { type: "player.down" });
    expect(b.frames("run.ended")).toHaveLength(0); // B still stands
    send(rooms, b, { type: "player.down" });
    expect(a.last("run.ended")?.["reason"]).toBe("wipe");
    // The table reopens as a lobby…
    expect(rooms.getRoom(code)?.phase).toBe("lobby");
    // …and both players hold receipts with the server's own tallies.
    const ra = rooms.getReceipt(ME, code);
    const rb = rooms.getReceipt(OTHER, code);
    expect(ra?.playerCount).toBe(2);
    expect(rb?.kills).toBe(1);
    expect(rb?.coins).toBe(1);
    expect(ra?.coins).toBe(0);
    // Receipts expire: 16 minutes later there is nothing to vouch with.
    expect(rooms.getReceipt(ME, code, (ra?.endedAt ?? 0) + 16 * 60_000)).toBeNull();
    // The host can start a fresh run at the same table.
    send(rooms, a, { type: "start" });
    expect(b.last("run.started")?.["depth"]).toBe(1);
  });

  it("relays King state stamped with the sender's seat — a forged peerId is ignored", () => {
    const { rooms, a, b } = startedRun();
    send(rooms, a, {
      type: "state", peerId: "FORGED", x: 300, y: 400, faceX: 1, faceY: 0,
      hp: 80, maxhp: 100, firing: true, down: false, away: false,
    });
    const relayed = b.last("state");
    expect(relayed?.["peerId"]).toBe(a.peerId);
    expect(relayed?.["x"]).toBe(300);
    expect(relayed?.["firing"]).toBe(true);
    // The sender never receives their own state back.
    expect(a.frames("state")).toHaveLength(0);
  });

  it("only the host starts the run", () => {
    const rooms = new CrownfallRooms(new RoomHub(), {});
    const dto = rooms.createRoom(identity(ME, "Host Royal"), {});
    const a = joinRoom(rooms, dto.code, ME, "Host Royal");
    const b = joinRoom(rooms, dto.code, OTHER, "Guest Gold");
    send(rooms, b, { type: "start" });
    expect(b.last("error")?.["code"]).toBe("not_host");
    expect(a.frames("run.started")).toHaveLength(0);
    send(rooms, a, { type: "start" });
    expect(b.last("run.started")?.["seed"]).toBeGreaterThan(0);
  });
});


/* ─── HTTP: rooms + the score receipt seam ─────────────────────────── */

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(crownfallRouter);
  app.use(arcadeRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  h.fake.clear();
  h.userId = ME;
  h.names = new Map();
  // The shared manager is process state: clear any rooms between tests.
  crownfallRooms.sweep(Date.now() + 60 * 60_000);
});

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}
async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

describe("crownfall rooms HTTP", () => {
  it("creates a room owned by the caller, with the WS path", async () => {
    const { status, body } = await post("/arcade/crownfall/rooms", {});
    expect(status).toBe(201);
    expect(body.room.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(body.room.name).toBe("Creator's Run"); // no profile → generic identity
    expect(body.room.maxPlayers).toBe(4);
    expect(body.room.phase).toBe("lobby");
    expect(body.wsPath).toBe("/api/arcade/crownfall/ws");
  });

  it("honors a custom room name and lists the room as open", async () => {
    const created = await post("/arcade/crownfall/rooms", { name: "Friday Descent" });
    expect(created.body.room.name).toBe("Friday Descent");
    const list = await get("/arcade/crownfall/rooms");
    expect(list.body.cap).toBe(30);
    expect(list.body.rooms.map((r: any) => r.code)).toContain(created.body.room.code);
    const one = await get(`/arcade/crownfall/rooms/${created.body.room.code}`);
    expect(one.body.room.name).toBe("Friday Descent");
  });

  it("404s honestly for a room that isn't open", async () => {
    const { status, body } = await get("/arcade/crownfall/rooms/ZZZZZZ");
    expect(status).toBe(404);
    expect(body.error).toContain("isn't open");
  });

  it("refuses the 31st room with an honest 429", async () => {
    for (let i = 0; i < CROWNFALL_MAX_ROOMS; i++) {
      crownfallRooms.createRoom(identity(ME, "Host Royal"), {});
    }
    expect(crownfallRooms.roomCount()).toBe(30);
    const { status, body } = await post("/arcade/crownfall/rooms", {});
    expect(status).toBe(429);
    expect(body.error).toContain("All 30 Crownfall rooms are full");
    expect(body.cap).toBe(30);
  });
});

describe("crownfall scores: the receipt is the only party-size truth", () => {
  /** Play a real (manager-refereed) 2-player run to a wipe on the
   *  shared instance, so both players hold genuine receipts. */
  function refereedDuoRun(): string {
    const dto = crownfallRooms.createRoom(identity(ME, "Host Royal"), {});
    const a = fakeSocket();
    const b = fakeSocket();
    crownfallRooms.attach(a.socket, dto.code, identity(ME, "Host Royal"));
    crownfallRooms.attach(b.socket, dto.code, identity(OTHER, "Guest Gold"));
    crownfallRooms.handleFrame(a.socket, JSON.stringify({ type: "start" }));
    crownfallRooms.handleFrame(a.socket, JSON.stringify({ type: "player.down" }));
    crownfallRooms.handleFrame(b.socket, JSON.stringify({ type: "player.down" }));
    // Receipts are already issued; drop the seats so the shared
    // manager stays clean for the next test's sweep.
    crownfallRooms.detach(a.socket);
    crownfallRooms.detach(b.socket);
    return dto.code;
  }

  it("a party score validates only with the receipt — claims are ignored", async () => {
    const code = refereedDuoRun();
    // 8,000 at 20 s is impossible solo (cap 7,455) but honest for a
    // duo (cap 9,121) — see the caps tests above.
    const withReceipt = await post("/arcade/scores", {
      game: "crownfall", score: 8_000, durationMs: 20_000, roomId: code,
    });
    expect(withReceipt.status).toBe(200);
    expect(withReceipt.body.ok).toBe(true);

    const noReceipt = await post("/arcade/scores", {
      game: "crownfall", score: 8_000, durationMs: 20_000,
    });
    expect(noReceipt.status).toBe(400);
    expect(noReceipt.body.error).toContain("not possible");

    // A stranger with the room code has no receipt: solo caps apply.
    h.userId = THIRD;
    const stranger = await post("/arcade/scores", {
      game: "crownfall", score: 8_000, durationMs: 20_000, roomId: code,
    });
    expect(stranger.status).toBe(400);
    h.userId = ME;

    // Claiming a party of 4 does not widen past the receipt's 2:
    // 9,500 fits a 4-player cap (10,908) but not the duo cap (9,121).
    const inflated = await post("/arcade/scores", {
      game: "crownfall", score: 9_500, durationMs: 20_000, roomId: code, partySize: 4,
    });
    expect(inflated.status).toBe(400);
  });

  it("solo Crownfall submissions are unchanged (no roomId, no receipt)", async () => {
    const ok = await post("/arcade/scores", { game: "crownfall", score: 500, durationMs: 20_000 });
    expect(ok.status).toBe(200);
    const tooBig = await post("/arcade/scores", { game: "crownfall", score: 99_999, durationMs: 20_000 });
    expect(tooBig.status).toBe(400);
  });
});
