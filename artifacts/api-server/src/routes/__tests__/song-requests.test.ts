/**
 * Route tests for Song Requests, Live (Stack-200 N18):
 *   POST /api/live/:id/song-requests — rule declines refused BEFORE
 *     charge (closed / off-catalog / excluded / below creator minimum
 *     all charge nothing), guests refused, exactly-once charge on
 *     retry, creator NOT paid until the song plays.
 *   POST .../play-next — creator credited exactly once per play.
 *   POST .../:requestId/skip — declined request refunded exactly
 *     once; replaying the skip is a no-op.
 *   POST .../close — stream-end/queue-close refunds every unplayed
 *     request exactly once; a second close refunds nothing more.
 *   PUT  /api/song-request-rules — persisted creator rules.
 *
 * Credits machinery is mocked at the house seams (the live-tips test
 * pattern) with a balance map, so money movement is asserted exactly.
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
const SONG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SONG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SONG_OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // owned by FAN2, not the creator

const h = vi.hoisted(() => ({
  streams: new Map<string, Record<string, unknown>>(),
  songs: [] as Array<Record<string, unknown>>,
  rules: [] as Array<Record<string, unknown>>,
  requests: [] as Array<Record<string, unknown>>,
  messages: [] as Array<Record<string, unknown>>,
  profiles: [] as Array<Record<string, unknown>>,
  creditUsage: [] as Array<Record<string, unknown>>,
  notifications: [] as Array<Record<string, unknown>>,
  balances: new Map<string, number>(),
  chargedKeys: new Set<string>(),
  refunds: [] as Array<{ userId: string; amount: number }>,
  credits: [] as Array<{ userId: string; amount: number }>,
  seq: 0,
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}
interface Cond {
  eq: Array<[string, unknown]>;
  isNull: string[];
}
function parseCond(cond: unknown): Cond {
  const { sql, params } = render(cond);
  const out: Cond = { eq: [], isNull: [] };
  for (const m of sql.matchAll(/"(\w+)" = \$(\d+)/g)) out.eq.push([m[1], params[Number(m[2]) - 1]]);
  for (const m of sql.matchAll(/"(\w+)" is null/g)) out.isNull.push(m[1]);
  return out;
}
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
function rowVal(row: Record<string, unknown>, col: string): unknown {
  return row[col] ?? row[camel(col)];
}
function rowMatches(row: Record<string, unknown>, cond: Cond): boolean {
  for (const [col, val] of cond.eq) if (String(rowVal(row, col) ?? "") !== String(val ?? "")) return false;
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
    buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) =>
      typeof clientKey === "string" && clientKey.trim().length >= 8
        ? `${scope}:${userId}:client:${clientKey.trim()}`
        : `${scope}:${userId}:derived:${JSON.stringify(intent)}`,
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
    h.credits.push({ userId, amount });
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
  const {
    liveStreamsTable,
    liveChatMessagesTable,
    songsTable,
    songRequestRulesTable,
    songRequestsTable,
    creatorProfilesTable,
    creditUsageTable,
    notificationsTable,
  } = actual;
  const tableOf = (t: unknown) =>
    t === liveStreamsTable
      ? "streams"
      : t === liveChatMessagesTable
        ? "messages"
        : t === songsTable
          ? "songs"
          : t === songRequestRulesTable
            ? "rules"
            : t === songRequestsTable
              ? "requests"
              : t === creatorProfilesTable
                ? "profiles"
                : t === creditUsageTable
                  ? "creditUsage"
                  : t === notificationsTable
                    ? "notifications"
                    : "?";
  const allRows = (kind: string): Array<Record<string, unknown>> =>
    kind === "streams"
      ? [...state.streams.values()]
      : kind === "messages"
        ? state.messages
        : kind === "songs"
          ? state.songs
          : kind === "rules"
            ? state.rules
            : kind === "requests"
              ? state.requests
              : kind === "profiles"
                ? state.profiles
                : kind === "creditUsage"
                  ? state.creditUsage
                  : kind === "notifications"
                    ? state.notifications
                    : [];

  function selectChain(table: unknown, fields?: Record<string, { name: string }>): any {
    const kind = tableOf(table);
    let cond: Cond = { eq: [], isNull: [] };
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
        const stamp = () => {
          row.id = `99999999-9999-4999-8999-${String(++state.seq).padStart(12, "0")}`;
          row.created_at = new Date();
          row.updated_at = new Date();
        };
        if (kind === "requests") {
          stamp();
          row.creator_credited_at = null;
          row.played_at = null;
          row.decided_at = null;
          row.refunded_at = null;
          state.requests.push(row);
        } else if (kind === "rules") {
          stamp();
          state.rules.push(row);
        } else if (kind === "messages") {
          stamp();
          row.deleted_at = null;
          state.messages.push(row);
        } else if (kind === "notifications") {
          stamp();
          state.notifications.push(row);
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
    delete: (_table: unknown) => ({
      where: () => Promise.resolve([]),
    }),
  };
  return { ...actual, db };
});

import router from "../song-requests";
import {
  expireQueuedRequests,
  __setSongRequestEventNotifier,
  buildSongRequestRefundEvent,
} from "../../lib/song-requests";

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
    ticket_price_vb: null,
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
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.streams.clear();
  h.songs = [
    { id: SONG_A, user_id: OWNER, title: "Golden Hour", audio_url: "https://x/a.mp3", source: "upload", created_at: new Date(1000) },
    { id: SONG_B, user_id: OWNER, title: "Night Palace", audio_url: "https://x/b.mp3", source: "upload", created_at: new Date(2000) },
    { id: SONG_OTHER, user_id: FAN2, title: "Someone Else's Song", audio_url: "https://x/c.mp3", source: "upload", created_at: new Date(3000) },
  ];
  h.rules = [];
  h.requests = [];
  h.messages = [];
  h.profiles = [
    { userId: OWNER, displayName: "Thy Cheat Code", avatarUrl: null, slug: "thy-cheat-code" },
    { userId: FAN, displayName: "Front Row Fan", avatarUrl: null, slug: "front-row-fan" },
    { userId: FAN2, displayName: "Second Fan", avatarUrl: null, slug: "second-fan" },
  ];
  h.creditUsage = [];
  h.notifications = [];
  h.balances = new Map([
    [OWNER, 0],
    [FAN, 10_000],
    [FAN2, 10_000],
  ]);
  h.chargedKeys = new Set();
  h.refunds = [];
  h.credits = [];
  h.seq = 0;
  seedStream(STREAM, "live");
  seedStream(STREAM_ENDED, "ended");
});

const submit = (user: string | undefined, body: unknown, stream = STREAM) =>
  req("POST", `/api/live/${stream}/song-requests`, { user, body });

describe("submission gates — declines happen before any charge", () => {
  it("refuses guests (no charge)", async () => {
    const r = await submit(undefined, { songId: SONG_A, amountVb: 500, idempotencyKey: "guest-key-1" });
    expect(r.status).toBe(401);
    expect(h.requests).toHaveLength(0);
    expect(h.balances.get(FAN)).toBe(10_000);
  });

  it("refuses the creator tipping their own stream", async () => {
    const r = await submit(OWNER, { songId: SONG_A, amountVb: 500, idempotencyKey: "self-key-1" });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("SELF_REQUEST");
    expect(h.requests).toHaveLength(0);
  });

  it("refuses requests on an ended stream", async () => {
    const r = await submit(FAN, { songId: SONG_A, amountVb: 500, idempotencyKey: "ended-key-1" }, STREAM_ENDED);
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("STREAM_NOT_LIVE");
    expect(h.balances.get(FAN)).toBe(10_000);
  });

  it("requests closed by rule: refused, nothing charged", async () => {
    const put = await req("PUT", "/api/song-request-rules", {
      user: OWNER,
      body: { requestsOpen: false, catalogOnly: true, excludedSongIds: [], minTipVb: null },
    });
    expect(put.status).toBe(200);
    const r = await submit(FAN, { songId: SONG_A, amountVb: 500, idempotencyKey: "closed-key-1" });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("REQUESTS_CLOSED");
    expect(h.balances.get(FAN)).toBe(10_000);
    expect(h.requests).toHaveLength(0);
    expect(h.refunds).toHaveLength(0);
  });

  it("off-catalog song under catalog-only: refused, nothing charged", async () => {
    const r = await submit(FAN, { songId: SONG_OTHER, amountVb: 500, idempotencyKey: "catalog-key-1" });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("NOT_IN_CATALOG");
    expect(h.balances.get(FAN)).toBe(10_000);
    expect(h.requests).toHaveLength(0);
  });

  it("excluded catalog song: refused, nothing charged", async () => {
    const put = await req("PUT", "/api/song-request-rules", {
      user: OWNER,
      body: { requestsOpen: true, catalogOnly: true, excludedSongIds: [SONG_B], minTipVb: null },
    });
    expect(put.status).toBe(200);
    const r = await submit(FAN, { songId: SONG_B, amountVb: 500, idempotencyKey: "excluded-key-1" });
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("SONG_EXCLUDED");
    expect(h.balances.get(FAN)).toBe(10_000);
    expect(h.requests).toHaveLength(0);
  });

  it("below the creator-set minimum: refused, nothing charged; at the minimum it lands", async () => {
    await req("PUT", "/api/song-request-rules", {
      user: OWNER,
      body: { requestsOpen: true, catalogOnly: true, excludedSongIds: [], minTipVb: 1000 },
    });
    const low = await submit(FAN, { songId: SONG_A, amountVb: 500, idempotencyKey: "low-key-1" });
    expect(low.status).toBe(403);
    expect(low.json.code).toBe("BELOW_CREATOR_MINIMUM");
    expect(h.balances.get(FAN)).toBe(10_000);
    const atMin = await submit(FAN, { songId: SONG_A, amountVb: 1000, idempotencyKey: "atmin-key-1" });
    expect(atMin.status).toBe(201);
    expect(h.balances.get(FAN)).toBe(9_000);
  });

  it("insufficient balance: honest 402, no request row", async () => {
    h.balances.set(FAN, 100);
    const r = await submit(FAN, { songId: SONG_A, amountVb: 500, idempotencyKey: "poor-key-1" });
    expect(r.status).toBe(402);
    expect(r.json.code).toBe("INSUFFICIENT_BALANCE");
    expect(h.requests).toHaveLength(0);
  });
});

describe("the queue — order, play, pay-on-play", () => {
  it("charges once, holds the tip, and queues in order", async () => {
    const a = await submit(FAN, { songId: SONG_A, amountVb: 500, idempotencyKey: "order-key-1" });
    const b = await submit(FAN2, { songId: SONG_B, amountVb: 700, idempotencyKey: "order-key-2" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.json.request.position).toBe(1);
    expect(b.json.request.position).toBe(2);
    // Debited exactly once each; the creator has NOT been paid yet —
    // a request tip pays on the play, not on the ask.
    expect(h.balances.get(FAN)).toBe(9_500);
    expect(h.balances.get(FAN2)).toBe(9_300);
    expect(h.balances.get(OWNER)).toBe(0);

    const list = await req("GET", `/api/live/${STREAM}/song-requests`);
    expect(list.status).toBe(200);
    expect(list.json.queue.map((q: any) => q.songTitle)).toEqual(["Golden Hour", "Night Palace"]);
    expect(list.json.queue.map((q: any) => q.position)).toEqual([1, 2]);
    expect(list.json.rules.requestsOpen).toBe(true);
    expect(list.json.refundCopy).toContain("refunded in full");
  });

  it("a retried submission (same key) is one charge, one row", async () => {
    const first = await submit(FAN, { songId: SONG_A, amountVb: 500, idempotencyKey: "retry-key-1" });
    const again = await submit(FAN, { songId: SONG_A, amountVb: 500, idempotencyKey: "retry-key-1" });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.json.duplicate).toBe(true);
    expect(h.balances.get(FAN)).toBe(9_500);
    expect(h.requests).toHaveLength(1);
  });

  it("play-next pays the creator exactly once and advances the line", async () => {
    await submit(FAN, { songId: SONG_A, amountVb: 500, idempotencyKey: "play-key-1" });
    await submit(FAN2, { songId: SONG_B, amountVb: 700, idempotencyKey: "play-key-2" });

    const notOwner = await req("POST", `/api/live/${STREAM}/song-requests/play-next`, { user: FAN, body: {} });
    expect(notOwner.status).toBe(403);
    expect(h.balances.get(OWNER)).toBe(0);

    const first = await req("POST", `/api/live/${STREAM}/song-requests/play-next`, { user: OWNER, body: {} });
    expect(first.status).toBe(200);
    expect(first.json.nowPlaying.songTitle).toBe("Golden Hour");
    expect(h.balances.get(OWNER)).toBe(500);
    expect(h.creditUsage.filter((c) => c.action === "Song Request Tip — Received")).toHaveLength(1);

    const second = await req("POST", `/api/live/${STREAM}/song-requests/play-next`, { user: OWNER, body: {} });
    expect(second.json.finished.songTitle).toBe("Golden Hour");
    expect(second.json.nowPlaying.songTitle).toBe("Night Palace");
    expect(h.balances.get(OWNER)).toBe(1_200);

    const third = await req("POST", `/api/live/${STREAM}/song-requests/play-next`, { user: OWNER, body: {} });
    expect(third.json.nowPlaying).toBeNull();
    expect(third.json.finished.songTitle).toBe("Night Palace");
    // No phantom re-payments from advancing an empty queue.
    expect(h.balances.get(OWNER)).toBe(1_200);
    expect(h.creditUsage.filter((c) => c.action === "Song Request Tip — Received")).toHaveLength(2);
  });
});

describe("declines after charge — the refund rails", () => {
  it("skip refunds the fan in full exactly once; replaying the skip is a no-op", async () => {
    const a = await submit(FAN, { songId: SONG_A, amountVb: 500, idempotencyKey: "skip-key-1" });
    const requestId = a.json.request.id;
    expect(h.balances.get(FAN)).toBe(9_500);

    const skip = await req("POST", `/api/live/${STREAM}/song-requests/${requestId}/skip`, { user: OWNER, body: {} });
    expect(skip.status).toBe(200);
    expect(skip.json.request.status).toBe("skipped");
    expect(skip.json.request.refunded).toBe(true);
    expect(h.balances.get(FAN)).toBe(10_000);
    expect(h.refunds).toEqual([{ userId: FAN, amount: 500 }]);
    expect(h.balances.get(OWNER)).toBe(0);

    const replay = await req("POST", `/api/live/${STREAM}/song-requests/${requestId}/skip`, { user: OWNER, body: {} });
    expect(replay.status).toBe(200);
    expect(replay.json.request.status).toBe("skipped");
    expect(h.refunds).toHaveLength(1);
    expect(h.balances.get(FAN)).toBe(10_000);
  });

  it("notification-truth: the refund tell rides the money channel, exactly once", async () => {
    const seen: Array<Record<string, unknown>> = [];
    __setSongRequestEventNotifier(async (input: unknown) => {
      seen.push(input as Record<string, unknown>);
    });
    try {
      const a = await submit(FAN, { songId: SONG_A, amountVb: 500, idempotencyKey: "skip-key-notify" });
      const requestId = a.json.request.id;
      const skip = await req("POST", `/api/live/${STREAM}/song-requests/${requestId}/skip`, { user: OWNER, body: {} });
      expect(skip.status).toBe(200);
      const replay = await req("POST", `/api/live/${STREAM}/song-requests/${requestId}/skip`, { user: OWNER, body: {} });
      expect(replay.status).toBe(200);
    } finally {
      __setSongRequestEventNotifier(null);
    }
    // One refund = one event on the money channel, to the fan, copy
    // naming the amount that actually came back.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      userId: FAN,
      category: "money",
      kind: "song_request_refund",
      title: "Your request tip was refunded",
      link: `/live/${STREAM}`,
    });
    expect(String(seen[0]!["body"])).toContain("500 Visual Bucs tip is back in your balance");
    expect(
      buildSongRequestRefundEvent({
        fan_user_id: FAN,
        song_title: "Midnight Reel",
        amount_vb: 700,
        stream_id: STREAM,
      }),
    ).toMatchObject({
      category: "money",
      body: "\"Midnight Reel\" didn't play, so your 700 Visual Bucs tip is back in your balance.",
    });
  });

  it("a fan cannot skip someone else's queue", async () => {
    const a = await submit(FAN, { songId: SONG_A, amountVb: 500, idempotencyKey: "skip-key-2" });
    const r = await req("POST", `/api/live/${STREAM}/song-requests/${a.json.request.id}/skip`, { user: FAN2, body: {} });
    expect(r.status).toBe(403);
    expect(h.refunds).toHaveLength(0);
  });

  it("skipping an already-playing request is refused — its tip was earned", async () => {
    const a = await submit(FAN, { songId: SONG_A, amountVb: 500, idempotencyKey: "skip-key-3" });
    await req("POST", `/api/live/${STREAM}/song-requests/play-next`, { user: OWNER, body: {} });
    const r = await req("POST", `/api/live/${STREAM}/song-requests/${a.json.request.id}/skip`, { user: OWNER, body: {} });
    expect(r.status).toBe(409);
    expect(h.refunds).toHaveLength(0);
    expect(h.balances.get(OWNER)).toBe(500);
  });

  it("queue close (stream end) refunds every unplayed request exactly once, and is replay-safe", async () => {
    await submit(FAN, { songId: SONG_A, amountVb: 500, idempotencyKey: "close-key-1" });
    await submit(FAN2, { songId: SONG_B, amountVb: 700, idempotencyKey: "close-key-2" });
    // First request starts playing (paid); the second is still queued.
    await req("POST", `/api/live/${STREAM}/song-requests/play-next`, { user: OWNER, body: {} });
    expect(h.balances.get(OWNER)).toBe(500);

    const close = await req("POST", `/api/live/${STREAM}/song-requests/close`, { user: OWNER, body: {} });
    expect(close.status).toBe(200);
    expect(close.json.expired).toBe(1);
    expect(close.json.refunded).toBe(1);
    expect(close.json.playedOut).toBe(1);
    expect(h.balances.get(FAN2)).toBe(10_000);
    expect(h.balances.get(FAN)).toBe(9_500); // played request: no refund
    expect(h.refunds).toEqual([{ userId: FAN2, amount: 700 }]);

    const again = await req("POST", `/api/live/${STREAM}/song-requests/close`, { user: OWNER, body: {} });
    expect(again.json.expired).toBe(0);
    expect(h.refunds).toHaveLength(1);

    // The service-level stream-end hook is the same rail — replaying
    // it after the close changes nothing.
    const summary = await expireQueuedRequests(STREAM);
    expect(summary.expired).toBe(0);
    expect(h.refunds).toHaveLength(1);
  });
});

describe("rules surface", () => {
  it("GET rules returns defaults + catalog before any rules are set", async () => {
    const r = await req("GET", "/api/song-request-rules", { user: OWNER });
    expect(r.status).toBe(200);
    expect(r.json.rules).toEqual({ requestsOpen: true, catalogOnly: true, excludedSongIds: [], minTipVb: null });
    expect(r.json.catalog.map((c: any) => c.title)).toEqual(["Night Palace", "Golden Hour"]);
  });

  it("PUT rules rejects excluding a song that isn't the creator's", async () => {
    const r = await req("PUT", "/api/song-request-rules", {
      user: OWNER,
      body: { requestsOpen: true, catalogOnly: true, excludedSongIds: [SONG_OTHER], minTipVb: null },
    });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("BAD_EXCLUDED");
  });

  it("the public read shows rules + refund copy up front, before anyone tips", async () => {
    await req("PUT", "/api/song-request-rules", {
      user: OWNER,
      body: { requestsOpen: true, catalogOnly: true, excludedSongIds: [SONG_B], minTipVb: 250 },
    });
    const r = await req("GET", `/api/live/${STREAM}/song-requests`);
    expect(r.status).toBe(200);
    expect(r.json.rules.minTipVb).toBe(250);
    expect(r.json.catalog.find((c: any) => c.id === SONG_B).excluded).toBe(true);
    expect(r.json.refundCopy).toContain("refunded in full");
  });
});
