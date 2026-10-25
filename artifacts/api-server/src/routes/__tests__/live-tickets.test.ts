/**
 * Ticketed live streams (Wave 4 #31) — the door, end to end.
 *
 * The contract these tests hold (see lib/live-tickets.ts):
 *   · the watch DTO hands playback (and the replay) ONLY to entitled
 *     viewers — owner, channel moderators, ticket holders;
 *   · the media plane (HLS playlist + segments + heartbeat) requires
 *     the signed playback token an entitled DTO carries;
 *   · chat history/post/socket and tips sit behind the same predicate;
 *   · buying charges exactly once (any retry shape), credits the
 *     creator the price minus the house fee split (PLATFORM_FEE_BPS,
 *     lib/platform-fees), and stops dead at capacity;
 *   · the refund unwind restores both sides exactly once and revokes
 *     entry; a re-buy after a refund is a fresh, working purchase.
 *
 * Harness: the live-tips / live-streams-own in-memory pattern — the
 * real tables from @workspace/db, drizzle conditions rendered through
 * PgDialect and matched by column, money through the house seams
 * (chargeCredits / addCreditsAtomic / recordCreditUsageStrict) over
 * one shared balance map, and the own-server engine reduced to a
 * session set + a temp HLS directory (the filename whitelist stays
 * real).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { PgDialect } from "drizzle-orm/pg-core";

process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "ticket-test-secret";

const CREATOR = "user-creator";
const CREATOR2 = "user-creator2";
const FAN = "user-fan";
const HOLDER = "user-holder";
const MOD = "user-mod";
const POOR = "user-poor";

const T1 = "11111111-1111-4111-8111-111111111111"; // ticketed, 200 VB, uncapped
const T2 = "22222222-2222-4222-8222-222222222222"; // ticketed, 200 VB, capacity 1
const F1 = "33333333-3333-4333-8333-333333333333"; // free

const TOKENS: Record<string, string> = {
  "tok-fan": FAN,
  "tok-holder": HOLDER,
  "tok-owner": CREATOR,
  "tok-mod": MOD,
};

const h = vi.hoisted(() => {
  const state = {
    streams: new Map<string, any>(),
    profiles: [] as any[],
    tickets: [] as any[],
    messages: [] as any[],
    mutes: [] as any[],
    tips: [] as any[],
    moderators: [] as any[],
    creditUsage: [] as any[],
    notifications: [] as any[],
    samples: [] as any[],
    balances: new Map<string, number>(),
    seq: 0,
    hlsDir: "",
    own: { sessions: new Set<string>(), activeCount: 0 },
  };
  return { state };
});

vi.mock("../../lib/credits", () => {
  const s = h.state;
  const bal = (u: string) => s.balances.get(u) ?? 0;
  class OutOfCreditsError extends Error {
    code = "INSUFFICIENT_CREDITS";
    needed: number;
    available: number;
    constructor(needed: number, available: number) {
      super("not enough");
      this.needed = needed;
      this.available = available;
    }
  }
  class CreditsDisabledError extends Error {
    code = "CREDITS_DISABLED";
  }
  class LedgerWriteError extends Error {
    code = "LEDGER_WRITE_FAILED";
  }
  return {
    OutOfCreditsError,
    CreditsDisabledError,
    LedgerWriteError,
    chargeCredits: async (userId: string, amount: number, opts: { idempotencyKey?: string } = {}) => {
      const key = opts.idempotencyKey ?? null;
      if (key && s.creditUsage.some((r) => (r.idempotencyKey ?? r.key) === key)) {
        return { charged: false as const, balance: bal(userId) };
      }
      if (bal(userId) < amount) throw new OutOfCreditsError(amount, bal(userId));
      s.balances.set(userId, bal(userId) - amount);
      if (key) s.creditUsage.push({ userId, creditsUsed: amount, key, idempotencyKey: key });
      return { charged: true as const, balance: bal(userId) };
    },
    refundCredits: async (userId: string, amount: number) => {
      s.balances.set(userId, bal(userId) + amount);
      s.creditUsage.push({ userId, creditsUsed: -amount, key: null, idempotencyKey: null });
      return { balance: bal(userId) };
    },
    voidChargeIdempotencyKey: async (key: string) => {
      const row = s.creditUsage.find((r) => (r.idempotencyKey ?? r.key) === key);
      if (row) {
        row.key = null;
        row.idempotencyKey = null;
        return true;
      }
      return false;
    },
    buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: string | null, intent?: unknown) => {
      if (clientKey && clientKey.trim().length >= 8) return clientKey.trim();
      return `${scope}:${userId}:${JSON.stringify(intent ?? {})}`;
    },
  };
});

vi.mock("../../lib/supabase-admin", () => ({
  addCreditsAtomic: async (userId: string, amount: number) => {
    const s = h.state;
    const next = (s.balances.get(userId) ?? 0) + amount;
    s.balances.set(userId, next);
    return next;
  },
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: async (entry: { userId: string; creditsUsed: number; idempotencyKey?: string | null }) => {
    h.state.creditUsage.push({
      userId: entry.userId,
      creditsUsed: entry.creditsUsed,
      key: entry.idempotencyKey ?? null,
      idempotencyKey: entry.idempotencyKey ?? null,
    });
    return { recorded: true as const };
  },
}));

/* Session-token verification is the seam the optional-auth door and
   the chat socket share; test tokens map to test users. RoomHub
   stays real — the chat module builds its hub from it. */
