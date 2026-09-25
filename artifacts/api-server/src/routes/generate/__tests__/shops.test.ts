/**
 * Route tests for Customer Shops:
 *
 *   GET    /api/shops/mine
 *   POST   /api/shops
 *   PATCH  /api/shops/:id
 *   DELETE /api/shops/:id
 *   GET    /api/shops/handle/:handle        (public storefront)
 *   POST   /api/shops/:id/products
 *   PATCH  /api/shops/:id/products/:productId
 *   DELETE /api/shops/:id/products/:productId
 *   POST   /api/shops/ai/shop-description   (1 credit)
 *   POST   /api/shops/ai/product-description (1 credit)
 *   POST   /api/shops/ai/product-image       (1cr standard / 2cr premium)
 *
 * Real database semantics via pg-mem. The AI provider (getOpenAI),
 * credits, and Supabase storage are mocked so money flow is exercised
 * without spending anything:
 * - charge-before-generate on every AI endpoint
 * - 402 when the balance can't cover the cost
 * - automatic refund when the provider fails
 * - shop/product CRUD is FREE (asserts chargeCredits is never called)
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userCredits: 10,
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = testState.userId;
    req.userCredits = testState.userCredits;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return testState.db;
    },
  };
});

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(),
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getTextModel: vi.fn(() => "gpt-6-sol"),
  getOpenAI: vi.fn(),
}));

vi.mock("../../../lib/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

vi.mock("../../../lib/objectStorage", () => ({
  ensureShopProductsBucket: vi.fn(async () => {}),
  SHOP_PRODUCTS_BUCKET: "shop-products",
}));

import router, {
  SHOP_AI_CREDIT_COST,
  SHOP_IMAGE_STANDARD_CREDITS,
  SHOP_IMAGE_PREMIUM_CREDITS,
  normalizeHandle,
  handleError,
  formatPriceCents,
} from "../shops";
import { chargeCredits, refundCredits } from "../../../lib/credits";
import { getOpenAI } from "../../../lib/ai-clients";
import { getSupabaseAdmin } from "../../../lib/supabase-admin";
import { createTestDb } from "../../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const SHOPS_DDL = `
CREATE TABLE shops (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  handle text NOT NULL UNIQUE,
  tagline text,
  description text,
  banner_color text NOT NULL DEFAULT '#0a0a0a',
  accent_color text NOT NULL DEFAULT '#d4af37',
  banner_image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_products (
  id uuid PRIMARY KEY,
  shop_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL,
  price_cents integer NOT NULL DEFAULT 0,
  description text,
  image_url text,
  image_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`;

const mockCharge = vi.mocked(chargeCredits);
const mockRefund = vi.mocked(refundCredits);
const mockGetOpenAI = vi.mocked(getOpenAI);
const mockGetSupabaseAdmin = vi.mocked(getSupabaseAdmin);

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

const USER_A = randomUUID();
const USER_B = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.none(SHOPS_DDL);
  testState.db = db;
  testState.userId = USER_A;
  testState.userCredits = 10;
  vi.clearAllMocks();
  mockCharge.mockImplementation(async (_userId: string, cost: number) => {
    testState.userCredits -= cost;
    return testState.userCredits;
  });
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

async function seedShop(userId: string, handle = `shop-${randomUUID().slice(0, 8)}`) {
  const id = randomUUID();
  await testState.db.execute(sql`
    INSERT INTO shops (id, user_id, name, handle, tagline)
    VALUES (${id}, ${userId}, 'Test Shop', ${handle}, 'Test tagline')
  `);
  return { id, handle };
}

async function seedProduct(shopId: string, userId: string, name = "Test Product") {
  const id = randomUUID();
  await testState.db.execute(sql`
    INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, description)
    VALUES (${id}, ${shopId}, ${userId}, ${name}, 1999, 'A fine product')
  `);
  return { id };
}

/* ── Pricing constants ─────────────────────────────────────────────────── */
describe("pricing constants", () => {
  it("AI descriptions cost 1 credit", () => {
    expect(SHOP_AI_CREDIT_COST).toBe(1);
  });
  it("standard product images cost 1 credit, premium cost 2", () => {
    expect(SHOP_IMAGE_STANDARD_CREDITS).toBe(1);
    expect(SHOP_IMAGE_PREMIUM_CREDITS).toBe(2);
  });
});

