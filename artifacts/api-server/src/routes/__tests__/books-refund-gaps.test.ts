/**
 * D5 refund-gap pins — Books (G3, G6) + U1 server-derived idempotency.
 *
 * POST /books/ai/assist (100 VB) and POST /books/:id/cover/generate
 * (200 VB) charged first and delivered second with no refund leg:
 * provider throw, empty image payload, storage throw, or book-row
 * write throw all left the member charged for nothing. Both also took
 * a CLIENT-OPTIONAL idempotency key (U1) — omitting it meant a retry
 * double-charged for one delivery. These tests pin the refunds and
 * the derived-key behavior.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  charges: [] as Array<{ amount: number; idempotencyKey?: string }>,
  refunds: [] as Array<{ amount: number; action?: string }>,
  voidedKeys: [] as string[],
  chargedKeys: new Set<string>(),
  book: null as Record<string, any> | null,
  failBookUpdate: false,
  aiMode: "throw" as "throw" | "ok" | "empty-image",
  failUpload: false,
}));

function creditsFactory() {
  return {
    chargeCredits: vi.fn(async (_u: string, amount: number, meta: any, opts: any) => {
      const key = (opts?.idempotencyKey ?? meta?.idempotencyKey) as string | undefined;
      if (key) {
        if (h.chargedKeys.has(key)) return 4242; // replay — no second charge
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
  };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    req.userCredits = 100_000;
    next();
  },
}));

vi.mock("../../lib/credits", () => creditsFactory());
vi.mock("../../lib/credits.js", () => creditsFactory());

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          if (h.aiMode === "throw") throw new Error("provider down");
          return { choices: [{ message: { content: "Polished suggestion." } }] };
        },
      },
    },
    images: {
      generate: async () => {
        if (h.aiMode === "throw") throw new Error("provider down");
        if (h.aiMode === "empty-image") return { data: [{}] };
        return { data: [{ b64_json: "aGVsbG8=" }] };
      },
    },
  }),
  getTextModel: () => "test-model",
}));

vi.mock("../../lib/book-export", () => ({
  generateEpub: vi.fn(async () => Buffer.from("")),
  generatePdf: vi.fn(async () => Buffer.from("")),
  generateCoverPdf: vi.fn(async () => Buffer.from("")),
  bookFilename: vi.fn(() => "book"),
}));

vi.mock("../../lib/r2-client", () => ({
  r2Upload: vi.fn(async () => {
    if (h.failUpload) throw new Error("storage down");
    return "books/covers/x.png";
  }),
  r2PublicUrl: vi.fn((key: string) => `https://cdn.example/${key}`),
}));

vi.mock("../../lib/lulu-print", () => ({
  isLuluConfigured: () => false,
  getCoverDimensions: () => ({}),
  getPrintQuote: async () => ({}),
  getShippingOptions: async () => [],
  validateInterior: async () => ({}),
  validateCover: async () => ({}),
  createPrintOrder: async () => ({}),
  getOrderStatus: async () => ({}),
  getPrintJob: async () => ({}),
  LULU_SKU_6X9_BW_PAPERBACK: "sku-bw",
  LULU_SKU_6X9_COLOR_PAPERBACK: "sku-color",
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const selectChain: any = {
    where: () => selectChain,
    orderBy: () => selectChain,
    limit: async () => (h.book ? [h.book] : []),
    then: (res: any, rej: any) => Promise.resolve(h.book ? [h.book] : []).then(res, rej),
  };
  return {
    ...actual,
    db: {
      select: () => ({ from: () => selectChain }),
      update: () => ({
        set: (vals: any) => ({
          where: () => {
            if (h.failBookUpdate) return Promise.reject(new Error("simulated book write failure"));
            if (h.book) Object.assign(h.book, vals);
            return Promise.resolve([]);
          },
        }),
      }),
      insert: () => ({ values: async () => [] }),
      delete: () => ({ where: async () => [] }),
    },
  };
});

import booksRouter from "../books";

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
  app.use(booksRouter);
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
  h.book = {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "user-1",
    title: "My Memoir",
    subtitle: "",
    author_name: "Tester",
    description: "A life in music.",
    genre: "memoir",
    cover_url: null,
  };
  h.failBookUpdate = false;
  h.aiMode = "throw";
  h.failUpload = false;
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

describe("G6 — POST /books/ai/assist provider failure refunds the 100 VB charge", () => {
  it("refunds exactly once and voids the charge key when the provider throws", async () => {
    const r = await post("/books/ai/assist", { bookId: "11111111-1111-4111-8111-111111111111", action: "rewrite", text: "draft text" });
    expect(r.status).toBe(500);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.refunds).toEqual([
      { amount: 100, action: "books_ai_assist — Refund (generation failed)" },
    ]);
    expect(h.voidedKeys).toHaveLength(1);
  });

  it("delivers without a refund when the provider answers", async () => {
    h.aiMode = "ok";
    const r = await post("/books/ai/assist", { bookId: "11111111-1111-4111-8111-111111111111", action: "rewrite", text: "draft text" });
    expect(r.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.refunds).toEqual([]);
  });

  it("U1: two identical keyless requests charge once — the server derives the key", async () => {
    h.aiMode = "ok";
    const body = { bookId: "11111111-1111-4111-8111-111111111111", action: "rewrite", text: "same draft" };
    const first = await post("/books/ai/assist", body);
    const second = await post("/books/ai/assist", body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.idempotencyKey).toMatch(/^books_ai_assist:user-1:auto:/);
  });
});

describe("G3 — POST /books/:id/cover/generate failures refund the 200 VB charge", () => {
  it("refunds when the image provider throws", async () => {
    const r = await post("/books/11111111-1111-4111-8111-111111111111/cover/generate", { style: "bold" });
    expect(r.status).toBe(500);
    expect(h.charges).toEqual([{ amount: 200, idempotencyKey: expect.stringMatching(/^books_cover_generate:/) }]);
    expect(h.refunds).toEqual([
      { amount: 200, action: "books_cover_generate — Refund (generation failed)" },
    ]);
  });

  it("refunds when the provider returns no image data", async () => {
    h.aiMode = "empty-image";
    const r = await post("/books/11111111-1111-4111-8111-111111111111/cover/generate", { style: "bold" });
    expect(r.status).toBe(500);
    expect(h.refunds).toHaveLength(1);
    expect(h.refunds[0]!.amount).toBe(200);
  });

  it("refunds when the storage upload throws", async () => {
    h.aiMode = "ok";
    h.failUpload = true;
    const r = await post("/books/11111111-1111-4111-8111-111111111111/cover/generate", { style: "bold" });
    expect(r.status).toBe(500);
    expect(h.refunds).toHaveLength(1);
    expect(h.refunds[0]!.amount).toBe(200);
  });

  it("refunds when the book-row write throws after the upload", async () => {
    h.aiMode = "ok";
    h.failBookUpdate = true;
    const r = await post("/books/11111111-1111-4111-8111-111111111111/cover/generate", { style: "bold" });
    expect(r.status).toBe(500);
    expect(h.refunds).toHaveLength(1);
    expect(h.refunds[0]!.amount).toBe(200);
    expect(h.voidedKeys).toHaveLength(1);
  });

  it("delivers without a refund on the happy path", async () => {
    h.aiMode = "ok";
    const r = await post("/books/11111111-1111-4111-8111-111111111111/cover/generate", { style: "bold" });
    expect(r.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.refunds).toEqual([]);
    expect(h.book!.cover_url).toMatch(/^https:\/\/cdn\.example\//);
  });
});
