/**
 * CA-6 (charge audit B6) — replay protection for the Pattern B
 * (charge-then-job) generate rails t–w. Representative families
 * pinned over HTTP with the house harness (fake keyed ledger +
 * in-memory generation_stored_results):
 *
 *   - upscale-generative (1,500, provider-submit runner): a replayed
 *     create — while the job lives AND after a restart (durable store
 *     only) — returns the same jobId with replayed:true, one charge,
 *     one provider submit. A provider failure refunds + VOIDS in the
 *     runner, so the retry charges fresh under the same deterministic
 *     job id.
 *   - vocal-polish (ffmpeg runner): a replayed create while the job
 *     is still in flight returns the twin's job; a download failure
 *     refunds + voids in the runner and the retry charges fresh.
 *
 * Fresh create bodies are byte-identical to the pre-CA-6 wire shape.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = "user-1";

const h = vi.hoisted(() => ({
  balance: 100_000,
  charges: [] as Array<{ amount: number; key: string }>,
  refunds: [] as number[],
  voids: [] as string[],
  chargedKeys: new Set<string>(),
  stored: new Map<string, { userId: string; rail: string; result: any }>(),
  submitCalls: 0,
  submitMode: "ok" as "ok" | "throw",
  fetchMode: "hang" as "hang" | "throw",
}));

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

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER;
    req.userCredits = h.balance;
    req.log = { info() {}, error() {}, warn() {} };
    next();
  },
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error { readonly code = "OUT_OF_CREDITS"; }
  class LedgerWriteError extends Error { readonly code = "LEDGER_WRITE"; }
  return {
    OutOfCreditsError,
    LedgerWriteError,
    buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) =>
      typeof clientKey === "string" && clientKey.trim().length >= 8
        ? `${scope}:${userId}:client:${clientKey.trim()}`
        : `${scope}:${userId}:${JSON.stringify(intent)}`,
    chargeCredits: async (_userId: string, amount: number, _meta: unknown, opts?: { idempotencyKey?: string | null }) => {
      const key = opts?.idempotencyKey ?? "";
      if (key && h.chargedKeys.has(key)) return h.balance;
      if (h.balance < amount) throw new OutOfCreditsError("out");
      h.balance -= amount;
      if (key) h.chargedKeys.add(key);
      h.charges.push({ amount, key });
      return h.balance;
    },
    refundCredits: async (_userId: string, amount: number) => {
      h.balance += amount;
      h.refunds.push(amount);
      return h.balance;
    },
    voidChargeIdempotencyKey: async (key: string) => {
      h.voids.push(key);
      return h.chargedKeys.delete(key);
    },
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          const key = keyFromCondition(cond);
          const row = key ? h.stored.get(key) : undefined;
          return Promise.resolve(row ? [{ result: row.result, userId: row.userId, rail: row.rail }] : []);
        },
        limit: () => Promise.resolve([]),
      }),
    }),
    insert: () => ({
      values: (v: { idempotencyKey: string; userId: string; rail: string; result: unknown }) => ({
        onConflictDoNothing: () => {
          if (!h.stored.has(v.idempotencyKey)) {
            h.stored.set(v.idempotencyKey, { userId: v.userId, rail: v.rail, result: v.result });
          }
          return Promise.resolve();
        },
      }),
    }),
  },
  generationStoredResultsTable: {
    idempotencyKey: "idempotencyKey",
    userId: "userId",
    rail: "rail",
    result: "result",
  },
}));

vi.mock("../../lib/generative-upscale-client", () => ({
  generativeUpscaleConfigured: () => true,
  GenerativeUpscaleNotConfiguredError: class extends Error {},
  submitGenerativeUpscale: async () => {
    h.submitCalls++;
    if (h.submitMode === "throw") throw new Error("provider submit failed");
    return { status: "done", videoUrl: "https://cdn.test/upscaled.mp4" };
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (name: string) => `ref:${name}`,
  refreshSupabaseStorageUrl: async (ref: string) => `https://cdn.test/${ref}`,
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    execFile: (_file: string, _args: string[], options: unknown, callback?: unknown) => {
      const cb = (typeof options === "function" ? options : callback) as (err: Error | null, stdout: string, stderr: string) => void;
      cb(new Error("no ffmpeg in tests"), "", "");
    },
  };
});

import upscaleGenerativeRouter from "../generate/upscale-generative";
import vocalPolishRouter from "../generate/vocal-polish";
import { __resetCa6ReplayCache } from "../generate/ca6-replay-guard";

let server: any;
let baseUrl: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(upscaleGenerativeRouter);
  app.use(vocalPolishRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: err?.message ?? "error" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(() => {
  h.balance = 100_000;
  h.charges = [];
  h.refunds = [];
  h.voids = [];
  h.chargedKeys.clear();
  h.stored.clear();
  h.submitCalls = 0;
  h.submitMode = "ok";
  h.fetchMode = "hang";
  __resetCa6ReplayCache();
  vi.stubGlobal("fetch", async () => {
    if (h.fetchMode === "throw") throw new Error("download failed");
    return new Promise(() => {}); // hang: the vocal-polish job stays in flight
  });
});

async function post(path: string, body: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
}

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
}

async function waitFor(pred: () => boolean, ms = 5_000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("CA-6 upscale-generative (Pattern B, 1,500)", () => {
  const body = { sourceVideoUrl: "https://cdn.test/in.mp4", target: "4k" };

  it("replayed create returns the same job: one charge, one submit — live, then durable-only", async () => {
    const first = await post("/ai-upscale", body);
    expect(first.status).toBe(202);
    expect(first.json.replayed).toBeUndefined();
    expect(first.json.jobId).toBeTruthy();

    await waitFor(() => h.stored.size === 1);
    expect(h.submitCalls).toBe(1);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(1500);

    const status = await get(`/ai-upscale/${first.json.jobId}`);
    expect(status.json.status).toBe("done");

    const second = await post("/ai-upscale", body);
    expect(second.status).toBe(202);
    expect(second.json.replayed).toBe(true);
    expect(second.json.jobId).toBe(first.json.jobId);
    expect(h.charges).toHaveLength(1);
    expect(h.submitCalls).toBe(1);

    /* Post-restart shape: the in-process guard cache is wiped, so only
       the durable row can answer — same job, still no new charge. */
    __resetCa6ReplayCache();
    const third = await post("/ai-upscale", body);
    expect(third.status).toBe(202);
    expect(third.json.replayed).toBe(true);
    expect(third.json.jobId).toBe(first.json.jobId);
    expect(h.charges).toHaveLength(1);
    expect(h.submitCalls).toBe(1);
  });

  it("provider failure refunds + voids in the runner; the retry charges fresh", async () => {
    /* Distinct intent from the success test above: the module-level
       jobs map outlives a single test, so a shared body would find
       the earlier DONE job instead of creating a failing one. */
    const failBody = { sourceVideoUrl: "https://cdn.test/fail.mp4", target: "4k" };
    h.submitMode = "throw";
    const first = await post("/ai-upscale", failBody);
    expect(first.status).toBe(202);
    expect(first.json.replayed).toBeUndefined();
    await waitFor(() => h.voids.length === 1);
    expect(h.refunds).toHaveLength(1);
    expect(h.refunds[0]).toBe(1500);

    const status = await get(`/ai-upscale/${first.json.jobId}`);
    expect(status.json.status).toBe("failed");

    h.submitMode = "ok";
    const retry = await post("/ai-upscale", failBody);
    expect(retry.status).toBe(202);
    expect(retry.json.replayed).toBeUndefined();
    expect(retry.json.jobId).toBe(first.json.jobId); // deterministic id
    expect(h.charges).toHaveLength(2);
  });
});

