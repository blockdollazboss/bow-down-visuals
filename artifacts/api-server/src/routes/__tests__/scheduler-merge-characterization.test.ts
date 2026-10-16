/**
 * Stack 8 Item 1 — characterization tests for the TWO scheduler surfaces
 * as they behave TODAY (pre-merge), driven the way production drives them:
 * routes/index.ts mounts BOTH routers on the same app.
 *
 *   Canonical (routes/scheduler.ts):
 *     POST   /scheduler/posts        draft free / scheduled = 100 VB charge
 *     GET    /scheduler/posts        camelCase DTO list
 *     DELETE /scheduler/posts/:id    scheduled → canceled + refund
 *
 *   Legacy (routes/generate/scheduler.ts):
 *     POST   /schedule-post          FREE, {content, platform} payload,
 *                                    RAW snake_case row response
 *     GET    /scheduled-posts        raw rows
 *     DELETE /scheduled-posts/:id    sets status canceled (row kept),
 *                                    404 unknown, 409 when posted/publishing
 *
 * Fake-db style (mirrors challenges-dto.test.ts): both routers speak the
 * Drizzle query builder, which pg-mem cannot drive (rowMode) — the house
 * reason raw-SQL routes exist. The fake interprets eq()/and() conditions
 * by walking their queryChunks, so ownership/status filters are REAL.
 *
 * These tests must pass UNCHANGED after the merge, when the legacy routes
 * are served by the canonical router alone (generate/scheduler.ts becomes
 * a re-export shim and is no longer mounted separately).
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
      // StringChunk also carries .value (string[]) — only Param counts.
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
  getOpenAI: vi.fn(() => { throw new Error("no ai in characterization tests"); }),
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

import canonicalRouter from "../scheduler";
import legacyRouter from "../generate/scheduler";
import { chargeCredits, refundCredits } from "../../lib/credits";

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const USER = randomUUID();
const ACCOUNT = randomUUID();
const future = () => new Date(Date.now() + 3_600_000).toISOString();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {} }; next(); });
  app.use(canonicalRouter);
  app.use(legacyRouter); // production mounts both today; post-merge the shim re-exports the canonical router
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

describe("canonical /scheduler/posts surface", () => {
  it("draft (no scheduledAt) is free and returns the camelCase DTO", async () => {
    const { status, json } = await req("POST", "/scheduler/posts", {
      mediaUrl: "https://cdn.example/v.mp4", caption: "hi", platforms: ["instagram"], accountIds: { instagram: ACCOUNT },
    });
    expect(status).toBe(201);
    expect(json.post.status).toBe("draft");
    expect(json.post.mediaUrl).toBe("https://cdn.example/v.mp4");
    expect(json.post.creditsCharged).toBe(0);
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
  });

  it("scheduled post charges 100 VB up front; DELETE cancels + refunds", async () => {
    const { status, json } = await req("POST", "/scheduler/posts", {
      mediaUrl: "https://cdn.example/v.mp4", caption: "hi", platforms: ["instagram"],
      accountIds: { instagram: ACCOUNT }, scheduledAt: future(),
    });
    expect(status).toBe(201);
    expect(json.post.status).toBe("scheduled");
    expect(json.post.creditsCharged).toBe(100);
    expect(vi.mocked(chargeCredits)).toHaveBeenCalledTimes(1);

    const del = await req("DELETE", `/scheduler/posts/${json.post.id}`);
    expect(del.status).toBe(200);
    expect(del.json).toEqual({ canceled: true, refunded: 100 });
    expect(vi.mocked(refundCredits)).toHaveBeenCalledTimes(1);
  });

  it("requires an account per platform (400 account_required)", async () => {
    const { status, json } = await req("POST", "/scheduler/posts", {
      mediaUrl: "https://cdn.example/v.mp4", platforms: ["tiktok"], accountIds: {},
    });
    expect(status).toBe(400);
    expect(json.error).toBe("account_required");
  });

  it("GET list returns DTO posts (camelCase, no snake_case leak)", async () => {
    await req("POST", "/scheduler/posts", {
      mediaUrl: "https://cdn.example/v.mp4", platforms: ["instagram"], accountIds: { instagram: ACCOUNT },
    });
    const { status, json } = await req("GET", "/scheduler/posts");
    expect(status).toBe(200);
    expect(json.posts).toHaveLength(1);
    expect(json.posts[0].media_url).toBeUndefined();
    expect(json.posts[0].mediaUrl).toBe("https://cdn.example/v.mp4");
  });
});

describe("legacy /schedule-post surface (generate/scheduler)", () => {
  it("POST /schedule-post is FREE, takes {content, platform}, returns the raw row", async () => {
    const { status, json } = await req("POST", "/schedule-post", {
      content: "legacy caption", mediaUrl: "https://cdn.example/a.mp4",
      platform: "tiktok", scheduledAt: future(),
    });
    expect(status).toBe(201);
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
    expect(json.post.caption).toBe("legacy caption");
    expect(json.post.platforms).toEqual(["tiktok"]);
    expect(json.post.status).toBe("scheduled");
    expect(json.post.user_id).toBe(USER);
  });

  it("POST /schedule-post rejects a past scheduledAt with 400 + details", async () => {
    const { status, json } = await req("POST", "/schedule-post", {
      content: "x", mediaUrl: "https://cdn.example/a.mp4", platform: "tiktok",
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(status).toBe(400);
    expect(json.error).toBe("Invalid request.");
    expect(Array.isArray(json.details)).toBe(true);
  });

  it("GET /scheduled-posts lists raw rows; DELETE /scheduled-posts/:id cancels (row kept)", async () => {
    const created = await req("POST", "/schedule-post", {
      content: "c", mediaUrl: "https://cdn.example/a.mp4", platform: "instagram", scheduledAt: future(),
    });
    const id = created.json.post.id;
    const list = await req("GET", "/scheduled-posts");
    expect(list.status).toBe(200);
    expect(list.json.posts).toHaveLength(1);

    const del = await req("DELETE", `/scheduled-posts/${id}`);
    expect(del.status).toBe(200);
    expect(del.json.post.status).toBe("canceled");

    const missing = await req("DELETE", `/scheduled-posts/${randomUUID()}`);
    expect(missing.status).toBe(404);
  });

  it("both surfaces write the SAME table: a legacy post appears in the canonical list", async () => {
    await req("POST", "/schedule-post", {
      content: "shared", mediaUrl: "https://cdn.example/a.mp4", platform: "facebook", scheduledAt: future(),
    });
    const { json } = await req("GET", "/scheduler/posts");
    expect(json.posts).toHaveLength(1);
    expect(json.posts[0].caption).toBe("shared");
    expect(json.posts[0].status).toBe("scheduled");
  });
});