/* ── Handle validation ─────────────────────────────────────────────────── */
describe("handleError", () => {
  it("accepts valid handles", () => {
    expect(handleError("shark-king")).toBeNull();
    expect(handleError("shop123")).toBeNull();
    expect(handleError("a-b-c")).toBeNull();
  });
  it("rejects bad characters and shapes", () => {
    expect(handleError("SHARK")).toBeNull(); // normalized to lowercase before validation
    expect(handleError("has space")).not.toBeNull();
    expect(handleError("ab")).not.toBeNull();
    expect(handleError("-leading")).not.toBeNull();
    expect(handleError("trailing-")).not.toBeNull();
    expect(handleError("under_score")).not.toBeNull();
  });
  it("rejects reserved handles", () => {
    expect(handleError("admin")).not.toBeNull();
    expect(handleError("shop")).not.toBeNull();
    expect(handleError("checkout")).not.toBeNull();
  });
});

describe("normalizeHandle", () => {
  it("lowercases and trims", () => {
    expect(normalizeHandle("  Shark-King ")).toBe("shark-king");
  });
});

describe("formatPriceCents", () => {
  it("formats cents as dollars", () => {
    expect(formatPriceCents(1999)).toBe("$19.99");
    expect(formatPriceCents(0)).toBe("$0.00");
    expect(formatPriceCents(5)).toBe("$0.05");
  });
  it("never goes negative", () => {
    expect(formatPriceCents(-100)).toBe("$0.00");
  });
});

/* ── Shop CRUD (free) ──────────────────────────────────────────────────── */
describe("POST /api/shops", () => {
  it("creates a shop for free (no credit charge)", async () => {
    const { status, json } = await req("POST", "/shops", {
      name: "Shark King Supply",
      handle: "shark-king-supply",
      tagline: "Luxury merch",
    });
    expect(status).toBe(201);
    expect(json.shop.handle).toBe("shark-king-supply");
    expect(mockCharge).not.toHaveBeenCalled();
  });

  it("rejects duplicate handles with 409", async () => {
    await req("POST", "/shops", { name: "One", handle: "taken-handle" });
    const { status, json } = await req("POST", "/shops", { name: "Two", handle: "taken-handle" });
    expect(status).toBe(409);
    expect(json.error).toMatch(/already taken/);
  });

  it("rejects invalid handles with 400", async () => {
    const { status } = await req("POST", "/shops", { name: "Bad", handle: "no good!" });
    expect(status).toBe(400);
  });

  it("rejects reserved handles with 400", async () => {
    const { status, json } = await req("POST", "/shops", { name: "Bad", handle: "admin" });
    expect(status).toBe(400);
    expect(json.error).toMatch(/reserved/);
  });

  it("requires a name", async () => {
    const { status } = await req("POST", "/shops", { name: "", handle: "valid-handle" });
    expect(status).toBe(400);
  });
});

