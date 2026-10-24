/**
 * Provenance in Publish/Scheduler (Stack-100 #3, wave 3) — HTTP pins over
 * the REAL scheduler router with a per-table fake db:
 *  - creating a post from a library asset stamps the provenance snapshot
 *    (record id + tool/model + licence + disclosure line) on the row;
 *  - the DTO hands the publish UI the record summary + the honest
 *    per-platform disclosure plan BEFORE the post fires;
 *  - the linkage is what was stamped at schedule time — it reads back
 *    identical after scheduling (it rides the row, never re-derived);
 *  - another creator's asset, or a malformed id, is a 400 with NO row
 *    written and NO credits charged;
 *  - PATCH can relink or clear; the legacy surface stamps it too.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  stores: new Map<any, Array<Record<string, any>>>(),
  userId: "",
  userCredits: 100000,
}));

function store(table: any): Array<Record<string, any>> {
  let s = h.stores.get(table);
  if (!s) { s = []; h.stores.set(table, s); }
  return s;
}

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
      from: (table: any) => {
        let cond: any = null; let lim: number | null = null;
        const run = () => {
          let rows = cond ? store(table).filter((r) => matches(r, cond)) : [...store(table)];
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
    insert: (table: any) => ({
      values: (v: Record<string, any>) => ({
        returning: async () => {
          const row = {
            attempts: 0, last_error: null, credits_refunded: false, ai_best_time: null,
            results: [], posted_at: null, scheduled_at: null, provenance: null,
            ...v,
            id: v.id ?? randomUUID(),
            created_at: new Date(), updated_at: new Date(),
          };
          store(table).push(row);
          return [row];
        },
      }),
    }),
    update: (table: any) => ({
      set: (patch: Record<string, any>) => ({
        where: (cond: any) => ({
          returning: async () => {
            const hit = store(table).filter((r) => matches(r, cond));
            for (const r of hit) Object.assign(r, patch);
            return hit;
          },
          then: (res: any, rej: any) => {
            const hit = store(table).filter((r) => matches(r, cond));
            for (const r of hit) Object.assign(r, patch);
            return Promise.resolve(hit).then(res, rej);
          },
        }),
      }),
    }),
    delete: (table: any) => ({
      where: async (cond: any) => {
        h.stores.set(table, store(table).filter((r) => !matches(r, cond)));
      },
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
  getOpenAI: vi.fn(() => { throw new Error("no ai in provenance tests"); }),
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
import { chargeCredits } from "../../lib/credits";
import {
  scheduledPostsTable,
  generationHistoryTable,
  hubProjectsTable,
  creatorProfilesTable,
} from "@workspace/db";

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const USER = randomUUID();
const OTHER = randomUUID();
const ACCOUNT = randomUUID();
const GEN_ID = randomUUID();
const OTHER_GEN_ID = randomUUID();
const future = () => new Date(Date.now() + 3_600_000).toISOString();

function seedLibrary() {
  /* Rows carry BOTH the drizzle property names (what route code reads)
     and the raw column names (what the fake's eq-matcher keys off) —
     generation_history/creator_profiles use camelCase properties over
     snake_case columns, unlike scheduled_posts where they coincide. */
  store(generationHistoryTable).push({
    id: GEN_ID, userId: USER, user_id: USER, generationType: "runway_video_clip", generation_type: "runway_video_clip",
    prompt: "a shark in a crown",
    result: { videoUrl: "https://cdn.example.com/shark.mp4" },
    creditsUsed: 4, credits_used: 4, saveStatus: "saved", save_status: "saved",
    createdAt: new Date("2026-10-20T00:00:00.000Z"), created_at: new Date("2026-10-20T00:00:00.000Z"),
  });
  store(generationHistoryTable).push({
    id: OTHER_GEN_ID, userId: OTHER, user_id: OTHER, generationType: "runway_video_clip", generation_type: "runway_video_clip",
    prompt: "someone else's",
    result: { videoUrl: "https://cdn.example.com/other.mp4" },
    creditsUsed: 4, credits_used: 4, saveStatus: "saved", save_status: "saved",
    createdAt: new Date("2026-10-20T00:00:00.000Z"), created_at: new Date("2026-10-20T00:00:00.000Z"),
  });
  store(hubProjectsTable).push({
    id: randomUUID(), user_id: USER, updated_at: new Date(),
    assets: [{
      id: "entry-9", kind: "video", url: "https://cdn.example.com/hub.mp4",
      label: "Hub clip", detail: null, createdAt: Date.parse("2026-10-21T00:00:00.000Z"),
    }],
  });
  store(creatorProfilesTable).push({ userId: USER, user_id: USER, displayName: "TRGDY", display_name: "TRGDY" });
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
  h.stores.clear();
  h.userId = USER;
  h.userCredits = 100000;
  vi.clearAllMocks();
  seedLibrary();
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

const body = {
  mediaUrl: "https://cdn.example.com/shark.mp4",
  mediaType: "video",
  caption: "New drop",
  platforms: ["instagram", "tiktok"],
  accountIds: { instagram: ACCOUNT, tiktok: ACCOUNT },
};

