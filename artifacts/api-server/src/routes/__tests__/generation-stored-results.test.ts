/**
 * Stack400 s400-stored-results — durable stored results (migration
 * 0333) for bg-generate, thumbnail-generator and bio-generator.
 *
 * The CA-KEY keying gave these rails real server-derived charge
 * idempotency keys with (on that lane) in-process stored results.
 * This lane's half is the DURABLE table: these tests fake
 * @workspace/db with an in-memory generation_stored_results table
 * and pin, per rail:
 *
 *   - a fresh success persists exactly ONE row under the charge key;
 *   - an identical re-ask is served FROM THE TABLE — the stored
 *     body verbatim + exactly the replay marker fields — with ZERO
 *     additional charges and ZERO additional provider calls. There
 *     is no in-process store in this tree, so the table is the only
 *     place the replay can come from: this IS the post-restart case;
 *   - storage failure FAILS OPEN: the request still succeeds once,
 *     the ledger key still prevents any double charge, and nothing
 *     errors;
 *   - (thumbnail + bio) a failed generation refunds and VOIDS its
 *     key, so the retry charges fresh instead of generating free.
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
  /* The generation_stored_results table, keyed by idempotency key. */
  stored: new Map<string, { userId: string; rail: string; result: any }>(),
  storeMode: "ok" as "ok" | "throw",
  selectMode: "ok" as "ok" | "throw",
  bgGenerateCalls: 0,
  thumbGenerateCalls: 0,
  thumbMode: "ok" as "ok" | "throw",
  thumbProfileRefunds: 0,
  bioFetchCalls: 0,
  bioMode: "ok" as "ok" | "throw",
}));

/* The rails always look up BY KEY — recover the key from the eq()
   the lib built (drizzle parameterizes the value; it rides the
   condition's queryChunks as a Param node). Same walker as the
   contract / post-assist stored-result fakes. */
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
      if (key && h.chargedKeys.has(key)) return h.balance; // ledger replay suppression
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

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
  getOpenAI: () => ({
    images: {
      generate: async () => {
        h.thumbGenerateCalls++;
        if (h.thumbMode === "throw") throw new Error("image provider down");
        return { data: [{ b64_json: "aW1hZ2UtYnl0ZXM=" }] };
      },
      edit: async () => {
        h.thumbGenerateCalls++;
        if (h.thumbMode === "throw") throw new Error("image provider down");
        return { data: [{ b64_json: "aW1hZ2UtYnl0ZXM=" }] };
      },
    },
  }),
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => null,
  addCreditsToProfile: async (_userId: string, amount: number) => {
    h.thumbProfileRefunds += amount;
    return { oldCredits: 0, newCredits: 0, created: false };
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (objectName: string) => `storage-ref:${objectName}`,
  refreshSupabaseStorageUrl: async (ref: string) => `https://signed.example/${ref}`,
  normalizeToStorageRef: (u: string) => u,
}));

/* The stored-result seam: @workspace/db is replaced with a key-aware
   fake over h.stored. The storage lib's only db uses are the
   select-by-key and the conflict-do-nothing insert, so the fake
   models exactly those two chains; the table objects stay real. */
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => ({
          limit: async () => {
            if (h.selectMode === "throw") throw new Error("select failed");
            const key = keyFromCondition(cond);
            const row = key !== null ? h.stored.get(key) : undefined;
            return row ? [row] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: { idempotencyKey: string; userId: string; rail: string; result: any }) => ({
        onConflictDoNothing: async () => {
          if (h.storeMode === "throw") throw new Error("store write failed");
          if (!h.stored.has(v.idempotencyKey)) {
            h.stored.set(v.idempotencyKey, { userId: v.userId, rail: v.rail, result: v.result });
          }
          return [];
        },
      }),
    }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    delete: () => ({ where: async () => [] }),
  };
  return { ...actual, db: fakeDb };
});

import bgGenerateRouter, { __resetBgGenerateReplayCache } from "../generate/bg-generate";
import thumbnailRouter, { __resetThumbnailReplayCache } from "../generate/thumbnail-generator";
import bioRouter, { generateBiosForUser, __resetBioReplayCache } from "../generate/bio-generator";
import { __setBgImageDepsForTests } from "../../lib/bg-image-client";

let base = "";
let server: ReturnType<express.Express["listen"]>;
/* beforeEach stubs the global fetch for the bio rail's provider call;
   the HTTP helper below must keep the REAL fetch for the test server. */
const realFetch = globalThis.fetch;