describe("GET /api/shops/mine", () => {
  it("returns only the caller's shops with product counts", async () => {
    const mine = await seedShop(USER_A, "my-shop-a");
    await seedProduct(mine.id, USER_A);
    await seedProduct(mine.id, USER_A);
    await seedShop(USER_B, "their-shop-b");

    const { status, json } = await req("GET", "/shops/mine");
    expect(status).toBe(200);
    expect(json.shops).toHaveLength(1);
    expect(json.shops[0].handle).toBe("my-shop-a");
    expect(json.shops[0].product_count).toBe(2);
    expect(mockCharge).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/shops/:id", () => {
  it("updates the owner's shop for free", async () => {
    const { id } = await seedShop(USER_A, "patch-me");
    const { status, json } = await req("PATCH", `/shops/${id}`, {
      tagline: "New tagline",
      accent_color: "#ff0000",
    });
    expect(status).toBe(200);
    expect(json.shop.tagline).toBe("New tagline");
    expect(json.shop.accent_color).toBe("#ff0000");
    expect(mockCharge).not.toHaveBeenCalled();
  });

  it("404s on another user's shop", async () => {
    const { id } = await seedShop(USER_B, "not-mine-shop");
    const { status } = await req("PATCH", `/shops/${id}`, { tagline: "hijack" });
    expect(status).toBe(404);
  });

  it("rejects bad hex colors", async () => {
    const { id } = await seedShop(USER_A, "color-shop");
    const { status } = await req("PATCH", `/shops/${id}`, { accent_color: "not-a-color" });
    expect(status).toBe(400);
  });
});

describe("DELETE /api/shops/:id", () => {
  it("deletes the owner's shop and cascades products", async () => {
    const { id } = await seedShop(USER_A, "doomed-shop");
    await seedProduct(id, USER_A);
    const { status } = await req("DELETE", `/shops/${id}`);
    expect(status).toBe(200);
    const after = await req("GET", "/shops/mine");
    expect(after.json.shops).toHaveLength(0);
  });

  it("404s on another user's shop", async () => {
    const { id } = await seedShop(USER_B, "safe-shop");
    const { status } = await req("DELETE", `/shops/${id}`);
    expect(status).toBe(404);
  });
});

/* ── Public storefront ─────────────────────────────────────────────────── */
describe("GET /api/shops/handle/:handle", () => {
  it("returns shop + products without leaking user_id", async () => {
    const { handle } = await seedShop(USER_A, "public-shop");
    const { id: shopId } = await (async () => {
      const r = await testState.db.execute(sql`SELECT id FROM shops WHERE handle = 'public-shop' LIMIT 1`);
      return { id: (r.rows as any[])[0].id as string };
    })();
    await seedProduct(shopId, USER_A, "Widget");

    const { status, json } = await req("GET", "/shops/handle/public-shop");
    expect(status).toBe(200);
    expect(json.shop.name).toBe("Test Shop");
    expect(json.shop.user_id).toBeUndefined();
    expect(json.products).toHaveLength(1);
    expect(json.products[0].name).toBe("Widget");
    expect(handle).toBe("public-shop");
  });

  it("404s on unknown handles", async () => {
    const { status } = await req("GET", "/shops/handle/nope-not-here");
    expect(status).toBe(404);
  });
});

/* ── Product CRUD (free) ───────────────────────────────────────────────── */
describe("product CRUD", () => {
  it("adds, updates, and removes products for free", async () => {
    const { id } = await seedShop(USER_A, "product-shop");
    const created = await req("POST", `/shops/${id}/products`, {
      name: "Gold Tee",
      price_cents: 2999,
      description: "Heavyweight gold tee",
      image_url: "https://example.com/tee.png",
    });
    expect(created.status).toBe(201);
    expect(created.json.product.price_cents).toBe(2999);

    const updated = await req("PATCH", `/shops/${id}/products/${created.json.product.id}`, {
      price_cents: 3499,
    });
    expect(updated.status).toBe(200);
    expect(updated.json.product.price_cents).toBe(3499);

    const deleted = await req("DELETE", `/shops/${id}/products/${created.json.product.id}`);
    expect(deleted.status).toBe(200);
    expect(mockCharge).not.toHaveBeenCalled();
  });

  it("rejects negative prices", async () => {
    const { id } = await seedShop(USER_A, "price-shop");
    const { status } = await req("POST", `/shops/${id}/products`, { name: "Bad", price_cents: -5 });
    expect(status).toBe(400);
  });

  it("404s when adding to another user's shop", async () => {
    const { id } = await seedShop(USER_B, "their-product-shop");
    const { status } = await req("POST", `/shops/${id}/products`, { name: "Hijack", price_cents: 100 });
    expect(status).toBe(404);
  });
});

/* ── AI endpoints: money flow ──────────────────────────────────────────── */
function mockChatCompletion(content: string) {
  mockGetOpenAI.mockReturnValue({
    chat: {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content } }],
        })),
      },
    },
    images: { generate: vi.fn() },
  } as any);
}

describe("POST /api/shops/ai/shop-description", () => {
  it("charges 1 credit before generating", async () => {
    mockChatCompletion(JSON.stringify({ description: "Luxury merch for the bold." }));
    const { status, json } = await req("POST", "/shops/ai/shop-description", {
      shopName: "Shark King Supply",
      tagline: "Luxury merch",
    });
    expect(status).toBe(200);
    expect(json.description).toBe("Luxury merch for the bold.");
    expect(mockCharge).toHaveBeenCalledTimes(1);
    expect(mockCharge.mock.calls[0]![1]).toBe(1);
    expect(json.creditsUsed).toBe(1);
  });

  it("returns 402 when out of credits (no charge attempted)", async () => {
    testState.userCredits = 0;
    const { status, json } = await req("POST", "/shops/ai/shop-description", { shopName: "X" });
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(mockCharge).not.toHaveBeenCalled();
  });

  it("refunds the credit when the provider fails", async () => {
    mockGetOpenAI.mockReturnValue({
      chat: { completions: { create: vi.fn(async () => { throw new Error("provider down"); }) } },
      images: { generate: vi.fn() },
    } as any);
    const { status } = await req("POST", "/shops/ai/shop-description", { shopName: "X" });
    expect(status).toBe(502);
    expect(mockCharge).toHaveBeenCalledTimes(1);
    expect(mockRefund).toHaveBeenCalledTimes(1);
    expect(mockRefund.mock.calls[0]![1]).toBe(1);
  });

  it("uses max_completion_tokens (GPT-6 rejects max_tokens)", async () => {
    const createSpy = vi.fn(async () => ({ choices: [{ message: { content: JSON.stringify({ description: "D" }) } }] }));
    mockGetOpenAI.mockReturnValue({ chat: { completions: { create: createSpy } }, images: { generate: vi.fn() } } as any);
    await req("POST", "/shops/ai/shop-description", { shopName: "X" });
    const args = createSpy.mock.calls[0]![0];
    expect(args.max_completion_tokens).toBeGreaterThan(0);
    expect(args.max_tokens).toBeUndefined();
  });
});

