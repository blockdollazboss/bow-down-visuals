/**
 * Route tests for GET /api/storefronts/slug/:slug
 * (routes/generate/storefronts.ts) — creator-profile slug resolution.
 *
 * THE REGRESSION: the handler matched its :slug param against
 * shops.handle ONLY, but the media-page caller — MediaLinkBar via
 * lib/streaming.ts resolveStoreSlug, fed from pages/stream/track.tsx,
 * watch.tsx and playlist.tsx — passes a CREATOR-PROFILE slug
 * (creator_profiles.slug). Shop handles are freely chosen at shop
 * creation; nothing equates them with the owner's profile slug. When
 * handle ≠ profile slug the lookup 404'd, resolveStoreSlug swallowed
 * it into null, and the Store button on media pages never rendered.
 *
 * THE FIX SHAPE: handle lookup first (unchanged — /shop/:handle and
 * the storefront hub callers keep working exactly as before); on a
 * handle miss, resolve profile slug → creator_profiles.user_id →
 * the shop that user owns, and return it in the same payload shape
 * (shop.handle is what the client builds /shop/<handle> from).
 *
 * Fake-db style mirrors store-refresh-links.test.ts: real table
 * exports via importOriginal, db.execute dispatched on the flattened
 * SQL text (PgDialect) the handler emitted, params read positionally.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const NO_SHOP_USER_ID = "33333333-3333-4333-8333-333333333333";
const SHOP_ID = "44444444-4444-4444-8444-444444444444";
const PRODUCT_ID = "55555555-5555-4555-8555-555555555555";
const PROFILE_SLUG = "queen-creator";
const SHOP_HANDLE = "queens-corner-shop";
const NO_SHOP_PROFILE_SLUG = "no-shop-creator";

const dialect = new PgDialect();

const h = vi.hoisted(() => ({
  state: {
    // creator_profiles rows keyed by slug: slug -> user_id
    profileUserBySlug: new Map<string, string>(),
    shops: [] as Array<Record<string, unknown>>,
    productsByShop: new Map<string, Array<Record<string, unknown>>>(),
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = OWNER_ID;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
}));

vi.mock("../../lib/objectStorage", () => ({
  // Fixtures carry no storage refs — pass values through untouched.
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;

  const fakeDb: any = {
    execute: async (q: unknown) => {
      const { sql: text, params } = dialect.sqlToQuery(q as never);
      const first = String(params[0] ?? "");

      // recordView dedupe probe — no recent view on record.
      if (text.includes("FROM shop_events")) return { rows: [] };
      // recordView insert — analytics only, result unused.
      if (text.includes("INSERT INTO shop_events")) return { rows: [] };

      if (text.includes("FROM shop_products")) {
        return { rows: state.productsByShop.get(first) ?? [] };
      }

      // Profile-slug fallback: shops JOIN creator_profiles ON user_id,
      // filtered by the profile slug.
      if (text.includes("creator_profiles")) {
        const userId = state.profileUserBySlug.get(first);
        if (!userId) return { rows: [] };
        const owned = state.shops
          .filter((s) => String(s["user_id"]) === userId)
          .sort((a, b) => String(a["created_at"]).localeCompare(String(b["created_at"])));
        return { rows: owned.slice(0, 1) };
      }

      // Primary handle lookup: FROM shops WHERE handle = $1.
      if (text.includes("FROM shops")) {
        const shop = state.shops.find((s) => String(s["handle"]) === first);
        return { rows: shop ? [shop] : [] };
      }

      return { rows: [] };
    },
  };

  return { ...actual, db: fakeDb };
});

import router from "../generate/storefronts";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

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

beforeEach(() => {
  const s = h.state;
  s.profileUserBySlug = new Map([
    [PROFILE_SLUG, OWNER_ID],
    [NO_SHOP_PROFILE_SLUG, NO_SHOP_USER_ID],
  ]);
  s.shops = [
    {
      id: SHOP_ID,
      user_id: OWNER_ID,
      name: "Queen's Corner",
      handle: SHOP_HANDLE,
      tagline: "Merch + downloads",
      description: null,
      banner_color: "#0a0a0a",
      accent_color: "#d4af37",
      banner_image_url: null,
      custom_domain: null,
      domain_verified: false,
      created_at: "2026-10-01T00:00:00.000Z",
    },
  ];
  s.productsByShop = new Map([
    [
      SHOP_ID,
      [
        {
          id: PRODUCT_ID,
          name: "Golden Hoodie",
          price_cents: 4999,
          description: null,
          image_url: null,
          created_at: "2026-10-02T00:00:00.000Z",
        },
      ],
    ],
  ]);
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("GET /api/storefronts/slug/:slug — creator-profile slug (MediaLinkBar caller)", () => {
  it("finds the shop BY OWNER'S PROFILE SLUG when the shop handle differs from it", async () => {
    const { status, json } = await get(`/storefronts/slug/${PROFILE_SLUG}`);

    expect(status).toBe(200);
    expect(json.shop.id).toBe(SHOP_ID);
    // The handle is what the client needs to build /shop/<handle>.
    expect(json.shop.handle).toBe(SHOP_HANDLE);
    expect(json.shop.name).toBe("Queen's Corner");
    expect(json.products).toHaveLength(1);
    expect(json.products[0].id).toBe(PRODUCT_ID);
    // Public payload never leaks the owner's user_id.
    expect(json.shop.user_id).toBeUndefined();
  });

  it("404s a profile slug whose owner genuinely has no shop", async () => {
    const { status } = await get(`/storefronts/slug/${NO_SHOP_PROFILE_SLUG}`);
    expect(status).toBe(404);
  });
});

describe("GET /api/storefronts/slug/:slug — handle callers (regression)", () => {
  it("still resolves BY SHOP HANDLE exactly as /shop/:handle does", async () => {
    const { status, json } = await get(`/storefronts/slug/${SHOP_HANDLE}`);

    expect(status).toBe(200);
    expect(json.shop.id).toBe(SHOP_ID);
    expect(json.shop.handle).toBe(SHOP_HANDLE);
    expect(json.products).toHaveLength(1);
  });

  it("404s an unknown value that is neither a handle nor a profile slug", async () => {
    const { status } = await get(`/storefronts/slug/no-such-thing`);
    expect(status).toBe(404);
  });
});
