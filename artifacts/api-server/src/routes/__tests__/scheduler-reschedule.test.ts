/**
 * Stack-3 scheduler calendar depth — the drag-to-reschedule write path.
 *
 * The month grid's drag persists through PATCH /api/scheduler/posts/:id
 * (the composer's datetime edit rides the same path; this harness
 * mounts the router at root, so test paths omit the /api prefix).
 * These tests drive
 * the REAL router against the house fake-db harness (same shape as
 * scheduler-release-attribution.test.ts) and pin the reschedule
 * contract the optimistic UI depends on:
 *   - an owner can move a scheduled post to a new future time;
 *   - the path is owner-scoped (a stranger's PATCH is a 404);
 *   - past times are refused per the existing rule (≥60s in the
 *     future, 400 bad_time) and a posted post can't move (409);
 *   - EVERY refused or failed write leaves the original time in
 *     place — including a database write that throws mid-flight
 *     (500 update_failed, row untouched), which is exactly the case
 *     the calendar's optimistic rollback mirrors.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, any>>,
  userId: "",
  userCredits: 100000,
  failUpdate: false,
}));

/** Walk a drizzle condition's queryChunks collecting column = param pairs. */
function collectEq(node: any, out: Record<string, unknown>): void {
  if (!node || typeof node !== "object") return;
  const chunks: any[] = Array.isArray(node.queryChunks) ? node.queryChunks : [];
  let pendingCol: string | null = null;
  for (const ch of chunks) {
    if (ch && typeof ch === "object") {
      if (typeof ch.name === "string" && ch.table) { pendingCol = ch.name; continue; }
      if (ch.constructor?.name === "Param" && pendingCol) { out[pendingCol] = ch.value; pendingCol = null; continue; }
      if (Array.isArray(ch.queryChunks)) collectEq(ch, out);
      if (Array.isArray(ch.value)) for (const v of ch.value) collectEq(v, out);
    }
  }
}
function matches(row: Record<string, any>, cond: any): boolean {
  const eqs: Record<string, unknown> = {};
  collectEq(cond, eqs);
  return Object.entries(eqs).every(([k, v]) => String(row[k]) === String(v));
}
function fakeDb() {
  return {
    select: (fields?: Record<string, any>) => ({
      from: (_table: any) => {
        let cond: any = null; let lim: number | null = null;
        const run = () => {
          let rows = cond ? h.rows.filter((r) => matches(r, cond)) : [...h.rows];
          if (lim !== null) rows = rows.slice(0, lim);
          if (fields) rows = rows.map((r) => Object.fromEntries(Object.keys(fields).map((k) => [k, r[k]])));
          return rows;
        };
        const chain: any = {
          where: (c: any) => { cond = c; return chain; },
          orderBy: (..._a: any[]) => chain,
          limit: async (n: number) => { lim = n; return run(); },
          then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
        };
        return chain;
      },
    }),
    insert: (_table: any) => ({
      values: (v: Record<string, any>) => ({
        returning: async () => {
          const row = {
            attempts: 0, last_error: null, credits_refunded: false, ai_best_time: null,
            results: [], posted_at: null, scheduled_at: null,
            ...v,
            id: v.id ?? randomUUID(),
            created_at: new Date(), updated_at: new Date(),
          };
          h.rows.push(row);
          return [row];
        },
      }),
    }),
    update: (_table: any) => ({
      set: (patch: Record<string, any>) => ({
        where: (cond: any) => ({
          returning: async () => {
            if (h.failUpdate) throw new Error("simulated write failure");
            const hit = h.rows.filter((r) => matches(r, cond));
            for (const r of hit) Object.assign(r, patch);
            return hit;
          },
          then: (res: any, rej: any) => {
            const hit = h.rows.filter((r) => matches(r, cond));
            for (const r of hit) Object.assign(r, patch);
            return Promise.resolve(hit).then(res, rej);
          },
        }),
      }),
    }),
    delete: (_table: any) => ({
      where: async (cond: any) => { h.rows = h.rows.filter((r) => !matches(r, cond)); },
    }),
  };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userCredits = h.userCredits;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, db: fakeDb() };
});

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async (_u: string, cost: number) => { h.userCredits -= cost; return h.userCredits; }),
  refundCredits: vi.fn(async (_u: string, cost: number) => { h.userCredits += cost; return h.userCredits; }),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(() => { throw new Error("no ai in reschedule tests"); }),
  getTextModel: vi.fn(() => "gpt-6-sol"),
}));

vi.mock("../../lib/job-poller", () => ({ requestPollerTick: vi.fn() }));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v ?? null),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: vi.fn(async (v: string) => v),
  refreshSupabaseStorageUrlsDeep: vi.fn(async (x: any) => x),
}));

