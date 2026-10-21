/**
 * Widget data tests (routes/live-widgets):
 * GET /live/:id/widgets — latest follower, recent tips, goal progress
 * from real rows; honest nulls/empties when there is no data.
 * POST /live/:id/tip-goal — owner-only goal set/clear.
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
const PROFILE = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  streams: new Map<string, Record<string, unknown>>(),
  tips: [] as Array<Record<string, unknown>>,
  follows: [] as Array<Record<string, unknown>>,
  profiles: [] as Array<Record<string, unknown>>,
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
  for (const m of sql.matchAll(/"(\w+)" = \$(\d+)/g)) out.eq.push([m[1], params[Number(m[2]) - 1]]);
  for (const m of sql.matchAll(/"(\w+)" in \(([^)]+)\)/g)) {
    const idxs = m[2].split(",").map((s) => Number(s.trim().replace("$", "")) - 1);
    out.in.push([m[1], idxs.map((i) => params[i])]);
  }
  return out;
}
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
function rowVal(row: Record<string, unknown>, col: string): unknown {
  return row[col] ?? row[camel(col)];
}
function rowMatches(row: Record<string, unknown>, cond: Cond): boolean {
  for (const [col, val] of cond.eq) if (String(rowVal(row, col) ?? "") !== String(val ?? "")) return false;
  for (const [col, vals] of cond.in) if (!vals.some((v) => String(v) === String(rowVal(row, col) ?? ""))) return false;
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

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const T = actual;
  const tableOf = (t: unknown) =>
    t === T.liveStreamsTable
      ? "streams"
      : t === T.liveStreamTipsTable
        ? "tips"
        : t === T.followsTable
          ? "follows"
          : t === T.creatorProfilesTable
            ? "profiles"
            : "?";
  const allRows = (kind: string): Array<Record<string, unknown>> =>
    kind === "streams" ? [...h.streams.values()] : kind === "tips" ? h.tips : kind === "follows" ? h.follows : kind === "profiles" ? h.profiles : [];

  const db = {
    select: (fields?: Record<string, { name: string }>) => ({
      from: (table: unknown) => {
        const kind = tableOf(table);
        let cond: Cond = { eq: [], in: [] };
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
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async (cond: unknown) => {
          const parsed = parseCond(cond);
          const kind = tableOf(table);
          for (const row of allRows(kind)) if (rowMatches(row, parsed)) Object.assign(row, patch);
          return [];
        },
      }),
    }),
  };
  return { ...actual, db };
});

import router from "../live-widgets";

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
  h.tips = [];
  h.follows = [];
  h.profiles = [
    { userId: OWNER, slug: "king", displayName: "King Live", avatarUrl: null },
    { userId: FAN, slug: "fan-one", displayName: "Fan One", avatarUrl: null },
    { userId: FAN2, slug: "fan-two", displayName: "Fan Two", avatarUrl: null },
  ];
  h.streams.set(STREAM, {
    id: STREAM,
    user_id: OWNER,
    profile_id: PROFILE,
    title: "Friday Night Live",
    status: "live",
    provider: "own-server",
    tip_goal_vb: 5000,
    started_at: new Date(),
    ended_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  });
});

describe("GET /live/:id/widgets", () => {
  it("returns honest empties when nothing has happened", async () => {
    const { status, json } = await req("GET", `/api/live/${STREAM}/widgets`);
    expect(status).toBe(200);
    expect(json.latestFollower).toBeNull();
    expect(json.recentTips).toEqual([]);
    expect(json.goal).toEqual({ goalVb: 5000, totalVb: 0, tipCount: 0 });
  });

  it("returns the latest follower, recent tips, and goal progress from real rows", async () => {
    h.follows = [
      { followerUserId: FAN, profileId: PROFILE, createdAt: new Date("2026-10-16T09:00:00Z") },
      { followerUserId: FAN2, profileId: PROFILE, createdAt: new Date("2026-10-16T10:00:00Z") },
    ];
    h.tips = [
      { id: "t1", stream_id: STREAM, tipper_user_id: FAN, creator_user_id: OWNER, amount_vb: 1000, created_at: new Date("2026-10-16T10:01:00Z") },
      { id: "t2", stream_id: STREAM, tipper_user_id: FAN2, creator_user_id: OWNER, amount_vb: 500, created_at: new Date("2026-10-16T10:02:00Z") },
    ];
    const { json } = await req("GET", `/api/live/${STREAM}/widgets`);
    expect(json.latestFollower).toMatchObject({ displayName: "Fan Two", slug: "fan-two" });
    expect(json.recentTips).toHaveLength(2);
    expect(json.recentTips[0]).toMatchObject({ tipperName: "Fan Two", amountVb: 500 });
    expect(json.goal).toEqual({ goalVb: 5000, totalVb: 1500, tipCount: 2 });
  });

  it("404s for a stream that doesn't exist", async () => {
    expect((await req("GET", "/api/live/99999999-9999-4999-8999-999999999999/widgets")).status).toBe(404);
  });
});

describe("POST /live/:id/tip-goal", () => {
  it("the owner sets and clears the goal", async () => {
    const set = await req("POST", `/api/live/${STREAM}/tip-goal`, { user: OWNER, body: { goalVb: 2500 } });
    expect(set.status).toBe(200);
    expect(h.streams.get(STREAM)?.tip_goal_vb).toBe(2500);
    const cleared = await req("POST", `/api/live/${STREAM}/tip-goal`, { user: OWNER, body: { goalVb: null } });
    expect(cleared.json.goalVb).toBeNull();
    expect(h.streams.get(STREAM)?.tip_goal_vb).toBeNull();
  });

  it("a non-owner can't set the goal", async () => {
    const { status } = await req("POST", `/api/live/${STREAM}/tip-goal`, { user: FAN, body: { goalVb: 100 } });
    expect(status).toBe(403);
    expect(h.streams.get(STREAM)?.tip_goal_vb).toBe(5000);
  });
});
