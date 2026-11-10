/**
 * Durable job store (migration 0335) — the generic Pattern-B layer
 * every converted generation rail now runs on.
 *
 * Fakes @workspace/db with an in-memory generation_jobs table and
 * pins the store contract the rails depend on:
 *
 *   - persist + find: a job written at creation is rehydrated by a
 *     FRESH store over the same table (the restart boundary);
 *   - resume returning true: the resumed worker owns the job — no
 *     settle, no refund;
 *   - resume returning false / throwing: the job SETTLES — failed
 *     with the settle error, refunded exactly once, charge key
 *     voided, and the persisted claim stops any second refund;
 *   - NO resume hook: poll-driven rails — rehydration alone is the
 *     continuation, nothing settles;
 *   - a persisted creditsRefunded claim blocks the settle refund;
 *   - terminal jobs are answered from the table untouched;
 *   - findByChargeKey rehydrates rails whose ids aren't key-derived;
 *   - FAIL-OPEN: with storage throwing, persist/find degrade to the
 *     pre-0335 in-memory behavior;
 *   - the TTL sweep deletes only expired rows for the rail.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DurableJobStore, type DurableJobHooks } from "../durable-job-store";
import { sweepExpiredGenerationJobs } from "../generation-jobs";

const USER = "user-1";

const state = vi.hoisted(() => ({
  balance: 5000,
  refunds: [] as { amount: number; action: string }[],
  voids: [] as string[],
  rows: new Map<string, Record<string, unknown>>(),
  dbMode: "ok" as "ok" | "throw",
}));

/* Recover EVERY bound value from a drizzle condition (Param nodes
   inside queryChunks) — the store's queries bind rail + id, rail +
   chargeKey, or rail + a created_at cutoff. */
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

