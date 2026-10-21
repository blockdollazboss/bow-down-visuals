/**
 * Route tests for live stream chat (routes/live-chat):
 *   GET    /api/live/:id/chat              history + after-cursor + stream state
 *   POST   /api/live/:id/chat              auth, live gate, pacing, mute, body rules
 *   DELETE /api/live/:id/chat/:messageId   author vs owner vs stranger
 *   POST   /api/live/:id/chat/mute         owner-only moderation
 *   DELETE /api/live/:id/chat/mute/:userId unmute
 *
 * Style mirrors live-streams.test.ts: the real router over a fake db
 * (real table objects via importOriginal; WHERE params read back
 * through PgDialect rendering). requireAuth is mocked to take the
 * user from an x-test-user header — absent header = the 401 the real
 * middleware returns. Broadcasts are asserted against the real
 * liveChatHub with a fake socket in the room.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const VIEWER = "00000000-0000-4000-8000-0000000000bb";
const STRANGER = "00000000-0000-4000-8000-0000000000cc";
const STREAM = "22222222-2222-4222-8222-222222222222";
const STREAM_ENDED = "33333333-3333-4333-8333-333333333333";
const T0 = new Date("2026-10-16T10:00:00.000Z");

const h = vi.hoisted(() => ({
  state: {
    streams: new Map<string, Record<string, unknown>>(),
    messages: [] as Array<Record<string, unknown>>,
    mutes: [] as Array<Record<string, unknown>>,
    profiles: [] as Array<Record<string, unknown>>,
    seq: 0,
  },
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

function rowMatches(row: Record<string, unknown>, cond: Cond): boolean {
  for (const [col, val] of cond.eq) {
    if (String(row[col] ?? "") !== String(val ?? "")) return false;
  }
  for (const [col, val] of cond.gt) {
    const a = new Date(String(row[col])).getTime();
    const b = new Date(String(val)).getTime();
    if (!(a > b)) return false;
  }
  for (const col of cond.isNull) {
    if (row[col] !== null && row[col] !== undefined) return false;
  }
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

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { liveStreamsTable, liveChatMessagesTable, liveChatMutesTable, creatorProfilesTable } = actual;

  const tableOf = (table: unknown) =>
    table === liveStreamsTable
      ? "streams"
      : table === liveChatMessagesTable
        ? "messages"
        : table === liveChatMutesTable
          ? "mutes"
          : table === creatorProfilesTable
            ? "profiles"
            : "?";

  function allRows(kind: string): Array<Record<string, unknown>> {
    if (kind === "streams") return [...state.streams.values()];
    if (kind === "messages") return state.messages;
    if (kind === "mutes") return state.mutes;
    if (kind === "profiles") return state.profiles;
    return [];
  }

  function selectChain(table: unknown, fields?: Record<string, { name: string }>): any {
    const kind = tableOf(table);
    let cond: Cond = { eq: [], gt: [], isNull: [] };
    let order: Array<{ col: string; dir: 1 | -1 }> = [];
    let limitN: number | null = null;
    const run = () => {
      let rows = allRows(kind).filter((r) => rowMatches(r, cond));
      for (const o of [...order].reverse()) {
        rows = [...rows].sort((a, b) => {
          const av = a[o.col] instanceof Date ? (a[o.col] as Date).getTime() : String(a[o.col] ?? "");
          const bv = b[o.col] instanceof Date ? (b[o.col] as Date).getTime() : String(b[o.col] ?? "");
          return (av < bv ? -1 : av > bv ? 1 : 0) * o.dir;
        });
      }
      if (limitN !== null) rows = rows.slice(0, limitN);
      if (fields) {
        const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        return rows.map((r) => {
          const out: Record<string, unknown> = {};
          for (const [key, col] of Object.entries(fields)) out[key] = r[snakeToCamel(col.name)] ?? r[col.name] ?? null;
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
          // Rendered as "table"."column" asc|desc — the column is the LAST quoted name.
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
          row.created_at = new Date(Date.now() + state.seq);
          row.deleted_at = null;
          state.messages.push(row);
        }
        if (kind === "mutes") {
          row.created_at = new Date();
          state.mutes.push(row);
        }
        const self: any = {
          returning: async () => [{ ...row }],
          then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
        };
        return self;
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const parsed = parseCond(cond);
          const kind = tableOf(table);
          for (const row of allRows(kind)) if (rowMatches(row, parsed)) Object.assign(row, patch);
          return Promise.resolve([]);
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => {
        const parsed = parseCond(cond);
        const kind = tableOf(table);
        if (kind === "mutes") state.mutes = state.mutes.filter((r) => !rowMatches(r, parsed));
        return Promise.resolve([]);
      },
    }),
  };

  return { ...actual, db };
});

import router, { liveChatHub, __resetChatRateLimit } from "../live-chat";

let server: Server;
let base = "";

function seedStream(id: string, owner: string, status: string, startedAt: Date = T0) {
  h.state.streams.set(id, {
    id,
    user_id: owner,
    profile_id: "11111111-1111-4111-8111-111111111111",
    title: "Friday Night Live",
    status,
    provider: "own",
    started_at: startedAt,
    ended_at: status === "ended" ? new Date() : null,
    created_at: startedAt,
    updated_at: startedAt,
  });
}

function seedMessage(streamId: string, userId: string, body: string, at: Date, deleted = false) {
  const id = `55555555-5555-4555-8555-${String(h.state.messages.length + 1).padStart(12, "0")}`;
  h.state.messages.push({
    id,
    stream_id: streamId,
    user_id: userId,
    body: deleted ? "" : body,
    created_at: at,
    deleted_at: deleted ? new Date() : null,
  });
  return id;
}

async function req(method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(opts.user ? { "x-test-user": opts.user } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

function fakeSocket() {
  return {
    readyState: 1,
    sent: [] as string[],
    send(data: string) {
      this.sent.push(data);
    },
    close() {},
    terminate() {},
    ping() {},
    on() {},
  };
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
  h.state.streams.clear();
  h.state.messages = [];
  h.state.mutes = [];
  h.state.profiles = [
    { userId: OWNER, slug: "king", displayName: "King Live", avatarUrl: "https://x/av.png" },
    { userId: VIEWER, slug: "viewer-one", displayName: "Viewer One", avatarUrl: null },
  ];
  h.state.seq = 0;
  __resetChatRateLimit();
  seedStream(STREAM, OWNER, "live", new Date());
  seedStream(STREAM_ENDED, OWNER, "ended");
});

describe("GET /live/:id/chat", () => {
  it("returns history ascending with author cards, deleted rows never served", async () => {
    seedMessage(STREAM, VIEWER, "first!", new Date(T0.getTime() + 1000));
    seedMessage(STREAM, STRANGER, "spam", new Date(T0.getTime() + 2000), true);
    seedMessage(STREAM, OWNER, "welcome in", new Date(T0.getTime() + 3000));
    const { status, json } = await req("GET", `/api/live/${STREAM}/chat`);
    expect(status).toBe(200);
    expect(json.streamStatus).toBe("live");
    expect(json.ownerId).toBe(OWNER);
    expect(json.messages).toHaveLength(2);
    expect(json.messages[0].body).toBe("first!");
    expect(json.messages[0].author).toEqual({ displayName: "Viewer One", avatarUrl: null, slug: "viewer-one" });
    expect(json.messages[1].author.displayName).toBe("King Live");
    expect(json.messages[1]).toMatchObject({ streamId: STREAM, userId: OWNER });
    expect(typeof json.messages[0].createdAt).toBe("string");
  });

  it("an author with no creator profile reads as Someone — never a fake name", async () => {
    seedMessage(STREAM, STRANGER, "hi from a lurker", new Date(T0.getTime() + 1000));
    const { json } = await req("GET", `/api/live/${STREAM}/chat`);
    expect(json.messages[0].author).toEqual({ displayName: "Someone", avatarUrl: null, slug: null });
  });

  it("404s for a stream that doesn't exist", async () => {
    const { status } = await req("GET", `/api/live/99999999-9999-4999-8999-999999999999/chat`);
    expect(status).toBe(404);
  });

  it("?after= returns only newer messages; an unknown cursor falls back to full history", async () => {
    const first = seedMessage(STREAM, VIEWER, "one", new Date(T0.getTime() + 1000));
    seedMessage(STREAM, VIEWER, "two", new Date(T0.getTime() + 2000));
    seedMessage(STREAM, OWNER, "three", new Date(T0.getTime() + 3000));
    const caught = await req("GET", `/api/live/${STREAM}/chat?after=${first}`);
    expect(caught.json.messages.map((m: any) => m.body)).toEqual(["two", "three"]);
    const bogus = await req("GET", `/api/live/${STREAM}/chat?after=66666666-6666-4666-8666-666666666666`);
    expect(bogus.json.messages).toHaveLength(3);
  });

  it("an ended stream serves its archive with streamStatus ended", async () => {
    seedMessage(STREAM_ENDED, VIEWER, "was here", new Date(T0.getTime() + 1000));
    const { status, json } = await req("GET", `/api/live/${STREAM_ENDED}/chat`);
    expect(status).toBe(200);
    expect(json.streamStatus).toBe("ended");
    expect(json.messages).toHaveLength(1);
  });

  it("empty live chat is a genuine empty list", async () => {
    const { json } = await req("GET", `/api/live/${STREAM}/chat`);
    expect(json.messages).toEqual([]);
    expect(json.hasMore).toBe(false);
  });
});

describe("POST /live/:id/chat", () => {
  it("posts, returns the DTO, stores trimmed text, and broadcasts to the room", async () => {
    const sock = fakeSocket();
    liveChatHub.join(STREAM, sock as never);
    const { status, json } = await req("POST", `/api/live/${STREAM}/chat`, {
      user: VIEWER,
      body: { body: "  let's gooo  " },
    });
    expect(status).toBe(201);
    expect(json.message.body).toBe("let's gooo");
    expect(json.message.author.displayName).toBe("Viewer One");
    const stored = h.state.messages.find((m) => m.id === json.message.id);
    expect(stored?.body).toBe("let's gooo");
    const events = sock.sent.map((s) => JSON.parse(s));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message");
    expect(events[0].message.id).toBe(json.message.id);
    liveChatHub.leave(STREAM, sock as never);
  });

  it("requires sign-in", async () => {
    const { status } = await req("POST", `/api/live/${STREAM}/chat`, { body: { body: "hi" } });
    expect(status).toBe(401);
  });

  it("refuses posts to an ended stream with STREAM_NOT_LIVE", async () => {
    const { status, json } = await req("POST", `/api/live/${STREAM_ENDED}/chat`, {
      user: VIEWER,
      body: { body: "too late" },
    });
    expect(status).toBe(409);
    expect(json.code).toBe("STREAM_NOT_LIVE");
  });

  it("enforces the 1–500 character body rule", async () => {
    const empty = await req("POST", `/api/live/${STREAM}/chat`, { user: VIEWER, body: { body: "   " } });
    expect(empty.status).toBe(400);
    const long = await req("POST", `/api/live/${STREAM}/chat`, { user: VIEWER, body: { body: "x".repeat(501) } });
    expect(long.status).toBe(400);
    expect(long.json.code).toBe("BAD_BODY");
  });

  it("paces posts at ~1 per 1.5s with an honest 429", async () => {
    const first = await req("POST", `/api/live/${STREAM}/chat`, { user: VIEWER, body: { body: "one" } });
    expect(first.status).toBe(201);
    const second = await req("POST", `/api/live/${STREAM}/chat`, { user: VIEWER, body: { body: "two" } });
    expect(second.status).toBe(429);
    expect(second.json.code).toBe("RATE_LIMITED");
    expect(second.json.retryAfterMs).toBeGreaterThan(0);
    // A different chatter is not paced by someone else's posts.
    const other = await req("POST", `/api/live/${STREAM}/chat`, { user: STRANGER, body: { body: "mine" } });
    expect(other.status).toBe(201);
  });
});

describe("moderation", () => {
  it("the author can delete their own message; the body is gone from storage and reads", async () => {
    const id = seedMessage(STREAM, VIEWER, "oops", new Date());
    const sock = fakeSocket();
    liveChatHub.join(STREAM, sock as never);
    const { status } = await req("DELETE", `/api/live/${STREAM}/chat/${id}`, { user: VIEWER });
    expect(status).toBe(200);
    const stored = h.state.messages.find((m) => m.id === id);
    expect(stored?.deleted_at).toBeTruthy();
    expect(stored?.body).toBe("");
    const { json } = await req("GET", `/api/live/${STREAM}/chat`);
    expect(json.messages).toHaveLength(0);
    const events = sock.sent.map((s) => JSON.parse(s));
    expect(events).toContainEqual({ type: "message_deleted", messageId: id });
    liveChatHub.leave(STREAM, sock as never);
  });

  it("the stream owner can delete anyone's message", async () => {
    const id = seedMessage(STREAM, VIEWER, "rowdy", new Date());
    const { status } = await req("DELETE", `/api/live/${STREAM}/chat/${id}`, { user: OWNER });
    expect(status).toBe(200);
  });

  it("a stranger cannot delete someone else's message", async () => {
    const id = seedMessage(STREAM, VIEWER, "mine", new Date());
    const { status } = await req("DELETE", `/api/live/${STREAM}/chat/${id}`, { user: STRANGER });
    expect(status).toBe(403);
    const { json } = await req("GET", `/api/live/${STREAM}/chat`);
    expect(json.messages).toHaveLength(1);
  });

  it("deleting a message that doesn't exist 404s", async () => {
    const { status } = await req("DELETE", `/api/live/${STREAM}/chat/77777777-7777-4777-8777-777777777777`, {
      user: OWNER,
    });
    expect(status).toBe(404);
  });

  it("owner mutes a chatter: their posts 403 until unmuted; non-owners can't mute", async () => {
    const byStranger = await req("POST", `/api/live/${STREAM}/chat/mute`, {
      user: STRANGER,
      body: { userId: VIEWER },
    });
    expect(byStranger.status).toBe(403);

    const mute = await req("POST", `/api/live/${STREAM}/chat/mute`, { user: OWNER, body: { userId: VIEWER } });
    expect(mute.status).toBe(200);
    expect(mute.json.mutedUntil).toBeTruthy();

    const blocked = await req("POST", `/api/live/${STREAM}/chat`, { user: VIEWER, body: { body: "hello?" } });
    expect(blocked.status).toBe(403);
    expect(blocked.json.code).toBe("MUTED");

    const unmute = await req("DELETE", `/api/live/${STREAM}/chat/mute/${VIEWER}`, { user: OWNER });
    expect(unmute.status).toBe(200);
    const after = await req("POST", `/api/live/${STREAM}/chat`, { user: VIEWER, body: { body: "back again" } });
    expect(after.status).toBe(201);
  });

  it("the streamer cannot be muted in their own stream", async () => {
    const { status } = await req("POST", `/api/live/${STREAM}/chat/mute`, { user: OWNER, body: { userId: OWNER } });
    expect(status).toBe(400);
  });
});