beforeAll(async () => {
  process.env["OPENAI_API_KEY"] = "test-key-not-real";
  const app = express();
  app.use(express.json());
  app.use(bgGenerateRouter);
  app.use(thumbnailRouter);
  app.use(bioRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  __setBgImageDepsForTests(null);
  delete process.env["OPENAI_API_KEY"];
  vi.unstubAllGlobals();
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  /* Join15 composition: the rails also carry the CA-KEY in-process
     replay caches in front of the durable layer — reset them too, so
     each case starts from a cold replay state on both layers. */
  __resetBgGenerateReplayCache();
  __resetThumbnailReplayCache();
  __resetBioReplayCache();
  h.balance = 100_000;
  h.charges = []; h.refunds = []; h.voids = [];
  h.chargedKeys = new Set();
  h.stored = new Map();
  h.storeMode = "ok"; h.selectMode = "ok";
  h.bgGenerateCalls = 0;
  h.thumbGenerateCalls = 0; h.thumbMode = "ok"; h.thumbProfileRefunds = 0;
  h.bioFetchCalls = 0; h.bioMode = "ok";
  __setBgImageDepsForTests({
    generate: async () => { h.bgGenerateCalls++; return Buffer.from("fake-png-bytes"); },
    upload: async (userId: string) => `https://cdn.example/bg-plates/${userId}/plate.png`,
  });
  vi.stubGlobal("fetch", vi.fn(async () => {
    h.bioFetchCalls++;
    if (h.bioMode === "throw") return { ok: false, json: async () => ({}) };
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              instagram: "ig bio",
              tiktok: "tt bio",
              twitter: "tw bio",
              youtube: "yt bio",
            }),
          },
        }],
      }),
    };
  }));
});

async function post(path: string, body?: unknown) {
  const res = await realFetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null };
}

