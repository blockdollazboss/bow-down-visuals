/**
 * Post-stream summary tests (routes/live-summary): every figure is
 * computed from seeded real rows — samples, chat, tips, follows in
 * the stream window — and the average is honestly null (not the
 * peak) when no samples exist. Owner-only.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const FAN = "00000000-0000-4000-8000-0000000000bb";
const STREAM = "22222222-2222-4222-8222-222222222222";
const PROFILE = "11111111-1111-4111-8111-111111111111";
const START = new Date("2026-10-16T10:00:00.000Z");
const END = new Date("2026-10-16T11:30:00.000Z");

const h = vi.hoisted(() => ({
  streams: new Map<string, Record<string, unknown>>(),
  samples: [] as Array<Record<string, unknown>>,
  messages: [] as Array<Record<string, unknown>>,
  tips: [] as Array<Record<string, unknown>>,
  follows: [] as Array<Record<string, unknown>>,
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

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const T = actual;
  const tableOf = (t: unknown) =>
    t === T.liveStreamsTable
      ? "streams"
      : t === T.liveViewerSamplesTable
        ? "samples"
        : t === T.liveChatMessagesTable
          ? "messages"
          : t === T.liveStreamTipsTable
            ? "tips"
            : t === T.followsTable
              ? "follows"
              : "?";
  const allRows = (kind: string): Array<Record<string, unknown>> =>
    kind === "streams"
      ? [...h.streams.values()]
      : kind === "samples"
        ? h.samples
        : kind === "messages"
          ? h.messages
          : kind === "tips"
            ? h.tips
            : kind === "follows"
              ? h.follows
              : [];
  const db = {
    select: (fields?: Record<string, { name: string }>) => ({
      from: (table: unknown) => {
        const kind = tableOf(table);
        let cond: Cond = { eq: [], isNull: [] };
        let limitN: number | null = null;
        const run = () => {
          let rows = allRows(kind).filter((r) => rowMatches(r, cond));
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
          limit: (n: number) => {
            limitN = n;
            return self;
          },
          then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
        };
        return self;
      },
    }),
  };
  return { ...actual, db };
});

import router from "../live-summary";

let server: Server;
let base = "";
async function req(method: string, path: string, opts: { user?: string } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(opts.user ? { "x-test-user": opts.user } : {}) },
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
  h.samples = [];
  h.messages = [];
  h.tips = [];
  h.follows = [];
  h.streams.set(STREAM, {
    id: STREAM,
    user_id: OWNER,
    profile_id: PROFILE,
    title: "Friday Night Live",
    status: "ended",
    provider: "own-server",
    peak_viewers: 42,
    started_at: START,
    ended_at: END,
    created_at: START,
    updated_at: END,
  });
});

describe("GET /live/:id/summary", () => {
  it("computes every figure from the real rows", async () => {
    h.samples = [
      { stream_id: STREAM, viewer_count: 10, sampled_at: START },
      { stream_id: STREAM, viewer_count: 20, sampled_at: START },
      { stream_id: STREAM, viewer_count: 42, sampled_at: START },
    ];
    h.messages = [
      { id: "m1", stream_id: STREAM, user_id: FAN, body: "a", deleted_at: null },
      { id: "m2", stream_id: STREAM, user_id: FAN, body: "b", deleted_at: null },
      { id: "m3", stream_id: STREAM, user_id: FAN, body: "", deleted_at: new Date() }, // soft-deleted: not counted
    ];
    h.tips = [
      { stream_id: STREAM, amount_vb: 1000 },
      { stream_id: STREAM, amount_vb: 500 },
    ];
    h.follows = [
      { followerUserId: FAN, profileId: PROFILE, createdAt: new Date("2026-10-15T10:00:00Z") }, // before: no
      { followerUserId: FAN, profileId: PROFILE, createdAt: new Date("2026-10-16T10:30:00Z") }, // during: yes
      { followerUserId: FAN, profileId: PROFILE, createdAt: new Date("2026-10-16T12:00:00Z") }, // after: no
      { followerUserId: FAN, profileId: "99999999-9999-4999-8999-999999999999", createdAt: new Date("2026-10-16T10:30:00Z") }, // other channel: no
    ];
    const { status, json } = await req("GET", `/api/live/${STREAM}/summary`, { user: OWNER });
    expect(status).toBe(200);
    expect(json.summary).toEqual({
      streamId: STREAM,
      title: "Friday Night Live",
      status: "ended",
      startedAt: START.toISOString(),
      endedAt: END.toISOString(),
      durationSec: 5400,
      peakViewers: 42,
      averageViewers: 24,
      viewerSampleCount: 3,
      chatMessageCount: 2,
      tipsTotalVb: 1500,
      tipCount: 2,
      newFollowers: 1,
    });
  });

  it("with no samples the average is honestly null — never the peak in disguise", async () => {
    const { json } = await req("GET", `/api/live/${STREAM}/summary`, { user: OWNER });
    expect(json.summary.averageViewers).toBeNull();
    expect(json.summary.viewerSampleCount).toBe(0);
    expect(json.summary.peakViewers).toBe(42);
    expect(json.summary.chatMessageCount).toBe(0);
    expect(json.summary.tipsTotalVb).toBe(0);
    expect(json.summary.newFollowers).toBe(0);
  });

  it("only the streamer sees the summary", async () => {
    expect((await req("GET", `/api/live/${STREAM}/summary`, { user: FAN })).status).toBe(403);
    expect((await req("GET", `/api/live/${STREAM}/summary`)).status).toBe(401);
    expect((await req("GET", "/api/live/99999999-9999-4999-8999-999999999999/summary", { user: OWNER })).status).toBe(404);
  });
});
