/**
 * Avatar presenter — DURABLE job storage (migration 0334,
 * follow-on lane f-avatar-durable).
 *
 * The CA-KEY keying made the job id intent-derived, so twin POSTs
 * collapse to one job — but the records lived only in the rail's
 * in-process Map: a restart between submit and completion lost
 * the job and orphaned its reserve-at-submit charge. This suite
 * fakes @workspace/db with an in-memory avatar_presenter_jobs
 * table and pins what 0334 buys:
 *
 *   - RESTART SURVIVAL: a job submitted before a "restart" (the
 *     in-memory store cleared; the table kept) is still THERE —
 *     the next poll rehydrates it, resumes its worker, and it
 *     completes: one charge, one provider submit, done;
 *   - a failure landing after the restart refunds + voids exactly
 *     once even though the job row was persisted — and the
 *     persisted refund claim itself stops a later replay cold;
 *   - TWIN COLLAPSE ACROSS THE RESTART: the twin POST is answered
 *     from the table (202 + replayed: true) — still one reserve,
 *     one provider submit;
 *   - TERMINAL JOBS ARE ANSWERED FROM THE TABLE after a restart;
 *   - FAIL-OPEN: with every storage call throwing, the rail
 *     behaves exactly as it did pre-0334 (charge → run → answer),
 *     no error, no double charge.
 *
 * A "restart" in this file is __resetAvatarJobs() — the new
 * process's empty Map over the same table — exactly the boundary
 * the durable layer exists to cross.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

/* The auth seam user. Deliberately NOT uuid-shaped: auth user ids
   in this codebase are opaque strings at the route/lib layer (the
   existing money-path suite runs as "user-1"), and this seam keeps
   them that way — the durable layer itself is id-format-agnostic. */
const USER = "user-1";

const state = vi.hoisted(() => ({
  balance: 5000,
  charges: [] as { amount: number; key: string }[],
  refunds: [] as { amount: number; action: string }[],
  voids: [] as string[],
  chargedKeys: new Set<string>(),
  configured: true,
  submitCalls: 0,
  statusImpl: null as null | (() => Promise<{ providerJobId: string; status: string; videoUrl?: string; error?: string }>),
  /* A per-case nonce folded into the request script, so every case
     derives its OWN intent job id. Cases share one module/server;
     a prior case's still-polling worker reads the CURRENT status
     stub, and a shared job id would let it settle (or hold open)
     another case's job — every flake this file ever had. */
  caseNonce: "",
  /* The avatar_presenter_jobs table, keyed by job id. */
  rows: new Map<string, Record<string, unknown>>(),
  dbMode: "ok" as "ok" | "throw",
}));

/* The durable layer looks rows up BY JOB ID and sweeps BY
   created_at — recover each condition's bound value from the
   drizzle expression the lib built (the value parameterizes as a
   Param node inside the condition's queryChunks). Same walker as
   the stored-result fakes. */
function valueFromCondition(cond: unknown): unknown {
  const walk = (node: unknown, depth: number): unknown => {
    if (node === null || typeof node !== "object" || depth > 6) return undefined;
    if ((node as { constructor?: { name?: string } }).constructor?.name === "Param") {
      return (node as { value?: unknown }).value;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = walk(child, depth + 1);
        if (hit !== undefined) return hit;
      }
      return undefined;
    }
    const chunks = (node as { queryChunks?: unknown }).queryChunks;
    return Array.isArray(chunks) ? walk(chunks, depth + 1) : undefined;
  };
  return walk(cond, 0);
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
      if (key && state.chargedKeys.has(key)) return state.balance; // ledger replay suppression
      if (state.balance < cost) throw new OutOfCreditsError("out_of_credits");
      state.balance -= cost;
      if (key) state.chargedKeys.add(key);
      state.charges.push({ amount: cost, key });
      return state.balance;
    },
    refundCredits: async (_userId: string, amount: number, rec: { action: string }) => {
      state.balance += amount;
      state.refunds.push({ amount, action: rec.action });
    },
    voidChargeIdempotencyKey: async (key: string) => {
      state.voids.push(key);
      state.chargedKeys.delete(key);
      return true;
    },
  };
});