describe("bg-generate — durable stored results (0333)", () => {
  const body = { prompt: "a moody jazz club stage", style: "studio", idempotencyKey: "attempt-durable-1" };

  it("a fresh success persists exactly one row; the re-ask is served from the table — no charge, no provider call", async () => {
    const a = await post("/bg-generate", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined(); // fresh answers stay bare
    expect(h.charges).toHaveLength(1);
    expect(h.bgGenerateCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    const row = [...h.stored.values()][0]!;
    expect(row.rail).toBe("bg-generate");
    expect(row.result).toEqual(a.json);

    const b = await post("/bg-generate", body);
    expect(b.status).toBe(200);
    expect(h.charges).toHaveLength(1); // zero additional charges
    expect(h.bgGenerateCalls).toBe(1); // zero additional provider calls
    expect(b.json).toEqual({
      ...a.json,
      replayed: true,
      replayNote: "This is the background plate you already made for this request — tweak the prompt or style for a fresh one.",
    });
  });

  it("storage failure fails open: the request still succeeds once, with no double charge and no error", async () => {
    h.storeMode = "throw"; // writes fail
    const a = await post("/bg-generate", body);
    expect(a.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.bgGenerateCalls).toBe(1);
    expect(h.stored.size).toBe(0);

    h.selectMode = "throw"; // reads fail too
    const b = await post("/bg-generate", body);
    expect(b.status).toBe(200); // degraded, never an error
    expect(h.charges).toHaveLength(1); // the ledger key still prevents a double charge
  });
});

describe("thumbnail-generator — durable stored results (0333)", () => {
  const body = { prompt: "epic gaming setup reveal", aspectRatio: "16:9" };

  it("a fresh batch persists exactly one row; the re-ask is served from the table — no charge, no provider calls", async () => {
    const a = await post("/thumbnail-generator", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(1);
    expect(h.thumbGenerateCalls).toBe(4); // one batch of 4
    expect(h.stored.size).toBe(1);
    const row = [...h.stored.values()][0]!;
    expect(row.rail).toBe("thumbnail-generator");
    expect(row.result).toEqual(a.json);

    const b = await post("/thumbnail-generator", body);
    expect(b.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.thumbGenerateCalls).toBe(4);
    expect(b.json).toEqual({
      ...a.json,
      replayed: true,
      replayNote: "These are the thumbnails you already made for this request — tweak the prompt or style for a fresh batch.",
    });
  });

  it("storage failure fails open: the batch still succeeds once, with no double charge and no error", async () => {
    h.storeMode = "throw";
    const a = await post("/thumbnail-generator", body);
    expect(a.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.selectMode = "throw";
    const b = await post("/thumbnail-generator", body);
    expect(b.status).toBe(200);
    expect(h.charges).toHaveLength(1);
  });

  it("a failed batch refunds and VOIDS its key, so the retry charges fresh (was: free regeneration)", async () => {
    h.thumbMode = "throw";
    const failed = await post("/thumbnail-generator", body);
    expect(failed.status).toBe(500);
    expect(h.thumbProfileRefunds).toBe(200);
    expect(h.voids).toHaveLength(1);
    expect(h.voids[0]).toMatch(/^thumbnail-generator:user-1:/);
    expect(h.stored.size).toBe(0); // failures never persist a row

    h.thumbMode = "ok";
    const retry = await post("/thumbnail-generator", body);
    expect(retry.status).toBe(200);
    expect(h.charges).toHaveLength(2); // the retry paid again
  });
});

describe("bio-generator — durable stored results (0333)", () => {
  const input = { niche: "fitness coaching", personality: ["bold", "funny"], achievements: [] as string[] };

  it("a fresh success persists exactly one row; the re-ask is served from the table — no charge, no provider call", async () => {
    const a = await generateBiosForUser(USER, input, { action: "Bio Generator" });
    expect(a.replayed).toBeUndefined();
    expect(h.charges).toHaveLength(1);
    expect(h.bioFetchCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    const row = [...h.stored.values()][0]!;
    expect(row.rail).toBe("bio-generator");
    expect(row.result).toEqual({ bios: a.bios, creditsRemaining: a.creditsRemaining });

    const b = await generateBiosForUser(USER, input, { action: "Bio Generator" });
    expect(b.replayed).toBe(true);
    expect(b.bios).toEqual(a.bios);
    expect(b.creditsRemaining).toBe(a.creditsRemaining);
    expect(h.charges).toHaveLength(1);
    expect(h.bioFetchCalls).toBe(1);
  });

  it("the website route surfaces the replay honestly (replayed + note), fresh answers stay bare", async () => {
    const a = await post("/generate-bio", { niche: "fitness coaching", personality: ["bold"] });
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();

    const b = await post("/generate-bio", { niche: "fitness coaching", personality: ["bold"] });
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(b.json?.["replayNote"]).toBe(
      "These are the bios you already made for this request — tweak the words for a fresh set.",
    );
    expect(b.json?.["bios"]).toEqual(a.json?.["bios"]);
    expect(h.charges).toHaveLength(1);
    expect(h.bioFetchCalls).toBe(1);
  });

  it("a caller-supplied key is threaded verbatim and replays under that same key", async () => {
    const a = await generateBiosForUser(USER, input, {
      action: "API: Bio Generator",
      idempotencyKey: "api:key-1:abc",
    });
    expect(a.replayed).toBeUndefined();
    expect(h.charges[0]!.key).toBe("api:key-1:abc");
    expect(h.stored.has("api:key-1:abc")).toBe(true);

    const b = await generateBiosForUser(USER, input, {
      action: "API: Bio Generator",
      idempotencyKey: "api:key-1:abc",
    });
    expect(b.replayed).toBe(true);
    expect(h.charges).toHaveLength(1);
    expect(h.bioFetchCalls).toBe(1);
  });

  it("storage failure fails open: the generation still succeeds once, with no double charge and no error", async () => {
    h.storeMode = "throw";
    const a = await generateBiosForUser(USER, input, { action: "Bio Generator" });
    expect(a.bios).toHaveLength(4);
    expect(h.charges).toHaveLength(1);
    expect(h.stored.size).toBe(0);

    h.selectMode = "throw";
    const b = await generateBiosForUser(USER, input, { action: "Bio Generator" });
    expect(b.bios).toHaveLength(4);
    expect(h.charges).toHaveLength(1); // the ledger key still prevents a double charge
  });

  it("a failed generation refunds and VOIDS its key, so the retry charges fresh", async () => {
    h.bioMode = "throw";
    await expect(
      generateBiosForUser(USER, input, { action: "Bio Generator" }),
    ).rejects.toThrow("Bio generation failed.");
    expect(h.refunds).toEqual([100]);
    expect(h.voids).toHaveLength(1);
    expect(h.voids[0]).toMatch(/^bio-generator:user-1:/);
    expect(h.stored.size).toBe(0);

    h.bioMode = "ok";
    const retry = await generateBiosForUser(USER, input, { action: "Bio Generator" });
    expect(retry.bios).toHaveLength(4);
    expect(h.charges).toHaveLength(2); // the retry paid again
  });
});
