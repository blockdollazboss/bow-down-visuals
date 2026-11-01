/**
 * Storefront hub search truth (Stack1100 lane Y5) — GET /api/storefronts?q=.
 *
 * THE DISEASE: the hub matched the whole query as one ILIKE phrase
 * over name/handle/tagline (description invisible), and the query's
 * LIKE wildcards were live — q="%" listed every shop on the platform.
 *
 * THE FIX (lib/search-match): token-AND over name, handle, tagline
 * and description, accent-folded, wildcards literal. This suite
 * drives the REAL shops router over pg-mem (the commerce-pixels
 * harness) with seeded shops, so the semantics — not just the SQL
 * shape — are pinned end to end. pg-mem lacks translate(), so it is
 * registered with a faithful implementation (the registerFunction
 * pattern; the fold map itself is pinned in search-match.test.ts).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { DataType } from "pg-mem";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "../../lib/__tests__/test-db";
import { SEARCH_FOLD_FROM, SEARCH_FOLD_TO } from "../../lib/search-match";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userCredits = 10000;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../../lib/stripe-checkout", () => ({
  getCheckoutStripe: () => ({
    checkout: {
      sessions: {
        create: async () => ({ id: "cs_test_1", url: "https://checkout.example.com/pay" }),
      },
    },
  }),
  retrieveCheckoutSession: async () => null,
  checkoutBaseUrl: () => "https://example.com",
  isCheckoutTestMode: () => true,
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
  generationLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v ?? null),
}));

vi.mock("../../lib/objectStorage", () => ({
  SHOP_PRODUCTS_BUCKET: "shop-products",
  refreshSupabaseStorageUrl: vi.fn(async (v: string) => v),
  refreshSupabaseStorageUrlsDeep: vi.fn(async (x: any) => x),
  isStorageRef: vi.fn(() => false),
}));

import shopsRouter from "../generate/shops";

const DDL = `
CREATE TABLE shops (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, handle text NOT NULL,
  tagline text, description text, banner_color text NOT NULL DEFAULT '#0a0a0a',
  accent_color text NOT NULL DEFAULT '#d4af37', banner_image_url text,
  custom_domain text, domain_verified boolean NOT NULL DEFAULT false,
  domain_verification_token text,
  meta_pixel_id text, tiktok_pixel_id text, google_tag_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL, user_id uuid NOT NULL, name text NOT NULL,
  price_cents integer NOT NULL DEFAULT 0, description text,
  image_url text, image_path text, status text NOT NULL DEFAULT 'active',
  pinned_ugc_ad_id uuid,
  affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer,
  image_alt_text text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);`;

let tdb: TestDb;
let server: ReturnType<typeof express.application.listen>;
let baseUrl = "";

const KING = randomUUID();
const BAIT = randomUUID();
const FANS = randomUUID();
const LEGIT = randomUUID();
const OWNER = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(shopsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  tdb = createTestDb();
  tdb.mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    impure: true,
    implementation: () => randomUUID(),
  });
  tdb.mem.public.registerFunction({
    name: "translate",
    args: [DataType.text, DataType.text, DataType.text],
    returns: DataType.text,
    implementation: (s: string | null, from: string, to: string) => {
      if (s == null) return null;
      let out = "";
      for (const ch of String(s)) {
        const i = String(from).indexOf(ch);
        out += i >= 0 ? String(to)[i] : ch;
      }
      return out;
    },
  });
  // The fold constants ride along so this registration can never
  // drift from the lib's map.
  expect(SEARCH_FOLD_FROM.length).toBe(SEARCH_FOLD_TO.length);
  tdb.mem.public.none(DDL);
  h.db = tdb.db;
  const db = tdb.db;
  await db.execute(sql`INSERT INTO shops (id, user_id, name, handle, tagline, description) VALUES
    (${KING}, ${OWNER}, 'King Shark Merch', 'kingshark', 'Official gear', 'Hoodies and tees'),
    (${BAIT}, ${OWNER}, 'Shark Bait Records', 'sharkbait', 'Vinyl and merch', NULL),
    (${FANS}, ${OWNER}, 'Beyoncé Fans FR', 'beyoncefans', 'Fan shop', 'Posters and prints'),
    (${LEGIT}, ${OWNER}, '100% Legit Goods', 'legitgoods', 'No fakes', 'All real')`);
  await db.execute(sql`INSERT INTO shop_products (shop_id, user_id, name, status) VALUES
    (${KING}, ${OWNER}, 'Crown Hoodie', 'active'),
    (${KING}, ${OWNER}, 'Fin Tee', 'active'),
    (${KING}, ${OWNER}, 'Old Drop', 'paused')`);
});

async function hub(qs: string): Promise<Array<Record<string, any>>> {
  const res = await fetch(`${baseUrl}/storefronts${qs}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { shops: Array<Record<string, any>> };
  return body.shops;
}
const ids = (shops: Array<Record<string, any>>) => shops.map((s) => s.id).sort();

describe("GET /storefronts?q= — token-AND semantics, end to end", () => {
  it("matches words split across name and tagline; a missing word excludes", async () => {
    // "king" is in KING's name; "merch" is in KING's name AND BAIT's
    // tagline — only KING carries both words.
    expect(ids(await hub(`?q=${encodeURIComponent("king merch")}`))).toEqual([KING]);
    expect(ids(await hub(`?q=${encodeURIComponent("shark merch")}`))).toEqual([BAIT, KING].sort());
  });

  it("searches the description too", async () => {
    expect(ids(await hub(`?q=${encodeURIComponent("hoodies")}`))).toEqual([KING]);
    expect(ids(await hub(`?q=${encodeURIComponent("posters")}`))).toEqual([FANS]);
  });

  it("folds accents: 'beyonce' finds the Beyoncé shop", async () => {
    expect(ids(await hub(`?q=beyonce`))).toEqual([FANS]);
    expect(ids(await hub(`?q=${encodeURIComponent("beyoncé fans")}`))).toEqual([FANS]);
  });

  it("a typed % can never widen the match", async () => {
    // "100%" tokenizes to the token 100 (the % is a separator), so the
    // pattern is %100% — the LEGIT shop, and nothing the % could have
    // widened it to. The pure-"%" query rides the whole-string
    // fallback with an escaped \% pattern; pg-mem's ILIKE does not
    // implement LIKE escapes at all (verified by probe — real
    // Postgres treats \% as a literal percent), so that exact case is
    // pinned at the pattern level in search-match.test.ts instead.
    expect(ids(await hub(`?q=${encodeURIComponent("100% legit")}`))).toEqual([LEGIT]);
    expect(ids(await hub(`?q=${encodeURIComponent("100%")}`))).toEqual([LEGIT]);
  });

  it("no query lists everything; product_count counts live products only", async () => {
    const shops = await hub("");
    expect(ids(shops)).toEqual([KING, BAIT, FANS, LEGIT].sort());
    const king = shops.find((s) => s.id === KING);
    expect(king?.["product_count"]).toBe(2); // the paused product is unlisted
  });

  it("a query with no matches is an honest empty list", async () => {
    expect(await hub(`?q=${encodeURIComponent("zzz nothing")}`)).toEqual([]);
  });
});
