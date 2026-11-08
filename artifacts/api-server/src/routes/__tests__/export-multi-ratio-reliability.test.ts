/**
 * Stack300 export-reliability items 64/65/66 — POST /export-multi-ratio.
 *
 * Before the fix: (64) a duplicate POST charged the full cost AGAIN
 * and rendered twice; (65) the charge landed BEFORE the durable job
 * row was inserted, and the insert swallowed its own failure — a
 * charge with no row is a charge boot recovery can never refund;
 * (66) settlement swallowed refund failures while still recording
 * the money as refunded. Driven over real HTTP; auth/credits/storage/
 * queue are mocked, the job rows are real (pg-mem).
 */
import { randomUUID } from "crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = randomUUID();

const h = vi.hoisted(() => ({
  failInsert: false,
  failRefund: false,
  charges: [] as number[],
  refunds: [] as number[],
  queued: [] as Array<() => Promise<void>>,
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
    chargeCredits: vi.fn(async (_userId: string, cost: number) => {
      h.charges.push(cost);
      return 100_000 - cost;
    }),
    refundCredits: vi.fn(async (_userId: string, cost: number) => {
      if (h.failRefund) throw new Error("refund boom");
      h.refunds.push(cost);
      return 100_000;
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

/* The durable job rows are real (pg-mem) — with a kill switch on the
   INSERT so item 65's stranded-charge path can be driven. */
vi.mock("@workspace/db", async () => {
  const { createTestDb, MULTI_RATIO_JOBS_DDL } = await import("../../lib/__tests__/test-db");
  const td = createTestDb();
  td.mem.public.none(MULTI_RATIO_JOBS_DDL);
  const realDb = td.db as any;
  const db = {
    execute: async (q: any) => {
      if (h.failInsert && /INSERT INTO multi_ratio_jobs/.test(sqlText(q))) {
        throw new Error("insert boom");
      }
      return realDb.execute(q);
    },
  };
  return { db, pgSslConfig: () => undefined };
});

import multiRatioRouter, { recoverInterruptedMultiRatioJobs } from "../generate/export-multi-ratio";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;
let seq = 0;

async function postExport(overrides: Record<string, unknown> = {}) {
  const res = await fetch(`${baseUrl}/export-multi-ratio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      videoUrl: `https://source.example/video-${++seq}.mp4`,
      ratios: ["1:1"],
      ...overrides,
    }),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function pollJob(jobId: string) {
  const res = await fetch(`${baseUrl}/export-multi-ratio/job/${jobId}`);
  return { status: res.status, json: (await res.json()) as any };
}

async function rowFor(jobId: string): Promise<Record<string, unknown> | undefined> {
  const r = await (db as any).execute(sql`SELECT * FROM multi_ratio_jobs WHERE id = ${jobId} LIMIT 1`);
  return r.rows[0] as Record<string, unknown> | undefined;
}

beforeAll(async () => {
  /* The worker's source-video download always fails in this suite —
     that is what drives the settlement paths under test. */
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
  h.failInsert = false;
  h.failRefund = false;
  h.charges = [];
  h.refunds = [];
  h.queued = [];
});

describe("duplicate-submit guard (item 64)", () => {
  it("a second identical POST returns the same job and charges ONCE", async () => {
    const body = { videoUrl: "https://source.example/dup.mp4", ratios: ["1:1"] };
    const first = await postExport(body);
    expect(first.status).toBe(202);
    expect(h.charges).toEqual([100]);

    const second = await postExport(body);
    expect(second.status).toBe(202);
    expect(second.json.jobId).toBe(first.json.jobId);
    expect(second.json.duplicate).toBe(true);
    expect(h.charges).toEqual([100]); // still exactly one charge
    expect(h.queued).toHaveLength(1); // and exactly one render queued
  });

  it("a genuinely different export is a new job with its own charge", async () => {
    const first = await postExport({ videoUrl: "https://source.example/a.mp4", ratios: ["1:1"] });
    const second = await postExport({ videoUrl: "https://source.example/a.mp4", ratios: ["16:9"] });
    expect(second.json.jobId).not.toBe(first.json.jobId);
    expect(h.charges).toEqual([100, 100]);
  });
});

describe("charge-then-insert compensation (item 65)", () => {
  it("when the durable row cannot be written, the charge is refunded in full and the start is refused", async () => {
    h.failInsert = true;
    const res = await postExport();
    expect(res.status).toBe(503);
    expect(res.json.error).toBe("export_unavailable");
    expect(res.json.message).toContain("refunded in full");
    expect(h.charges).toEqual([100]); // the charge landed…
    expect(h.refunds).toEqual([100]); // …and was compensated in full
    expect(h.queued).toHaveLength(0); // nothing renders without a row
  });

  it("recovers cleanly once the row can be written again", async () => {
    h.failInsert = true;
    await postExport();
    h.failInsert = false;
    const res = await postExport();
    expect(res.status).toBe(202);
    expect(await rowFor(res.json.jobId)).toBeDefined();
  });
});

describe("settlement refund honesty (item 66)", () => {
  it("a landed refund is recorded exactly once when the render fails", async () => {
    const created = await postExport();
    expect(created.status).toBe(202);
    const run = h.queued.shift();
    await run!(); // source download fails → settle refunds everything
    const job = await pollJob(created.json.jobId);
    expect(job.json.state).toBe("failed");
    expect(job.json.refunded).toBe(100);
    expect(h.refunds).toEqual([100]);
  });

  it("a FAILED refund is never recorded as refunded — the job stays open for recovery, which retries it", async () => {
    h.failRefund = true;
    const created = await postExport();
    const run = h.queued.shift();
    await run!(); // settle attempts the refund; it throws

    const during = await pollJob(created.json.jobId);
    expect(during.json.state).toBe("active"); // NOT terminal
    expect(during.json.refunded).toBe(0); // NOT recorded as refunded
    expect(h.refunds).toEqual([]); // nothing landed

    /* The next boot's recovery re-runs settlement on the open row —
       with the refund rail healthy again, the money lands and only
       then is it recorded. (Recovery also settles other tests'
       still-queued rows in this shared in-memory DB, so the refund
       assertions here are row-scoped, not ledger-scoped.) */
    h.failRefund = false;
    await recoverInterruptedMultiRatioJobs();
    const row = await rowFor(created.json.jobId);
    expect(row?.["state"]).toBe("failed");
    expect(Number(row?.["refunded"])).toBe(100);
    expect(h.refunds).toContain(100);
  });
});