describe("CA-6 vocal-polish (Pattern B, ffmpeg runner)", () => {
  const body = { audioUrl: "https://cdn.test/song.wav", correctionStrength: 50, keyShift: 0, tempoFactor: 1 };

  it("replayed create while the job is in flight returns the twin: one charge", async () => {
    const first = await post("/vocal-polish", body);
    expect(first.status).toBe(202);
    expect(first.json.replayed).toBeUndefined();

    const second = await post("/vocal-polish", body);
    expect(second.status).toBe(202);
    expect(second.json.replayed).toBe(true);
    expect(second.json.jobId).toBe(first.json.jobId);
    expect(h.charges).toHaveLength(1);
  });

  it("download failure refunds + voids in the runner; the retry charges fresh", async () => {
    h.fetchMode = "throw";
    const first = await post("/vocal-polish", { ...body, audioUrl: "https://cdn.test/other.wav" });
    expect(first.status).toBe(202);
    await waitFor(() => h.voids.length === 1);
    expect(h.refunds).toHaveLength(1);

    const status = await get(`/vocal-polish/${first.json.jobId}`);
    expect(status.json.status).toBe("failed");

    h.fetchMode = "hang";
    const retry = await post("/vocal-polish", { ...body, audioUrl: "https://cdn.test/other.wav" });
    expect(retry.status).toBe(202);
    expect(retry.json.replayed).toBeUndefined();
    expect(retry.json.jobId).toBe(first.json.jobId);
    expect(h.charges).toHaveLength(2);
  });
});
