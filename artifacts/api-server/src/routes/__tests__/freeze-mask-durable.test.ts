/**
 * Freeze-mask — DURABLE job storage (migration 0335, durable-jobs
 * lane generalizing the avatar-presenter 0334 pattern).
 *
 * The freeze/mask job records lived only in the rail's in-process
 * Map: a restart between POST and poll lost the job — and with it
 * the refund path for a charge that already landed. This suite
 * fakes @workspace/db with in-memory generation_jobs +
 * generation_stored_results tables and pins what 0335 buys:
 *
 *   - the job row persists at creation (rail "freeze-mask");
 *   - a worker failure refunds exactly once, and the persisted row
 *     carries the claim (creditsRefunded: true) + failed status;
 *   - RESTART (vi.resetModules — a fresh module instance with an
 *     empty Map over the same tables): a terminal job is answered
 *     from the table, refunds stay at one;
 *   - RESTART + IN-FLIGHT: a persisted processing job with no
 *     resumable input SETTLES on first poll — failed, refunded
 *     exactly once, charge key voided; a second poll refunds
 *     nothing more;
 *   - a persisted claim (creditsRefunded: true) blocks the settle
 *     refund entirely;
 *   - FAIL-OPEN: with storage throwing, the rail behaves exactly
 *     as it did pre-0335.
 *
 * The worker's video download is the global fetch, stubbed to 404:
 * every real render in this suite fails fast at the download step,
 * which is the failure path under test.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = "user-1";
const FREEZE_COST = 150;

const state = vi.hoisted(() => ({
  balance: 5000,
  charges: [] as { amount: number; key: string }[],
  refunds: [] as { amount: number; action: string }[],
  voids: [] as string[],
  chargedKeys: new Set<string>(),
  /* generation_jobs rows, keyed `${rail}␟${id}`. */
  jobRows: new Map<string, Record<string, unknown>>(),
  /* generation_stored_results rows, keyed by idempotencyKey. */
  storedRows: new Map<string, Record<string, unknown>>(),
  dbMode: "ok" as "ok" | "throw",
}));

function paramsFromCondition(cond: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (node === null || typeof node !== "object" || depth > 8) return;
    if ((node as { constructor?: { name?: string } }).constructor?.name === "Param") {
      out.push((node as { value?: unknown }).value);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    const chunks = (node as { queryChunks?: unknown }).queryChunks;
    if (Array.isArray(chunks)) walk(chunks, depth + 1);
  };
  walk(cond, 0);
  return out;
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: { userId?: string; userCredits?: number }, _res: unknown, next: () => void) => {
    req.userId = USER;
    req.userCredits = state.balance;
    next();
  },
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error {
    readonly code = "OUT_OF_CREDITS";
  }
  class LedgerWriteError extends Error {}
  return {
    OutOfCreditsError,
    LedgerWriteError,
    buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) =>
      typeof clientKey === "string" && clientKey.trim().length >= 8
        ? `${scope}:${userId}:client:${clientKey.trim()}`
        : `${scope}:${userId}:${JSON.stringify(intent)}`,
    chargeCredits: async (
      _userId: string,
      cost: number,
      _rec: unknown,
      opts?: { idempotencyKey?: string },
    ) => {
      const key = opts?.idempotencyKey ?? "";
      if (key && state.chargedKeys.has(key)) return state.balance;
      if (state.balance < cost) throw new OutOfCreditsError("out_of_credits");
      state.balance -= cost;
      if (key) state.chargedKeys.add(key);
      state.charges.push({ amount: cost, key });
      return state.balance;
    },
    refundCredits: async (_userId: string, amount: number, rec: { action: string }) => {
      state.balance += amount;
      state.refunds.push({ amount, action: rec.action });
      return state.balance;
    },
    voidChargeIdempotencyKey: async (key: string) => {
      state.voids.push(key);
      state.chargedKeys.delete(key);
      return true;
    },
  };
});

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (objectName: string) => `r2://freeze-mask/${objectName}`,
  refreshSupabaseStorageUrl: async (ref: string) => `https://cdn.example/play?ref=${encodeURIComponent(ref)}`,
}));

