/**
 * Stack-30 D1 — scheduler release attribution (migration 0143).
 *
 * The DE-4 scheduler-from-release flow hands the composer a prefilled
 * announcement from the release itself; as of 0143 the release's id rides
 * the deep link and the created scheduled_posts row is stamped with it
 * (release_id), so release-driven posts stay attributable. Posts created
 * any other way must keep release_id NULL, and both read surfaces must
 * expose the stamp: the canonical camelCase DTO (releaseId) and the
 * legacy raw-row surface (release_id, verbatim passthrough).
 *
 * Driven against the REAL router with the same fake-db harness as
 * scheduler-merge-characterization.test.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, any>>,
  userId: "",
  userCredits: 100000,
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
  getOpenAI: vi.fn(() => { throw new Error("no ai in attribution tests"); }),
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
const ACCOUNT = randomUUID();
const RELEASE = randomUUID();
const future = () => new Date(Date.now() + 3_600_000).toISOString();

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
  vi.clearAllMocks();
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

const draftBody = {
  mediaUrl: "https://cdn.example.com/cover.jpg",
  mediaType: "image",
  caption: "announcing",
  platforms: ["instagram"],
  accountIds: { instagram: ACCOUNT },
};

describe("release attribution on create (0143)", () => {
  it("a create carrying releaseId stamps release_id on the row and returns it in the DTO", async () => {
    const { status, json } = await req("POST", "/scheduler/posts", { ...draftBody, releaseId: RELEASE });
    expect(status).toBe(201);
    expect(json.post.releaseId).toBe(RELEASE);
    expect(h.rows).toHaveLength(1);
    expect(h.rows[0]!["release_id"]).toBe(RELEASE);
  });

  it("a scheduled (paid) create from a release is stamped the same way", async () => {
    const { status, json } = await req("POST", "/scheduler/posts", {
      ...draftBody, releaseId: RELEASE, scheduledAt: future(),
    });
    expect(status).toBe(201);
    expect(json.post.status).toBe("scheduled");
    expect(json.post.releaseId).toBe(RELEASE);
    expect(h.rows[0]!["release_id"]).toBe(RELEASE);
  });

  it("a create without releaseId leaves release_id NULL — in the row and the DTO", async () => {
    const { status, json } = await req("POST", "/scheduler/posts", draftBody);
    expect(status).toBe(201);
    expect(json.post.releaseId).toBeNull();
    expect(h.rows[0]!["release_id"]).toBeNull();
  });

  it("a non-uuid releaseId is rejected (400) and writes no row", async () => {
    const { status } = await req("POST", "/scheduler/posts", { ...draftBody, releaseId: "not-a-release" });
    expect(status).toBe(400);
    expect(h.rows).toHaveLength(0);
  });
});

describe("release attribution on read", () => {
  it("the canonical list DTO exposes releaseId per post (stamped vs null)", async () => {
    await req("POST", "/scheduler/posts", { ...draftBody, releaseId: RELEASE });
    await req("POST", "/scheduler/posts", { ...draftBody, caption: "hand-typed" });
    const { status, json } = await req("GET", "/scheduler/posts");
    expect(status).toBe(200);
    const byCaption = new Map(json.posts.map((p: any) => [p.caption, p.releaseId]));
    expect(byCaption.get("announcing")).toBe(RELEASE);
    expect(byCaption.get("hand-typed")).toBeNull();
  });

  it("the legacy raw-row list passes release_id through verbatim", async () => {
    await req("POST", "/scheduler/posts", { ...draftBody, releaseId: RELEASE });
    const { status, json } = await req("GET", "/scheduled-posts");
    expect(status).toBe(200);
    expect(json.posts).toHaveLength(1);
    expect(json.posts[0].release_id).toBe(RELEASE);
  });
});
