/**
 * Failure-path route tests for stream tips (Lane V3 F2 + F6).
 *
 * Same harness as live-tips.test.ts (fake db + balance map at the
 * house seams), extended with failure injection:
 *   F2 — the creator's ledger write throws AFTER the balance credit
 *        landed: the credit must be REVERSED, the fan refunded, the
 *        attempt rows removed and the debit key voided, so value is
 *        never duplicated and a same-key retry starts clean. When the
 *        refund itself fails, the response must NOT claim it landed.
 *   F6 — the tip/message insert throws AFTER the debit: the fan is
 *        refunded immediately (was: bare 500, VB gone), the orphan
 *        chat message is dropped, and a retry succeeds end-to-end.
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
  voidedKeys: [] as string[],
  failCreditLedger: false,
  failRefunds: false,
  failTipInsert: false,
  failMessageInsert: false,
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
      if (h.failRefunds) throw new Error("refund rail down");
      h.balances.set(userId, (h.balances.get(userId) ?? 0) + amount);
      h.refunds.push({ userId, amount });
    },
    voidChargeIdempotencyKey: async (key: string) => {
      h.voidedKeys.push(key);
      return h.chargedKeys.delete(key);
    },
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
    if (h.failCreditLedger && rec.action === "Live Stream Tip — Received") {
      throw new Error("ledger write exploded");
    }
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
        if (kind === "tips" && h.failTipInsert) throw new Error("tip insert exploded");
        if (kind === "messages" && h.failMessageInsert) throw new Error("message insert exploded");
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
    delete: (table: unknown) => ({
      where: (cond: unknown) => {
        const parsed = parseCond(cond);
        const kind = tableOf(table);
        const rows = allRows(kind);
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rowMatches(rows[i], parsed)) rows.splice(i, 1);
        }
        return {
          returning: async () => [],
          then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
          catch: (rej: any) => Promise.resolve([]).catch(rej),
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
  h.voidedKeys = [];
  h.failCreditLedger = false;
  h.failRefunds = false;
  h.failTipInsert = false;
  h.failMessageInsert = false;
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

describe("F2 — creator credit lands, its ledger write throws", () => {
  it("reverses the creator credit, refunds the fan, unwinds the attempt — no duplicated value", async () => {
    h.failCreditLedger = true;
    const r = await req("POST", `/api/live/${STREAM}/tips`, {
      user: FAN,
      body: { amountVb: 500, body: "great stream", idempotencyKey: "attempt-f2-0001" },
    });
    expect(r.status).toBe(502);
    expect(r.json.code).toBe("CREDIT_FAILED");
    expect(r.json.error).toContain("refunded in full");
    // Creator: credited +500 then reversed -500 → net zero.
    expect(h.balances.get(OWNER)).toBe(0);
    // Fan: debited 500 then refunded 500 → whole.
    expect(h.balances.get(FAN)).toBe(10_000);
    expect(h.refunds).toEqual([{ userId: FAN, amount: 500 }]);
    // The attempt is unwound: no tip row, no chat message, debit key voided.
    expect(h.tips).toEqual([]);
    expect(h.messages).toEqual([]);
    expect(h.voidedKeys).toEqual(["live-tip:00000000-0000-4000-8000-0000000000bb:client:attempt-f2-0001"]);
  });

  it("after the unwound failure, the same-key retry succeeds as a fresh attempt", async () => {
    h.failCreditLedger = true;
    await req("POST", `/api/live/${STREAM}/tips`, {
      user: FAN,
      body: { amountVb: 500, body: "great stream", idempotencyKey: "attempt-f2-0002" },
    });
    h.failCreditLedger = false;
    const retry = await req("POST", `/api/live/${STREAM}/tips`, {
      user: FAN,
      body: { amountVb: 500, body: "great stream", idempotencyKey: "attempt-f2-0002" },
    });
    expect(retry.status).toBe(201);
    expect(h.balances.get(OWNER)).toBe(500); // paid exactly once
    expect(h.balances.get(FAN)).toBe(9_500); // charged exactly once net
    expect(h.tips).toHaveLength(1);
  });

  it("when the refund itself fails, the response does NOT claim a refund and the record survives for reconciliation", async () => {
    h.failCreditLedger = true;
    h.failRefunds = true;
    const r = await req("POST", `/api/live/${STREAM}/tips`, {
      user: FAN,
      body: { amountVb: 500, body: "great stream", idempotencyKey: "attempt-f2-0003" },
    });
    expect(r.status).toBe(502);
    expect(r.json.error).toContain("refund didn't land");
    expect(r.json.error).not.toContain("you've been refunded in full");
    // Creator still reversed; fan still out (flagged, not hidden).
    expect(h.balances.get(OWNER)).toBe(0);
    expect(h.balances.get(FAN)).toBe(9_500);
    expect(h.refunds).toEqual([]);
    // No cleanup: the tip row is the reconciliation handle.
    expect(h.tips).toHaveLength(1);
    expect(h.voidedKeys).toEqual([]);
  });
});

describe("F6 — insert fails after the debit", () => {
  it("tip-row insert failure refunds immediately and drops the orphan chat message", async () => {
    h.failTipInsert = true;
    const r = await req("POST", `/api/live/${STREAM}/tips`, {
      user: FAN,
      body: { amountVb: 300, body: "nice", idempotencyKey: "attempt-f6-0001" },
    });
    expect(r.status).toBe(500);
    expect(r.json.code).toBe("RECORD_FAILED");
    expect(r.json.error).toContain("refunded in full");
    expect(h.balances.get(FAN)).toBe(10_000);
    expect(h.balances.get(OWNER)).toBe(0);
    expect(h.tips).toEqual([]);
    expect(h.messages).toEqual([]); // orphan message removed
    expect(h.voidedKeys).toEqual(["live-tip:00000000-0000-4000-8000-0000000000bb:client:attempt-f6-0001"]);

    // And the same key retries clean.
    h.failTipInsert = false;
    const retry = await req("POST", `/api/live/${STREAM}/tips`, {
      user: FAN,
      body: { amountVb: 300, body: "nice", idempotencyKey: "attempt-f6-0001" },
    });
    expect(retry.status).toBe(201);
    expect(h.balances.get(OWNER)).toBe(300);
    expect(h.balances.get(FAN)).toBe(9_700);
  });

  it("chat-message insert failure also refunds immediately", async () => {
    h.failMessageInsert = true;
    const r = await req("POST", `/api/live/${STREAM}/tips`, {
      user: FAN,
      body: { amountVb: 300, body: "nice", idempotencyKey: "attempt-f6-0002" },
    });
    expect(r.status).toBe(500);
    expect(r.json.code).toBe("RECORD_FAILED");
    expect(h.balances.get(FAN)).toBe(10_000);
    expect(h.tips).toEqual([]);
    expect(h.messages).toEqual([]);
  });
});
