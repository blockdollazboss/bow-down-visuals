/**
 * Route tests for pinned UGC ads on the product surfaces (Stack-4
 * wave 2 #7, migration 0178) — routes/generate/shops.ts:
 *   GET /api/shops/handle/:handle    public storefront (buyer)
 *   GET /api/storefronts/slug/:slug  public storefront (buyer)
 *   GET /api/shops/:id/products      owner management read
 *   PATCH /api/shops/:id/products/:productId  owner edit return
 *
 * Contract pinned here:
 * - A buyer product carries `pinned_ad: { id, video_url }` — the
 *   playable URL minted fresh on the read — only while the pinned ad
 *   is still 'ready' with a video. A pin to a draft ad, or a dangling
 *   pin (ad deleted), renders as pinned_ad: null, never a broken
 *   player.
 * - Buyer payloads never carry the owner state: no pinned_ugc_ad_id,
 *   no status (the 0176 discipline). Paused products stay unlisted.
 * - Owner reads carry BOTH the pin id and the resolved pinned_ad.
 *
 * Fake-db style mirrors storefronts-profile-slug.test.ts: db.execute
 * dispatched on the flattened SQL text (PgDialect), params positional.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const ALICE = "00000000-0000-4000-8000-00000000a11c";
const BOB = "00000000-0000-4000-8000-00000000b0b5";
const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const HANDLE = "alice-shop";
const P_PINNED = "22222222-2222-4222-8222-222222222222";
const P_DRAFT_PIN = "33333333-3333-4333-8333-333333333333";
const P_PLAIN = "44444444-4444-4444-8444-444444444444";
const P_DANGLE = "45454545-4444-4444-8444-444444444444";
const P_PAUSED = "55555555-5555-4555-8555-555555555555";
const AD_READY = "66666666-6666-4666-8666-666666666666";
const AD_DRAFT = "77777777-7777-4777-8777-777777777777";
const AD_GONE = "88888888-8888-4888-8888-888888888888";

const dialect = new PgDialect();

const h = vi.hoisted(() => ({
  state: {
    shop: null as any,
    products: [] as Array<Record<string, unknown>>,
    ads: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(user);
    req.userCredits = 10000;
    req.log = { info: () => {}, error: () => {}, warn: () => {} };
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
}));

const mint = (v: string): string => {
  const m = /^supabase:\/\/[^/]+\/(.+)$/.exec(v);
  return m ? `https://signed.example/${m[1]}` : v;
};

vi.mock("../../lib/objectStorage", () => {
  const deep = async (v: unknown): Promise<unknown> => {
    if (typeof v === "string") return v.startsWith("supabase://") ? mint(v) : v;
    if (Array.isArray(v)) return Promise.all(v.map(deep));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = await deep(val);
      return out;
    }
    return v;
  };
  return {
    SHOP_PRODUCTS_BUCKET: "shop-products",
    refreshSupabaseStorageUrl: async (v: string) => mint(v),
    refreshSupabaseStorageUrlsDeep: deep,
    isStorageRef: (v: string) => typeof v === "string" && v.startsWith("supabase://"),
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const fakeDb: any = {
    execute: async (q: unknown) => {
      const { sql: text, params } = dialect.sqlToQuery(q as never);
      const shop = state.shop;
      if (text.includes("FROM ugc_ads")) {
        return { rows: state.ads.filter((a) => params.includes(a.id)) };
      }
      if (text.includes("shop_events")) return { rows: [] };
      if (text.includes("UPDATE shop_products")) return { rows: [] };
      if (text.includes("FROM shops") && text.includes("AND user_id =")) {
        const [id, userId] = params as string[];
        return { rows: shop && shop.id === id && shop.user_id === userId ? [shop] : [] };
      }
      if (text.includes("creator_profiles")) return { rows: [] };
      if (text.includes("FROM shops")) {
        return { rows: shop && shop.handle === params[0] ? [shop] : [] };
      }
      if (text.includes("SELECT id FROM shop_products")) {
        const [pid, sid] = params as string[];
        const hit = state.products.find((p) => p.id === pid && p.shop_id === sid);
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      if (text.includes("FROM shop_products") && text.includes("status = 'active'")) {
        /* Buyer reads select an explicit column list (no status, no
           shop_id/user_id) — project the seeded rows to exactly those
           columns, as real SQL would. */
        return {
          rows: state.products
            .filter((p) => p.shop_id === params[0] && p.status === "active")
            .map((p) => ({
              id: p.id,
              name: p.name,
              price_cents: p.price_cents,
              description: p.description,
              image_url: p.image_url,
              created_at: p.created_at,
              pinned_ugc_ad_id: p.pinned_ugc_ad_id,
            })),
        };
      }
      if (text.includes("FROM shop_products") && text.includes("WHERE id =")) {
        return { rows: state.products.filter((p) => p.id === params[0]) };
      }
      if (text.includes("FROM shop_products")) {
        return { rows: state.products.filter((p) => p.shop_id === params[0]) };
      }
      return { rows: [] };
    },
  };
  return { ...actual, db: fakeDb };
});

