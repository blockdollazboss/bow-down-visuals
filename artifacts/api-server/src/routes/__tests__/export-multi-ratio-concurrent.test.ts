/**
 * Stack400 lane s400-exports-idempotency — C-04: POST
 * /export-multi-ratio under a TRUE concurrent duplicate submit.
 *
 * The item-64 guard was a lookup: two simultaneous identical POSTs
 * both passed it, both charged (the charge carried NO idempotency
 * key), and both rendered. The fix is two-layered:
 *  1. the charge now carries the attempt key as its idempotencyKey,
 *     so the credits ledger suppresses the loser's charge as a
 *     replay of the winner's (the credits mock below models that
 *     documented ledger contract and records what actually landed);
 *  2. migration 0331's partial UNIQUE index on multi_ratio_jobs
 *     (user_id, attempt_key) for in-flight states turns the loser's
 *     INSERT into a conflict, and the route answers with the
 *     winner's job as the duplicate.
 * To force the race (not the sequential lookup hit the sibling
 * reliability suite already pins), the durable-row SELECTs are
 * delayed so BOTH requests pass the lookup before either inserts.
 * Plus: settlement's refund voids the charge key (the Lane V3 F1
 * pattern), so a fresh identical POST after a full refund charges
 * again instead of replaying for free.
 */
import { randomUUID } from "crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = randomUUID();

const h = vi.hoisted(() => ({
  charges: [] as Array<{ cost: number; key: string | null }>,
  refunds: [] as number[],
  voids: [] as string[],
  queued: [] as Array<() => Promise<void>>,
  seenKeys: new Set<string>(),
  delayLookups: false,
}));

function sqlText(q: any): string {
  const parts: string[] = [];
  const walk = (node: any): void => {
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (typeof node.value === "string") parts.push(node.value);
    if (Array.isArray(node.value)) node.value.forEach(walk);
    if (Array.isArray(node.queryChunks)) node.queryChunks.forEach(walk);
  };
  walk(q);
  return parts.join(" ");
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER;
    req.userCredits = 100_000;
    next();
  },
}));

vi.mock("../../lib/credits", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    chargeCredits: vi.fn(
      async (
        _userId: string,
        cost: number,
        _record: unknown,
        opts?: { idempotencyKey?: string | null },
      ) => {
        const key = opts?.idempotencyKey ?? null;
        /* The real ledger's contract (lib/credits.ts): a charge
           whose key already stands is a suppressed replay — the
           balance comes back, no new charge is recorded. */
        if (key && h.seenKeys.has(key)) return 100_000;
        if (key) h.seenKeys.add(key);
        h.charges.push({ cost, key });
        return 100_000 - cost;
      },
    ),
    refundCredits: vi.fn(async (_userId: string, cost: number) => {
      h.refunds.push(cost);
      return 100_000;
    }),
    voidChargeIdempotencyKey: vi.fn(async (key: string) => {
      h.voids.push(key);
      h.seenKeys.delete(key);
      return true;
    }),
  };
});

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async (objectName: string) => `supabase://media/${objectName}`),
  refreshSupabaseStorageUrl: vi.fn(async (ref: string) => `https://signed.example/${ref}`),
}));

vi.mock("../../lib/export-jobs", () => ({
  enqueueExport: (fn: () => Promise<void>) => {
    h.queued.push(fn);
  },
}));

vi.mock("../../lib/disclosure-metadata", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, stampVideoFileWithDisclosure: async () => true };
});

/* The durable job rows are real (pg-mem) WITH migration 0331's
   partial UNIQUE index — and a delay on row SELECTs so the
   concurrent pair below genuinely races past the item-64 lookup. */
vi.mock("@workspace/db", async () => {
  const { createTestDb, MULTI_RATIO_JOBS_DDL } = await import("../../lib/__tests__/test-db");
  const td = createTestDb();
  td.mem.public.none(MULTI_RATIO_JOBS_DDL);
  td.mem.public.none(`
    CREATE UNIQUE INDEX multi_ratio_jobs_active_attempt_uniq
      ON multi_ratio_jobs (user_id, attempt_key)
      WHERE state IN ('queued', 'active') AND attempt_key IS NOT NULL;
  `);
  const realDb = td.db as any;
  const db = {
    execute: async (q: any) => {
      if (h.delayLookups && /SELECT \* FROM multi_ratio_jobs/.test(sqlText(q))) {
        await new Promise((r) => setTimeout(r, 75));
      }
      return realDb.execute(q);
    },
  };
  return { db, pgSslConfig: () => undefined };
});

import multiRatioRouter from "../generate/export-multi-ratio";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

async function postExport(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/export-multi-ratio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

beforeAll(async () => {
  /* The worker's source-video download always fails in this suite —
     that is what drives the settlement path under test. */
  vi.stubGlobal("fetch", async (url: unknown, init?: unknown) => {
    if (String(url).includes("source.example")) {
      return new Response("unavailable", { status: 500 });
    }
    return realFetch(url as any, init as any);
  });

  const app = express();
  app.use(express.json());
  app.use(multiRatioRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.charges = [];
  h.refunds = [];
  h.voids = [];
  h.queued = [];
  h.seenKeys = new Set<string>();
  h.delayLookups = false;
});

describe("C-04 — concurrent duplicate POSTs", () => {
  it("two simultaneous identical POSTs: one job, one charge, one render", async () => {
    const body = { videoUrl: "https://source.example/race.mp4", ratios: ["1:1"] };
    h.delayLookups = true;
    const [first, second] = await Promise.all([postExport(body), postExport(body)]);
    h.delayLookups = false;

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.json.jobId).toBe(first.json.jobId);
    expect([first.json.duplicate, second.json.duplicate]).toContain(true);

    /* Exactly one charge landed, and it carried the attempt key. */
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.cost).toBe(100);
    expect(h.charges[0]!.key).toMatch(/^multi_ratio_export:/);

    /* Exactly one durable row, exactly one render queued. */
    const rows = await (db as any).execute(sql`SELECT id FROM multi_ratio_jobs`);
    expect(rows.rows).toHaveLength(1);
    expect(h.queued).toHaveLength(1);
  });

  it("settlement's refund voids the charge key — a fresh identical POST charges again", async () => {
    const body = { videoUrl: "https://source.example/settle.mp4", ratios: ["1:1"] };
    const created = await postExport(body);
    expect(created.status).toBe(202);
    expect(h.charges).toHaveLength(1);
    const key = h.charges[0]!.key;
    expect(key).toMatch(/^multi_ratio_export:/);

    const run = h.queued.shift();
    await run!(); // source download fails → settle refunds everything
    expect(h.refunds).toEqual([100]);
    expect(h.voids).toEqual([key]);

    /* The key was voided with the refund, so the retry is a new
       purchase — not a free replay of a charge that no longer stands. */
    const retry = await postExport(body);
    expect(retry.status).toBe(202);
    expect(retry.json.jobId).not.toBe(created.json.jobId);
    expect(h.charges).toHaveLength(2);
  });
});
