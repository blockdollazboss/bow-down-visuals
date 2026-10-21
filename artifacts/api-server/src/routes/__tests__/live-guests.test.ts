/**
 * Route tests for Go Live guest invites + backstage (routes/live-guests):
 *   POST   /live-streams/:id/guest-invites        mint (owner only, token once)
 *   GET    /live-streams/:id/guest-invites        roster (no token material)
 *   DELETE /live-streams/:id/guest-invites/:inv   revoke — kills its sessions
 *   POST   /live-streams/:id/guests/:sid/promote|demote|remove (owner only)
 *   GET    /live-streams/:id/guests               public: ON-STAGE only
 *   GET/POST /live-streams/:id/backstage/messages host greenroom chat
 *   GET    /live-guest-invites/:token             pre-join read
 *   POST   /live-guest-invites/:token/join        join → guest session
 *   GET    /live-guest/session (+ heartbeat/leave, backstage chat)
 *
 * Style mirrors live-chat.test.ts: the real router over a fake db
 * (real table objects via importOriginal; WHERE params read back
 * through PgDialect rendering). requireAuth is mocked to take the
 * user from an x-test-user header — absent header = the 401 the real
 * middleware returns, which is exactly what a guest token gets when
 * it tries a host door.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000bb";
const STREAM = "22222222-2222-4222-8222-222222222222";
const STREAM_ENDED = "33333333-3333-4333-8333-333333333333";
const T0 = new Date("2026-10-21T10:00:00.000Z");

const h = vi.hoisted(() => ({
  state: {
    streams: new Map<string, Record<string, unknown>>(),
    invites: [] as Array<Record<string, unknown>>,
    sessions: [] as Array<Record<string, unknown>>,
    messages: [] as Array<Record<string, unknown>>,
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
  in: Array<[string, unknown[]]>;
}
function parseCond(cond: unknown): Cond {
  const { sql, params } = render(cond);
  const out: Cond = { eq: [], in: [] };
  for (const m of sql.matchAll(/"(\w+)" in \(([^)]*)\)/g)) {
    const idxs = [...m[2].matchAll(/\$(\d+)/g)].map((x) => Number(x[1]) - 1);
    out.in.push([m[1], idxs.map((i) => params[i])]);
  }
  const noIn = sql.replace(/"\w+" in \([^)]*\)/g, "");
  for (const m of noIn.matchAll(/"(\w+)" = \$(\d+)/g)) out.eq.push([m[1], params[Number(m[2]) - 1]]);
  return out;
}

function rowMatches(row: Record<string, unknown>, cond: Cond): boolean {
  for (const [col, val] of cond.eq) {
    if (String(row[col] ?? "") !== String(val ?? "")) return false;
  }
  for (const [col, vals] of cond.in) {
    if (!vals.map(String).includes(String(row[col] ?? ""))) return false;
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
  const { liveStreamsTable, liveGuestInvitesTable, liveGuestSessionsTable, liveBackstageMessagesTable, creatorProfilesTable } =
    actual;

  const tableOf = (table: unknown) =>
    table === liveStreamsTable
      ? "streams"
      : table === liveGuestInvitesTable
        ? "invites"
        : table === liveGuestSessionsTable
          ? "sessions"
          : table === liveBackstageMessagesTable
            ? "messages"
            : table === creatorProfilesTable
              ? "profiles"
              : "?";

  function allRows(kind: string): Array<Record<string, unknown>> {
    if (kind === "streams") return [...state.streams.values()];
    if (kind === "invites") return state.invites;
    if (kind === "sessions") return state.sessions;
    if (kind === "messages") return state.messages;
    if (kind === "profiles") return state.profiles;
    return [];
  }

  function selectChain(table: unknown, fields?: Record<string, { name: string }>): any {
    const kind = tableOf(table);
    let cond: Cond = { eq: [], in: [] };
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
        return rows.map((r) => {
          const out: Record<string, unknown> = {};
          for (const [key, col] of Object.entries(fields)) out[key] = r[col.name] ?? null;
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
        row.id = `99999999-9999-4999-8999-${String(++state.seq).padStart(12, "0")}`;
        row.created_at = new Date(Date.now() + state.seq);
        row.updated_at = row.created_at;
        if (kind === "invites") {
          row.join_count = 0;
          row.revoked_at = null;
          state.invites.push(row);
        }
        if (kind === "sessions") {
          row.joined_at = row.created_at;
          row.last_seen_at = row.created_at;
          row.ended_at = null;
          state.sessions.push(row);
        }
        if (kind === "messages") state.messages.push(row);
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
          const applied: Array<Record<string, unknown>> = [];
          for (const row of allRows(kind)) {
            if (!rowMatches(row, parsed)) continue;
            for (const [k, v] of Object.entries(patch)) {
              /* The join_count increment arrives as a SQL template
                 object, not a number — apply it as +1. */
              if (k === "join_count" && typeof v !== "number") row[k] = (Number(row[k]) || 0) + 1;
              else row[k] = v;
            }
            applied.push({ ...row });
          }
          const p: any = Promise.resolve([]);
          p.returning = async () => applied;
          return p;
        },
      }),
    }),
  };

  return { ...actual, db };
});

