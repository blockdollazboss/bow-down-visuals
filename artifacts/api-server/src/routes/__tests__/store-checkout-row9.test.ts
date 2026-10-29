/**
 * Payments-matrix ROW 9 — the digital store (routes/store.ts) gaps
 * left by the existing suites. Inventory (stack800 Lane 1, items 5–9):
 *
 *  COVERED elsewhere (not re-pinned here):
 *   - mint shape / 48h TTL / 5-use cap on the response, buyer-scoped
 *     mint, tampered + never-minted tokens → store-download-token.test.ts
 *   - bump totals at clean numbers (2000 + 3000@10% = 4700, fee 235),
 *     verify lines, duplicate verify → store-order-bumps.test.ts
 *   - bundle total + 5% split once on the total (1299 → fee 65),
 *     bundle grants, component-pulled auto-refund → store-bundles.test.ts
 *   - fulfillment-impossible auto-refund HAPPY path (track withdrawn,
 *     series pulled, bundle component pulled) → store-refresh-links.test.ts
 *     (F3), paid-series-store.test.ts, store-bundles.test.ts
 *   - series checkout at 1999¢ with fee in metadata → paid-series-store.test.ts
 *
 *  PINNED HERE (the gaps):
 *   item 5 — an exported, reusable seed helper for a purchasable
 *            digital product (+ seller profile) on pg-mem, used by
 *            every test below. Sibling suites can import
 *            { seedPurchasableProduct } from this file.
 *   item 6 — a PLAIN track (no bump/bundle/series) checkout at an
 *            odd-cent price: the Stripe session args AND the recorded
 *            sale row split the flat 5% fee to the cent
 *            (1999¢ → fee round(99.95) = 100, creator 1899).
 *   item 7 — download-token rules against REAL pg-mem rows: an
 *            expired minted link refuses (410) WITHOUT burning a use;
 *            each delivery increments used_count exactly once; the
 *            5th use succeeds and the 6th is refused, cap never moves.
 *   item 8 — the verify-time auto-refund's FAILURE branch (the only
 *            fulfillment-impossible mechanism in the codebase is the
 *            re-resolve at POST /store/verify, store.ts ~1419): when
 *            Stripe's refund call itself fails — or the session has
 *            no payment intent — the rail answers honestly
 *            (refunded:false, "couldn't be refunded automatically"),
 *            records NO sale, and never claims the buyer was made whole.
 *   item 9 — bump math at odd cents (bump list 999¢ at 33% off →
 *            round(669.33) = 669; total 2668, session fee
 *            round(2668·5%) = 133, attributed bump 33 / main 100 so
 *            lines sum exactly), and
 *            the bump+bundle combination: a bundle cannot carry a
 *            bump (attach refuses kind=bundle; a ticked bundle
 *            checkout refuses BUMP_NOT_OFFERED with no session created).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

process.env["STORE_DOWNLOAD_SECRET"] = "test-download-secret-for-store-row9";
process.env["STRIPE_SECRET_KEY"] = "sk_test_fake_for_store_row9_route_tests";

const h = vi.hoisted(() => ({
  db: null as any,
  mem: null as any,
  userId: "",
  userEmail: "",
  stripeCreates: [] as Array<{ params: any; options: any }>,
  sessions: new Map<string, any>(),
  refundCalls: [] as Array<{ params: any; options: any }>,
  refundThrows: false,
  omitPaymentIntent: false,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userEmail = h.userEmail;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("stripe", () => {
  class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: any, options: any) => {
          const id = `cs_test_${h.stripeCreates.length + 1}`;
          h.stripeCreates.push({ params, options });
          const amount_total = (params.line_items as Array<any>).reduce(
            (sum, li) => sum + li.price_data.unit_amount * (li.quantity ?? 1),
            0,
          );
          h.sessions.set(id, {
            id,
            payment_status: "paid",
            amount_total,
            metadata: params.metadata,
            payment_intent: h.omitPaymentIntent ? null : `pi_test_${h.stripeCreates.length}`,
            customer_details: { email: "buyer@example.com" },
          });
          return { id, url: "https://checkout.example.com/pay" };
        },
        retrieve: async (id: string) => {
          const s = h.sessions.get(id);
          if (!s) throw new Error("No such checkout session");
          return s;
        },
      },
    };
    refunds = {
      create: async (params: any, options: any) => {
        h.refundCalls.push({ params, options });
        if (h.refundThrows) throw new Error("Stripe refund unavailable");
        return { id: "re_test_row9", status: "succeeded" };
      },
    };
  }
  return { default: FakeStripe };
});

vi.mock("../generate/storefronts", () => ({
  STOREFRONT_PLATFORM_FEE_BPS: 500,
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/email", () => ({
  sendEmail: async () => undefined,
  emailShell: (_title: string, html: string) => html,
  emailButton: (href: string, label: string) => `<a href="${href}">${label}</a>`,
  emailDetailBox: (html: string) => html,
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  escapeHtml: (s: string) => s,
  baseUrlForEmail: () => "https://example.com",
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
}));

import storeRouter from "../store";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

/* Same table set the store-order-bumps pg-mem suite runs the real
   router against (bump columns + offers table included). */
