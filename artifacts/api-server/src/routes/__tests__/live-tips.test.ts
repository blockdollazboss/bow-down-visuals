/**
 * Route tests for stream tips + paid pins (routes/live-tips):
 *   POST /api/live/:id/tips — transfer fan -> creator, idempotent
 *     retries, insufficient balance, self-tip, not-live, mute gate,
 *     pin at/above the minimum replacing the previous pin.
 *   GET  /api/live/:id/tips — recent tips + totals.
 *
 * Credits machinery is mocked at the house seams (chargeCredits /
 * refundCredits / addCreditsAtomic / recordCreditUsageStrict) with a
 * balance map, so the transfer's money movement is asserted exactly.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const FAN = "00000000-0000-4000-8000-0000000000bb";
const FAN2 = "00000000-0000-4000-8000-0000000000cc";
const STREAM = "22222222-2222-4222-8222-222222222222";
const STREAM_ENDED = "33333333-3333-4333-8333-333333333333";
const PROFILE = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  streams: new Map<string, Record<string, unknown>>(),
  messages: [] as Array<Record<string, unknown>>,
  mutes: [] as Array<Record<string, unknown>>,
  tips: [] as Array<Record<string, unknown>>,
  profiles: [] as Array<Record<string, unknown>>,
  creditUsage: [] as Array<Record<string, unknown>>,
  balances: new Map<string, number>(),
  chargedKeys: new Set<string>(),
  refunds: [] as Array<{ userId: string; amount: number }>,
  seq: 0,
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}
interface Cond {
  eq: Array<[string, unknown]>;
  gt: Array<[string, unknown]>;
  isNull: string[];
}
function parseCond(cond: unknown): Cond {
  const { sql, params } = render(cond);
  const out: Cond = { eq: [], gt: [], isNull: [] };
  for (const m of sql.matchAll(/"(\w+)" = \$(\d+)/g)) out.eq.push([m[1], params[Number(m[2]) - 1]]);
  for (const m of sql.matchAll(/"(\w+)" > \$(\d+)/g)) out.gt.push([m[1], params[Number(m[2]) - 1]]);
  for (const m of sql.matchAll(/"(\w+)" is null/g)) out.isNull.push(m[1]);
  return out;
}
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
function rowVal(row: Record<string, unknown>, col: string): unknown {
  return row[col] ?? row[camel(col)];
}
function rowMatches(row: Record<string, unknown>, cond: Cond): boolean {
  for (const [col, val] of cond.eq) if (String(rowVal(row, col) ?? "") !== String(val ?? "")) return false;
  for (const [col, val] of cond.gt) {
    const a = new Date(String(rowVal(row, col))).getTime();
    const b = new Date(String(val)).getTime();
    if (!(a > b)) return false;
  }
  for (const col of cond.isNull) if (rowVal(row, col) !== null && rowVal(row, col) !== undefined) return false;
  return true;
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = user;
    next();
  },
}));
vi.mock("../../lib/rate-limit", () => ({ publicApiLimiter: (_q: any, _s: any, n: any) => n() }));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error {
    readonly status = 402;
    constructor() {
      super("out_of_credits");
      this.name = "OutOfCreditsError";
    }
  }
  class CreditsDisabledError extends Error {
    readonly status = 403;
    constructor() {
      super("credits_disabled");
      this.name = "CreditsDisabledError";
    }
  }
  class LedgerWriteError extends Error {
    readonly status = 500;
    constructor() {
      super("ledger_write_failed");
      this.name = "LedgerWriteError";
    }
  }
  return {
    OutOfCreditsError,
    CreditsDisabledError,
    LedgerWriteError,
    buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown) =>
      typeof clientKey === "string" && clientKey.trim().length >= 8
        ? `${scope}:${userId}:client:${clientKey.trim()}`
        : `${scope}:${userId}:derived`,
    chargeCredits: async (userId: string, cost: number, _rec: unknown, opts?: { idempotencyKey?: string }) => {
      const key = opts?.idempotencyKey ?? "";
      if (key && h.chargedKeys.has(key)) return h.balances.get(userId) ?? 0;
      const balance = h.balances.get(userId) ?? 0;
      if (balance < cost) throw new OutOfCreditsError();
      h.balances.set(userId, balance - cost);
      if (key) h.chargedKeys.add(key);
      return balance - cost;
    },
    refundCredits: async (userId: string, amount: number) => {
      h.balances.set(userId, (h.balances.get(userId) ?? 0) + amount);
      h.refunds.push({ userId, amount });
    },
    voidChargeIdempotencyKey: async (key: string) => h.chargedKeys.delete(key),
  };
});

vi.mock("../../lib/supabase-admin", () => ({
  addCreditsAtomic: async (userId: string, amount: number) => {
    const oldCredits = h.balances.get(userId) ?? 0;
    h.balances.set(userId, oldCredits + amount);
    return { oldCredits, newCredits: oldCredits + amount, created: false };
  },
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: async (rec: { userId: string; action: string; creditsUsed: number; idempotencyKey?: string }) => {
    h.creditUsage.push({
      id: `cu-${h.creditUsage.length + 1}`,
      userId: rec.userId,
      action: rec.action,
      creditsUsed: rec.creditsUsed,
      idempotencyKey: rec.idempotencyKey ?? null,
    });
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h;
  const { liveStreamsTable, liveChatMessagesTable, liveChatMutesTable, liveStreamTipsTable, creatorProfilesTable, creditUsageTable } = actual;
  const tableOf = (t: unknown) =>
    t === liveStreamsTable
      ? "streams"
      : t === liveChatMessagesTable
        ? "messages"
        : t === liveChatMutesTable
          ? "mutes"
          : t === liveStreamTipsTable
            ? "tips"
            : t === creatorProfilesTable
              ? "profiles"
              : t === creditUsageTable
                ? "creditUsage"
                : "?";
  const allRows = (kind: string): Array<Record<string, unknown>> =>
    kind === "streams"
      ? [...state.streams.values()]
      : kind === "messages"
        ? state.messages
        : kind === "mutes"
          ? state.mutes
          : kind === "tips"
            ? state.tips
            : kind === "profiles"
              ? state.profiles
              : kind === "creditUsage"
                ? state.creditUsage
                : [];

  function selectChain(table: unknown, fields?: Record<string, { name: string }>): any {
    const kind = tableOf(table);
    let cond: Cond = { eq: [], gt: [], isNull: [] };
    let order: Array<{ col: string; dir: 1 | -1 }> = [];
    let limitN: number | null = null;
    const run = () => {
      let rows = allRows(kind).filter((r) => rowMatches(r, cond));
      for (const o of [...order].reverse()) {
        rows = [...rows].sort((a, b) => {
          const av = rowVal(a, o.col) instanceof Date ? (rowVal(a, o.col) as Date).getTime() : String(rowVal(a, o.col) ?? "");
          const bv = rowVal(b, o.col) instanceof Date ? (rowVal(b, o.col) as Date).getTime() : String(rowVal(b, o.col) ?? "");
          return (av < bv ? -1 : av > bv ? 1 : 0) * o.dir;
        });
      }
      if (limitN !== null) rows = rows.slice(0, limitN);
      if (fields) {
        return rows.map((r) => {
          const out: Record<string, unknown> = {};
          for (const [key, col] of Object.entries(fields)) out[key] = rowVal(r, col.name) ?? null;
          return out;
        });
      }
      return rows.map((r) => ({ ...r }));
    };
    const self: any = {
      from: (_t: unknown) => self,
      where: (c: unknown) => {
        cond = parseCond(c);
        return self;
      },
      orderBy: (...args: unknown[]) => {
        order = args.map((a) => {
          const { sql } = render(a);
          const cols = [...sql.matchAll(/"(\w+)"/g)].map((m) => m[1]);
          return { col: cols[cols.length - 1] ?? "", dir: sql.includes(" desc") ? (-1 as const) : (1 as const) };
        });
        return self;
      },
      limit: (n: number) => {
        limitN = n;
        return self;
      },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
      catch: (rej: any) => Promise.resolve(run()).catch(rej),
    };
    return self;
  }

  const db = {
    select: (fields?: Record<string, { name: string }>) => ({
      from: (table: unknown) => selectChain(table, fields).from(table),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const kind = tableOf(table);
        const row: Record<string, unknown> = { ...values };
        if (kind === "messages") {
          row.id = `44444444-4444-4444-8444-${String(++state.seq).padStart(12, "0")}`;
          row.created_at = new Date();
          row.deleted_at = null;
          state.messages.push(row);
        }
        if (kind === "tips") {
          row.id = `55555555-5555-4555-8555-${String(++state.seq).padStart(12, "0")}`;
          row.created_at = new Date();
          row.pinned_until = null;
          row.creator_credited_at = null;
          state.tips.push(row);
        }
        return {
          returning: async () => [{ ...row }],
          then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const parsed = parseCond(cond);
          const kind = tableOf(table);
          const updated: Array<Record<string, unknown>> = [];
          for (const row of allRows(kind)) {
            if (rowMatches(row, parsed)) {
              Object.assign(row, patch);
              updated.push({ ...row });
            }
          }
          const self: any = {
            returning: async () => updated,
            then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
          };
          return self;
        },
      }),
    }),
  };
  return { ...actual, db };
});

import router from "../live-tips";
import { liveChatHub } from "../live-chat";

let server: Server;
let base = "";

async function req(method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(opts.user ? { "x-test-user": opts.user } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

function seedStream(id: string, status: string) {
  h.streams.set(id, {
    id,
    user_id: OWNER,
    profile_id: PROFILE,
    title: "Friday Night Live",
    status,
    provider: "own-server",
    started_at: new Date(),
    ended_at: status === "ended" ? new Date() : null,
    created_at: new Date(),
    updated_at: new Date(),
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  h.streams.clear();
  h.messages = [];
  h.mutes = [];
  h.tips = [];
  h.creditUsage = [];
  h.chargedKeys.clear();
  h.refunds = [];
  h.balances = new Map([
    [OWNER, 0],
    [FAN, 10_000],
    [FAN2, 10_000],
  ]);
  h.profiles = [
    { userId: OWNER, slug: "king", displayName: "King Live", avatarUrl: null },
    { userId: FAN, slug: "fan-one", displayName: "Fan One", avatarUrl: null },
    { userId: FAN2, slug: "fan-two", displayName: "Fan Two", avatarUrl: null },
  ];
  h.seq = 0;
  seedStream(STREAM, "live");
  seedStream(STREAM_ENDED, "ended");
});

describe("POST /live/:id/tips", () => {
  it("moves Visual Bucs fan -> creator, lands a tip chat message, and broadcasts", async () => {
    const sent: string[] = [];
    const sock = { readyState: 1, send: (d: string) => sent.push(d), close() {}, terminate() {}, ping() {}, on() {} };
    liveChatHub.join(STREAM, sock as never);
    const { status, json } = await req("POST", `/api/live/${STREAM}/tips`, {
      user: FAN,
      body: { amountVb: 1000, body: "love this song", idempotencyKey: "tip-key-0001" },
    });
    liveChatHub.leave(STREAM, sock as never);
    expect(status).toBe(201);
    expect(json.tip).toMatchObject({ amountVb: 1000, body: "love this song", tipperUserId: FAN, creatorUserId: OWNER });
    expect(h.balances.get(FAN)).toBe(9_000);
    expect(h.balances.get(OWNER)).toBe(1_000);
    const msg = h.messages.find((m) => m.id === json.tip.messageId);
    expect(msg).toMatchObject({ kind: "tip", tip_amount_vb: 1000, body: "love this song" });
    expect(h.tips[0]?.creator_credited_at).toBeTruthy();
    const events = sent.map((s) => JSON.parse(s));
    expect(events.some((e) => e.type === "message" && e.message.kind === "tip")).toBe(true);
    expect(events.some((e) => e.type === "alert" && e.alert.kind === "tip")).toBe(true);
  });

  it("a retry with the same key never double-charges or double-pays", async () => {
    const body = { amountVb: 1000, body: "once only", idempotencyKey: "tip-key-retry" };
    const first = await req("POST", `/api/live/${STREAM}/tips`, { user: FAN, body });
    expect(first.status).toBe(201);
    const second = await req("POST", `/api/live/${STREAM}/tips`, { user: FAN, body });
    expect(second.status).toBe(200);
    expect(second.json.duplicate).toBe(true);
    expect(second.json.tip.id).toBe(first.json.tip.id);
    expect(h.balances.get(FAN)).toBe(9_000);
    expect(h.balances.get(OWNER)).toBe(1_000);
    expect(h.tips).toHaveLength(1);
  });

  it("insufficient balance is an honest 402 and nothing moves", async () => {
    const { status, json } = await req("POST", `/api/live/${STREAM}/tips`, {
      user: FAN,
      body: { amountVb: 50_000, idempotencyKey: "tip-key-broke" },
    });
    expect(status).toBe(402);
    expect(json.code).toBe("INSUFFICIENT_BALANCE");
    expect(h.balances.get(FAN)).toBe(10_000);
    expect(h.balances.get(OWNER)).toBe(0);
    expect(h.tips).toHaveLength(0);
    expect(h.messages).toHaveLength(0);
  });

  it("self-tips, ended streams, and below-minimum amounts are refused before money moves", async () => {
    const self = await req("POST", `/api/live/${STREAM}/tips`, {
      user: OWNER,
      body: { amountVb: 1000, idempotencyKey: "tip-key-self0" },
    });
    expect(self.status).toBe(400);
    expect(self.json.code).toBe("SELF_TIP");
    const ended = await req("POST", `/api/live/${STREAM_ENDED}/tips`, {
      user: FAN,
      body: { amountVb: 1000, idempotencyKey: "tip-key-ended" },
    });
    expect(ended.status).toBe(409);
    expect(ended.json.code).toBe("STREAM_NOT_LIVE");
    const small = await req("POST", `/api/live/${STREAM}/tips`, {
      user: FAN,
      body: { amountVb: 50, idempotencyKey: "tip-key-small" },
    });
    expect(small.status).toBe(400);
    expect(small.json.code).toBe("BAD_AMOUNT");
    expect(h.balances.get(FAN)).toBe(10_000);
    expect(h.tips).toHaveLength(0);
  });

  it("a muted fan cannot tip a message into chat", async () => {
    h.mutes.push({ stream_id: STREAM, user_id: FAN, muted_until: new Date(Date.now() + 60_000), created_at: new Date() });
    const { status, json } = await req("POST", `/api/live/${STREAM}/tips`, {
      user: FAN,
      body: { amountVb: 1000, idempotencyKey: "tip-key-muted" },
    });
    expect(status).toBe(403);
    expect(json.code).toBe("MUTED");
    expect(h.balances.get(FAN)).toBe(10_000);
  });
});

describe("paid pinned messages", () => {
  it("a tip at the pin minimum pins; a later qualifying tip replaces the pin", async () => {
    const first = await req("POST", `/api/live/${STREAM}/tips`, {
      user: FAN,
      body: { amountVb: 500, body: "pin me first", idempotencyKey: "tip-key-pin01" },
    });
    expect(first.status).toBe(201);
    expect(first.json.pinnedUntil).toBeTruthy();
    expect(first.json.pinMinimumVb).toBe(500);
    const firstTip = h.tips.find((t) => t.id === first.json.tip.id);
    expect(new Date(String(firstTip?.pinned_until)).getTime()).toBeGreaterThan(Date.now());

    const second = await req("POST", `/api/live/${STREAM}/tips`, {
      user: FAN2,
      body: { amountVb: 1000, body: "new pin in town", idempotencyKey: "tip-key-pin02" },
    });
    expect(second.status).toBe(201);
    // The first pin expired the moment the second landed.
    expect(new Date(String(firstTip?.pinned_until)).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    const secondTip = h.tips.find((t) => t.id === second.json.tip.id);
    expect(new Date(String(secondTip?.pinned_until)).getTime()).toBeGreaterThan(Date.now() + 60_000);
  });

  it("a tip below the pin minimum does not pin", async () => {
    const { status, json } = await req("POST", `/api/live/${STREAM}/tips`, {
      user: FAN,
      body: { amountVb: 100, body: "small thanks", idempotencyKey: "tip-key-nopin" },
    });
    expect(status).toBe(201);
    expect(json.pinnedUntil).toBeNull();
    expect(h.tips[0]?.pinned_until).toBeNull();
  });
});

describe("GET /live/:id/tips", () => {
  it("lists recent tips with the real total", async () => {
    await req("POST", `/api/live/${STREAM}/tips`, { user: FAN, body: { amountVb: 1000, body: "one", idempotencyKey: "tip-key-list1" } });
    await req("POST", `/api/live/${STREAM}/tips`, { user: FAN2, body: { amountVb: 500, body: "two", idempotencyKey: "tip-key-list2" } });
    const { status, json } = await req("GET", `/api/live/${STREAM}/tips`);
    expect(status).toBe(200);
    expect(json.tips).toHaveLength(2);
    expect(json.totalVb).toBe(1500);
    expect(json.tips[0].tipper.displayName).toBeTruthy();
  });
});