vi.mock("../credits", () => ({
  refundCredits: async (_userId: string, amount: number, rec: { action: string }) => {
    state.balance += amount;
    state.refunds.push({ amount, action: rec.action });
    return state.balance;
  },
  voidChargeIdempotencyKey: async (key: string) => {
    state.voids.push(key);
    return true;
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const guard = () => {
    if (state.dbMode === "throw") throw new Error("storage is down");
  };
  const keyOf = (v: Record<string, unknown>) => `${String(v["rail"])}␟${String(v["id"])}`;
  const fakeDb = {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          guard();
          const k = keyOf(v);
          if (!state.rows.has(k)) state.rows.set(k, { ...v });
          return [];
        },
        onConflictDoUpdate: async (cfg: { set: Record<string, unknown> }) => {
          guard();
          const k = keyOf(v);
          const prev = state.rows.get(k) ?? {};
          state.rows.set(k, { ...prev, ...v, ...cfg.set });
          return [];
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: (cond: unknown) => ({
          limit: async () => {
            guard();
            const params = paramsFromCondition(cond).filter(
              (p) => typeof p === "string",
            ) as string[];
            for (const row of state.rows.values()) {
              const fields = [row["rail"], row["id"], row["chargeKey"]];
              if (params.every((p) => fields.includes(p))) return [row];
            }
            return [];
          },
        }),
      }),
    }),
    delete: () => ({
      where: (cond: unknown) => ({
        returning: async () => {
          guard();
          const params = paramsFromCondition(cond);
          const rail = params.find((p) => typeof p === "string") as string | undefined;
          const cutoff = params.find((p) => p instanceof Date) as Date | undefined;
          const deleted: { id: string }[] = [];
          if (rail && cutoff) {
            for (const [k, row] of state.rows) {
              const created = row["createdAt"];
              if (
                row["rail"] === rail &&
                created instanceof Date &&
                created.getTime() < cutoff.getTime()
              ) {
                state.rows.delete(k);
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

interface TestJob {
  id: string;
  userId: string;
  status: "queued" | "processing" | "done" | "failed";
  error: string | null;
  creditsCharged: number;
  chargeKey: string | null;
  creditsRefunded?: boolean;
}

function makeJob(over: Partial<TestJob> = {}): TestJob {
  return {
    id: "job-1",
    userId: USER,
    status: "processing",
    error: null,
    creditsCharged: 300,
    chargeKey: "rail:user-1:key-1",
    creditsRefunded: false,
    ...over,
  };
}

function makeStore(
  map: Map<string, TestJob>,
  over: Partial<DurableJobHooks<TestJob>> = {},
): DurableJobStore<TestJob> {
  return new DurableJobStore<TestJob>(map, {
    rail: "test-rail",
    statusOf: (j) => j.status,
    isTerminalStatus: (s) => s === "done" || s === "failed",
    setFailed: (j, error) => {
      j.status = "failed";
      j.error = error;
    },
    amountOf: (j) => j.creditsCharged,
    chargeKeyOf: (j) => j.chargeKey,
    refundAction: "Test Rail — Refund (job failed)",
    settleError: "interrupted by a server restart — refunded",
    ...over,
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
}

beforeEach(() => {
  state.balance = 5000;
  state.refunds = [];
  state.voids = [];
  state.rows = new Map();
  state.dbMode = "ok";
});

describe("durable job store (0335)", () => {
  it("persists at creation and a fresh store rehydrates the job (restart boundary)", async () => {
    const mapA = new Map<string, TestJob>();
    const storeA = makeStore(mapA);
    const job = makeJob();
    mapA.set(job.id, job);
    await storeA.persist(job);

    const row = state.rows.get("test-rail␟job-1");
    expect(row).toBeDefined();
    expect(row?.["creditsRefunded"]).toBe(false);
    expect(row?.["chargeKey"]).toBe("rail:user-1:key-1");

    /* Restart: a brand-new store + empty Map over the same table. */
    const storeB = makeStore(new Map(), { resume: async () => true });
    const found = await storeB.find("job-1");
    expect(found?.id).toBe("job-1");
    expect(found?.creditsCharged).toBe(300);
  });

  it("resume returning true owns the job — no settle, no refund", async () => {
    const storeA = makeStore(new Map());
    const job = makeJob();
    await storeA.persist(job);

    let resumed: TestJob | null = null;
    const storeB = makeStore(new Map(), {
      resume: async (j) => {
        resumed = j;
        j.status = "done";
        return true;
      },
    });
    await storeB.find("job-1");
    await flush();
    expect(resumed?.id).toBe("job-1");
    expect(state.refunds).toEqual([]);
    expect(state.voids).toEqual([]);
  });

  it("resume returning false settles: failed + refunded exactly once + key voided", async () => {
    const storeA = makeStore(new Map());
    await storeA.persist(makeJob());

    const storeB = makeStore(new Map(), { resume: async () => false });
    const found = await storeB.find("job-1");
    await flush();
    expect(found?.status).toBe("failed");
    expect(found?.error).toBe("interrupted by a server restart — refunded");
    expect(state.refunds).toEqual([{ amount: 300, action: "Test Rail — Refund (job failed)" }]);
    expect(state.voids).toEqual(["rail:user-1:key-1"]);

    /* The claim is persisted: another fresh store sees a terminal,
       already-claimed job and refunds nothing more. */
    const row = state.rows.get("test-rail␟job-1");
    expect(row?.["creditsRefunded"]).toBe(true);
    expect(row?.["status"]).toBe("failed");
    const storeC = makeStore(new Map(), { resume: async () => false });
    await storeC.find("job-1");
    await flush();
    expect(state.refunds).toHaveLength(1);
  });

  it("a throwing resume settles the same way", async () => {
    const storeA = makeStore(new Map());
    await storeA.persist(makeJob());
    const storeB = makeStore(new Map(), {
      resume: async () => {
        throw new Error("inputs gone");
      },
    });
    await storeB.find("job-1");
    await flush();
    expect(state.refunds).toHaveLength(1);
    expect(state.voids).toEqual(["rail:user-1:key-1"]);
  });

  it("no resume hook = poll-driven: rehydration alone, nothing settles", async () => {
    const storeA = makeStore(new Map());
    await storeA.persist(makeJob());
    const storeB = makeStore(new Map());
    const found = await storeB.find("job-1");
    await flush();
    expect(found?.status).toBe("processing");
    expect(state.refunds).toEqual([]);
  });

  it("a persisted refund claim blocks the settle refund entirely", async () => {
    const storeA = makeStore(new Map());
    await storeA.persist(makeJob({ creditsRefunded: true }));
    const storeB = makeStore(new Map(), { resume: async () => false });
    const found = await storeB.find("job-1");
    await flush();
    expect(found?.status).toBe("failed"); // still settles the state…
    expect(state.refunds).toEqual([]); // …but never a second refund
    expect(state.voids).toEqual([]);
  });

  it("terminal jobs are answered from the table untouched", async () => {
    const storeA = makeStore(new Map());
    await storeA.persist(makeJob({ status: "done" }));
    let resumeCalls = 0;
    const storeB = makeStore(new Map(), {
      resume: async () => {
        resumeCalls += 1;
        return true;
      },
    });
    const found = await storeB.find("job-1");
    await flush();
    expect(found?.status).toBe("done");
    expect(resumeCalls).toBe(0);
    expect(state.refunds).toEqual([]);
  });

  it("claimRefund claims exactly once across stores (persisted claim wins)", async () => {
    const map = new Map<string, TestJob>();
    const storeA = makeStore(map);
    const job = makeJob();
    map.set(job.id, job);
    await storeA.persist(job);
    expect(await storeA.claimRefund(job)).toBe(true);
    expect(await storeA.claimRefund(job)).toBe(false);

    const storeB = makeStore(new Map(), { resume: async () => true });
    const rehydrated = await storeB.find("job-1");
    expect(rehydrated?.creditsRefunded).toBe(true);
    expect(await storeB.claimRefund(rehydrated!)).toBe(false);
  });

  it("findByChargeKey rehydrates a job whose id is not key-derived", async () => {
    const storeA = makeStore(new Map());
    await storeA.persist(makeJob({ id: "uuid-abc", chargeKey: "rail:user-1:xyz" }));
    const storeB = makeStore(new Map(), { resume: async () => true });
    const found = await storeB.findByChargeKey("rail:user-1:xyz");
    expect(found?.id).toBe("uuid-abc");
    expect(await storeB.findByChargeKey("rail:user-1:absent")).toBeUndefined();
  });

  it("fail-open: storage throwing degrades to in-memory behavior", async () => {
    state.dbMode = "throw";
    const map = new Map<string, TestJob>();
    const store = makeStore(map, { resume: async () => false });
    const job = makeJob();
    map.set(job.id, job);
    await store.persist(job); // must not throw
    expect(await store.find("job-1")).toBe(job); // Map hit still answers
    expect(await store.find("missing")).toBeUndefined(); // load fails open
    expect(state.rows.size).toBe(0);
  });

  it("TTL sweep deletes only the rail's expired rows", async () => {
    const storeA = makeStore(new Map());
    await storeA.persist(makeJob({ id: "old" }));
    await storeA.persist(makeJob({ id: "new" }));
    /* Age the "old" row past the TTL. */
    const old = state.rows.get("test-rail␟old")!;
    old["createdAt"] = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const deleted = await sweepExpiredGenerationJobs("test-rail", 2 * 60 * 60 * 1000);
    expect(deleted).toBe(1);
    expect(state.rows.has("test-rail␟old")).toBe(false);
    expect(state.rows.has("test-rail␟new")).toBe(true);
  });
});