const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE profile_tracks (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, title text NOT NULL,
  download_price_cents integer, is_published boolean NOT NULL DEFAULT true,
  pwyw_enabled boolean NOT NULL DEFAULT false, pwyw_min_cents integer NOT NULL DEFAULT 0,
  audio_url text, artwork_url text
);
CREATE TABLE profile_videos (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, title text NOT NULL,
  download_price_cents integer, is_published boolean NOT NULL DEFAULT true,
  pwyw_enabled boolean NOT NULL DEFAULT false, pwyw_min_cents integer NOT NULL DEFAULT 0,
  video_url text, thumbnail_url text
, thumbnail_alt_text text);
CREATE TABLE playlists (
  id uuid PRIMARY KEY, owner_profile_id uuid NOT NULL, title text NOT NULL,
  price_cents integer, is_public boolean NOT NULL DEFAULT true,
  kind text NOT NULL DEFAULT 'series', cover_url text,
  items jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE digital_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid NOT NULL, profile_id uuid NOT NULL,
  item_kind text NOT NULL, item_id uuid NOT NULL,
  stripe_session_id text UNIQUE, amount_cents integer NOT NULL,
  platform_fee_cents integer NOT NULL DEFAULT 0, creator_amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed', refunded_at timestamptz,
  bump_item_kind text, bump_item_id uuid, bump_title text,
  bump_amount_cents integer, bump_platform_fee_cents integer, bump_creator_amount_cents integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE download_links (
  token text PRIMARY KEY, sale_id uuid NOT NULL, file_url text NOT NULL,
  expires_at timestamptz NOT NULL, used_count integer NOT NULL DEFAULT 0
);
CREATE TABLE money_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  entry_type text NOT NULL, category text, amount_cents integer,
  note text, source text, entry_date text
);
CREATE TABLE digital_bump_offers (
  item_kind text NOT NULL, item_id uuid NOT NULL,
  bump_kind text NOT NULL, bump_item_id uuid NOT NULL,
  percent_off integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_kind, item_id)
);`;

/* ── Item 5: the reusable seed helper ────────────────────────────────
   Creates a seller (creator_profiles row) and ONE purchasable,
   published digital track at an explicit price, in whatever pg-mem
   db the caller is running. Exported for sibling Row 9 suites. */
export interface SeededPurchasableProduct {
  sellerUserId: string;
  profileId: string;
  trackId: string;
  title: string;
  priceCents: number;
  fileUrl: string;
}

export async function seedPurchasableProduct(
  db: any,
  opts: {
    priceCents?: number;
    title?: string;
    fileUrl?: string;
    sellerUserId?: string;
    profileId?: string;
    trackId?: string;
    slug?: string;
    displayName?: string;
  } = {},
): Promise<SeededPurchasableProduct> {
  const sellerUserId = opts.sellerUserId ?? randomUUID();
  const profileId = opts.profileId ?? randomUUID();
  const trackId = opts.trackId ?? randomUUID();
  const title = opts.title ?? "Golden Track";
  const priceCents = opts.priceCents ?? 1999;
  const fileUrl = opts.fileUrl ?? "https://cdn.example.com/golden-track.mp3";
  await db.execute(sql`
    INSERT INTO creator_profiles (id, user_id, slug, display_name)
    VALUES (${profileId}, ${sellerUserId}, ${opts.slug ?? `seller-${profileId.slice(0, 8)}`}, ${opts.displayName ?? "Queen Creator"})
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO profile_tracks (id, profile_id, title, download_price_cents, audio_url)
    VALUES (${trackId}, ${profileId}, ${title}, ${priceCents}, ${fileUrl})
  `);
  return { sellerUserId, profileId, trackId, title, priceCents, fileUrl };
}

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const BUYER = randomUUID();
let SELLER = randomUUID();
let MAIN: SeededPurchasableProduct;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", storeRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[store-row9] unhandled route error:", err?.message ?? err);
    res.status(500).json({ error: "unhandled" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.registerFunction({
    name: "jsonb_array_length",
    args: ["jsonb" as never],
    returns: "integer" as never,
    implementation: (v: unknown) => (Array.isArray(v) ? v.length : 0),
  });
  mem.public.none(DDL);
  h.db = db;
  h.mem = mem;
  h.userId = BUYER;
  h.userEmail = "buyer@example.com";
  h.stripeCreates = [];
  h.sessions = new Map();
  h.refundCalls = [];
  h.refundThrows = false;
  h.omitPaymentIntent = false;
  SELLER = randomUUID();
  /* Item 5's helper seeds the fixture every test below rides. */
  MAIN = await seedPurchasableProduct(h.db, {
    sellerUserId: SELLER,
    priceCents: 1999,
    title: "Odd Cent Track",
    fileUrl: "https://cdn.example.com/odd-cent.mp3",
  });
});

async function req(method: string, path: string, body?: unknown, as?: string) {
  if (as) { h.userId = as; h.userEmail = as === BUYER ? "buyer@example.com" : "creator@example.com"; }
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* HTML delivery pages land here */ }
  return { status: r.status, text, json };
}

/** Checkout + verify a seeded track as BUYER; returns the verify body. */
async function buySeeded(trackId: string) {
  const co = await req("POST", "/store/checkout", { kind: "track", id: trackId }, BUYER);
  expect(co.status).toBe(200);
  const v = await req("POST", "/store/verify", { sessionId: co.json.sessionId }, BUYER);
  expect(v.status).toBe(200);
  return { checkout: co.json, verify: v.json, sessionId: co.json.sessionId as string };
}

describe("item 5 — seedable purchasable product fixture", () => {
  it("the helper's product is live on the buy page at its seeded price, with the 5% split shown", async () => {
    const r = await req("GET", `/store/item/track/${MAIN.trackId}`);
    expect(r.status).toBe(200);
    expect(r.json.item).toMatchObject({ kind: "track", id: MAIN.trackId, title: "Odd Cent Track", priceCents: 1999 });
    /* 1999 * 5% = 99.95 → 100 to the platform, 1899 to the creator. */
    expect(r.json.feeSplit).toMatchObject({ platformFeeCents: 100, creatorCents: 1899, platformFeePct: 5 });
  });

  it("the helper seeds independent products for independent sellers", async () => {
    const other = await seedPurchasableProduct(h.db, { priceCents: 500, title: "Second Seller Track" });
    expect(other.profileId).not.toBe(MAIN.profileId);
    const r = await req("GET", `/store/item/track/${other.trackId}`);
    expect(r.status).toBe(200);
    expect(r.json.item.priceCents).toBe(500);
    expect(r.json.feeSplit).toMatchObject({ platformFeeCents: 25, creatorCents: 475 });
  });
});

describe("item 6 — plain digital checkout session + 5% fee split, to the cent", () => {
  it("session creation args carry the odd-cent price and the split in metadata", async () => {
    const co = await req("POST", "/store/checkout", { kind: "track", id: MAIN.trackId }, BUYER);
    expect(co.status).toBe(200);
    expect(co.json.amountCents).toBe(1999);
    expect(co.json.mainAmountCents).toBe(1999);
    expect(co.json.bump).toBeNull();

    expect(h.stripeCreates).toHaveLength(1);
    const { params } = h.stripeCreates[0];
    expect(params.mode).toBe("payment");
    expect(params.line_items).toHaveLength(1);
    expect(params.line_items[0].price_data.unit_amount).toBe(1999);
    expect(params.line_items[0].price_data.currency).toBe("usd");
    expect(params.line_items[0].price_data.product_data.name).toBe("Odd Cent Track — Queen Creator");
    expect(params.success_url).toContain("/store/success?session_id={CHECKOUT_SESSION_ID}");
    expect(params.cancel_url).toContain(`/store/buy/track/${MAIN.trackId}`);
    expect(params.metadata).toMatchObject({
      buyer_user_id: BUYER,
      profile_id: MAIN.profileId,
      item_kind: "track",
      item_id: MAIN.trackId,
      platform_fee_cents: "100",
      creator_amount_cents: "1899",
      bump_amount_cents: "0",
    });
  });

  it("verify records the sale row with the same split: 1999 = 100 platform + 1899 creator", async () => {
    const { verify } = await buySeeded(MAIN.trackId);
    expect(verify.success).toBe(true);
    expect(verify.sale).toMatchObject({ amountCents: 1999, platformFeeCents: 100, creatorAmountCents: 1899 });
    expect(verify.download?.token).toBeTruthy();

    const sales = await h.db.execute(sql`SELECT * FROM digital_sales`);
    expect(sales.rows).toHaveLength(1);
    const row = sales.rows[0] as Record<string, unknown>;
    expect(Number(row["amount_cents"])).toBe(1999);
    expect(Number(row["platform_fee_cents"])).toBe(100);
    expect(Number(row["creator_amount_cents"])).toBe(1899);
    expect(Number(row["platform_fee_cents"]) + Number(row["creator_amount_cents"])).toBe(1999);
    expect(String(row["status"])).toBe("completed");
  });
});

describe("item 7 — download-token rules against real pg-mem rows", () => {
  it("an expired minted link refuses 410 and does NOT burn a use", async () => {
    const { verify } = await buySeeded(MAIN.trackId);
    const token = verify.download.token as string;
    await h.db.execute(sql`
      UPDATE download_links SET expires_at = ${new Date(Date.now() - 3600_000).toISOString()} WHERE token = ${token}
    `);
    const r = await req("GET", `/store/download/${token}`);
    expect(r.status).toBe(410);
    expect(r.text).toContain("expired (48 hours) or hit its 5-download limit");
    const links = await h.db.execute(sql`SELECT used_count FROM download_links WHERE token = ${token}`);
    expect(Number((links.rows[0] as any)["used_count"])).toBe(0);
  });

  it("each delivery increments used_count once; the 5th use succeeds, the 6th is refused", async () => {
    const { verify } = await buySeeded(MAIN.trackId);
    const token = verify.download.token as string;
    const leftAfter = ["4 downloads left", "3 downloads left", "2 downloads left", "1 download left", "0 downloads left"];
    for (let use = 1; use <= 5; use++) {
      const r = await req("GET", `/store/download/${token}`);
      expect(r.status).toBe(200);
      expect(r.text).toContain(leftAfter[use - 1]);
      const links = await h.db.execute(sql`SELECT used_count FROM download_links WHERE token = ${token}`);
      expect(Number((links.rows[0] as any)["used_count"])).toBe(use);
    }
    const sixth = await req("GET", `/store/download/${token}`);
    expect(sixth.status).toBe(410);
    expect(sixth.text).toContain("hit its 5-download limit");
    const links = await h.db.execute(sql`SELECT used_count FROM download_links WHERE token = ${token}`);
    expect(Number((links.rows[0] as any)["used_count"])).toBe(5);
  });
});

describe("item 8 — fulfillment-impossible auto-refund: the failure branch", () => {
  async function paidThenWithdrawn() {
    const co = await req("POST", "/store/checkout", { kind: "track", id: MAIN.trackId }, BUYER);
    expect(co.status).toBe(200);
    /* The product is pulled after payment, before verify re-resolves it. */
    await h.db.execute(sql`UPDATE profile_tracks SET is_published = false WHERE id = ${MAIN.trackId}`);
    return co.json.sessionId as string;
  }

  it("when Stripe's refund call fails, the rail says so honestly and records no sale", async () => {
    const sessionId = await paidThenWithdrawn();
    h.refundThrows = true;
    const v = await req("POST", "/store/verify", { sessionId }, BUYER);
    expect(v.status).toBe(400);
    expect(v.json.refunded).toBe(false);
    expect(v.json.error).toContain("couldn't be refunded automatically");
    expect(v.json.error).not.toContain("refunded in full");
    /* The refund WAS attempted, once, against the session's payment
       intent, idempotent per session — it is Stripe that failed. */
    expect(h.refundCalls).toHaveLength(1);
    expect(h.refundCalls[0].params).toEqual({ payment_intent: "pi_test_1" });
    expect(h.refundCalls[0].options).toEqual({ idempotencyKey: `refund:${sessionId}` });
    const sales = await h.db.execute(sql`SELECT * FROM digital_sales`);
    expect(sales.rows).toHaveLength(0);
  });

  it("a paid session with no payment intent cannot auto-refund — and never claims it did", async () => {
    h.omitPaymentIntent = true;
    const sessionId = await paidThenWithdrawn();
    const v = await req("POST", "/store/verify", { sessionId }, BUYER);
    expect(v.status).toBe(400);
    expect(v.json.refunded).toBe(false);
    expect(v.json.error).toContain("couldn't be refunded automatically");
    expect(h.refundCalls).toHaveLength(0);
    const sales = await h.db.execute(sql`SELECT * FROM digital_sales`);
    expect(sales.rows).toHaveLength(0);
  });
});

describe("item 9 — bump/bundle pricing math at odd cents", () => {
  it("bump at odd cents: 999¢ at 33% off rounds to 669; fee attribution sums exactly", async () => {
    const bumpProduct = await seedPurchasableProduct(h.db, {
      sellerUserId: SELLER, profileId: MAIN.profileId, slug: "queen-creator",
      priceCents: 999, title: "Odd Bump Pack", fileUrl: "https://cdn.example.com/odd-bump.zip",
    });
    const att = await req("PUT", `/store/item/track/${MAIN.trackId}/bump`,
      { bumpKind: "track", bumpItemId: bumpProduct.trackId, percentOff: 33 }, SELLER);
    expect(att.status).toBe(200);

    const co = await req("POST", "/store/checkout", { kind: "track", id: MAIN.trackId, includeBump: true }, BUYER);
    expect(co.status).toBe(200);
    /* bump unit = round(999 * 67 / 100) = round(669.33) = 669;
       total = main 1999 + bump 669 = 2668 */
    expect(co.json.amountCents).toBe(2668);
    expect(co.json.bump).toMatchObject({ grossCents: 669, feeCents: 33, creatorCents: 636 });
    const create = h.stripeCreates[0];
    expect(create.params.line_items).toHaveLength(2);
    expect(create.params.line_items[1].price_data.unit_amount).toBe(669);
    /* total fee = round(2668 * 5%) = round(133.40) = 133 */
    expect(create.params.metadata.platform_fee_cents).toBe("133");
    expect(create.params.metadata.creator_amount_cents).toBe("2535");
    expect(create.params.metadata.bump_amount_cents).toBe("669");

    const v = await req("POST", "/store/verify", { sessionId: co.json.sessionId }, BUYER);
    expect(v.status).toBe(200);
    expect(v.json.sale.lines).toEqual([
      expect.objectContaining({ kind: "main", grossCents: 1999, platformFeeCents: 100, creatorAmountCents: 1899 }),
      expect.objectContaining({ kind: "bump", grossCents: 669, platformFeeCents: 33, creatorAmountCents: 636 }),
    ]);
    const lines = v.json.sale.lines as Array<any>;
    expect(lines.reduce((s, l) => s + l.grossCents, 0)).toBe(2668);
    expect(lines.reduce((s, l) => s + l.platformFeeCents, 0)).toBe(133);
    expect(lines.reduce((s, l) => s + l.creatorAmountCents, 0)).toBe(2535);

    const sales = await h.db.execute(sql`SELECT * FROM digital_sales`);
    expect(sales.rows).toHaveLength(1);
    const row = sales.rows[0] as Record<string, unknown>;
    expect(Number(row["amount_cents"])).toBe(2668);
    expect(Number(row["platform_fee_cents"])).toBe(133);
    expect(Number(row["creator_amount_cents"])).toBe(2535);
    expect(Number(row["bump_amount_cents"])).toBe(669);
    expect(Number(row["bump_platform_fee_cents"])).toBe(33);
    expect(Number(row["bump_creator_amount_cents"])).toBe(636);
  });

  it("bump + bundle combined: a bundle cannot carry a bump — attach and ticked checkout both refuse, no session", async () => {
    const compA = await seedPurchasableProduct(h.db, {
      sellerUserId: SELLER, profileId: MAIN.profileId, slug: "queen-creator",
      priceCents: 500, title: "Bundle Part A",
    });
    const compB = await seedPurchasableProduct(h.db, {
      sellerUserId: SELLER, profileId: MAIN.profileId, slug: "queen-creator",
      priceCents: 999, title: "Bundle Part B",
    });
    const bundleId = randomUUID();
    const items = JSON.stringify([
      { kind: "track", id: compA.trackId },
      { kind: "track", id: compB.trackId },
    ]);
    h.mem.public.none(
      `INSERT INTO playlists (id, owner_profile_id, title, price_cents, kind, items) VALUES ('${bundleId}', '${MAIN.profileId}', 'Odd Bundle', 1299, 'bundle', '${items}'::jsonb)`,
    );

    /* The attach rail's owner lookup (resolveItemOwnerProfileId)
       resolves only track/video/series — a bundle id resolves to no
       owner, so the attach refuses 404 "Item not found.": a bundle
       cannot carry a bump, even for its own seller. */
    const att = await req("PUT", `/store/item/bundle/${bundleId}/bump`,
      { bumpKind: "track", bumpItemId: compA.trackId, percentOff: 10 }, SELLER);
    expect(att.status).toBe(404);
    expect(att.json.error).toBe("Item not found.");

    /* And a buyer ticking a bump on a bundle checkout is refused
       before any Stripe session exists. */
    const co = await req("POST", "/store/checkout", { kind: "bundle", id: bundleId, includeBump: true }, BUYER);
    expect(co.status).toBe(400);
    expect(co.json.error).toBe("BUMP_NOT_OFFERED");
    expect(h.stripeCreates).toHaveLength(0);

    /* The unticked bundle checkout itself is unaffected: 1299 total,
       fee round(1299 * 5%) = 65, creator 1234 (split pinned in full
       in store-bundles.test.ts — here only the combined-behavior delta). */
    const plain = await req("POST", "/store/checkout", { kind: "bundle", id: bundleId }, BUYER);
    expect(plain.status).toBe(200);
    expect(plain.json.amountCents).toBe(1299);
    expect(h.stripeCreates).toHaveLength(1);
    expect(h.stripeCreates[0].params.metadata.platform_fee_cents).toBe("65");
    expect(h.stripeCreates[0].params.metadata.creator_amount_cents).toBe("1234");
  });
});