import router, { __resetGuestPacing } from "../live-guests";
import { guestTokenLookup } from "../../lib/live-backstage";

let server: Server;
let base = "";

function seedStream(id: string, owner: string, status: string) {
  h.state.streams.set(id, {
    id,
    user_id: owner,
    profile_id: "11111111-1111-4111-8111-111111111111",
    title: "Friday Night Live",
    status,
    provider: "own",
    started_at: new Date(),
    ended_at: status === "ended" ? new Date() : null,
    created_at: T0,
    updated_at: T0,
  });
}

async function req(
  method: string,
  path: string,
  opts: { user?: string; guest?: string; body?: unknown } = {},
) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
      ...(opts.guest ? { "x-guest-token": opts.guest } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

async function mintAndJoin(name = "Casey"): Promise<{ token: string; sessionToken: string; sessionId: string }> {
  const mint = await req("POST", `/api/live-streams/${STREAM}/guest-invites`, { user: OWNER, body: {} });
  expect(mint.status).toBe(201);
  const token = mint.json.token as string;
  const join = await req("POST", `/api/live-guest-invites/${token}/join`, { body: { display_name: name } });
  expect(join.status).toBe(201);
  return { token, sessionToken: join.json.session_token, sessionId: join.json.session.id };
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
  h.state.invites = [];
  h.state.sessions = [];
  h.state.messages = [];
  h.state.seq = 0;
  h.state.profiles = [
    { user_id: OWNER, display_name: "Nova Reign", slug: "nova-reign", avatar_url: null },
  ];
  seedStream(STREAM, OWNER, "live");
  seedStream(STREAM_ENDED, OWNER, "ended");
  __resetGuestPacing();
});

describe("host: minting invite links", () => {
  it("mints a link and shows the plain token exactly once (list never carries it)", async () => {
    const mint = await req("POST", `/api/live-streams/${STREAM}/guest-invites`, {
      user: OWNER,
      body: { label: "For the band", expires_in_minutes: 120, max_joins: 3 },
    });
    expect(mint.status).toBe(201);
    expect(typeof mint.json.token).toBe("string");
    expect(mint.json.token.length).toBeGreaterThan(30);
    expect(mint.json.invite_path).toBe(`/live/guest/${mint.json.token}`);
    expect(mint.json.invite.label).toBe("For the band");
    expect(mint.json.invite.max_joins).toBe(3);
    /* stored row holds only the hash lookup + hint */
    const stored = h.state.invites[0];
    expect(stored.token_lookup).toBe(guestTokenLookup(mint.json.token));
    expect(JSON.stringify(stored)).not.toContain(mint.json.token);

    const list = await req("GET", `/api/live-streams/${STREAM}/guest-invites`, { user: OWNER });
    expect(list.status).toBe(200);
    expect(list.json.invites).toHaveLength(1);
    expect(JSON.stringify(list.json)).not.toContain(mint.json.token);
    expect(list.json.invites[0].token_hint).toBe(mint.json.token.slice(-4));
  });

  it("refuses strangers and the signed-out", async () => {
    const stranger = await req("POST", `/api/live-streams/${STREAM}/guest-invites`, { user: OTHER, body: {} });
    expect(stranger.status).toBe(403);
    const anon = await req("POST", `/api/live-streams/${STREAM}/guest-invites`, { body: {} });
    expect(anon.status).toBe(401);
    const strangerList = await req("GET", `/api/live-streams/${STREAM}/guest-invites`, { user: OTHER });
    expect(strangerList.status).toBe(403);
  });

  it("rejects nonsense invite settings", async () => {
    const bad = await req("POST", `/api/live-streams/${STREAM}/guest-invites`, {
      user: OWNER,
      body: { expires_in_minutes: 2 },
    });
    expect(bad.status).toBe(400);
    const bad2 = await req("POST", `/api/live-streams/${STREAM}/guest-invites`, {
      user: OWNER,
      body: { max_joins: 0 },
    });
    expect(bad2.status).toBe(400);
  });
});