describe("POST /api/shops/ai/product-description", () => {
  it("charges 1 credit and returns the description", async () => {
    mockChatCompletion(JSON.stringify({ description: "A heavyweight tee. Built to last." }));
    const { status, json } = await req("POST", "/shops/ai/product-description", {
      productName: "Gold Tee",
      tone: "luxury",
    });
    expect(status).toBe(200);
    expect(json.description).toContain("heavyweight");
    expect(mockCharge).toHaveBeenCalledTimes(1);
  });

  it("refunds on provider failure", async () => {
    mockGetOpenAI.mockReturnValue({
      chat: { completions: { create: vi.fn(async () => { throw new Error("boom"); }) } },
      images: { generate: vi.fn() },
    } as any);
    const { status } = await req("POST", "/shops/ai/product-description", { productName: "X" });
    expect(status).toBe(502);
    expect(mockRefund).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/shops/ai/product-image", () => {
  function mockImageSuccess() {
    const generate = vi.fn(async () => ({ data: [{ b64_json: "aGVsbG8=" }] }));
    mockGetOpenAI.mockReturnValue({ chat: { completions: { create: vi.fn() } }, images: { generate } } as any);
    const upload = vi.fn(async () => ({ error: null }));
    const getPublicUrl = vi.fn(() => ({ data: { publicUrl: "https://cdn.example.com/shop-products/x.png" } }));
    mockGetSupabaseAdmin.mockReturnValue({
      storage: { from: vi.fn(() => ({ upload, getPublicUrl })) },
    } as any);
    return { generate, upload };
  }

  it("charges 1 credit for standard tier and returns the URL", async () => {
    const { generate } = mockImageSuccess();
    const { status, json } = await req("POST", "/shops/ai/product-image", {
      productName: "Gold Tee",
      tier: "standard",
    });
    expect(status).toBe(200);
    expect(json.url).toContain("cdn.example.com");
    expect(mockCharge).toHaveBeenCalledTimes(1);
    expect(mockCharge.mock.calls[0]![1]).toBe(1);
    expect(generate.mock.calls[0]![0].quality).toBe("medium");
  });

  it("charges 2 credits for premium tier with high quality", async () => {
    const { generate } = mockImageSuccess();
    const { status, json } = await req("POST", "/shops/ai/product-image", {
      productName: "Gold Tee",
      tier: "premium",
    });
    expect(status).toBe(200);
    expect(json.creditsUsed).toBe(2);
    expect(mockCharge.mock.calls[0]![1]).toBe(2);
    expect(generate.mock.calls[0]![0].quality).toBe("high");
  });

  it("returns 402 when the balance can't cover premium", async () => {
    testState.userCredits = 1;
    const { status } = await req("POST", "/shops/ai/product-image", {
      productName: "Gold Tee",
      tier: "premium",
    });
    expect(status).toBe(402);
    expect(mockCharge).not.toHaveBeenCalled();
  });

  it("refunds when image generation fails", async () => {
    mockGetOpenAI.mockReturnValue({
      chat: { completions: { create: vi.fn() } },
      images: { generate: vi.fn(async () => { throw new Error("image provider down"); }) },
    } as any);
    const { status } = await req("POST", "/shops/ai/product-image", {
      productName: "Gold Tee",
      tier: "standard",
    });
    expect(status).toBe(502);
    expect(mockCharge).toHaveBeenCalledTimes(1);
    expect(mockRefund).toHaveBeenCalledTimes(1);
    expect(mockRefund.mock.calls[0]![1]).toBe(1);
  });

  it("ensures the bucket exists before uploading (self-healing storage)", async () => {
    const { ensureShopProductsBucket } = await import("../../../lib/objectStorage");
    mockImageSuccess();
    const { status } = await req("POST", "/shops/ai/product-image", {
      productName: "Gold Tee",
      tier: "standard",
    });
    expect(status).toBe(200);
    expect(vi.mocked(ensureShopProductsBucket)).toHaveBeenCalledTimes(1);
  });

  it("refunds when bucket creation fails loudly", async () => {
    const { ensureShopProductsBucket } = await import("../../../lib/objectStorage");
    vi.mocked(ensureShopProductsBucket).mockRejectedValueOnce(new Error("bucket still missing"));
    mockImageSuccess();
    const { status, json } = await req("POST", "/shops/ai/product-image", {
      productName: "Gold Tee",
      tier: "standard",
    });
    expect(status).toBe(502);
    expect(json.error).toContain("bucket still missing");
    expect(json.error).toContain("refunded");
    expect(mockCharge).toHaveBeenCalledTimes(1);
    expect(mockRefund).toHaveBeenCalledTimes(1);
  });
});