vi.mock("../../lib/avatar-client", () => {
  class AvatarNotConfiguredError extends Error {
    readonly code = "AVATAR_PROVIDER_NOT_CONFIGURED";
    constructor() {
      super("not configured");
      this.name = "AvatarNotConfiguredError";
    }
  }
  return {
    AvatarNotConfiguredError,
    avatarProviderConfigured: () => state.configured,
    avatarProviderName: () => (state.configured ? "hedra" : null),
    AVATAR_PLACEHOLDER_CATALOG: [
      { id: "avatar-host-male", name: "Host — Male", style: "Confident studio host", providerAvatarId: null, imageUrl: null },
    ],
    submitAvatarVideo: async () => {
      state.submitCalls += 1;
      return { providerJobId: "hedra-job-1", status: "processing" };
    },
    getAvatarVideoStatus: async (providerJobId: string) => {
      if (state.statusImpl) return state.statusImpl();
      return { providerJobId, status: "processing" };
    },
  };
});

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (objectName: string) => `r2://generated-clips/${objectName}`,
  refreshSupabaseStorageUrl: async (ref: string) => `https://cdn.example/play?ref=${encodeURIComponent(ref)}`,
}));

/* The durable seam: @workspace/db is replaced with a row-aware
   fake over state.rows. The lib's chains are insert (persist —
   conflict-do-nothing; sync — conflict-do-update), select (load
   by id), and delete+returning (the TTL sweep); the fake models
   exactly those. dbMode "throw" takes every call down — the
   fail-open case. The table objects stay real. */
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const guard = () => {
    if (state.dbMode === "throw") throw new Error("storage is down");
  };
  const fakeDb = {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          guard();
          if (!state.rows.has(String(v["id"]))) state.rows.set(String(v["id"]), { ...v });
          return [];
        },
        onConflictDoUpdate: async (cfg: { set: Record<string, unknown> }) => {
          guard();
          const prev = state.rows.get(String(v["id"])) ?? {};
          state.rows.set(String(v["id"]), { ...prev, ...v, ...cfg.set });
          return [];
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: (cond: unknown) => ({
          limit: async () => {
            guard();
            const id = valueFromCondition(cond);
            const row = typeof id === "string" ? state.rows.get(id) : undefined;
            return row ? [row] : [];
          },
        }),
      }),
    }),
    delete: () => ({
      where: (cond: unknown) => ({
        returning: async () => {
          guard();
          const cutoff = valueFromCondition(cond);
          const deleted: { id: string }[] = [];
          if (cutoff instanceof Date) {
            for (const [id, row] of state.rows) {
              const created = row["createdAt"];
              if (created instanceof Date && created.getTime() < cutoff.getTime()) {
                state.rows.delete(id);
                deleted.push({ id });
              }
            }
          }
          return deleted;
        },
      }),
    }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
  };
  return { ...actual, db: fakeDb };
});

import avatarPresenterRouter, {
  __resetAvatarJobs,
  __putAvatarJob,
  type AvatarJob,
} from "../generate/avatar-presenter";
import { sweepExpiredAvatarJobs } from "../../lib/avatar-presenter-jobs";

const realFetch = globalThis.fetch;
let base = "";
let server: ReturnType<express.Express["listen"]>;

beforeAll(async () => {
  process.env["AVATAR_POLL_INTERVAL_MS"] = "1";
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://provider.example/finished.mp4") {
      return new Response(Buffer.from("fake-mp4-bytes"), { status: 200 });
    }
    return realFetch(input as string, init);
  });

  const app = express();
  app.use(express.json());
  app.use(avatarPresenterRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env["AVATAR_POLL_INTERVAL_MS"];
  await new Promise((r) => server.close(r));
});

let caseSeq = 0;
beforeEach(() => {
  state.balance = 5000;
  state.charges = [];
  state.refunds = [];
  state.voids = [];
  state.chargedKeys = new Set();
  state.configured = true;
  state.submitCalls = 0;
  state.statusImpl = null;
  state.rows = new Map();
  state.dbMode = "ok";
  state.caseNonce = `case-${++caseSeq}`;
  __resetAvatarJobs();
});