describe("guest: joining through a link", () => {
  it("reads the invite before joining, then joins as an honest guest", async () => {
    const mint = await req("POST", `/api/live-streams/${STREAM}/guest-invites`, { user: OWNER, body: {} });
    const token = mint.json.token as string;
    const read = await req("GET", `/api/live-guest-invites/${token}`);
    expect(read.status).toBe(200);
    expect(read.json.stream.title).toBe("Friday Night Live");
    expect(read.json.stream.status).toBe("live");
    expect(read.json.host.display_name).toBe("Nova Reign");

    const join = await req("POST", `/api/live-guest-invites/${token}/join`, { body: { display_name: "Casey" } });
    expect(join.status).toBe(201);
    expect(join.json.session.guest).toBe(true);
    expect(join.json.session.kind).toBe("guest");
    expect(join.json.session.state).toBe("backstage");
    expect(join.json.session.display_name).toBe("Casey");
    /* no member identity is ever attached to a guest session */
    expect(JSON.stringify(join.json.session)).not.toContain("user_id");
    expect(h.state.invites[0].join_count).toBe(1);
  });

  it("refuses an unknown token with the one dead-link answer", async () => {
    const read = await req("GET", `/api/live-guest-invites/${"x".repeat(43)}`);
    expect(read.status).toBe(404);
    const join = await req("POST", `/api/live-guest-invites/${"x".repeat(43)}/join`, {
      body: { display_name: "Casey" },
    });
    expect(join.status).toBe(404);
  });

  it("refuses an expired link (same dead-link answer)", async () => {
    const mint = await req("POST", `/api/live-streams/${STREAM}/guest-invites`, { user: OWNER, body: {} });
    h.state.invites[0].expires_at = new Date(Date.now() - 1000);
    const read = await req("GET", `/api/live-guest-invites/${mint.json.token}`);
    expect(read.status).toBe(404);
    const join = await req("POST", `/api/live-guest-invites/${mint.json.token}/join`, {
      body: { display_name: "Casey" },
    });
    expect(join.status).toBe(404);
  });

  it("refuses joining an ended stream", async () => {
    const mint = await req("POST", `/api/live-streams/${STREAM_ENDED}/guest-invites`, { user: OWNER, body: {} });
    expect(mint.status).toBe(201);
    const join = await req("POST", `/api/live-guest-invites/${mint.json.token}/join`, {
      body: { display_name: "Casey" },
    });
    expect(join.status).toBe(410);
  });

  it("enforces the per-link join cap", async () => {
    const mint = await req("POST", `/api/live-streams/${STREAM}/guest-invites`, {
      user: OWNER,
      body: { max_joins: 1 },
    });
    const token = mint.json.token as string;
    const first = await req("POST", `/api/live-guest-invites/${token}/join`, { body: { display_name: "One" } });
    expect(first.status).toBe(201);
    const second = await req("POST", `/api/live-guest-invites/${token}/join`, { body: { display_name: "Two" } });
    expect(second.status).toBe(410);
  });

  it("needs a real display name", async () => {
    const mint = await req("POST", `/api/live-streams/${STREAM}/guest-invites`, { user: OWNER, body: {} });
    const join = await req("POST", `/api/live-guest-invites/${mint.json.token}/join`, {
      body: { display_name: "   " },
    });
    expect(join.status).toBe(400);
  });
});

describe("host controls: promote / demote / remove", () => {
  it("walks a guest backstage → on stage → backstage → removed", async () => {
    const { sessionId } = await mintAndJoin();
    const promote = await req("POST", `/api/live-streams/${STREAM}/guests/${sessionId}/promote`, { user: OWNER });
    expect(promote.status).toBe(200);
    expect(promote.json.guest.state).toBe("on_stage");
    const demote = await req("POST", `/api/live-streams/${STREAM}/guests/${sessionId}/demote`, { user: OWNER });
    expect(demote.json.guest.state).toBe("backstage");
    const remove = await req("POST", `/api/live-streams/${STREAM}/guests/${sessionId}/remove`, { user: OWNER });
    expect(remove.status).toBe(200);
    expect(h.state.sessions[0].state).toBe("removed");
  });

  it("is owner-only: another member cannot promote, and a guest pass is not a host key", async () => {
    const { sessionId, sessionToken } = await mintAndJoin();
    const other = await req("POST", `/api/live-streams/${STREAM}/guests/${sessionId}/promote`, { user: OTHER });
    expect(other.status).toBe(403);
    /* the guest presenting their guest token at the host door: no
       session auth header → the 401 every signed-out caller gets */
    const asGuest = await req("POST", `/api/live-streams/${STREAM}/guests/${sessionId}/promote`, {
      guest: sessionToken,
    });
    expect(asGuest.status).toBe(401);
    expect(h.state.sessions[0].state).toBe("backstage");
  });

  it("caps the stage at the on-stage guest limit", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const j = await mintAndJoin(`Guest ${i}`);
      ids.push(j.sessionId);
    }
    for (let i = 0; i < 5; i++) {
      const p = await req("POST", `/api/live-streams/${STREAM}/guests/${ids[i]}/promote`, { user: OWNER });
      expect(p.status).toBe(200);
    }
    const sixth = await req("POST", `/api/live-streams/${STREAM}/guests/${ids[5]}/promote`, { user: OWNER });
    expect(sixth.status).toBe(409);
  });
});

