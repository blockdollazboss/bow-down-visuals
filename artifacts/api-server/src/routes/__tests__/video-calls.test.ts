/**
 * Route tests for video calls Phase 1 (Stack-200) — the REAL
 * video-calls router over an ephemeral server against a cond-aware
 * fake db, in the house style of dm-drafts.test.ts.
 *
 * Pins:
 *  - the privacy gate end-to-end: inbox rings; request 403
 *    not_accepted; blocked 403 blocked; non-participant 403; guests
 *    (no token) 401 everywhere;
 *  - the ledger lifecycle: ring -> accept -> end (duration lands),
 *    decline, caller cancel reads missed/caller_cancelled, a stale
 *    ring settles missed/ring_timeout on read;
 *  - one live call per person: second start 409 already_in_call; a
 *    busy callee settles the new attempt as busy without ringing;
 *  - a block landing mid-call: a late action answers 403 and the row
 *    settles blocked; severVideoCallsForConversation settles live
 *    rows directly (the community block handler's hook);
 *  - history is participant-only and chronological;
 *  - call-config serves STUN + the honest relay flag, signed-in only.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";
const CONV_ID = "44444444-4444-4444-8444-444444444444";
const CONV_REQUEST_ID = "55555555-5555-4555-8555-555555555555";
const CONV_BLOCKED_ID = "66666666-6666-4666-8666-666666666666";

const h = vi.hoisted(() => ({
  state: {
    conversations: [] as Array<Record<string, unknown>>,
    calls: [] as Array<Record<string, unknown>>,
    profiles: [] as Array<Record<string, unknown>>,
    seq: 0,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (req.headers["x-anon"]) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.userId = req.headers["x-user-id"] ?? ME;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { conversationsTable, videoCallsTable, creatorProfilesTable } = actual;

  function nextId(): string {
    state.seq += 1;
    return `99999999-9999-4999-8999-${String(state.seq).padStart(12, "0")}`;
  }

  function rowsFor(table: unknown, cond: unknown): Array<Record<string, unknown>> {
    if (cond === undefined || cond === null) {
      if (table === conversationsTable) return state.conversations;
      if (table === videoCallsTable) return state.calls;
      if (table === creatorProfilesTable) return state.profiles;
      return [];
    }
    const { params } = render(cond);
    const strs = params.map((x) => String(x));
    if (table === conversationsTable) {
      return state.conversations.filter((c) => strs.includes(String(c["id"])));
    }
    if (table === creatorProfilesTable) {
      return state.profiles.filter((p) => strs.includes(String(p["userId"])));
    }
    if (table === videoCallsTable) {
      const convHit = state.conversations.some((c) => strs.includes(String(c["id"])));
      if (convHit) {
        return state.calls.filter((c) =>
          strs.includes(String(c["conversationId"])) &&
          (!strs.includes("ringing") || c["status"] === "ringing" || c["status"] === "accepted"));
      }
      const byId = state.calls.filter((c) => strs.includes(String(c["id"])));
      if (byId.length > 0) return byId;
      /* live-call sweep: user ids + live statuses */
      return state.calls.filter((c) =>
        (strs.includes(String(c["callerUserId"])) || strs.includes(String(c["calleeUserId"]))) &&
        strs.includes(String(c["status"])));
    }
    return [];
  }

  function chain(table: unknown): any {
    let cond: unknown;
    let orderSql = "";
    const c: any = {
      where: (w: unknown) => { cond = w; return c; },
      orderBy: (...args: unknown[]) => {
        orderSql = args.map((a) => { try { return render(a).sql; } catch { return ""; } }).join(" ");
        return c;
      },
      limit: async (n: number) => {
        let rows = [...rowsFor(table, cond)];
        if (/desc/i.test(orderSql)) rows.sort((a, b) => new Date(b["createdAt"] as any).getTime() - new Date(a["createdAt"] as any).getTime());
        return rows.slice(0, n);
      },
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table, cond)).then(res, rej),
    };
    return c;
  }

  function thenable(extra: Record<string, unknown> = {}): any {
    return { ...extra, then: (res: any, rej: any) => Promise.resolve([]).then(res, rej) };
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({ from: (table: unknown) => chain(table) }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        const full = {
          id: nextId(), endReason: null, answeredAt: null, endedAt: null,
          durationSeconds: null, createdAt: new Date(), updatedAt: new Date(), ...v,
        };
        if (table === videoCallsTable) state.calls.push(full);
        return thenable({ returning: async () => [full] });
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const { params } = render(cond);
          const strs = params.map((x) => String(x));
          const out: Array<Record<string, unknown>> = [];
          if (table === videoCallsTable) {
            for (const row of state.calls) {
              if (strs.includes(String(row["id"]))) { Object.assign(row, patch); out.push(row); }
            }
          }
          return thenable({ returning: async () => out });
        },
      }),
    }),
    delete: (_table: unknown) => ({ where: (_cond: unknown) => thenable({ returning: async () => [] }) }),
    execute: async () => ({ rows: [] }),
  };

  return { ...actual, db: fakeDb };
});