vi.mock("../../lib/live-ws", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    verifyAccessToken: async (token: string) => {
      const userId = TOKENS[token];
      return userId ? { userId, email: `${userId}@test` } : null;
    },
  };
});

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const uid = req.header("x-test-user");
    if (!uid) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    req.userId = uid;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/cloudflare-stream", () => {
  class StreamNotConfiguredError extends Error {
    code = "STREAM_NOT_CONFIGURED";
  }
  class StreamProviderError extends Error {
    status = 502;
  }
  return {
    StreamNotConfiguredError,
    StreamProviderError,
    isStreamConfigured: () => false,
    createLiveInput: async () => {
      throw new Error("cloudflare must not be called on the own transport");
    },
    deleteLiveInput: async () => undefined,
    playbackUrlsFromWhip: () => ({ whep_url: null, hls_url: null }),
  };
});

vi.mock("../../lib/own-server-live", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const own = h.state.own;
  return {
    ...actual,
    initOwnServerLive: () => undefined,
    ownServerConfig: () => ({ ...actual.ownServerConfig(), maxConcurrent: 10 }),
    activeSessionCount: () => own.activeCount,
    beginSession: (id: string) => {
      own.sessions.add(id);
      own.activeCount += 1;
      return { ok: true };
    },
    hasSession: (id: string) => own.sessions.has(id),
    endSession: async (id: string) => {
      own.sessions.delete(id);
    },
    finalizeRecording: async () => null,
    liveFilePath: (id: string, name: string) => {
      if (!actual.isLiveFileName(name)) return null;
      const p = path.join(h.state.hlsDir, id, name);
      return fs.existsSync(p) ? p : null;
    },
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const s = h.state;
  const {
    liveStreamsTable,
    creatorProfilesTable,
    liveStreamTicketsTable,
    liveChatMessagesTable,
    liveChatMutesTable,
    liveChannelModeratorsTable,
    liveStreamTipsTable,
    creditUsageTable,
    notificationsTable,
    liveViewerSamplesTable,
  } = actual;

  const dialect = new PgDialect();
  function render(cond: unknown): { sql: string; params: unknown[] } {
    if (!cond) return { sql: "", params: [] };
    const q = dialect.sqlToQuery(cond as never);
    return { sql: q.sql, params: q.params as unknown[] };
  }
  function camel(col: string): string {
    return col.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
  }
  function rowVal(row: any, col: string): unknown {
    return row[col] ?? row[camel(col)];
  }
  function eqPairs(sql: string, params: unknown[]): Array<[string, unknown]> {
    const cols = [...sql.matchAll(/"(\w+)" = \$/g)].map((m) => m[1]!);
    return cols.map((c, i) => [c, params[i]] as [string, unknown]);
  }
  function filterEq(rows: any[], sql: string, params: unknown[]): any[] {
    if (sql.includes(" in (")) {
      const col = /"(\w+)" in \(/.exec(sql)?.[1] ?? "id";
      const ids = params.map(String);
      return rows.filter((r) => ids.includes(String(rowVal(r, col) ?? "")));
    }
    let out = rows;
    for (const [col, val] of eqPairs(sql, params)) {
      out = out.filter((r) => String(rowVal(r, col) ?? "") === String(val ?? ""));
    }
    return out;
  }
  function sortDesc(rows: any[], sql: string): any[] {
    if (sql.includes(" desc")) return [...rows].sort((a, b) => Number(rowVal(b, "created_at") ?? 0) - Number(rowVal(a, "created_at") ?? 0));
    return rows;
  }

  function rowsFor(table: unknown, cond: unknown): any[] {
    const { sql, params } = render(cond);
    if (table === liveStreamsTable) return sortDesc(filterEq([...s.streams.values()], sql, params), sql);
    if (table === creatorProfilesTable) return filterEq([...s.profiles], sql, params);
    if (table === liveStreamTicketsTable) return sortDesc(filterEq([...s.tickets], sql, params), sql);
    if (table === liveChatMessagesTable) return sortDesc(filterEq([...s.messages], sql, params), sql);
    if (table === liveChatMutesTable) return filterEq([...s.mutes], sql, params);
    if (table === liveChannelModeratorsTable) return filterEq([...s.moderators], sql, params);
    if (table === liveStreamTipsTable) return filterEq([...s.tips], sql, params);
    if (table === creditUsageTable) return filterEq([...s.creditUsage], sql, params);
    return [];
  }

  function storeFor(table: unknown): any[] | null {
    if (table === liveStreamTicketsTable) return s.tickets;
    if (table === liveChatMessagesTable) return s.messages;
    if (table === liveStreamTipsTable) return s.tips;
    if (table === notificationsTable) return s.notifications;
    if (table === liveViewerSamplesTable) return s.samples;
    if (table === creditUsageTable) return s.creditUsage;
    return null;
  }

  function chain(table: unknown, cond: unknown, isCount = false): any {
    const rows = () => {
      const matched = rowsFor(table, cond);
      return isCount ? [{ n: matched.length }] : matched;
    };
    const self: any = {
      limit: (_n: number) => self,
      offset: (_n: number) => self,
      orderBy: (..._a: unknown[]) => self,
      then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
      catch: (rej: any) => Promise.resolve(rows()).catch(rej),
    };
    return self;
  }

  const fakeDb: any = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const isCount = !!fields && typeof fields === "object" && "n" in (fields as Record<string, unknown>);
          const proj =
            !isCount && fields && typeof fields === "object"
              ? Object.entries(fields as Record<string, any>)
                  .filter(([, col]) => col && typeof col === "object" && typeof col.name === "string")
                  .map(([alias, col]) => [alias, col.name] as [string, string])
              : [];
          const base = chain(table, cond, isCount);
          if (proj.length === 0) return base;
          const project = (rows: any[]) => rows.map((r) => Object.fromEntries(proj.map(([a, c]) => [a, rowVal(r, c)])));
          const self: any = {
            limit: (_n: number) => self,
            offset: (_n: number) => self,
            orderBy: (..._a: unknown[]) => self,
            then: (res: any, rej: any) => Promise.resolve(project(rowsFor(table, cond))).then(res, rej),
            catch: (rej: any) => Promise.resolve(project(rowsFor(table, cond))).catch(rej),
          };
          return self;
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        const doInsert = (): any[] => {
          s.seq += 1;
          if (table === liveStreamsTable) {
            const row: any = {
              id: `stream-${s.seq}`,
              viewer_count: 0,
              peak_viewers: 0,
              vod_url: null,
              vod_clip_id: null,
              ended_at: null,
              started_at: new Date(),
              created_at: new Date(),
              updated_at: new Date(),
              ...v,
            };
            s.streams.set(String(row.id), row);
            return [row];
          }
          const store = storeFor(table);
          /* Column defaults the real database applies (the ticket
             status starts 'active'; the lib relies on it). */
          const defaults: Record<string, unknown> =
            table === liveStreamTicketsTable ? { status: "active", refunded_at: null, creator_credited_at: null } : {};
          const row: any = { id: `row-${s.seq}`, created_at: new Date(), ...defaults, ...v };
          if (store) store.push(row);
          return [row];
        };
        const self: any = {
          returning: async () => doInsert(),
          onConflictDoNothing: () => ({
            returning: async () => {
              /* The ticket table's unique (stream, buyer) pair is the
                 only conflict this suite exercises. */
              if (table === liveStreamTicketsTable) {
                const dupe = s.tickets.some(
                  (t) => t.streamId === (v as any).streamId && t.buyerUserId === (v as any).buyerUserId,
                );
                if (dupe) return [];
              }
              return doInsert();
            },
          }),
          then: (res: any, rej: any) => Promise.resolve(doInsert()).then(res, rej),
          catch: (rej: any) => Promise.resolve().then(() => doInsert()).catch(rej),
        };
        return self;
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const apply = (): any[] => {
            const { sql, params } = render(cond);
            let targets: any[] = [];
            if (table === liveStreamsTable && sql.includes('"started_at"') && sql.includes("<")) {
              const cutoff = new Date(String(params[params.length - 1]));
              targets = [...s.streams.values()].filter(
                (r) => r["status"] === "live" && new Date(String(r["started_at"])) < cutoff,
              );
            } else if (table === liveStreamsTable) targets = filterEq([...s.streams.values()], sql, params);
            else {
              const store = storeFor(table);
              if (store) targets = filterEq(store, sql, params);
            }
            for (const row of targets) Object.assign(row, patch);
            return targets;
          };
          const self: any = {
            returning: async () => apply(),
            then: (res: any, rej: any) => {
              apply();
              return Promise.resolve([]).then(res, rej);
            },
            catch: (rej: any) => Promise.resolve([]).catch(rej),
          };
          return self;
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => {
        const { sql, params } = render(cond);
        const store = storeFor(table);
        if (store) {
          const doomed = new Set(filterEq(store, sql, params));
          for (let i = store.length - 1; i >= 0; i -= 1) if (doomed.has(store[i])) store.splice(i, 1);
        }
        return Promise.resolve([]);
      },
    }),
    execute: async () => [],
  };

  return { ...actual, db: fakeDb };
});

