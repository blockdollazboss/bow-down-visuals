/**
 * Route tests for Live Battles (routes/live-battles, Stack-200 #154):
 *   POST /api/live-battles                 challenge by slug
 *   GET  /api/live-battles/mine            my battles
 *   GET  /api/live-battles/crown           the Charts crown slot
 *   GET  /api/live-battles/by-stream/:id   the battle riding a stream
 *   GET  /api/live-battles/:id             detail + tally
 *   GET  /api/live-battles/:id/tally       tally alone
 *   POST /api/live-battles/:id/{accept,decline,cancel,start,vote,finalize}
 *
 * The REAL service (createLiveBattleService) runs over an in-memory
 * store — the module mock only swaps the service's store seam and
 * its clock/RNG/announcer, exactly like the service suite. Contract
 * pinned here:
 * - AUTH: guests read everything (watch + tally + crown) and write
 *   nothing (401 on every POST and on /mine).
 * - BLOCKS SEVER over HTTP: a block landing mid-flight voids the
 *   battle on the next read; a voided battle takes no votes.
 * - TALLY INTEGRITY: the tally is a COUNT of recorded vote rows —
 *   moving a voice moves the count without doubling it; battlers
 *   can never vote; NO money field ever appears (no price, fee or
 *   payout in any DTO — votes are never tips).
 * - LIFECYCLE: only the opponent answers, only the challenger
 *   cancels, start needs a battler's LIVE stream, finalize is
 *   battlers-only and declares the winner from the rows.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const CH = "11111111-1111-4111-8111-111111111111";
const OP = "22222222-2222-4222-8222-222222222222";
const FAN1 = "33333333-3333-4333-8333-333333333333";
const FAN2 = "44444444-4444-4444-8444-444444444444";
const STREAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STREAM_OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const h = vi.hoisted(() => {
  const profiles = new Map<string, any>();
  const battles = new Map<string, any>();
  const votes = new Map<string, any>();
  const streams = new Map<string, any>();
  const blockedPairs = new Set<string>();
  let seq = 0;
  let now = new Date("2026-10-26T12:00:00Z");
  const spoken: any[] = [];
  const pairKey = (a: string, b: string) => [a, b].sort().join("|");
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const store: any = {
    async profileByUserId(userId: string) {
      return [...profiles.values()].find((p) => p.userId === userId) ?? null;
    },
    async profileBySlug(slug: string) {
      return [...profiles.values()].find((p) => p.slug === slug) ?? null;
    },
    async profileById(profileId: string) {
      return profiles.get(profileId) ?? null;
    },
    async insertBattle(input: any) {
      seq += 1;
      const row = {
        id: uuid(seq), challengerUserId: input.challengerUserId, challengerProfileId: input.challengerProfileId,
        opponentUserId: input.opponentUserId, opponentProfileId: input.opponentProfileId, streamId: null,
        theme: input.theme, status: "pending", roundCount: input.roundCount, roundSeconds: input.roundSeconds,
        startsAt: null, endsAt: null, winnerUserId: null, result: null, challengerVotes: null, opponentVotes: null,
        voidReason: null, spectacleAnnouncedAt: null, createdAt: new Date(now), updatedAt: new Date(now),
      };
      battles.set(row.id, row);
      return { ...row };
    },
    async getBattle(id: string) {
      const r = battles.get(id);
      return r ? { ...r } : null;
    },
    async updateBattle(id: string, patch: any) {
      const r = battles.get(id);
      if (!r) throw new Error("no battle");
      Object.assign(r, patch, { updatedAt: new Date(now) });
      return { ...r };
    },
    async listBattlesForUser(userId: string) {
      return [...battles.values()].filter((b) => b.challengerUserId === userId || b.opponentUserId === userId).map((b) => ({ ...b }));
    },
    async openBattleBetween(a: string, b: string) {
      return [...battles.values()].find((x) =>
        ((x.challengerUserId === a && x.opponentUserId === b) || (x.challengerUserId === b && x.opponentUserId === a)) &&
        ["pending", "accepted", "live"].includes(x.status)) ?? null;
    },
    async countPendingOutgoing(userId: string) {
      return [...battles.values()].filter((b) => b.challengerUserId === userId && b.status === "pending").length;
    },
    async battleForStream(streamId: string) {
      const rows = [...battles.values()].filter((b) => b.streamId === streamId);
      return rows.find((b) => b.status === "live") ?? rows[rows.length - 1] ?? null;
    },
    async latestCompletedWithWinner() {
      const done = [...battles.values()].filter((b) => b.status === "completed" && b.winnerUserId !== null);
      return done[done.length - 1] ?? null;
    },
    async listVotes(battleId: string) {
      return [...votes.values()].filter((v) => v.battleId === battleId).map((v) => ({ ...v }));
    },
    async getVote(battleId: string, voterUserId: string) {
      return [...votes.values()].find((v) => v.battleId === battleId && v.voterUserId === voterUserId) ?? null;
    },
    async upsertVote(input: any) {
      const key = `${input.battleId}|${input.voterUserId}`;
      const existing = votes.get(key);
      if (existing) {
        existing.side = input.side;
        existing.roundNumber = input.roundNumber;
        existing.updatedAt = new Date(now);
        return { ...existing };
      }
      seq += 1;
      const row = { id: uuid(1000 + seq), battleId: input.battleId, voterUserId: input.voterUserId, side: input.side, roundNumber: input.roundNumber, createdAt: new Date(now), updatedAt: new Date(now) };
      votes.set(key, row);
      return { ...row };
    },
    async getStream(streamId: string) {
      return streams.get(streamId) ?? null;
    },
    async isBlockedBetween(a: string, b: string) {
      return blockedPairs.has(pairKey(a, b));
    },
    async notify() {},
  };
  return {
    store, profiles, battles, votes, streams, spoken,
    get now() { return now; },
    setNow(d: Date) { now = d; },
    block(a: string, b: string) { blockedPairs.add(pairKey(a, b)); },
    reset() {
      profiles.clear(); battles.clear(); votes.clear(); streams.clear(); blockedPairs.clear();
      spoken.length = 0; seq = 0; now = new Date("2026-10-26T12:00:00Z");
      profiles.set("prof-ch", { userId: CH, profileId: "prof-ch", displayName: "Thy Cheat Code", slug: "thy-cheat-code", avatarUrl: null });
      profiles.set("prof-op", { userId: OP, profileId: "prof-op", displayName: "Opponent", slug: "opponent", avatarUrl: null });
    },
  };
});

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.userId = String(user);
    next();
  },
}));
vi.mock("../../lib/rate-limit", () => ({ publicApiLimiter: (_q: any, _s: any, n: any) => n() }));
vi.mock("../../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../lib/optional-auth", () => ({
  resolveOptionalSession: async (req: any) => {
    const user = req.headers["x-test-user"];
    if (user) req.userId = String(user);
  },
}));
vi.mock("../../lib/live-battles", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const svc = actual.createLiveBattleService(h.store, {
    now: () => h.now,
    random: () => 0,
    announce: (a: any) => { h.spoken.push(a); return true; },
  });
  return { ...actual, liveBattleService: svc, dbLiveBattleStore: h.store };
});

import liveBattlesRouter from "../live-battles";

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", liveBattlesRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });
beforeEach(() => { h.reset(); });

async function call(method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.user) headers["x-test-user"] = opts.user;
  const res = await fetch(`${base}${path}`, {
    method, headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, json };
}

async function challenge(user = CH): Promise<any> {
  const { status, json } = await call("POST", "/api/live-battles", { user, body: { opponent_slug: "opponent" } });
  expect(status).toBe(201);
  return json.battle;
}
async function liveBattle(): Promise<any> {
  const b = await challenge();
  const acc = await call("POST", `/api/live-battles/${b.id}/accept`, { user: OP, body: {} });
  expect(acc.status).toBe(200);
  h.streams.set(STREAM, { id: STREAM, userId: CH, status: "live" });
  const started = await call("POST", `/api/live-battles/${b.id}/start`, { user: CH, body: { stream_id: STREAM } });
  expect(started.status).toBe(200);
  return started.json.battle;
}

describe("auth — guests watch only", () => {
  it("guests write nothing: every POST and /mine is 401 without a session", async () => {
    const b = await challenge();
    for (const [method, path, body] of [
      ["POST", "/api/live-battles", { opponent_slug: "opponent" }],
      ["GET", "/api/live-battles/mine", undefined],
      ["POST", `/api/live-battles/${b.id}/accept`, {}],
      ["POST", `/api/live-battles/${b.id}/decline`, {}],
      ["POST", `/api/live-battles/${b.id}/cancel`, {}],
      ["POST", `/api/live-battles/${b.id}/start`, { stream_id: STREAM }],
      ["POST", `/api/live-battles/${b.id}/vote`, { side: "challenger" }],
      ["POST", `/api/live-battles/${b.id}/finalize`, {}],
    ] as const) {
      const { status } = await call(method, path, { body });
      expect(status, `${method} ${path}`).toBe(401);
    }
  });

  it("guests read the battle, its tally, by-stream and the crown", async () => {
    const b = await liveBattle();
    expect((await call("GET", `/api/live-battles/${b.id}`)).status).toBe(200);
    expect((await call("GET", `/api/live-battles/${b.id}/tally`)).status).toBe(200);
    const byStream = await call("GET", `/api/live-battles/by-stream/${STREAM}`);
    expect(byStream.status).toBe(200);
    expect(byStream.json.battle.id).toBe(b.id);
    const crown = await call("GET", "/api/live-battles/crown");
    expect(crown.status).toBe(200);
    expect(crown.json.crown).toBeNull(); // nothing completed yet — no invented holder
  });
});

describe("challenge lifecycle over HTTP", () => {
  it("creates a pending battle with a drawn theme and both profile cards; no money fields anywhere", async () => {
    const b = await challenge();
    expect(b.status).toBe("pending");
    expect(b.theme).toBeTruthy();
    expect(b.challenger.display_name).toBe("Thy Cheat Code");
    expect(b.opponent.slug).toBe("opponent");
    expect(b.tally).toMatchObject({ challenger: 0, opponent: 0, total: 0 });
    const raw = JSON.stringify(b).toLowerCase();
    for (const moneyWord of ["price", "fee", "payout", "amount_vb", "cost"]) {
      expect(raw).not.toContain(moneyWord);
    }
  });

  it("only the opponent answers; only the challenger cancels; duplicates are 409", async () => {
    const b = await challenge();
    expect((await call("POST", `/api/live-battles/${b.id}/accept`, { user: CH, body: {} })).status).toBe(403);
    expect((await call("POST", `/api/live-battles/${b.id}/cancel`, { user: OP, body: {} })).status).toBe(403);
    expect((await call("POST", "/api/live-battles", { user: OP, body: { opponent_slug: "thy-cheat-code" } })).status).toBe(409);
    const declined = await call("POST", `/api/live-battles/${b.id}/decline`, { user: OP, body: {} });
    expect(declined.json.battle.status).toBe("declined");
    const b2 = await challenge();
    const cancelled = await call("POST", `/api/live-battles/${b2.id}/cancel`, { user: CH, body: {} });
    expect(cancelled.json.battle.status).toBe("cancelled");
  });

  it("self-battles and unknown creators are refused honestly", async () => {
    const self = await call("POST", "/api/live-battles", { user: CH, body: { opponent_slug: "thy-cheat-code" } });
    expect(self.status).toBe(400);
    expect(self.json.code).toBe("self_battle");
    const ghost = await call("POST", "/api/live-battles", { user: CH, body: { opponent_slug: "nobody" } });
    expect(ghost.status).toBe(404);
  });

  it("start needs an accepted battle and a LIVE stream owned by a battler", async () => {
    const b = await challenge();
    h.streams.set(STREAM, { id: STREAM, userId: CH, status: "live" });
    expect((await call("POST", `/api/live-battles/${b.id}/start`, { user: CH, body: { stream_id: STREAM } })).status).toBe(409);
    await call("POST", `/api/live-battles/${b.id}/accept`, { user: OP, body: {} });
    h.streams.set(STREAM_OTHER, { id: STREAM_OTHER, userId: FAN1, status: "live" });
    const foreign = await call("POST", `/api/live-battles/${b.id}/start`, { user: CH, body: { stream_id: STREAM_OTHER } });
    expect(foreign.status).toBe(403);
    expect(foreign.json.code).toBe("stream_not_participant");
    const ok = await call("POST", `/api/live-battles/${b.id}/start`, { user: OP, body: { stream_id: STREAM } });
    expect(ok.json.battle.status).toBe("live");
    expect(ok.json.battle.stream_id).toBe(STREAM);
  });

  it("/mine lists only my battles, settled", async () => {
    const b = await challenge();
    const mine = await call("GET", "/api/live-battles/mine", { user: OP });
    expect(mine.json.battles.map((x: any) => x.id)).toEqual([b.id]);
    const fanMine = await call("GET", "/api/live-battles/mine", { user: FAN1 });
    expect(fanMine.json.battles).toEqual([]);
  });
});

describe("voting — tally integrity", () => {
  it("the tally counts recorded rows; moving a voice moves it; battlers cannot vote", async () => {
    const b = await liveBattle();
    expect((await call("POST", `/api/live-battles/${b.id}/vote`, { user: CH, body: { side: "challenger" } })).status).toBe(403);
    const v1 = await call("POST", `/api/live-battles/${b.id}/vote`, { user: FAN1, body: { side: "challenger" } });
    expect(v1.status).toBe(200);
    expect(v1.json.tally).toMatchObject({ challenger: 1, opponent: 0, total: 1 });
    await call("POST", `/api/live-battles/${b.id}/vote`, { user: FAN2, body: { side: "opponent" } });
    const moved = await call("POST", `/api/live-battles/${b.id}/vote`, { user: FAN1, body: { side: "opponent" } });
    expect(moved.json.tally).toMatchObject({ challenger: 0, opponent: 2, total: 2 });
    expect(h.votes.size).toBe(2); // two rows — never three
    const tally = await call("GET", `/api/live-battles/${b.id}/tally`);
    expect(tally.json.tally.total).toBe(2);
    const detail = await call("GET", `/api/live-battles/${b.id}`, { user: FAN1 });
    expect(detail.json.battle.my_vote).toBe("opponent");
    expect(detail.json.battle.viewer_side).toBeNull();
  });

  it("votes before the battle is live are refused (409 not_live)", async () => {
    const b = await challenge();
    const { status, json } = await call("POST", `/api/live-battles/${b.id}/vote`, { user: FAN1, body: { side: "challenger" } });
    expect(status).toBe(409);
    expect(json.code).toBe("not_live");
  });

  it("finalize is battlers-only, declares the winner from the rows, and moves the crown", async () => {
    const b = await liveBattle();
    await call("POST", `/api/live-battles/${b.id}/vote`, { user: FAN1, body: { side: "opponent" } });
    await call("POST", `/api/live-battles/${b.id}/vote`, { user: FAN2, body: { side: "opponent" } });
    expect((await call("POST", `/api/live-battles/${b.id}/finalize`, { user: FAN1, body: {} })).status).toBe(403);
    expect((await call("POST", `/api/live-battles/${b.id}/finalize`, { user: CH, body: {} })).status).toBe(409); // still in rounds
    h.setNow(new Date("2026-10-26T12:05:00Z"));
    const done = await call("POST", `/api/live-battles/${b.id}/finalize`, { user: OP, body: {} });
    expect(done.status).toBe(200);
    expect(done.json.battle.result).toBe("opponent");
    expect(done.json.battle.winner_user_id).toBe(OP);
    expect(done.json.battle.tally).toMatchObject({ challenger: 0, opponent: 2 });
    expect(h.spoken).toHaveLength(1);
    expect(h.spoken[0].text).toContain("2–0"); // winner-first, as spoken
    const crown = await call("GET", "/api/live-battles/crown");
    expect(crown.json.crown.winner.user_id).toBe(OP);
    expect(crown.json.crown.battle.id).toBe(b.id);
  });
});

describe("blocks sever over HTTP", () => {
  it("a blocked pair cannot challenge (403 blocked)", async () => {
    h.block(CH, OP);
    const { status, json } = await call("POST", "/api/live-battles", { user: CH, body: { opponent_slug: "opponent" } });
    expect(status).toBe(403);
    expect(json.code).toBe("blocked");
  });

  it("a block landing mid-battle voids it on the next read — no votes, no crown", async () => {
    const b = await liveBattle();
    await call("POST", `/api/live-battles/${b.id}/vote`, { user: FAN1, body: { side: "challenger" } });
    h.block(OP, CH);
    const read = await call("GET", `/api/live-battles/${b.id}`);
    expect(read.json.battle.status).toBe("voided");
    expect(read.json.battle.void_reason).toBe("blocked");
    const vote = await call("POST", `/api/live-battles/${b.id}/vote`, { user: FAN2, body: { side: "challenger" } });
    expect(vote.status).toBe(403);
    expect(vote.json.code).toBe("blocked");
    const crown = await call("GET", "/api/live-battles/crown");
    expect(crown.json.crown).toBeNull();
  });

  it("unknown and malformed ids are honest 404s", async () => {
    expect((await call("GET", "/api/live-battles/99999999-9999-4999-8999-999999999999")).status).toBe(404);
    expect((await call("GET", "/api/live-battles/not-a-uuid")).status).toBe(404);
    expect((await call("GET", "/api/live-battles/by-stream/not-a-uuid")).json.battle).toBeNull();
  });
});