import videoCallsRouter, {
  severVideoCallsForConversation, __clearRingTimers,
} from "../video-calls";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", videoCallsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  __clearRingTimers();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function convRow(id: string, status: string, a = ME, b = OTHER): Record<string, unknown> {
  return { id, participantA: a, participantB: b, status, requestedBy: a, lastMessageAt: new Date(), createdAt: new Date() };
}
function callRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  h.state.seq += 1;
  return {
    id: `88888888-8888-4888-8888-${String(h.state.seq).padStart(12, "0")}`,
    conversationId: CONV_ID, callerUserId: ME, calleeUserId: OTHER,
    status: "ringing", endReason: null, answeredAt: null, endedAt: null,
    durationSeconds: null, createdAt: new Date(), updatedAt: new Date(),
    ...over,
  };
}

beforeEach(() => {
  const s = h.state;
  s.conversations = [
    convRow(CONV_ID, "inbox"),
    convRow(CONV_REQUEST_ID, "request"),
    convRow(CONV_BLOCKED_ID, "blocked"),
  ];
  s.calls = [];
  s.profiles = [{ userId: ME, displayName: "Caller Creator" }, { userId: OTHER, displayName: "Callee Creator" }];
  s.seq = 0;
  __clearRingTimers();
});

async function req(method: string, path: string, opts: { userId?: string; anon?: boolean } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.anon) headers["x-anon"] = "1";
  else headers["x-user-id"] = opts.userId ?? ME;
  const r = await realFetch(`${baseUrl}${path}`, { method, headers });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("POST /dm/:id/call — the privacy gate", () => {
  it("an inbox conversation rings: 201 + a ringing ledger row", async () => {
    const { status, json } = await req("POST", `/dm/${CONV_ID}/call`);
    expect(status).toBe(201);
    expect(json.call.status).toBe("ringing");
    expect(json.call.callerUserId).toBe(ME);
    expect(json.call.calleeUserId).toBe(OTHER);
    expect(json.ice.iceServers.length).toBeGreaterThan(0);
    expect(h.state.calls).toHaveLength(1);
  });
  it("a request thread cannot ring (403 not_accepted) and creates nothing", async () => {
    const { status, json } = await req("POST", `/dm/${CONV_REQUEST_ID}/call`);
    expect(status).toBe(403);
    expect(json.code).toBe("not_accepted");
    expect(h.state.calls).toHaveLength(0);
  });
  it("a blocked thread cannot ring (403 blocked)", async () => {
    const { status, json } = await req("POST", `/dm/${CONV_BLOCKED_ID}/call`);
    expect(status).toBe(403);
    expect(json.code).toBe("blocked");
  });
  it("a non-participant gets 403; a guest gets 401; an unknown thread 404", async () => {
    expect((await req("POST", `/dm/${CONV_ID}/call`, { userId: THIRD })).status).toBe(403);
    expect((await req("POST", `/dm/${CONV_ID}/call`, { anon: true })).status).toBe(401);
    expect((await req("POST", `/dm/77777777-7777-4777-8777-777777777777/call`)).status).toBe(404);
  });
  it("one live call per person: a second start while ringing is a 409", async () => {
    expect((await req("POST", `/dm/${CONV_ID}/call`)).status).toBe(201);
    const again = await req("POST", `/dm/${CONV_ID}/call`);
    expect(again.status).toBe(409);
    expect(again.json.code).toBe("already_in_call");
    expect(h.state.calls).toHaveLength(1);
  });
  it("a busy callee settles the new attempt as busy — no ring over a live call", async () => {
    h.state.calls = [callRow({ callerUserId: OTHER, calleeUserId: THIRD, status: "accepted", answeredAt: new Date() })];
    const { status, json } = await req("POST", `/dm/${CONV_ID}/call`);
    expect(status).toBe(201);
    expect(json.busy).toBe(true);
    expect(json.call.status).toBe("busy");
    const mine = h.state.calls.find((c) => c["callerUserId"] === ME);
    expect(mine?.["status"]).toBe("busy");
  });
});

