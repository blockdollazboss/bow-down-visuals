/**
 * Stack-24 Lane 7 — invariant 5 at the rail: the Gen 4.5 video rail
 * charges on JOB SUCCESS, not on submission, and never for a failed
 * job. This is the layer where money actually moves for the
 * operator's generate.video tool (its handler defers the charge to
 * this rail and audits 0 at submission — pinned in
 * operator-tier3.test.ts); here the REAL submit + poll handlers run
 * over HTTP with the provider SDK, the credit ledger, and storage
 * faked at the edges.
 *
 * The pins (routes/generate/runway-clip.ts):
 *  - submit registers the task and charges NOTHING;
 *  - a still-running poll charges nothing;
 *  - a FAILED task charges nothing — on the first poll or any later
 *    one (its pending entry is gone; there is no path back to a
 *    charge);
 *  - a SUCCEEDED task charges EXACTLY ONCE, the server-computed
 *    plan price (GEN45_CREDIT_COST = 400), to the task's owner,
 *    with the durable charge→refund obligation recorded once;
 *  - repeat polls after success never re-charge (the pending entry
 *    was consumed by the first successful poll);
 *  - a different member's poll cannot trigger the charge at all.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  taskSeq: 0,
  taskStates: new Map<string, any>(),
  chargeCalls: [] as any[],
  recordCalls: [] as any[],
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
    req.userId = String(u);
    req.userCredits = Number(req.headers["x-test-credits"] ?? 1_000_000);
    next();
  },
}));
vi.mock("../../lib/rate-limit", () => ({
  generationLimiter: (_q: any, _s: any, n: any) => n(),
}));
vi.mock("@runwayml/sdk", () => ({
  default: class FakeRunway {
    textToVideo = {
      create: async () => ({ id: `task-txt-${++h.taskSeq}` }),
    };
    imageToVideo = {
      create: async () => ({ id: `task-img-${++h.taskSeq}` }),
    };
    tasks = {
      retrieve: async (id: string) => h.taskStates.get(id) ?? { status: "RUNNING" },
    };
  },
}));
vi.mock("../../lib/veo-client", () => ({
  submitVeoVideo: async () => "operations/test-op",
  pollVeoOperation: async () => ({ done: false }),
  downloadVeoVideoToFile: async () => {},
}));
vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { credits: 1_000_000 } }),
        }),
      }),
    }),
  }),
}));
vi.mock("../../lib/rail-core", () => ({ invokeRailHandler: async () => ({}) }));
vi.mock("../../lib/credits", () => ({
  chargeCredits: async (userId: string, amount: number, meta: unknown) => {
    h.chargeCalls.push([userId, amount, meta]);
    return { success: true, creditsAfter: 1_000_000 - amount };
  },
  LedgerWriteError: class LedgerWriteError extends Error {},
}));
vi.mock("../../lib/clip-charge-obligations", () => ({
  recordClipCharge: async (row: unknown) => { h.recordCalls.push(row); },
}));
vi.mock("../../lib/objectStorage", () => ({
  SUPABASE_CLIPS_BUCKET: "generated-clips",
  uploadMediaToSupabaseStorage: async () => "supabase://generated-clips/x.jpg",
  uploadFileStreamToSupabaseStorage: async () => "supabase://generated-clips/clips/x.mp4",
  parseSupabaseStorageRef: (v: string) =>
    typeof v === "string" && v.startsWith("supabase://") ? v.slice("supabase://".length) : null,
  refreshSupabaseStorageUrl: async (v: string) =>
    v.startsWith("supabase://") ? `https://cdn.test/${v.slice("supabase://".length)}` : v,
}));
vi.mock("../generate/pre-production", () => ({
  getLockedPack: async () => {
    throw Object.assign(new Error("pack not locked"), { status: 404 });
  },
}));

import runwayClipRouter from "../generate/runway-clip";
import { GEN45_CREDIT_COST } from "../generate/clip-pricing";

const OWNER = randomUUID();
const OTHER = randomUUID();
const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;

beforeAll(async () => {
  process.env["RUNWAYML_API_SECRET"] = "test-secret";
  /* The poll handler downloads the finished clip before answering;
     the provider URL is unreachable by design in tests — the
     handler's own fallback (answer succeeded with the raw URL, the
     charge already landed) is the path under test. Localhost (the
     test's own HTTP) passes through untouched. */
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    if (url.startsWith("https://runway.test/")) throw new Error("provider download blocked in tests");
    return realFetch(input, init);
  }) as typeof fetch;

  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use(runwayClipRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  delete process.env["RUNWAYML_API_SECRET"];
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.chargeCalls = [];
  h.recordCalls = [];
});

