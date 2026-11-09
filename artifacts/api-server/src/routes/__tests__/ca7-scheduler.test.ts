/**
 * CA-7 replay safety for the scheduler's two charged surfaces:
 *  - POST /scheduler/posts (Pattern C): a re-ask of the same request
 *    serves the stored presented post — no second charge and NO
 *    second row inserted. Drafts stay free and are never stored.
 *  - POST /scheduler/best-time: a re-ask serves the stored suggestion
 *    — provider runs once. A provider failure refunds + voids the
 *    charge key, so the retry charges fresh.
 *
 * Harness mirrors scheduler-provenance.test.ts (per-table fake db with
 * the drizzle eq() collector) fused with the CA-KEY fake-credits
 * ledger (key-aware charge suppression + void tracking) and the
 * key-aware stored-result fake over @workspace/db.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { createHash } from "crypto";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = "user-1";

const h = vi.hoisted(() => ({
  balance: 10_000,
  charges: [] as Array<{ amount: number; key: string | null }>,
  refunds: [] as Array<{ amount: number }>,
  voids: [] as string[],
  chargedKeys: new Set<string>(),
  stored: new Map<string, { userId: string; rail: string; result: any }>(),
  storeFailOnInsert: false,
  selectMode: "ok" as "ok" | "throw",
  storeMode: "ok" as "ok" | "throw",
  stores: new Map<any, Array<Record<string, any>>>(),
  bestTimeMode: "ok" as "ok" | "throw" | "badjson",
  bestTimeCalls: 0,
}));

function tableStore(table: any): Array<Record<string, any>> {
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

function keyFromCondition(cond: unknown): string | null {
  const walk = (node: unknown, depth: number): string | null => {
    if (node === null || typeof node !== "object" || depth > 6) return null;
    if ((node as { constructor?: { name?: string } }).constructor?.name === "Param") {
      const v = (node as { value?: unknown }).value;
      return typeof v === "string" ? v : null;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = walk(child, depth + 1);
        if (hit !== null) return hit;
      }
      return null;
    }
    const chunks = (node as { queryChunks?: unknown }).queryChunks;
    return Array.isArray(chunks) ? walk(chunks, depth + 1) : null;
  };
  return walk(cond, 0);
}

const FakeClasses = vi.hoisted(() => ({
  OutOfCreditsError: class FakeOutOfCredits extends Error {},
  LedgerWriteError: class FakeLedgerWrite extends Error {},
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER;
    req.userCredits = h.balance;
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  OutOfCreditsError: FakeClasses.OutOfCreditsError,
  LedgerWriteError: FakeClasses.LedgerWriteError,
  buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) => {
    if (typeof clientKey === "string" && clientKey.trim().length >= 8) {
      return `${scope}:${userId}:client:${clientKey.trim()}`;
    }
    const hash = createHash("sha256").update(JSON.stringify(intent ?? null)).digest("hex").slice(0, 32);
    return `${scope}:${userId}:${hash}`;
  },
  chargeCredits: async (_userId: string, amount: number, _record: unknown, opts?: { idempotencyKey?: string }) => {
    const key = opts?.idempotencyKey ?? null;
    if (key !== null && h.chargedKeys.has(key)) return h.balance; // replay suppression
    if (h.balance < amount) throw new FakeClasses.OutOfCreditsError("out");
    h.balance -= amount;
    if (key !== null) h.chargedKeys.add(key);
    h.charges.push({ amount, key });
    return h.balance;
  },
  refundCredits: async (_userId: string, amount: number) => {
    h.balance += amount;
    h.refunds.push({ amount });
    return h.balance;
  },
  voidChargeIdempotencyKey: async (key: string) => {
    h.voids.push(key);
    h.chargedKeys.delete(key);
  },
}));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          h.bestTimeCalls++;
          if (h.bestTimeMode === "throw") throw new Error("openai down");
          if (h.bestTimeMode === "badjson") return { choices: [{ message: { content: "not json" } }] };
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  slots: [{ date: "2026-11-12", time: "18:30", platform: "instagram", reason: "peak scroll" }],
                  note: "Post at dinner scroll time.",
                }),
              },
            }],
          };
        },
      },
    },
  }),
}));

vi.mock("../../lib/job-poller", () => ({ requestPollerTick: vi.fn() }));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v ?? null),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: vi.fn(async (v: string) => v),
  refreshSupabaseStorageUrlsDeep: vi.fn(async (x: any) => x),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { scheduledPostsTable, generationStoredResultsTable } = actual;
  const fakeDb = {
    select: () => ({
      from: (table: any) => {
        if (table === generationStoredResultsTable) {
          return {
            where: (cond: unknown) => ({
              limit: async () => {
                if (h.selectMode === "throw") throw new Error("select failed");
                const key = keyFromCondition(cond);
                const row = key !== null ? h.stored.get(key) : undefined;
                return row ? [row] : [];
              },
            }),
          };
        }
        let cond: any = null; let lim: number | null = null;
        const run = () => {
          let rows = cond ? tableStore(table).filter((r) => matches(r, cond)) : [...tableStore(table)];
          if (lim !== null) rows = rows.slice(0, lim);
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
      values: (v: any) => {
        if (table === generationStoredResultsTable) {
          return {
            onConflictDoNothing: async () => {
              if (h.storeMode === "throw") throw new Error("store write failed");
              if (!h.stored.has(v.idempotencyKey)) {
                h.stored.set(v.idempotencyKey, { userId: v.userId, rail: v.rail, result: v.result });
              }
              return [];
            },
          };
        }
        return {
          returning: async () => {
            if (table === scheduledPostsTable && h.storeFailOnInsert) {
              throw new Error("insert exploded");
            }
            const row = {
              attempts: 0, last_error: null, credits_refunded: false, ai_best_time: null,
              results: [], posted_at: null, scheduled_at: null, provenance: null,
              ...v,
              id: v.id ?? randomUUID(),
              created_at: new Date(), updated_at: new Date(),
            };
            tableStore(table).push(row);
            return [row];
          },
        };
      },
    }),
    update: (table: any) => ({
      set: (patch: Record<string, any>) => ({
        where: (cond: any) => ({
          returning: async () => {
            const hit = tableStore(table).filter((r) => matches(r, cond));
            for (const r of hit) Object.assign(r, patch);
            return hit;
          },
          then: (res: any, rej: any) => {
            const hit = tableStore(table).filter((r) => matches(r, cond));
            for (const r of hit) Object.assign(r, patch);
            return Promise.resolve(hit).then(res, rej);
          },
        }),
      }),
    }),
    delete: (table: any) => ({
      where: async (cond: any) => {
        h.stores.set(table, tableStore(table).filter((r) => !matches(r, cond)));
      },
    }),
  };
  return { ...actual, db: fakeDb };
});

import schedulerRouter, { __resetSchedulerReplayCache } from "../scheduler";
import { scheduledPostsTable } from "@workspace/db";

let base = "";
let server: ReturnType<express.Express["listen"]>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {} }; next(); });
  app.use(schedulerRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

beforeEach(() => {
  h.balance = 10_000;
  h.charges = [];
  h.refunds = [];
  h.voids = [];
  h.chargedKeys = new Set();
  h.stored = new Map();
  h.stores = new Map();
  h.storeFailOnInsert = false;
  h.selectMode = "ok";
  h.storeMode = "ok";
  h.bestTimeMode = "ok";
  h.bestTimeCalls = 0;
  __resetSchedulerReplayCache();
});

async function postJson(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const ACCOUNT = randomUUID();
const futureIso = () => new Date(Date.now() + 3_600_000).toISOString();
const scheduledBody = () => ({
  mediaUrl: "https://cdn.example.com/clip.mp4",
  mediaType: "video",
  caption: "launch day",
  hashtags: "#bdv",
  platforms: ["instagram"],
  accountIds: { instagram: ACCOUNT },
  scheduledAt: futureIso(),
});

describe("CA-7 scheduler post create (Pattern C)", () => {
  it("fresh scheduled create charges once, inserts once, and persists the result", async () => {
    const body = scheduledBody();
    const r1 = await postJson("/scheduler/posts", body);
    expect(r1.status).toBe(201);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.post.status).toBe("scheduled");
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(tableStore(scheduledPostsTable)).toHaveLength(1);
    expect(h.stored.size).toBe(1);
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("scheduler-post-create");
    expect(storedRow.result).toEqual(r1.body);

    const r2 = await postJson("/scheduler/posts", body);
    expect(r2.status).toBe(201);
    expect(r2.body).toEqual({ ...r1.body, replayed: true });
    expect(h.charges).toHaveLength(1); // no second charge
    expect(tableStore(scheduledPostsTable)).toHaveLength(1); // NO second post
  });

  it("draft create stays free, unstored, and unkeyed", async () => {
    const draft = { ...scheduledBody(), scheduledAt: undefined };
    const r1 = await postJson("/scheduler/posts", draft);
    expect(r1.status).toBe(201);
    expect(r1.body.post.status).toBe("draft");
    const r2 = await postJson("/scheduler/posts", draft);
    expect(r2.status).toBe(201);
    expect(r2.body.replayed).toBeUndefined();
    expect(h.charges).toHaveLength(0);
    expect(h.stored.size).toBe(0);
    expect(tableStore(scheduledPostsTable)).toHaveLength(2); // two real drafts
  });

  it("insert failure refunds + voids the key, stores nothing, and the retry charges fresh", async () => {
    const body = scheduledBody();
    h.storeFailOnInsert = true;
    const r1 = await postJson("/scheduler/posts", body);
    expect(r1.status).toBe(500);
    expect(r1.body.error).toBe("create_failed");
    expect(h.charges).toHaveLength(1);
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.storeFailOnInsert = false;
    const r2 = await postJson("/scheduler/posts", body);
    expect(r2.status).toBe(201);
    expect(r2.body.replayed).toBeUndefined();
    expect(h.charges).toHaveLength(2); // charged fresh after the void
    expect(tableStore(scheduledPostsTable)).toHaveLength(1);
  });

  it("a different caption is a different request and charges again", async () => {
    const a = scheduledBody();
    const b = { ...scheduledBody(), caption: "different" };
    await postJson("/scheduler/posts", a);
    const r2 = await postJson("/scheduler/posts", b);
    expect(r2.status).toBe(201);
    expect(r2.body.replayed).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    expect(tableStore(scheduledPostsTable)).toHaveLength(2);
  });
});

describe("CA-7 scheduler best-time", () => {
  const btBody = { niche: "music production", platforms: ["instagram"], postsPerWeek: 3, timezone: "America/New_York" };

  it("fresh run charges once, calls the provider once, and persists the result", async () => {
    const r1 = await postJson("/scheduler/best-time", btBody);
    expect(r1.status).toBe(200);
    expect(r1.body.replayed).toBeUndefined();
    expect(r1.body.creditsUsed).toBe(100);
    expect(r1.body.slots).toHaveLength(1);
    expect(h.charges).toHaveLength(1);
    expect(h.bestTimeCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    const storedRow = [...h.stored.values()][0]!;
    expect(storedRow.rail).toBe("scheduler-best-time");
    expect(storedRow.result).toEqual(r1.body);

    const r2 = await postJson("/scheduler/best-time", btBody);
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual({ ...r1.body, replayed: true });
    expect(h.charges).toHaveLength(1);
    expect(h.bestTimeCalls).toBe(1); // provider ran once
  });

  it("provider failure refunds + voids, stores nothing, and the retry charges fresh", async () => {
    h.bestTimeMode = "throw";
    const r1 = await postJson("/scheduler/best-time", btBody);
    expect(r1.status).toBe(502);
    expect(r1.body.error).toBe("ai_failed");
    expect(h.charges).toHaveLength(1);
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.bestTimeMode = "ok";
    const r2 = await postJson("/scheduler/best-time", btBody);
    expect(r2.status).toBe(200);
    expect(r2.body.replayed).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    expect(h.bestTimeCalls).toBe(2);
  });

  it("unparseable provider output answers the same 502 and refunds + voids", async () => {
    h.bestTimeMode = "badjson";
    const r1 = await postJson("/scheduler/best-time", btBody);
    expect(r1.status).toBe(502);
    expect(r1.body.message).toBe("The AI returned an unusable suggestion — your Visual Buc was refunded.");
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);
    expect(h.stored.size).toBe(0);
  });

  it("storage failure fails open — the fresh answer still lands", async () => {
    h.storeMode = "throw";
    const r1 = await postJson("/scheduler/best-time", btBody);
    expect(r1.status).toBe(200);
    expect(r1.body.creditsUsed).toBe(100);
    expect(h.charges).toHaveLength(1);
  });
});