async function post(path: string, body?: unknown) {
  const res = await realFetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

async function getJob(jobId: string) {
  const res = await realFetch(`${base}/avatar-presenter/${jobId}`);
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

async function waitForTerminal(jobId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 8_000;
  for (;;) {
    const { json } = await getJob(jobId);
    if (json && (json["status"] === "done" || json["status"] === "failed")) return json;
    if (Date.now() > deadline) throw new Error(`job ${jobId} never reached a terminal state`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/* Let fire-and-forget durable writes (the syncs) land in the fake. */
async function flushDurable(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

/* The request body for the current case — the nonce in the script
   makes the intent (and therefore the job id) unique per case,
   while the TWIN within a case reuses the exact same body object
   values, so twin semantics are untouched. */
function validBody() {
  return {
    avatarId: "avatar-host-male",
    script: `Welcome back. [${state.caseNonce}]`,
    imageUrl: "https://img.example/char.png",
    audioUrl: "https://audio.example/voice.mp3",
  };
}

const doneStatus = async () => ({
  providerJobId: "hedra-job-1",
  status: "done",
  videoUrl: "https://provider.example/finished.mp4",
});

describe("avatar-presenter durable jobs (0334)", () => {
  it("persists the job row at creation, keyed by the intent-derived job id", async () => {
    state.statusImpl = async () => ({ providerJobId: "hedra-job-1", status: "processing" });
    const r = await post("/avatar-presenter", validBody());
    expect(r.status).toBe(202);
    const jobId = String(r.json?.["jobId"]);
    await flushDurable();
    const row = state.rows.get(jobId);
    expect(row).toBeDefined();
    expect(row?.["userId"]).toBe(USER);
    expect(row?.["creditsCharged"]).toBe(1200);
    expect(row?.["chargeKey"]).toBe(`avatar-presenter:${jobId}`);
    expect(row?.["creditsRefunded"]).toBe(false);
    expect((row?.["submitInput"] as { audioUrl?: string } | null)?.audioUrl).toBe(validBody().audioUrl);
  });

  it("RESTART: an in-flight job survives and completes — exactly one charge, no second charge ever", async () => {
    /* Provider never finishes while the first process lives: the
       job is genuinely in flight when the "restart" hits. */
    state.statusImpl = async () => ({ providerJobId: "hedra-job-1", status: "processing" });
    const r = await post("/avatar-presenter", validBody());
    const jobId = String(r.json?.["jobId"]);
    await flushDurable();
    const row = state.rows.get(jobId);
    expect(row?.["status"]).toBe("processing");
    expect(row?.["providerJobId"]).toBe("hedra-job-1");
    expect(state.submitCalls).toBe(1);
    expect(state.charges).toHaveLength(1);

    /* RESTART: the in-process store is gone; the table remains.
       The provider now finishes. */
    __resetAvatarJobs();
    state.statusImpl = doneStatus;

    /* The member's next poll rehydrates the job and resumes its
       worker; the job completes from the persisted record. */
    const job = await waitForTerminal(jobId);
    expect(job["status"]).toBe("done");
    expect(String(job["outputUrl"])).toContain("cdn.example/play");
    /* The resumed worker re-submitted under the SAME per-job
       idempotency key (the provider dedups on it) — and crucially
       there was no second CHARGE and the balance moved once.
       submitCalls is deliberately NOT asserted: the pre-restart
       worker from phase 1 may still be mid-poll when the resumed
       worker fires, and either may be the one to observe the
       provider finishing — provider submits are keyed-idempotent
       by design. The money invariant is the pin: one charge. */
    expect(state.charges).toHaveLength(1);
    expect(state.balance).toBe(3800);
    expect(state.refunds).toEqual([]);
    await flushDurable();
    expect(state.rows.get(jobId)?.["status"]).toBe("done");
  });

  it("RESTART + FAILURE: a job that fails after the restart refunds + voids exactly once", async () => {
    state.statusImpl = async () => ({ providerJobId: "hedra-job-1", status: "processing" });
    const r = await post("/avatar-presenter", validBody());
    const jobId = String(r.json?.["jobId"]);
    await flushDurable();
    expect(state.rows.get(jobId)?.["status"]).toBe("processing");

    __resetAvatarJobs();
    state.statusImpl = async () => ({
      providerJobId: "hedra-job-1",
      status: "failed",
      error: "Hedra generation failed: bad audio",
    });

    const job = await waitForTerminal(jobId);
    expect(job["status"]).toBe("failed");
    expect(String(job["error"])).toContain("bad audio");
    expect(state.charges).toHaveLength(1);
    expect(state.refunds).toEqual([{ amount: 1200, action: "AI Avatar Presenter — Refund" }]);
    expect(state.voids).toEqual([`avatar-presenter:${jobId}`]);
    expect(state.balance).toBe(5000); // net zero
    await flushDurable();
    const row = state.rows.get(jobId);
    expect(row?.["status"]).toBe("failed");
    expect(row?.["creditsRefunded"]).toBe(true); // the claim itself is durable
  });

  it("RESTART + TWIN: the twin POST after a restart collapses onto the persisted job", async () => {
    state.statusImpl = async () => ({ providerJobId: "hedra-job-1", status: "processing" });
    const first = await post("/avatar-presenter", validBody());
    const jobId = String(first.json?.["jobId"]);
    await flushDurable();
    __resetAvatarJobs();

    const twin = await post("/avatar-presenter", validBody());
    expect(twin.status).toBe(202);
    expect(String(twin.json?.["jobId"])).toBe(jobId);
    expect(twin.json?.["replayed"]).toBe(true);
    expect(String(twin.json?.["replayNote"])).toMatch(/already being made/);
    expect(state.charges).toHaveLength(1);
    expect(state.balance).toBe(3800);
  });

  it("TERMINAL: a finished job is answered from the table after a restart", async () => {
    state.statusImpl = doneStatus;
    const r = await post("/avatar-presenter", validBody());
    const jobId = String(r.json?.["jobId"]);
    const done = await waitForTerminal(jobId);
    expect(done["status"]).toBe("done");
    const outputUrl = String(done["outputUrl"]);
    await flushDurable();
    expect(state.rows.get(jobId)?.["status"]).toBe("done");

    __resetAvatarJobs();
    const after = await getJob(jobId);
    expect(after.status).toBe(200);
    expect(after.json?.["status"]).toBe("done");
    expect(after.json?.["outputUrl"]).toBe(outputUrl);
    expect(after.json?.["creditsCharged"]).toBe(1200);
    /* A terminal job never resumes a worker and never re-charges. */
    expect(state.submitCalls).toBe(1);
    expect(state.charges).toHaveLength(1);
  });

  it("FAIL-OPEN: storage fully down — the rail behaves exactly as it did pre-0334", async () => {
    state.dbMode = "throw";
    state.statusImpl = doneStatus;
    const r = await post("/avatar-presenter", validBody());
    expect(r.status).toBe(202);
    const jobId = String(r.json?.["jobId"]);
    const job = await waitForTerminal(jobId);
    expect(job["status"]).toBe("done");
    expect(state.charges).toHaveLength(1);
    expect(state.submitCalls).toBe(1);
    expect(state.balance).toBe(3800);
    expect(state.rows.size).toBe(0); // nothing persisted — and nothing broke
  });

  it("TTL: the sweep deletes rows older than the 2h clock — by query, not by process", async () => {
    const oldJob: AvatarJob = {
      id: "old-job",
      userId: USER,
      status: "done",
      avatarId: "avatar-host-male",
      script: "Long finished.",
      outputUrl: "https://cdn.example/old.mp4",
      error: null,
      creditsCharged: 1200,
      providerJobId: "hedra-old",
      createdAt: Date.now() - 3 * 60 * 60 * 1000, // 3h ago — past the TTL
      chargeKey: "avatar-presenter:old-job",
      creditsRefunded: false,
    };
    const freshJob: AvatarJob = { ...oldJob, id: "fresh-job", createdAt: Date.now() };
    __putAvatarJob(oldJob);
    __putAvatarJob(freshJob);
    await flushDurable();
    expect(state.rows.has("old-job")).toBe(true);
    expect(state.rows.has("fresh-job")).toBe(true);

    const deleted = await sweepExpiredAvatarJobs(2 * 60 * 60 * 1000);
    expect(deleted).toBe(1);
    expect(state.rows.has("old-job")).toBe(false);
    expect(state.rows.has("fresh-job")).toBe(true);
  });
});

describe("avatar-presenter durable jobs — the persisted refund claim", () => {
  it("a persisted credits_refunded claim stops a replayed worker from refunding again", async () => {
    /* A job whose refund ALREADY landed (its row says so) is
       rehydrated by a later poll — the poll resumes the worker,
       the provider still says failed, and the refund path must
       no-op on the persisted claim: exactly one refund, ever. */
    const failedJob: AvatarJob = {
      id: "refunded-job",
      userId: USER,
      status: "processing",
      avatarId: "avatar-host-male",
      script: "Welcome back.",
      outputUrl: null,
      error: null,
      creditsCharged: 1200,
      providerJobId: "hedra-job-1",
      createdAt: Date.now(),
      chargeKey: "avatar-presenter:refunded-job",
      creditsRefunded: true, // the refund landed before the restart
      submitInput: { imageUrl: validBody().imageUrl, audioUrl: validBody().audioUrl },
    };
    __putAvatarJob(failedJob);
    await flushDurable();
    expect(state.rows.get("refunded-job")?.["creditsRefunded"]).toBe(true);
    state.chargedKeys.add("avatar-presenter:refunded-job"); // the original reserve stands refunded

    __resetAvatarJobs(); // restart — the claim now lives ONLY in the row
    state.statusImpl = async () => ({
      providerJobId: "hedra-job-1",
      status: "failed",
      error: "provider said no",
    });

    const job = await waitForTerminal("refunded-job");
    expect(job["status"]).toBe("failed");
    expect(state.refunds).toEqual([]); // no second refund
    expect(state.voids).toEqual([]);
  });
});