describe("provenance linkage on create", () => {
  it("stamps the record snapshot on the row and returns summary + disclosure plan in the DTO", async () => {
    const { status, json } = await req("POST", "/scheduler/posts", { ...body, provenanceAssetId: `gen:${GEN_ID}` });
    expect(status).toBe(201);
    const rows = store(scheduledPostsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]!["provenance"]).toMatchObject({
      assetId: `gen:${GEN_ID}`,
      tool: "AI Video Clip",
      model: "Runway",
      aiGenerated: true,
      licence: "all-rights-reserved",
    });
    expect(rows[0]!["provenance"].disclosureLine).toContain("created with AI assistance");
    expect(json.post.provenance.assetId).toBe(`gen:${GEN_ID}`);
    /* The pre-publish plan is honest per platform. */
    expect(json.post.disclosure).toEqual({ instagram: "caption", tiktok: "record_only" });
  });

  it("linkage survives scheduling: a paid scheduled create reads back the identical stamped snapshot", async () => {
    const { status, json } = await req("POST", "/scheduler/posts", {
      ...body, provenanceAssetId: `gen:${GEN_ID}`, scheduledAt: future(),
    });
    expect(status).toBe(201);
    expect(json.post.status).toBe("scheduled");
    const stamped = store(scheduledPostsTable)[0]!["provenance"];
    const list = await req("GET", "/scheduler/posts");
    expect(list.json.posts[0].provenance).toEqual(stamped);
    expect(list.json.posts[0].disclosure).toEqual({ instagram: "caption", tiktok: "record_only" });
  });

  it("a hub asset links with its own record (no AI generation → not_applicable plan)", async () => {
    const { status, json } = await req("POST", "/scheduler/posts", { ...body, provenanceAssetId: "hub:entry-9" });
    expect(status).toBe(201);
    expect(json.post.provenance).toMatchObject({ assetId: "hub:entry-9", aiGenerated: false, disclosureLine: "" });
    expect(json.post.disclosure).toEqual({ instagram: "not_applicable", tiktok: "not_applicable" });
  });

  it("no asset id → provenance stays null and nothing claims a disclosure", async () => {
    const { status, json } = await req("POST", "/scheduler/posts", body);
    expect(status).toBe(201);
    expect(json.post.provenance).toBeNull();
    expect(json.post.disclosure).toEqual({ instagram: "not_applicable", tiktok: "not_applicable" });
    expect(store(scheduledPostsTable)[0]!["provenance"]).toBeNull();
  });

  it("another creator's asset is a 400 — no row, no charge", async () => {
    const { status, json } = await req("POST", "/scheduler/posts", {
      ...body, provenanceAssetId: `gen:${OTHER_GEN_ID}`, scheduledAt: future(),
    });
    expect(status).toBe(400);
    expect(json.error).toBe("provenance_not_found");
    expect(store(scheduledPostsTable)).toHaveLength(0);
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
  });

  it("a malformed asset id is a 400 — no row, no charge", async () => {
    const { status, json } = await req("POST", "/scheduler/posts", {
      ...body, provenanceAssetId: "https://cdn.example.com/shark.mp4", scheduledAt: future(),
    });
    expect(status).toBe(400);
    expect(json.error).toBe("invalid_provenance");
    expect(store(scheduledPostsTable)).toHaveLength(0);
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
  });
});

describe("provenance linkage on PATCH", () => {
  it("relink stamps a snapshot; explicit null clears it", async () => {
    const created = await req("POST", "/scheduler/posts", body);
    const id = created.json.post.id;
    const linked = await req("PATCH", `/scheduler/posts/${id}`, { provenanceAssetId: `gen:${GEN_ID}` });
    expect(linked.status).toBe(200);
    expect(linked.json.post.provenance.assetId).toBe(`gen:${GEN_ID}`);
    const cleared = await req("PATCH", `/scheduler/posts/${id}`, { provenanceAssetId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.json.post.provenance).toBeNull();
    expect(store(scheduledPostsTable)[0]!["provenance"]).toBeNull();
  });

  it("a caption-only PATCH leaves the linkage untouched", async () => {
    const created = await req("POST", "/scheduler/posts", { ...body, provenanceAssetId: `gen:${GEN_ID}` });
    const id = created.json.post.id;
    const edited = await req("PATCH", `/scheduler/posts/${id}`, { caption: "edited" });
    expect(edited.status).toBe(200);
    expect(edited.json.post.provenance.assetId).toBe(`gen:${GEN_ID}`);
  });
});

describe("legacy surface", () => {
  it("POST /schedule-post stamps the provenance snapshot on the raw row", async () => {
    const { status, json } = await req("POST", "/schedule-post", {
      content: "legacy drop", mediaUrl: "https://cdn.example.com/shark.mp4",
      platform: "instagram", scheduledAt: future(), provenanceAssetId: `gen:${GEN_ID}`,
    });
    expect(status).toBe(201);
    expect(json.post.provenance).toMatchObject({ assetId: `gen:${GEN_ID}`, aiGenerated: true });
  });
});