import liveStreamsRouter, { __resetViewerTracker } from "../live-streams";
import liveTicketsRouter from "../live-tickets";
import liveChatRouter, { registerLiveChatWs } from "../live-chat";
import liveTipsRouter from "../live-tips";
import { refundStreamTicket, canEnterStream } from "../../lib/live-tickets";
import { LiveWsGateway } from "../../lib/live-ws";

const realFetch = globalThis.fetch;
let baseUrl: string;
let wsPort = 0;

function profile(id: string, userId: string, slug: string): any {
  return { id, userId, slug, displayName: slug, avatarUrl: null };
}

function streamRow(over: Record<string, unknown>): any {
  return {
    title: "Show",
    status: "live",
    provider: "own-server",
    user_id: CREATOR,
    profile_id: "prof-creator",
    whip_url: null,
    ingest_source: "camera",
    ticket_price_vb: null,
    ticket_capacity: null,
    viewer_count: 0,
    peak_viewers: 0,
    vod_url: null,
    vod_clip_id: null,
    ended_at: null,
    started_at: new Date(),
    created_at: new Date(),
    destinations: [],
    ...over,
  };
}

function seed() {
  const s = h.state;
  s.streams.clear();
  s.profiles = [
    profile("prof-creator", CREATOR, "creator"),
    profile("prof-creator2", CREATOR2, "creator2"),
    profile("prof-fan", FAN, "fan"),
    profile("prof-holder", HOLDER, "holder"),
    profile("prof-mod", MOD, "mod"),
  ];
  s.tickets = [];
  s.messages = [];
  s.mutes = [];
  s.tips = [];
  s.moderators = [{ id: "modrow-1", profile_id: "prof-creator", moderator_user_id: MOD }];
  s.creditUsage = [];
  s.notifications = [];
  s.samples = [];
  s.balances = new Map([
    [CREATOR, 0],
    [CREATOR2, 0],
    [FAN, 1000],
    [HOLDER, 1000],
    [MOD, 0],
    [POOR, 50],
  ]);
  s.streams.set(T1, streamRow({ id: T1, title: "Ticketed Show", ticket_price_vb: 200 }));
  s.streams.set(T2, streamRow({ id: T2, title: "One Seat Show", ticket_price_vb: 200, ticket_capacity: 1 }));
  s.streams.set(F1, streamRow({ id: F1, title: "Free Show" }));
  s.messages.push({
    id: "msg-seed-1",
    stream_id: T1,
    user_id: CREATOR,
    body: "welcome to the show",
    kind: "chat",
    tip_amount_vb: null,
    created_at: new Date(Date.now() - 1000),
  });
  s.messages.push({
    id: "msg-seed-2",
    stream_id: F1,
    user_id: CREATOR,
    body: "free room hello",
    kind: "chat",
    tip_amount_vb: null,
    created_at: new Date(Date.now() - 1000),
  });
  __resetViewerTracker();
}