/* Table-aware fake: generation_jobs keyed (rail, id);
   generation_stored_results keyed by idempotencyKey. */
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const guard = () => {
    if (state.dbMode === "throw") throw new Error("storage is down");
  };
  const isJobs = (t: unknown) => t === actual.generationJobsTable;
  const fakeDb = {
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          guard();
          if (isJobs(table)) {
            const k = `${String(v["rail"])}␟${String(v["id"])}`;
            if (!state.jobRows.has(k)) state.jobRows.set(k, { ...v });
          } else {
            const k = String(v["idempotencyKey"]);
            if (!state.storedRows.has(k)) state.storedRows.set(k, { ...v });
          }
          return [];
        },
        onConflictDoUpdate: async (cfg: { set: Record<string, unknown> }) => {
          guard();
          if (isJobs(table)) {
            const k = `${String(v["rail"])}␟${String(v["id"])}`;
            const prev = state.jobRows.get(k) ?? {};
            state.jobRows.set(k, { ...prev, ...v, ...cfg.set });
          } else {
            const k = String(v["idempotencyKey"]);
            const prev = state.storedRows.get(k) ?? {};
            state.storedRows.set(k, { ...prev, ...v, ...cfg.set });
          }
          return [];
        },
      }),
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => ({
          limit: async () => {
            guard();
            const params = paramsFromCondition(cond).filter(
              (p) => typeof p === "string",
            ) as string[];
            if (isJobs(table)) {
              for (const row of state.jobRows.values()) {
                const fields = [row["rail"], row["id"], row["chargeKey"]];
                if (params.every((p) => fields.includes(p))) return [row];
              }
              return [];
            }
            for (const row of state.storedRows.values()) {
              if (params.every((p) => p === row["idempotencyKey"])) return [row];
            }
            return [];
          },
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => ({
        returning: async () => {
          guard();
          if (!isJobs(table)) return [];
          const params = paramsFromCondition(cond);
          const rail = params.find((p) => typeof p === "string") as string | undefined;
          const cutoff = params.find((p) => p instanceof Date) as Date | undefined;
          const deleted: { id: string }[] = [];
          if (rail && cutoff) {
            for (const [k, row] of state.jobRows) {
              const created = row["createdAt"];
              if (
                row["rail"] === rail &&
                created instanceof Date &&
                created.getTime() < cutoff.getTime()
              ) {
                state.jobRows.delete(k);
                deleted.push({ id: String(row["id"]) });
              }
            }
          }
          return deleted;
        },
      }),
    }),
  };
  return { ...actual, db: fakeDb };
});

const realFetch = globalThis.fetch;

interface RunningApp {
  base: string;
  close: () => Promise<void>;
}

/* Boot a FRESH instance of the route module (post-resetModules =
   a restarted server: empty in-memory Map, same durable tables). */
