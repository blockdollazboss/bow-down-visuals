/**
 * CA-6 (charge audit B6) — replay protection for the SYNC generate
 * rails t–w. Representative families pinned over HTTP with the house
 * harness (fake keyed ledger + in-memory generation_stored_results):
 *
 *   - title-studio (OpenAI chat rail): replay charges once, provider
 *     once, body verbatim + replayed:true; a provider failure refunds
 *     and VOIDS the key, so the retry charges fresh and succeeds.
 *   - translate-captions (direct-fetch rail): replay charges once;
 *     a provider failure refunds the full multi-language cost and
 *     VOIDS the key, so the retry charges fresh and succeeds.
 *   - video-trim (ffmpeg rail): replay charges once, ffmpeg once;
 *     an ffmpeg failure refunds + voids, retry charges fresh.
 *
 * Fresh responses are byte-identical to the pre-CA-6 wire shape (no
 * replayed field); only replays gain exactly `replayed: true`.
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
  titleCalls: 0,
  titleMode: "ok" as "ok" | "throw",
  ffmpegCalls: 0,
  ffmpegMode: "ok" as "ok" | "throw",
  translateMode: "ok" as "ok" | "throw",
  fetchCalls: 0,
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
    refundCreditsGuaranteed: async (_userId: string, amount: number, _meta: unknown, opts?: { idempotencyKey?: string | null }) => {
      /* Faithful mirror of the real helper against this fake ledger:
         refund, void only when the refund landed, exactly one retry. */
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          h.balance += amount;
          h.refunds.push(amount);
          if (opts?.idempotencyKey) {
            h.voids.push(opts.idempotencyKey);
            h.chargedKeys.delete(opts.idempotencyKey);
          }
          return true;
        } catch { /* the real helper retries exactly once */ }
      }
      return false;
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

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_q: any, _s: any, n: any) => n(),
}));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          h.titleCalls++;
          if (h.titleMode === "throw") throw new Error("model down");
          return {
            choices: [{
              message: {
                content: JSON.stringify({
                  titles: [{ title: "Big Title", score: 91, why: "hooks fast" }],
                  description: "desc",
                  tags: ["music"],
                  note: "note",
                }),
              },
            }],
          };
        },
      },
    },
  }),
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (name: string) => `ref:${name}`,
  refreshSupabaseStorageUrl: async (ref: string) => `https://cdn.test/${ref}`,
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { writeFileSync } = await import("node:fs");
  return {
    ...actual,
    execFile: (_file: string, args: string[], options: unknown, callback?: unknown) => {
      const cb = (typeof options === "function" ? options : callback) as (err: Error | null, stdout: string, stderr: string) => void;
      h.ffmpegCalls++;
      if (h.ffmpegMode === "throw") {
        cb(new Error("ffmpeg died"), "", "");
        return;
      }
      const out = args[args.length - 1];
      if (out) writeFileSync(out, Buffer.from("fake-video-bytes"));
      cb(null, "", "");
    },
  };
});

import titleStudioRouter from "../generate/title-studio";
import translateCaptionsRouter from "../generate/translate-captions";
import videoTrimRouter from "../generate/video-trim";
import { __resetCa6ReplayCache } from "../generate/ca6-replay-guard";

let server: any;
let baseUrl: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(titleStudioRouter);
  app.use(translateCaptionsRouter);
  app.use(videoTrimRouter);
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
  h.titleCalls = 0;
  h.titleMode = "ok";
  h.ffmpegCalls = 0;
  h.ffmpegMode = "ok";
  h.translateMode = "ok";
  h.fetchCalls = 0;
  __resetCa6ReplayCache();
  vi.stubGlobal("fetch", async (url: string) => {
    h.fetchCalls++;
    const u = String(url);
    if (u.includes("api.openai.com")) {
      if (h.translateMode === "throw") return { ok: false, status: 502, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(["Hola mundo"]) } }],
        }),
      };
    }
    /* Source-video download for video-trim. */
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    };
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

