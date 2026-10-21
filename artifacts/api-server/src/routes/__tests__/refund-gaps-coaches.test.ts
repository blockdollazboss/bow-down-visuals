/**
 * D5 refund-gap pins — the text-provider coach family (G9–G14).
 *
 * Every route in this file charged first and called a text provider
 * second, with NO refund leg: a provider throw or an unusable reply
 * left the member charged for nothing. Each test drives the real
 * router with the provider steered to fail AFTER the charge and pins:
 *   - the charge happened exactly once at the route's price;
 *   - the refund landed exactly once at the SAME amount;
 *   - the response is the route's existing honest failure status.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  charges: [] as Array<{ amount: number; idempotencyKey?: string }>,
  refunds: [] as Array<{ amount: number; action?: string }>,
  aiMode: "throw" as "throw" | "empty",
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    req.userCredits = 100_000;
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async (_u: string, amount: number, meta: any) => {
    h.charges.push({ amount, idempotencyKey: meta?.idempotencyKey });
    return 4242;
  }),
  refundCredits: vi.fn(async (_u: string, amount: number, meta: any) => {
    h.refunds.push({ amount, action: meta?.action });
  }),
  buildChargeIdempotencyKey: (
    scope: string,
    userId: string,
    clientKey: string | null | undefined,
    intent: Record<string, unknown>,
  ) =>
    clientKey
      ? `${scope}:${userId}:client:${clientKey}`
      : `${scope}:${userId}:auto:${JSON.stringify(intent)}`,
  voidChargeIdempotencyKey: vi.fn(async () => {}),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          if (h.aiMode === "throw") throw new Error("provider down");
          return { choices: [{ message: { content: "{}" } }] };
        },
      },
    },
  }),
  getTextModel: () => "test-model",
}));

vi.mock("openai", () => {
  class APIError extends Error {
    status?: number;
    code?: string;
  }
  class OpenAI {
    static APIError = APIError;
  }
  return { default: OpenAI, APIError };
});

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadPublicMediaToR2: vi.fn(async () => "https://cdn.example/x.png"),
}));

/* monetization-coach reads the creator catalog through @workspace/db —
   a chainable fake that resolves empty everywhere is enough (its own
   reader degrades each source to zero independently). */
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const chain: any = {
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
  };
  return {
    ...actual,
    db: {
      select: () => ({ from: () => chain }),
      execute: async () => ({ rows: [{ cents: 0 }] }),
    },
  };
});

import aiCoachRouter from "../generate/ai-coach";
import hookStudioRouter from "../generate/hook-studio";
import randomizerRouter from "../generate/randomizer";
import monetizationCoachRouter from "../generate/monetization-coach";
import aiCopilotRouter from "../generate/ai-copilot";
import jewelryRouter from "../generate/jewelry";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  process.env["OPENAI_API_KEY"] = "test-key";
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use(aiCoachRouter);
  app.use(hookStudioRouter);
  app.use(randomizerRouter);
  app.use(monetizationCoachRouter);
  app.use("/ai-copilot", aiCopilotRouter);
  app.use(jewelryRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.charges = [];
  h.refunds = [];
  h.aiMode = "throw";
  vi.clearAllMocks();
});

async function post(path: string, body: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("G9 — POST /ai-coach provider failure refunds the 100 VB charge", () => {
  it("refunds exactly once when the provider throws", async () => {
    const r = await post("/ai-coach", {
      posts: [{ title: "launch day", views: 10, likes: 2, comments: 1, shares: 0 }],
    });
    expect(r.status).toBe(502);
    expect(h.charges).toEqual([{ amount: 100, idempotencyKey: undefined }]);
    expect(h.refunds).toHaveLength(1);
    expect(h.refunds[0]!.amount).toBe(100);
    expect(h.refunds[0]!.action).toMatch(/Refund/);
  });

  it("refunds exactly once when the reply has no usable insights", async () => {
    h.aiMode = "empty";
    const r = await post("/ai-coach", {
      posts: [{ title: "launch day", views: 10, likes: 2, comments: 1, shares: 0 }],
    });
    expect(r.status).toBe(502);
    expect(h.charges).toHaveLength(1);
    expect(h.refunds).toHaveLength(1);
    expect(h.refunds[0]!.amount).toBe(100);
  });
});

describe("G10 — POST /hook-studio provider failure refunds the 100 VB charge", () => {
  it("refunds exactly once when the provider throws", async () => {
    const r = await post("/hook-studio", { mode: "hooks", videoType: "music-promo", topic: "new single" });
    expect(r.status).toBe(502);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.refunds).toHaveLength(1);
    expect(h.refunds[0]!.amount).toBe(100);
    expect(h.refunds[0]!.action).toMatch(/Hook Generator/);
  });
});

describe("G12 — POST /randomizer provider failure refunds the 100 VB charge", () => {
  it("refunds exactly once when the provider throws", async () => {
    const r = await post("/randomizer", { category: "video-ideas" });
    expect(r.status).toBe(502);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.refunds).toHaveLength(1);
    expect(h.refunds[0]!.amount).toBe(100);
    expect(h.refunds[0]!.action).toMatch(/Randomizer/);
  });
});

describe("G11 — POST /monetization-coach provider failure refunds the 100 VB charge", () => {
  it("refunds exactly once when the provider throws", async () => {
    const r = await post("/monetization-coach", {
      niche: "indie hip-hop",
      platforms: ["youtube"],
      followers: { youtube: 1200 },
      cadence: 3,
    });
    expect(r.status).toBe(502);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.refunds).toHaveLength(1);
    expect(h.refunds[0]!.amount).toBe(100);
    expect(h.refunds[0]!.action).toMatch(/Monetization Coach/);
  });
});

describe("G14 — POST /ai-copilot/analyze provider failure refunds the 50 VB charge", () => {
  it("refunds exactly once when the provider answers not-ok", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 500, text: async () => "err" }));
    try {
      const r = await post("/ai-copilot/analyze", {
        scenes: [{ id: "s1", sceneNumber: 1, durationSec: 5 }],
        songTitle: "My Song",
      });
      expect(r.status).toBe(500);
      expect(r.json.error).toBe("analysis_failed");
      expect(h.charges).toHaveLength(1);
      expect(h.charges[0]!.amount).toBe(50);
      expect(h.refunds).toHaveLength(1);
      expect(h.refunds[0]!.amount).toBe(50);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("G13 — POST /jewelry/consult provider failure refunds the 100 VB charge", () => {
  it("refunds exactly once when the provider throws", async () => {
    const r = await post("/jewelry/consult", { message: "I want a gold pendant for my logo" });
    expect(r.status).toBe(500);
    expect(r.json.error).toMatch(/Something went wrong/);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.refunds).toHaveLength(1);
    expect(h.refunds[0]!.amount).toBe(100);
    expect(h.refunds[0]!.action).toMatch(/Consultant Refund/);
  });
});
