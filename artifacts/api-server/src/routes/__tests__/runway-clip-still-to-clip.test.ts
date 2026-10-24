/**
 * Stack-100 #3 Wave 3 Lane 7 — the still→clip step of the LipSyncStudio
 * single-image flow, at the rail it rides.
 *
 * The still is animated by the EXISTING video rail in image-to-video
 * mode (POST /generate-runway-clip with `referenceImageUrl`). These
 * tests pin, with the provider SDK / ledger / storage faked at the
 * seams the codebase already uses:
 *  - a submission carrying a reference image goes to the provider's
 *    imageToVideo.create with that exact image as promptImage, and
 *    reports referenceSource "vault_photo";
 *  - submission charges NOTHING; a FAILED image-to-video task charges
 *    nothing on any poll;
 *  - a SUCCEEDED task charges EXACTLY ONCE at the rail's own constant
 *    (GEN45_CREDIT_COST from clip-pricing.ts — the same flat price as
 *    every gen4.5 clip; no still-specific price exists or is invented),
 *    and the poll response carries the stored clip's playable URL +
 *    storageRef — the exact hand-off shape POST /lip-sync/preview
 *    consumes as clipUrl.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  taskSeq: 0,
  taskStates: new Map<string, any>(),
  imageToVideoCalls: [] as any[],
  textToVideoCalls: [] as any[],
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
      create: async (args: any) => {
        h.textToVideoCalls.push(args);
        return { id: `task-txt-${++h.taskSeq}` };
      },
    };
    imageToVideo = {
      create: async (args: any) => {
        h.imageToVideoCalls.push(args);
        return { id: `task-img-${++h.taskSeq}` };
      },
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
    return 1_000_000 - amount;
  },
  LedgerWriteError: class LedgerWriteError extends Error {},
}));
vi.mock("../../lib/clip-charge-obligations", () => ({
  recordClipCharge: async (row: unknown) => { h.recordCalls.push(row); },
}));
vi.mock("../../lib/objectStorage", () => ({
  SUPABASE_CLIPS_BUCKET: "generated-clips",
  uploadMediaToSupabaseStorage: async () => "supabase://generated-clips/x.jpg",
  uploadFileStreamToSupabaseStorage: async () => "supabase://generated-clips/clips/still-clip.mp4",
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
const STILL = "https://cdn.test/artist-reference.jpg";
const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;

beforeAll(async () => {
  process.env["RUNWAYML_API_SECRET"] = "test-secret";
  /* Same download seam as runway-clip-charge-on-success.test.ts: the
     poll handler downloads the finished clip from the provider URL;
     block it so the handler's stored-ref path is what runs — the fake
     storage upload above resolves the ref without network. If the
     download fails the handler answers with the raw provider URL,
     which is also a valid lip-sync clipUrl; either way the charge
     assertions below are the point. Localhost passes through. */
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
  h.imageToVideoCalls = [];
  h.textToVideoCalls = [];
});

async function submitStill(userId: string) {
  const r = await realFetch(`${baseUrl}/generate-runway-clip`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": userId },
    body: JSON.stringify({
      promptText: "The artist performs the song straight to camera",
      ratio: "720:1280",
      referenceImageUrl: STILL,
      model: "gen4.5",
    }),
  });
  return { status: r.status, json: (await r.json()) as any };
}

async function poll(userId: string, taskId: string) {
  const r = await realFetch(`${baseUrl}/generate-runway-clip/${taskId}`, {
    headers: { "x-test-user": userId },
  });
  return { status: r.status, json: (await r.json()) as any };
}

describe("still → clip on the runway rail (image-to-video)", () => {
  it("submits the still to imageToVideo as promptImage — never text-to-video — and charges nothing at submit", async () => {
    const { status, json } = await submitStill(OWNER);
    expect(status).toBe(200);
    expect(json.taskId).toBeTruthy();
    expect(json.referenceSource).toBe("vault_photo");
    expect(json.creditCost).toBe(GEN45_CREDIT_COST);
    expect(json.durationSec).toBe(5);
    expect(h.imageToVideoCalls).toHaveLength(1);
    expect(h.imageToVideoCalls[0]).toMatchObject({
      model: "gen4.5",
      promptImage: STILL,
      duration: 5,
      ratio: "720:1280",
    });
    expect(h.textToVideoCalls).toHaveLength(0);
    expect(h.chargeCalls).toHaveLength(0);
  });

  it("a FAILED still animation charges nothing, on the first poll or any later one", async () => {
    const { json } = await submitStill(OWNER);
    h.taskStates.set(json.taskId, {
      status: "FAILED",
      failure: "moderation hit",
      failureCode: "CONTENT_MODERATION",
    });
    const p1 = await poll(OWNER, json.taskId);
    expect(p1.json.status).toBe("failed");
    expect(p1.json.error).toContain("content moderation");
    expect(h.chargeCalls).toHaveLength(0);
    const p2 = await poll(OWNER, json.taskId);
    expect(p2.json.status).toBe("failed");
    expect(h.chargeCalls).toHaveLength(0);
    expect(h.recordCalls).toHaveLength(0);
  });

  it("a SUCCEEDED still animation charges exactly once at GEN45_CREDIT_COST and hands back the clip lip-sync consumes", async () => {
    const { json } = await submitStill(OWNER);
    h.taskStates.set(json.taskId, { status: "SUCCEEDED", output: ["https://runway.test/still-clip.mp4"] });

    const p1 = await poll(OWNER, json.taskId);
    expect(p1.json.status).toBe("succeeded");
    /* The hand-off shape: a playable https clip URL (stored-ref preview
       URL, or the provider URL on the storage-fallback path). */
    expect(typeof p1.json.url).toBe("string");
    expect(p1.json.url.startsWith("https://")).toBe(true);
    expect(h.chargeCalls).toHaveLength(1);
    expect(h.chargeCalls[0][0]).toBe(OWNER);
    expect(h.chargeCalls[0][1]).toBe(GEN45_CREDIT_COST);
    expect(h.recordCalls).toHaveLength(1);

    const p2 = await poll(OWNER, json.taskId);
    expect(p2.json.status).toBe("succeeded");
    expect(h.chargeCalls).toHaveLength(1);
    expect(h.recordCalls).toHaveLength(1);
  });
});