async function call(method: string, urlPath: string, opts: { user?: string; bearer?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.user) headers["x-test-user"] = opts.user;
  if (opts.bearer) headers["authorization"] = `Bearer ${opts.bearer}`;
  const res = await realFetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* raw bodies (HLS) are asserted as text */
  }
  return { status: res.status, json, text };
}

beforeAll(async () => {
  h.state.hlsDir = await fsp.mkdtemp(path.join(os.tmpdir(), "bdv-ticket-hls-"));
  for (const id of [T1, F1]) {
    const dir = path.join(h.state.hlsDir, id);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, "playlist.m3u8"),
      "#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:2.0,\nseg000001.m4s\n#EXTINF:2.0,\nseg000002.m4s\n",
    );
    await fsp.writeFile(path.join(dir, "seg000001.m4s"), Buffer.from([0x47, 0x40, 0x11, 0x10]));
  }
  const app = express();
  app.use(express.json());
  app.use("/api", liveStreamsRouter);
  app.use("/api", liveTicketsRouter);
  app.use("/api", liveChatRouter);
  app.use("/api", liveTipsRouter);
  /* A REAL gateway for the socket gate test — the same construction
     the chat suite uses (registerLiveChatWs with an injected token
     verifier over a live HTTP server). */
  const gateway = new LiveWsGateway();
  registerLiveChatWs(gateway, {
    verifyToken: async (token: string) => {
      const userId = TOKENS[token];
      return userId ? { userId, email: null } : null;
    },
  });
  const wsServer = createServer();
  gateway.attach(wsServer);
  await new Promise<void>((resolve) => wsServer.listen(0, resolve));
  wsPort = (wsServer.address() as any).port;
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
});