async function bootApp(): Promise<RunningApp> {
  const mod = await import("../generate/freeze-mask");
  const app = express();
  app.use(express.json());
  /* The real app installs pino-http; the rail binds req.log.error
     for its worker logger. Give the test app the same seam. */
  app.use((req, _res, next) => {
    (req as { log?: unknown }).log = {
      error: () => {},
      info: () => {},
      warn: () => {},
    };
    next();
  });
  app.use(mod.default);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

async function post(app: RunningApp, path: string, body: unknown) {
  const res = await realFetch(`${app.base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

async function getJob(app: RunningApp, jobId: string) {
  const res = await realFetch(`${app.base}/freeze-mask/job/${jobId}`);
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
}

async function waitFor(cond: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const apps: RunningApp[] = [];

beforeEach(() => {
  state.balance = 5000;
  state.charges = [];
  state.refunds = [];
  state.voids = [];
  state.chargedKeys = new Set();
  state.jobRows = new Map();
  state.storedRows = new Map();
  state.dbMode = "ok";
  /* The worker's download always 404s in this suite. */
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("http://127.0.0.1:")) return realFetch(input as string, init);
    return new Response("not found", { status: 404 });
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await Promise.all(apps.map((a) => a.close()));
});

const freezeBody = { videoUrl: "https://video.example/clip.mp4", timestamp: 2, holdDuration: 2 };

describe("freeze-mask durable jobs (0335)", () => {
  it("persists the job row at creation; worker failure refunds exactly once and the row carries the claim", async () => {
    const app = await bootApp();
    apps.push(app);
    const r = await post(app, "/freeze-frame", freezeBody);
    expect(r.status).toBe(202);
    const jobId = String(r.json?.["jobId"]);
    expect(state.charges).toHaveLength(1);
    expect(state.charges[0]?.amount).toBe(FREEZE_COST);

    await flush();
    const rowKey = `freeze-mask␟${jobId}`;
    expect(state.jobRows.get(rowKey)).toBeDefined();

    /* The download 404s → the worker fails → exactly one refund. */
    await waitFor(() => state.refunds.length === 1, "worker refund");
    expect(state.refunds[0]).toEqual({ amount: FREEZE_COST, action: "Freeze frame — Refund" });
    expect(state.voids).toHaveLength(1);
    await flush();
    const row = state.jobRows.get(rowKey);
    expect(row?.["status"]).toBe("failed");
    expect(row?.["creditsRefunded"]).toBe(true);

    const poll = await getJob(app, jobId);
    expect(poll.json?.["status"]).toBe("failed");
    expect(state.refunds).toHaveLength(1);
  });

  it("RESTART: a terminal job is answered from the table; the refund stays at one", async () => {
    const app1 = await bootApp();
    apps.push(app1);
    const r = await post(app1, "/freeze-frame", freezeBody);
    const jobId = String(r.json?.["jobId"]);
    await waitFor(() => state.refunds.length === 1, "worker refund");
    await flush();

    /* Restart: fresh module, empty Map, same tables. */
    vi.resetModules();
    const app2 = await bootApp();
    apps.push(app2);
    const poll = await getJob(app2, jobId);
    expect(poll.status).toBe(200);
    expect(poll.json?.["status"]).toBe("failed");
    await flush();
    expect(state.refunds).toHaveLength(1);
    expect(state.charges).toHaveLength(1);
  });

  it("RESTART + IN-FLIGHT: a persisted processing job with no resumable input settles exactly once", async () => {
    /* Seed the row the way a pre-restart process left it: charged,
       processing, never claimed, no workerInput to resume from. */
    const payload = {
      id: "seeded-job-1",
      userId: USER,
      kind: "freeze-frame",
      cost: FREEZE_COST,
      status: "processing",
      createdAt: Date.now(),
      chargeKey: "seeded-charge-key",
      creditsRefunded: false,
    };
    state.jobRows.set("freeze-mask␟seeded-job-1", {
      rail: "freeze-mask",
      id: "seeded-job-1",
      userId: USER,
      status: "processing",
      creditsCharged: FREEZE_COST,
      chargeKey: "seeded-charge-key",
      creditsRefunded: false,
      payload,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    state.chargedKeys.add("seeded-charge-key");

    vi.resetModules();
    const app = await bootApp();
    apps.push(app);
    const poll = await getJob(app, "seeded-job-1");
    expect(poll.status).toBe(200);
    await waitFor(() => state.refunds.length === 1, "settle refund");
    expect(state.refunds[0]).toEqual({ amount: FREEZE_COST, action: "Freeze frame — Refund" });
    expect(state.voids).toEqual(["seeded-charge-key"]);

    const poll2 = await getJob(app, "seeded-job-1");
    expect(poll2.json?.["status"]).toBe("failed");
    await flush();
    expect(state.refunds).toHaveLength(1);
  });

  it("a persisted refund claim blocks the settle refund entirely", async () => {
    const payload = {
      id: "seeded-job-2",
      userId: USER,
      kind: "apply-mask",
      cost: 200,
      status: "processing",
      createdAt: Date.now(),
      chargeKey: "seeded-key-2",
      creditsRefunded: true, // the refund landed before the restart
    };
    state.jobRows.set("freeze-mask␟seeded-job-2", {
      rail: "freeze-mask",
      id: "seeded-job-2",
      userId: USER,
      status: "processing",
      creditsCharged: 200,
      chargeKey: "seeded-key-2",
      creditsRefunded: true,
      payload,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.resetModules();
    const app = await bootApp();
    apps.push(app);
    const poll = await getJob(app, "seeded-job-2");
    expect(poll.status).toBe(200);
    await flush();
    expect(state.refunds).toEqual([]);
    expect(state.voids).toEqual([]);
    const poll2 = await getJob(app, "seeded-job-2");
    expect(poll2.json?.["status"]).toBe("failed");
  });

  it("FAIL-OPEN: storage down — the rail behaves exactly as pre-0335", async () => {
    state.dbMode = "throw";
    const app = await bootApp();
    apps.push(app);
    const r = await post(app, "/freeze-frame", freezeBody);
    expect(r.status).toBe(202);
    const jobId = String(r.json?.["jobId"]);
    await waitFor(() => state.refunds.length === 1, "in-memory worker refund");
    const poll = await getJob(app, jobId);
    expect(poll.json?.["status"]).toBe("failed");
    expect(state.jobRows.size).toBe(0);
  });
});