import shopsRouter from "../generate/shops";

let server: ReturnType<typeof express.application.listen>;
let base = "";
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", shopsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.state.shop = {
    id: SHOP_ID,
    user_id: ALICE,
    name: "Alice Shop",
    handle: HANDLE,
    tagline: null,
    description: null,
    banner_color: "#0a0a0a",
    accent_color: "#d4af37",
    banner_image_url: null,
    custom_domain: null,
    domain_verified: false,
    domain_verification_token: null,
    created_at: "2026-10-19T00:00:00.000Z",
    updated_at: "2026-10-19T00:00:00.000Z",
  };
  const product = (over: Record<string, unknown>) => ({
    shop_id: SHOP_ID,
    user_id: ALICE,
    price_cents: 4900,
    description: null,
    image_url: null,
    image_path: null,
    status: "active",
    pinned_ugc_ad_id: null,
    created_at: "2026-10-19T00:00:00.000Z",
    updated_at: "2026-10-19T00:00:00.000Z",
    ...over,
  });
  h.state.products = [
    product({ id: P_PINNED, name: "Gold Chain Tee", pinned_ugc_ad_id: AD_READY }),
    product({ id: P_DRAFT_PIN, name: "Silver Cap", pinned_ugc_ad_id: AD_DRAFT }),
    product({ id: P_PLAIN, name: "Plain Hoodie" }),
    product({ id: P_DANGLE, name: "Dangling Pin", pinned_ugc_ad_id: AD_GONE }),
    product({ id: P_PAUSED, name: "Paused Item", status: "paused", pinned_ugc_ad_id: AD_READY }),
  ];
  h.state.ads = [
    { id: AD_READY, status: "ready", video_ref: "supabase://generated-clips/ugc-ads/ready.mp4" },
    { id: AD_DRAFT, status: "draft", video_ref: null },
  ];
});

async function call(
  method: string,
  path: string,
  opts: { user?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const res = await realFetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const byId = (products: any[]) => new Map(products.map((p) => [p.id, p]));

describe("buyer storefront reads (handle + slug)", () => {
  it("the pinned ad renders on the product; draft and dangling pins render as no pin", async () => {
    for (const path of [`/api/shops/handle/${HANDLE}`, `/api/storefronts/slug/${HANDLE}`]) {
      const r = await call("GET", path);
      expect(r.status).toBe(200);
      const products = byId(r.json.products);
      expect(products.has(P_PAUSED)).toBe(false);
      expect(products.get(P_PINNED).pinned_ad).toEqual({
        id: AD_READY,
        video_url: "https://signed.example/ugc-ads/ready.mp4",
      });
      expect(products.get(P_DRAFT_PIN).pinned_ad).toBeNull();
      expect(products.get(P_PLAIN).pinned_ad).toBeNull();
      expect(products.get(P_DANGLE).pinned_ad).toBeNull();
      /* Buyer payloads carry no owner state (0176 discipline). */
      for (const p of r.json.products) {
        expect(p).not.toHaveProperty("pinned_ugc_ad_id");
        expect(p).not.toHaveProperty("status");
      }
    }
  });
});

describe("owner product reads", () => {
  it("the management list carries the pin id AND the resolved ad, paused included", async () => {
    const r = await call("GET", `/api/shops/${SHOP_ID}/products`, { user: ALICE });
    expect(r.status).toBe(200);
    const products = byId(r.json.products);
    expect(products.size).toBe(5);
    expect(products.get(P_PINNED).pinned_ugc_ad_id).toBe(AD_READY);
    expect(products.get(P_PINNED).pinned_ad).toEqual({
      id: AD_READY,
      video_url: "https://signed.example/ugc-ads/ready.mp4",
    });
    expect(products.get(P_DRAFT_PIN).pinned_ad).toBeNull();
    expect(products.get(P_PAUSED).status).toBe("paused");
  });

  it("a foreign owner read is a 404 and an anonymous one a 401", async () => {
    expect((await call("GET", `/api/shops/${SHOP_ID}/products`, { user: BOB })).status).toBe(404);
    expect((await call("GET", `/api/shops/${SHOP_ID}/products`)).status).toBe(401);
  });

  it("the PATCH return keeps the resolved pinned ad", async () => {
    const r = await call("PATCH", `/api/shops/${SHOP_ID}/products/${P_PINNED}`, {
      user: ALICE,
      body: { name: "Gold Chain Tee v2" },
    });
    expect(r.status).toBe(200);
    expect(r.json.product.pinned_ugc_ad_id).toBe(AD_READY);
    expect(r.json.product.pinned_ad).toEqual({
      id: AD_READY,
      video_url: "https://signed.example/ugc-ads/ready.mp4",
    });
  });
});