beforeEach(() => {
  seed();
});

const bal = (u: string) => h.state.balances.get(u) ?? 0;

describe("the buy rail", () => {
  it("charges the buyer once and credits the creator the 95% net of the house fee split", async () => {
    const res = await call("POST", `/api/live-streams/${T1}/ticket`, { user: FAN, body: {} });
    expect(res.status).toBe(201);
    expect(res.json.already_had).toBe(false);
    expect(res.json.ticket.price_vb).toBe(200);
    expect(res.json.ticket.platform_fee_vb).toBe(10);
    expect(res.json.ticket.creator_net_vb).toBe(190);
    expect(res.json.door.sold).toBe(1);
    expect(bal(FAN)).toBe(800);
    expect(bal(CREATOR)).toBe(190);
    expect(h.state.tickets).toHaveLength(1);
    expect(h.state.tickets[0].status).toBe("active");
    /* Both sides are ledgered under keys: the fan's charge and the
       creator's net, so the money is auditable end to end. */
    const keys = h.state.creditUsage.map((r) => r.idempotencyKey ?? r.key).filter(Boolean);
    expect(keys.some((k: string) => k.startsWith("live-ticket:"))).toBe(true);
    expect(keys.some((k: string) => k.endsWith(":credit"))).toBe(true);
  });

  it("never double-charges: a repeat buy — fresh key or same key — returns the held ticket", async () => {
    const first = await call("POST", `/api/live-streams/${T1}/ticket`, {
      user: FAN,
      body: { idempotencyKey: "client-key-0001" },
    });
    expect(first.status).toBe(201);
    const againFresh = await call("POST", `/api/live-streams/${T1}/ticket`, { user: FAN, body: {} });
    expect(againFresh.status).toBe(200);
    expect(againFresh.json.already_had).toBe(true);
    const againSame = await call("POST", `/api/live-streams/${T1}/ticket`, {
      user: FAN,
      body: { idempotencyKey: "client-key-0001" },
    });
    expect(againSame.status).toBe(200);
    expect(againSame.json.already_had).toBe(true);
    expect(bal(FAN)).toBe(800);
    expect(bal(CREATOR)).toBe(190);
    expect(h.state.tickets).toHaveLength(1);
  });

  it("refuses an underfunded buyer with nothing recorded", async () => {
    const res = await call("POST", `/api/live-streams/${T1}/ticket`, { user: POOR, body: {} });
    expect(res.status).toBe(402);
    expect(res.json.code).toBe("INSUFFICIENT_BALANCE");
    expect(bal(POOR)).toBe(50);
    expect(bal(CREATOR)).toBe(0);
    expect(h.state.tickets).toHaveLength(0);
  });

  it("refuses the owner's self-buy and free-stream buys", async () => {
    const own = await call("POST", `/api/live-streams/${T1}/ticket`, { user: CREATOR, body: {} });
    expect(own.status).toBe(400);
    expect(own.json.code).toBe("OWN_STREAM");
    const free = await call("POST", `/api/live-streams/${F1}/ticket`, { user: FAN, body: {} });
    expect(free.status).toBe(400);
    expect(free.json.code).toBe("NOT_TICKETED");
    expect(h.state.tickets).toHaveLength(0);
  });

  it("stops at capacity: the second buyer of a one-seat show is turned away uncharged", async () => {
    const first = await call("POST", `/api/live-streams/${T2}/ticket`, { user: HOLDER, body: {} });
    expect(first.status).toBe(201);
    const second = await call("POST", `/api/live-streams/${T2}/ticket`, { user: FAN, body: {} });
    expect(second.status).toBe(409);
    expect(second.json.code).toBe("SOLD_OUT");
    expect(bal(FAN)).toBe(1000);
    expect(h.state.tickets.filter((t) => t.stream_id === T2)).toHaveLength(1);
  });

  it("refuses to sell entry to a show that has ended", async () => {
    h.state.streams.get(T1).status = "ended";
    const res = await call("POST", `/api/live-streams/${T1}/ticket`, { user: FAN, body: {} });
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("STREAM_NOT_LIVE");
    expect(bal(FAN)).toBe(1000);
  });
});