import schedulerRouter from "../scheduler";

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const USER = randomUUID();
const STRANGER = randomUUID();
const ACCOUNT = randomUUID();
const DAY = 24 * 3600_000;

function seedScheduled(over: Record<string, any> = {}) {
  const row = {
    id: randomUUID(),
    user_id: USER,
    status: "scheduled",
    media_url: "https://cdn.example.com/clip.mp4",
    media_type: "video",
    caption: "drop day",
    hashtags: "",
    platforms: ["instagram"],
    account_ids: { instagram: ACCOUNT },
    scheduled_at: new Date(Date.now() + DAY),
    posted_at: null,
    attempts: 0,
    last_error: null,
    credits_charged: 100,
    credits_refunded: false,
    release_id: null,
    ai_best_time: null,
    results: [],
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  };
  h.rows.push(row);
  return row;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {} }; next(); });
  app.use(schedulerRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(() => {
  h.rows = [];
  h.userId = USER;
  h.userCredits = 100000;
  h.failUpdate = false;
  vi.clearAllMocks();
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("PATCH /api/scheduler/posts/:id — reschedule (the drag's write path)", () => {
  it("moves an owner's scheduled post to the new time", async () => {
    const row = seedScheduled();
    const target = new Date(Date.now() + 3 * DAY).toISOString();
    const r = await req("PATCH", `/scheduler/posts/${row.id}`, { scheduledAt: target });
    expect(r.status).toBe(200);
    expect(r.json.post.scheduledAt).toBe(target);
    expect(new Date(row.scheduled_at).toISOString()).toBe(target);
    expect(row.status).toBe("scheduled");
  });

  it("is owner-scoped: a stranger's reschedule is a 404 and the time doesn't move", async () => {
    const row = seedScheduled();
    const original = new Date(row.scheduled_at).toISOString();
    h.userId = STRANGER;
    const r = await req("PATCH", `/scheduler/posts/${row.id}`, {
      scheduledAt: new Date(Date.now() + 3 * DAY).toISOString(),
    });
    expect(r.status).toBe(404);
    expect(new Date(row.scheduled_at).toISOString()).toBe(original);
  });

  it("refuses a past time per the existing 60-second rule and keeps the original", async () => {
    const row = seedScheduled();
    const original = new Date(row.scheduled_at).toISOString();
    const tooSoon = await req("PATCH", `/scheduler/posts/${row.id}`, {
      scheduledAt: new Date(Date.now() + 30_000).toISOString(),
    });
    expect(tooSoon.status).toBe(400);
    expect(tooSoon.json.error).toBe("bad_time");
    const past = await req("PATCH", `/scheduler/posts/${row.id}`, {
      scheduledAt: new Date(Date.now() - DAY).toISOString(),
    });
    expect(past.status).toBe(400);
    expect(new Date(row.scheduled_at).toISOString()).toBe(original);
  });

  it("refuses to move a posted post (409) and keeps the original time", async () => {
    const row = seedScheduled({ status: "posted", posted_at: new Date() });
    const original = new Date(row.scheduled_at).toISOString();
    const r = await req("PATCH", `/scheduler/posts/${row.id}`, {
      scheduledAt: new Date(Date.now() + 3 * DAY).toISOString(),
    });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("not_editable");
    expect(new Date(row.scheduled_at).toISOString()).toBe(original);
  });

  it("a failed database write returns 500 and leaves the original time in place", async () => {
    const row = seedScheduled();
    const original = new Date(row.scheduled_at).toISOString();
    h.failUpdate = true;
    const r = await req("PATCH", `/scheduler/posts/${row.id}`, {
      scheduledAt: new Date(Date.now() + 3 * DAY).toISOString(),
    });
    expect(r.status).toBe(500);
    expect(r.json.error).toBe("update_failed");
    expect(new Date(row.scheduled_at).toISOString()).toBe(original);
  });

  it("rejects a malformed scheduledAt at the schema gate, time untouched", async () => {
    const row = seedScheduled();
    const original = new Date(row.scheduled_at).toISOString();
    const r = await req("PATCH", `/scheduler/posts/${row.id}`, { scheduledAt: "next Tuesday-ish" });
    expect(r.status).toBe(400);
    expect(new Date(row.scheduled_at).toISOString()).toBe(original);
  });

  it("the same path schedules a draft (charges the reservation, status flips)", async () => {
    const row = seedScheduled({ status: "draft", scheduled_at: null, credits_charged: 0 });
    const target = new Date(Date.now() + 2 * DAY).toISOString();
    const before = h.userCredits;
    const r = await req("PATCH", `/scheduler/posts/${row.id}`, { scheduledAt: target });
    expect(r.status).toBe(200);
    expect(r.json.post.status).toBe("scheduled");
    expect(r.json.post.scheduledAt).toBe(target);
    expect(h.userCredits).toBeLessThan(before);
  });
});