describe("CA-6 title-studio (sync OpenAI rail)", () => {
  const body = { topic: "my new single", platform: "youtube", tone: "hype", keywords: "rap" };

  it("fresh works; identical replay charges once, calls the model once, body verbatim + replayed:true", async () => {
    const first = await post("/title-studio", body);
    expect(first.status).toBe(200);
    expect(first.json.replayed).toBeUndefined();
    expect(first.json.titles?.[0]?.title).toBe("Big Title");

    const second = await post("/title-studio", body);
    expect(second.status).toBe(200);
    expect(second.json.replayed).toBe(true);
    const { replayed, ...rest } = second.json;
    expect(rest).toEqual(first.json);
    expect(h.charges).toHaveLength(1);
    expect(h.titleCalls).toBe(1);
  });

  it("provider failure refunds + voids; the retry charges fresh and succeeds", async () => {
    h.titleMode = "throw";
    const failed = await post("/title-studio", body);
    expect(failed.status).toBe(502);
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);

    h.titleMode = "ok";
    const retry = await post("/title-studio", body);
    expect(retry.status).toBe(200);
    expect(retry.json.replayed).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    expect(h.titleCalls).toBe(2);
  });
});

describe("CA-6 translate-captions (direct-fetch rail)", () => {
  const body = {
    captions: [{ start: 0, end: 1.5, text: "Hello world" }],
    targetLanguages: ["es"],
  };

  it("fresh works; identical replay charges once (50/lang) and fetches once", async () => {
    const first = await post("/translate-captions", body);
    expect(first.status).toBe(200);
    expect(first.json.replayed).toBeUndefined();
    expect(first.json.translations?.es?.[0]?.text).toBe("Hola mundo");
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(50);

    const second = await post("/translate-captions", body);
    expect(second.status).toBe(200);
    expect(second.json.replayed).toBe(true);
    const { replayed, ...rest } = second.json;
    expect(rest).toEqual(first.json);
    expect(h.charges).toHaveLength(1);
    expect(h.fetchCalls).toBe(1);
  });

  it("provider failure refunds the full cost + voids; the retry charges fresh and succeeds", async () => {
    h.translateMode = "throw";
    const failed = await post("/translate-captions", body);
    expect(failed.status).toBe(500);
    expect(h.charges).toHaveLength(1);
    expect(h.refunds).toEqual([50]);
    expect(h.voids).toHaveLength(1);

    h.translateMode = "ok";
    const retry = await post("/translate-captions", body);
    expect(retry.status).toBe(200);
    expect(retry.json.replayed).toBeUndefined();
    expect(h.charges).toHaveLength(2);

    const third = await post("/translate-captions", body);
    expect(third.json.replayed).toBe(true);
    expect(h.charges).toHaveLength(2);
  });
});

describe("CA-6 video-trim (ffmpeg rail)", () => {
  const body = { videoUrl: "https://cdn.test/source.mp4", startTime: "0", endTime: "5" };

  it("fresh works; identical replay charges once and runs ffmpeg once", async () => {
    const first = await post("/trim-video", body);
    expect(first.status).toBe(200);
    expect(first.json.replayed).toBeUndefined();
    expect(first.json.url).toContain("https://cdn.test/");

    const second = await post("/trim-video", body);
    expect(second.status).toBe(200);
    expect(second.json.replayed).toBe(true);
    const { replayed, ...rest } = second.json;
    expect(rest).toEqual(first.json);
    expect(h.charges).toHaveLength(1);
    expect(h.ffmpegCalls).toBe(1);
  });

  it("ffmpeg failure refunds + voids; the retry charges fresh and succeeds", async () => {
    h.ffmpegMode = "throw";
    const failed = await post("/trim-video", body);
    expect(failed.status).toBe(500);
    expect(h.refunds).toHaveLength(1);
    expect(h.voids).toHaveLength(1);

    h.ffmpegMode = "ok";
    const retry = await post("/trim-video", body);
    expect(retry.status).toBe(200);
    expect(retry.json.replayed).toBeUndefined();
    expect(h.charges).toHaveLength(2);
  });
});