describe("the watch door (DTO)", () => {
  it("guests and non-holders see the door facts and NO playback", async () => {
    const guest = await call("GET", `/api/live-streams/${T1}`);
    expect(guest.status).toBe(200);
    expect(guest.json.stream.playback).toBeNull();
    expect(guest.json.stream.vod_url).toBeNull();
    expect(guest.json.stream.viewer_ticket).toBe(false);
    expect(guest.json.stream.playback_token).toBeNull();
    expect(guest.json.stream.ticket).toMatchObject({ price_vb: 200, sold: 0, seats_left: null });
    const fan = await call("GET", `/api/live-streams/${T1}`, { bearer: "tok-fan" });
    expect(fan.json.stream.playback).toBeNull();
    expect(fan.json.stream.viewer_ticket).toBe(false);
  });

  it("a ticket holder's DTO carries playback with the signed token; the owner and a moderator enter free", async () => {
    await call("POST", `/api/live-streams/${T1}/ticket`, { user: HOLDER, body: {} });
    const holder = await call("GET", `/api/live-streams/${T1}`, { bearer: "tok-holder" });
    expect(holder.json.stream.viewer_ticket).toBe(true);
    expect(holder.json.stream.playback_token).toBeTruthy();
    expect(holder.json.stream.playback.hls_url).toContain(`?t=${holder.json.stream.playback_token}`);
    expect(holder.json.stream.ticket.sold).toBe(1);

    const owner = await call("GET", `/api/live-streams/${T1}`, { bearer: "tok-owner" });
    expect(owner.json.stream.viewer_ticket).toBe(true);
    expect(owner.json.stream.playback).not.toBeNull();

    const mod = await call("GET", `/api/live-streams/${T1}`, { bearer: "tok-mod" });
    expect(mod.json.stream.viewer_ticket).toBe(true);
    expect(bal(MOD)).toBe(0);
  });

  it("the replay of an ended ticketed show stays behind the door", async () => {
    await call("POST", `/api/live-streams/${T1}/ticket`, { user: HOLDER, body: {} });
    const row = h.state.streams.get(T1);
    row.status = "ended";
    row.vod_url = "https://vod.example/show.mp4";
    const guest = await call("GET", `/api/live-streams/${T1}`);
    expect(guest.json.stream.vod_url).toBeNull();
    const holder = await call("GET", `/api/live-streams/${T1}`, { bearer: "tok-holder" });
    expect(holder.json.stream.vod_url).toBe("https://vod.example/show.mp4");
  });

  it("the public rail shows the door but never playback", async () => {
    const res = await call("GET", `/api/live-streams/live`);
    expect(res.status).toBe(200);
    const t1 = res.json.streams.find((s: any) => s.id === T1);
    expect(t1.ticket.price_vb).toBe(200);
    expect(t1.playback).toBeNull();
    const f1 = res.json.streams.find((s: any) => s.id === F1);
    expect(f1.ticket).toBeNull();
    expect(f1.playback).not.toBeNull();
  });
});