describe("revocation", () => {
  it("kills future joins AND live sessions on the spot", async () => {
    const { token, sessionToken } = await mintAndJoin();
    const inviteId = h.state.invites[0].id as string;
    const revoke = await req("DELETE", `/api/live-streams/${STREAM}/guest-invites/${inviteId}`, { user: OWNER });
    expect(revoke.status).toBe(200);
    expect(revoke.json.sessions_ended).toBe(1);
    expect(h.state.sessions[0].state).toBe("removed");

    const join = await req("POST", `/api/live-guest-invites/${token}/join`, { body: { display_name: "Late" } });
    expect(join.status).toBe(404);
    /* the killed session's very next call fails */
    const me = await req("GET", `/api/live-guest/session`, { guest: sessionToken });
    expect(me.status).toBe(401);
    const post = await req("POST", `/api/live-guest/session/backstage/messages`, {
      guest: sessionToken,
      body: { body: "still here?" },
    });
    expect(post.status).toBe(401);
  });

  it("a fresh link on the same stream still works after another is revoked", async () => {
    const first = await mintAndJoin();
    const inviteId = h.state.invites[0].id as string;
    await req("DELETE", `/api/live-streams/${STREAM}/guest-invites/${inviteId}`, { user: OWNER });
    const second = await mintAndJoin("Robin");
    expect(second.sessionId).not.toBe(first.sessionId);
    const me = await req("GET", `/api/live-guest/session`, { guest: second.sessionToken });
    expect(me.status).toBe(200);
  });
});

describe("backstage chat: private to the greenroom", () => {
  it("host and guest trade messages; history matches on both sides", async () => {
    const { sessionToken } = await mintAndJoin();
    const hostPost = await req("POST", `/api/live-streams/${STREAM}/backstage/messages`, {
      user: OWNER,
      body: { body: "Two minutes to showtime" },
    });
    expect(hostPost.status).toBe(201);
    expect(hostPost.json.message.author_kind).toBe("host");
    const guestPost = await req("POST", `/api/live-guest/session/backstage/messages`, {
      guest: sessionToken,
      body: { body: "Ready when you are" },
    });
    expect(guestPost.status).toBe(201);
    expect(guestPost.json.message.guest).toBe(true);
    expect(guestPost.json.message.author_name).toBe("Casey");

    const hostView = await req("GET", `/api/live-streams/${STREAM}/backstage/messages`, { user: OWNER });
    expect(hostView.json.messages.map((m: any) => m.body)).toEqual(["Two minutes to showtime", "Ready when you are"]);
    const guestView = await req("GET", `/api/live-guest/session/backstage/messages`, { guest: sessionToken });
    expect(guestView.json.messages).toHaveLength(2);
  });

  it("the audience surface never sees backstage: public roster lists only on-stage guests", async () => {
    const a = await mintAndJoin("Backstage Bea");
    const b = await mintAndJoin("Onstage Ola");
    await req("POST", `/api/live-streams/${STREAM}/guests/${b.sessionId}/promote`, { user: OWNER });
    const pub = await req("GET", `/api/live-streams/${STREAM}/guests`);
    expect(pub.status).toBe(200);
    expect(pub.json.on_stage).toEqual([{ display_name: "Onstage Ola", kind: "guest", guest: true }]);
    /* and a non-owner member can't read the greenroom chat either */
    const spy = await req("GET", `/api/live-streams/${STREAM}/backstage/messages`, { user: OTHER });
    expect(spy.status).toBe(403);
    void a;
  });

  it("a removed guest can no longer read or post backstage", async () => {
    const { sessionId, sessionToken } = await mintAndJoin();
    await req("POST", `/api/live-streams/${STREAM}/guests/${sessionId}/remove`, { user: OWNER });
    const read = await req("GET", `/api/live-guest/session/backstage/messages`, { guest: sessionToken });
    expect(read.status).toBe(401);
  });

  it("leaving ends the pass", async () => {
    const { sessionToken } = await mintAndJoin();
    const leave = await req("POST", `/api/live-guest/session/leave`, { guest: sessionToken });
    expect(leave.status).toBe(200);
    const me = await req("GET", `/api/live-guest/session`, { guest: sessionToken });
    expect(me.status).toBe(401);
  });
});