async function submit(userId: string) {
  const r = await realFetch(`${baseUrl}/generate-runway-clip`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": userId },
    body: JSON.stringify({ promptText: "a shark surfing at sunset", model: "gen4.5" }),
  });
  return { status: r.status, json: (await r.json()) as any };
}

async function poll(userId: string, taskId: string) {
  const r = await realFetch(`${baseUrl}/generate-runway-clip/${taskId}`, {
    headers: { "x-test-user": userId },
  });
  return { status: r.status, json: (await r.json()) as any };
}

describe("Gen 4.5 rail — charge on success only", () => {
  it("submission registers the task at the server-computed price and charges NOTHING", async () => {
    const { status, json } = await submit(OWNER);
    expect(status).toBe(200);
    expect(json.taskId).toBeTruthy();
    expect(json.creditCost).toBe(GEN45_CREDIT_COST);
    expect(h.chargeCalls).toHaveLength(0);
    expect(h.recordCalls).toHaveLength(0);
  });

  it("a still-running task charges nothing", async () => {
    const { json } = await submit(OWNER);
    h.taskStates.set(json.taskId, { status: "RUNNING", progress: 0.4 });
    const p = await poll(OWNER, json.taskId);
    expect(p.json.status).toBe("processing");
    expect(h.chargeCalls).toHaveLength(0);
  });

  it("a FAILED task charges nothing — not on the first poll, not on any later one", async () => {
    const { json } = await submit(OWNER);
    h.taskStates.set(json.taskId, { status: "FAILED", failure: "provider boom", failureCode: "UNKNOWN" });
    const p1 = await poll(OWNER, json.taskId);
    expect(p1.json.status).toBe("failed");
    expect(h.chargeCalls).toHaveLength(0);
    const p2 = await poll(OWNER, json.taskId);
    expect(p2.json.status).toBe("failed");
    expect(h.chargeCalls).toHaveLength(0);
    expect(h.recordCalls).toHaveLength(0);
  });

  it("a CANCELLED task charges nothing", async () => {
    const { json } = await submit(OWNER);
    h.taskStates.set(json.taskId, { status: "CANCELLED" });
    const p = await poll(OWNER, json.taskId);
    expect(p.json.status).toBe("cancelled");
    expect(h.chargeCalls).toHaveLength(0);
  });

  it("a SUCCEEDED task charges exactly once at the plan price — repeat polls never re-charge", async () => {
    const { json } = await submit(OWNER);
    h.taskStates.set(json.taskId, { status: "SUCCEEDED", output: ["https://runway.test/clip.mp4"] });

    const p1 = await poll(OWNER, json.taskId);
    expect(p1.json.status).toBe("succeeded");
    expect(h.chargeCalls).toHaveLength(1);
    const [chargedUser, amount, meta] = h.chargeCalls[0];
    expect(chargedUser).toBe(OWNER);
    expect(amount).toBe(GEN45_CREDIT_COST);
    expect(meta).toMatchObject({ action: "Runway Video Clip" });
    expect(h.recordCalls).toHaveLength(1);
    expect(h.recordCalls[0]).toMatchObject({ taskId: json.taskId, userId: OWNER, credits: GEN45_CREDIT_COST });

    const p2 = await poll(OWNER, json.taskId);
    expect(p2.json.status).toBe("succeeded");
    expect(h.chargeCalls).toHaveLength(1);
    expect(h.recordCalls).toHaveLength(1);
  });

  it("another member's poll cannot trigger the charge — the owner's own later poll charges once", async () => {
    const { json } = await submit(OWNER);
    h.taskStates.set(json.taskId, { status: "SUCCEEDED", output: ["https://runway.test/clip.mp4"] });

    const stranger = await poll(OTHER, json.taskId);
    expect(stranger.json.status).toBe("succeeded");
    expect(h.chargeCalls).toHaveLength(0);

    const owner = await poll(OWNER, json.taskId);
    expect(owner.json.status).toBe("succeeded");
    expect(h.chargeCalls).toHaveLength(1);
    expect(h.chargeCalls[0][0]).toBe(OWNER);
    expect(h.chargeCalls[0][1]).toBe(GEN45_CREDIT_COST);
  });
});