describe("the media plane (HLS + heartbeat)", () => {
  async function holderToken(): Promise<string> {
    await call("POST", `/api/live-streams/${T1}/ticket`, { user: HOLDER, body: {} });
    const dto = await call("GET", `/api/live-streams/${T1}`, { bearer: "tok-holder" });
    return dto.json.stream.playback_token as string;
  }

  it("playlist and segments refuse tokenless requests on a ticketed stream", async () => {
    const playlist = await call("GET", `/api/live-streams/${T1}/hls/playlist.m3u8`);
    expect(playlist.status).toBe(403);
    expect(playlist.json.code).toBe("TICKET_REQUIRED");
    const segment = await call("GET", `/api/live-streams/${T1}/hls/seg000001.m4s`);
    expect(segment.status).toBe(403);
  });

  it("the entitled playlist carries the token into its segment lines, and segments honor it", async () => {
    const token = await holderToken();
    const playlist = await call("GET", `/api/live-streams/${T1}/hls/playlist.m3u8?t=${token}`);
    expect(playlist.status).toBe(200);
    expect(playlist.text).toContain(`seg000001.m4s?t=${token}`);
    expect(playlist.text).toContain("#EXTM3U");
    const segment = await call("GET", `/api/live-streams/${T1}/hls/seg000001.m4s?t=${token}`);
    expect(segment.status).toBe(200);
    const forged = await call("GET", `/api/live-streams/${T1}/hls/playlist.m3u8?t=forged.token.value`);
    expect(forged.status).toBe(403);
  });

  it("a free stream's playlist serves exactly as before — no token, no rewrite", async () => {
    const playlist = await call("GET", `/api/live-streams/${F1}/hls/playlist.m3u8`);
    expect(playlist.status).toBe(200);
    expect(playlist.text).toContain("seg000001.m4s\n");
    expect(playlist.text).not.toContain("?t=");
  });

  it("heartbeat counts only entitled presence on a ticketed stream", async () => {
    const denied = await call("POST", `/api/live-streams/${T1}/heartbeat`, {
      body: { session_id: "viewer-session-1" },
    });
    expect(denied.status).toBe(403);
    expect(denied.json.code).toBe("TICKET_REQUIRED");
    const token = await holderToken();
    const ok = await call("POST", `/api/live-streams/${T1}/heartbeat`, {
      body: { session_id: "viewer-session-1", access_token: token },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.viewer_count).toBe(1);
    const free = await call("POST", `/api/live-streams/${F1}/heartbeat`, {
      body: { session_id: "viewer-session-2" },
    });
    expect(free.status).toBe(200);
  });
});

describe("the room (chat + tips)", () => {
  it("chat history is refused — with zero messages leaked — until the viewer holds a ticket", async () => {
    const guest = await call("GET", `/api/live/${T1}/chat`);
    expect(guest.status).toBe(402);
    expect(guest.json.code).toBe("TICKET_REQUIRED");
    expect(guest.json.messages).toBeUndefined();
    expect(guest.json.ticket.price_vb).toBe(200);
    const fan = await call("GET", `/api/live/${T1}/chat`, { bearer: "tok-fan" });
    expect(fan.status).toBe(402);
    await call("POST", `/api/live-streams/${T1}/ticket`, { user: HOLDER, body: {} });
    const holder = await call("GET", `/api/live/${T1}/chat`, { bearer: "tok-holder" });
    expect(holder.status).toBe(200);
    expect(holder.json.messages.map((m: any) => m.body)).toContain("welcome to the show");
    const free = await call("GET", `/api/live/${F1}/chat`);
    expect(free.status).toBe(200);
    expect(free.json.messages.map((m: any) => m.body)).toContain("free room hello");
  });

  it("posting and tipping are inside the door too", async () => {
    const post = await call("POST", `/api/live/${T1}/chat`, { user: FAN, body: { body: "let me in" } });
    expect(post.status).toBe(402);
    expect(post.json.code).toBe("TICKET_REQUIRED");
    const tip = await call("POST", `/api/live/${T1}/tips`, { user: FAN, body: { amountVb: 100, idempotencyKey: "tip-key-fan-0001" } });
    expect(tip.status).toBe(402);
    expect(tip.json.code).toBe("TICKET_REQUIRED");
    expect(bal(FAN)).toBe(1000);

    await call("POST", `/api/live-streams/${T1}/ticket`, { user: HOLDER, body: {} });
    const holderPost = await call("POST", `/api/live/${T1}/chat`, {
      user: HOLDER,
      body: { body: "great show" },
    });
    expect(holderPost.status).toBe(201);
    const holderTip = await call("POST", `/api/live/${T1}/tips`, { user: HOLDER, body: { amountVb: 100, idempotencyKey: "tip-key-holder-1" } });
    expect(holderTip.status).toBe(201);
    expect(bal(HOLDER)).toBe(1000 - 200 - 100);
    /* 190 ticket net (5% sales fee) + the full 100 tip — tips are
       fee-free transfers in this house; only sales split. */
    expect(bal(CREATOR)).toBe(190 + 100);
  });

  it("the chat socket closes 4403 for a non-holder and admits a holder", async () => {
    const connect = (token: string) => {
      const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/api/live/${T1}/chat/ws?token=${token}`);
      const messages: string[] = [];
      ws.on("message", (d: any) => messages.push(String(d)));
      const closed = new Promise<number>((resolve) => ws.on("close", (code: number) => resolve(code)));
      return { ws, messages, closed };
    };
    const fan = connect("tok-fan");
    await expect(fan.closed).resolves.toBe(4403);

    await call("POST", `/api/live-streams/${T1}/ticket`, { user: HOLDER, body: {} });
    const holder = connect("tok-holder");
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("holder received no room greeting")), 3000);
      const iv = setInterval(() => {
        if (holder.messages.length >= 1) {
          clearTimeout(t);
          clearInterval(iv);
          resolve();
        }
      }, 15);
    });
    expect(holder.messages.length).toBeGreaterThanOrEqual(1);
    holder.ws.close();
  });
});

describe("the refund unwind", () => {
  it("restores both sides exactly once, revokes entry, and a re-buy works fresh", async () => {
    await call("POST", `/api/live-streams/${T1}/ticket`, { user: FAN, body: {} });
    expect(bal(FAN)).toBe(800);
    expect(bal(CREATOR)).toBe(190);
    const ticket = h.state.tickets[0];

    const refunded = await refundStreamTicket(ticket);
    expect(refunded?.status).toBe("refunded");
    expect(bal(FAN)).toBe(1000);
    expect(bal(CREATOR)).toBe(0);

    const again = await refundStreamTicket(ticket);
    expect(again?.status).toBe("refunded");
    expect(bal(FAN)).toBe(1000);
    expect(bal(CREATOR)).toBe(0);

    const row = h.state.streams.get(T1);
    expect(await canEnterStream(row, FAN)).toBe(false);
    const dto = await call("GET", `/api/live-streams/${T1}`, { bearer: "tok-fan" });
    expect(dto.json.stream.viewer_ticket).toBe(false);
    expect(dto.json.stream.playback).toBeNull();

    const rebuy = await call("POST", `/api/live-streams/${T1}/ticket`, { user: FAN, body: {} });
    expect(rebuy.status).toBe(201);
    expect(rebuy.json.already_had).toBe(false);
    expect(bal(FAN)).toBe(800);
    expect(bal(CREATOR)).toBe(190);
    expect(await canEnterStream(row, FAN)).toBe(true);
    expect(h.state.tickets.filter((t) => t.status === "active")).toHaveLength(1);
  });
});

describe("creating a ticketed stream", () => {
  it("stores the door from Go Live setup and shows it on the owner DTO", async () => {
    const res = await call("POST", `/api/live-streams`, {
      user: CREATOR2,
      body: { title: "Paid Masterclass", ticket_price_vb: 500, ticket_capacity: 25 },
    });
    expect(res.status).toBe(201);
    expect(res.json.stream.ticket).toMatchObject({ price_vb: 500, capacity: 25, sold: 0, seats_left: 25 });
    expect(res.json.stream.viewer_ticket).toBe(true);
    const stored = [...h.state.streams.values()].find((r) => r.title === "Paid Masterclass");
    expect(stored.ticket_price_vb).toBe(500);
    expect(stored.ticket_capacity).toBe(25);
  });

  it("rejects a below-floor price and a cap without a price", async () => {
    const cheap = await call("POST", `/api/live-streams`, {
      user: CREATOR2,
      body: { title: "Too Cheap", ticket_price_vb: 50 },
    });
    expect(cheap.status).toBe(400);
    expect(cheap.json.code).toBe("TICKET_TOO_CHEAP");
    const capOnly = await call("POST", `/api/live-streams`, {
      user: CREATOR2,
      body: { title: "Cap Only", ticket_capacity: 10 },
    });
    expect(capOnly.status).toBe(400);
    expect(capOnly.json.code).toBe("CAPACITY_NEEDS_PRICE");
  });
});