describe("call lifecycle — accept / decline / end", () => {
  async function startRing(): Promise<string> {
    const { json } = await req("POST", `/dm/${CONV_ID}/call`);
    return json.call.id as string;
  }
  it("callee accepts, either side hangs up, duration lands on the row", async () => {
    const id = await startRing();
    const acc = await req("POST", `/dm/calls/${id}/accept`, { userId: OTHER });
    expect(acc.status).toBe(200);
    expect(acc.json.call.status).toBe("accepted");
    expect(acc.json.call.answeredAt).toBeTruthy();
    const end = await req("POST", `/dm/calls/${id}/end`, { userId: OTHER });
    expect(end.status).toBe(200);
    expect(end.json.call.status).toBe("ended");
    expect(end.json.call.endReason).toBe("hangup");
    expect(end.json.call.durationSeconds).toBeGreaterThanOrEqual(0);
  });
  it("the caller cannot accept their own ring; a stranger cannot act at all", async () => {
    const id = await startRing();
    expect((await req("POST", `/dm/calls/${id}/accept`, { userId: ME })).status).toBe(409);
    expect((await req("POST", `/dm/calls/${id}/accept`, { userId: THIRD })).status).toBe(403);
  });
  it("decline settles declined; caller cancel settles missed/caller_cancelled", async () => {
    const a = await startRing();
    const dec = await req("POST", `/dm/calls/${a}/decline`, { userId: OTHER });
    expect(dec.json.call.status).toBe("declined");
    const b = await startRing();
    const cancel = await req("POST", `/dm/calls/${b}/end`, { userId: ME });
    expect(cancel.json.call.status).toBe("missed");
    expect(cancel.json.call.endReason).toBe("caller_cancelled");
    /* a settled call never moves again */
    expect((await req("POST", `/dm/calls/${b}/accept`, { userId: OTHER })).status).toBe(409);
  });
});

describe("GET /dm/:id/calls — in-thread history", () => {
  it("lists entries chronologically for participants only", async () => {
    const old = new Date(Date.now() - 60_000);
    h.state.calls = [
      callRow({ status: "missed", endReason: "ring_timeout", createdAt: old }),
      callRow({ status: "ended", endReason: "hangup", durationSeconds: 65, answeredAt: new Date(), endedAt: new Date() }),
    ];
    const { status, json } = await req("GET", `/dm/${CONV_ID}/calls`);
    expect(status).toBe(200);
    expect(json.calls).toHaveLength(2);
    expect(json.calls[0].status).toBe("missed");
    expect(json.calls[1].durationSeconds).toBe(65);
    expect((await req("GET", `/dm/${CONV_ID}/calls`, { userId: THIRD })).status).toBe(403);
    expect((await req("GET", `/dm/${CONV_ID}/calls`, { anon: true })).status).toBe(401);
  });
  it("a stale ring (timer lost in a restart) settles missed/ring_timeout on read", async () => {
    h.state.calls = [callRow({ status: "ringing", createdAt: new Date(Date.now() - 10 * 60_000) })];
    const { json } = await req("GET", `/dm/${CONV_ID}/calls`);
    expect(json.calls[0].status).toBe("missed");
    expect(json.calls[0].endReason).toBe("ring_timeout");
  });
});

describe("blocks sever calls", () => {
  it("severVideoCallsForConversation settles a live call as blocked", async () => {
    const row = callRow({ status: "accepted", answeredAt: new Date() });
    h.state.calls = [row];
    await severVideoCallsForConversation(CONV_ID);
    expect(h.state.calls[0]?.["status"]).toBe("blocked");
    expect(h.state.calls[0]?.["endReason"]).toBe("blocked");
  });
  it("a late accept on a blocked conversation answers 403 and settles the ring blocked", async () => {
    const row = callRow({ status: "ringing", conversationId: CONV_BLOCKED_ID });
    h.state.calls = [row];
    const { status, json } = await req("POST", `/dm/calls/${row["id"]}/accept`, { userId: OTHER });
    expect(status).toBe(403);
    expect(json.code).toBe("blocked");
    expect(h.state.calls[0]?.["status"]).toBe("blocked");
  });
});

describe("GET /dm/call-config", () => {
  it("serves STUN + the ring window to members; guests get 401", async () => {
    const { status, json } = await req("GET", `/dm/call-config`);
    expect(status).toBe(200);
    expect(json.ringTimeoutMs).toBe(45_000);
    expect(Array.isArray(json.ice.iceServers)).toBe(true);
    expect((await req("GET", `/dm/call-config`, { anon: true })).status).toBe(401);
  });
});
