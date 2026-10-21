/**
 * D5 G15 + owner price ruling — POST /posts/assist.
 *
 * Before: the route charged 1 VB with NO idempotency key and NO
 * refund leg — a provider throw kept the money, and a double-submit
 * charged twice. Owner ruling (Oct 20, 2026): the price is now
 * 100 Visual Bucs. These tests pin:
 *   - POST_ASSIST_CREDITS === 100 (the owner-ruled price);
 *   - a provider failure after the charge refunds exactly 100, once,
 *     and voids the charge key so a retry can charge again;
 *   - two identical submits charge once (server-derived key).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  charges: [] as Array<{ amount: number; idempotencyKey?: string }>,
  refunds: [] as Array<{ amount: number; action?: string }>,
  voidedKeys: [] as string[],
  chargedKeys: new Set<string>(),
  aiMode: "throw" as "throw" | "ok",
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    req.userCredits = 100_000;
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async (_u: string, amount: number, _meta: any, opts: any) => {
    const key = opts?.idempotencyKey as string | undefined;
    if (key) {
      if (h.chargedKeys.has(key)) return 4242;
      h.chargedKeys.add(key);
    }
    h.charges.push({ amount, idempotencyKey: key });
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
  voidChargeIdempotencyKey: vi.fn(async (key: string) => {
    h.voidedKeys.push(key);
    h.chargedKeys.delete(key);
  }),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          if (h.aiMode === "throw") throw new Error("provider down");
          return { choices: [{ message: { content: "Golden hour, golden sound." } }] };
        },
      },
    },
  }),
  getTextModel: () => "test-model",
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => null,
  addCreditsToProfile: async () => undefined,
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: async () => undefined,
}));

vi.mock("../../lib/social-crypto", () => ({
  encryptToken: (s: string) => s,
  decryptToken: (s: string) => s,
  isSocialTokenKeyConfigured: () => false,
}));

vi.mock("../../lib/social-meta", () => ({
  buildAuthUrl: () => "",
  buildFacebookAuthUrl: () => "",
  exchangeCodeForLongLivedToken: async () => {
    throw new Error("no Meta in route tests");
  },
  exchangeFacebookCodeForLongLivedToken: async () => {
    throw new Error("no Meta in route tests");
  },
  fetchInstagramProfile: async () => {
    throw new Error("no Meta in route tests");
  },
  listPages: async () => [],
  publishReelToInstagram: async () => {
    throw new Error("no Meta in route tests");
  },
  publishVideoToPage: async () => {
    throw new Error("no Meta in route tests");
  },
  MetaApiError: class MetaApiError extends Error {},
}));

vi.mock("../../lib/social-idempotency", () => ({
  claimPublishAttempt: async () => ({ claimed: true }),
  createDrizzleAttemptStore: () => ({}),
}));

vi.mock("../../lib/social-tiktok", () => ({
  buildTikTokAuthUrl: () => "",
  exchangeCodeForTikTokTokens: async () => {
    throw new Error("no TikTok in route tests");
  },
  refreshTikTokTokens: async () => {
    throw new Error("no TikTok in route tests");
  },
  fetchTikTokUserInfo: async () => {
    throw new Error("no TikTok in route tests");
  },
  uploadDraftToTikTok: async () => {
    throw new Error("no TikTok in route tests");
  },
  downloadVideoBytes: async () => new Uint8Array(),
  TikTokApiError: class TikTokApiError extends Error {},
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) => typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: () => false,
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

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
      insert: () => ({ values: async () => [] }),
      update: () => ({ set: () => ({ where: async () => [] }) }),
      delete: () => ({ where: async () => [] }),
    },
  };
});

import socialRouter, { POST_ASSIST_CREDITS } from "../social";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use(socialRouter);
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
  h.voidedKeys = [];
  h.chargedKeys = new Set();
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

describe("POST /posts/assist — owner-ruled 100 VB price + refund leg (G15)", () => {
  it("pins the owner-ruled price at exactly 100 Visual Bucs", () => {
    expect(POST_ASSIST_CREDITS).toBe(100);
  });

  it("refunds exactly 100, once, when the provider throws after the charge", async () => {
    const r = await post("/posts/assist", { prompt: "my new single drops Friday", tone: "hype" });
    expect(r.status).toBe(500);
    expect(r.json.error).toBe("assist_failed");
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.charges[0]!.idempotencyKey).toMatch(/^post_assist:user-1:auto:/);
    expect(h.refunds).toEqual([{ amount: 100, action: "post_assist — Refund (assist failed)" }]);
    expect(h.voidedKeys).toEqual([h.charges[0]!.idempotencyKey]);
  });

  it("a double-submit of the same draft charges once", async () => {
    h.aiMode = "ok";
    const body = { prompt: "my new single drops Friday", tone: "hype" };
    const first = await post("/posts/assist", body);
    const second = await post("/posts/assist", body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.json.draft).toBe("Golden hour, golden sound.");
    expect(h.charges).toHaveLength(1);
    expect(h.refunds).toEqual([]);
  });

  it("delivers without a refund on the happy path", async () => {
    h.aiMode = "ok";
    const r = await post("/posts/assist", { prompt: "studio session recap", tone: "chill" });
    expect(r.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.refunds).toEqual([]);
  });
});
