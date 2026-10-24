/**
 * Creator Product Affiliates (#16) — core ledger discipline.
 * Drives lib/affiliates over pg-mem with DDL mirroring migration 0205
 * (.lane/MIGRATION-NEEDED.md) and pins:
 *  - commission = creator-set % of the SELLER'S NET (gross − platform fee),
 *    rounded to the cent; the fee and the buyer's price are never touched;
 *  - a fan claims one code per product; the seller can never claim their own;
 *  - recordAffiliateSale refuses self-referral (by user id AND by account
 *    email), self-dealing, disabled products, inactive codes, wrong-product
 *    codes and zero-value commissions — and lands exactly once per
 *    (surface, order_ref, product) however many times it is replayed;
 *  - the platform referral program is a different ledger: recording an
 *    affiliate sale never writes a referral_payouts row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

const h = vi.hoisted(() => ({ db: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

import {
  affiliateCommissionCents,
  isValidCommissionBps,
  claimAffiliateCode,
  recordAffiliateSale,
} from "../affiliates";
import { createTestDb } from "./test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE profiles (id uuid PRIMARY KEY, email text, plan text);
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL);
CREATE TABLE store_products (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, title text NOT NULL,
  price_cents integer NOT NULL, affiliate_enabled boolean NOT NULL DEFAULT false,
  affiliate_commission_bps integer
);
CREATE TABLE shops (id uuid PRIMARY KEY, user_id uuid NOT NULL, handle text NOT NULL);
CREATE TABLE shop_products (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, user_id uuid NOT NULL, name text NOT NULL,
  price_cents integer NOT NULL, affiliate_enabled boolean NOT NULL DEFAULT false,
  affiliate_commission_bps integer
);
CREATE TABLE affiliate_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL, affiliate_user_id uuid NOT NULL, seller_user_id uuid NOT NULL,
  surface text NOT NULL, product_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX affiliate_codes_code_ux ON affiliate_codes (UPPER(code));
CREATE UNIQUE INDEX affiliate_codes_affiliate_product_ux ON affiliate_codes (affiliate_user_id, surface, product_id);
CREATE TABLE affiliate_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_code_id uuid NOT NULL, affiliate_user_id uuid NOT NULL, seller_user_id uuid NOT NULL,
  surface text NOT NULL, product_id uuid, product_title text NOT NULL DEFAULT '',
  order_ref text NOT NULL, buyer_user_id uuid, buyer_email text,
  gross_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0,
  seller_net_cents integer NOT NULL DEFAULT 0, commission_bps integer NOT NULL,
  commission_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'owed',
  created_at timestamptz NOT NULL DEFAULT now(), paid_at timestamptz
);
CREATE UNIQUE INDEX affiliate_sales_once_ux ON affiliate_sales (surface, order_ref, product_id);
CREATE TABLE referral_payouts (
  id uuid PRIMARY KEY, referral_id uuid NOT NULL, stripe_session_id text NOT NULL,
  referee_credits_purchased integer NOT NULL, referrer_credits_awarded integer NOT NULL
);`;

const SELLER = randomUUID();
const FAN = randomUUID();
const BUYER = randomUUID();
const PROFILE_ID = randomUUID();
const SHOP_ID = randomUUID();
const STORE_PRODUCT = randomUUID();
const SHOP_PRODUCT = randomUUID();

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  h.db = db;
  await db.execute(sql`INSERT INTO profiles (id, email) VALUES (${FAN}, 'fan@example.com'), (${SELLER}, 'seller@example.com'), (${BUYER}, 'buyer@example.com')`);
  await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${SELLER}, 'seller', 'Seller')`);
  await db.execute(sql`INSERT INTO store_products (id, profile_id, title, price_cents, affiliate_enabled, affiliate_commission_bps)
                        VALUES (${STORE_PRODUCT}, ${PROFILE_ID}, 'Beat Pack', 10000, true, 1000)`);
  await db.execute(sql`INSERT INTO shops (id, user_id, handle) VALUES (${SHOP_ID}, ${SELLER}, 'sellershop')`);
  await db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, affiliate_enabled, affiliate_commission_bps)
                        VALUES (${SHOP_PRODUCT}, ${SHOP_ID}, ${SELLER}, 'Poster', 5000, true, 2000)`);
});

async function saleCount() {
  const r = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM affiliate_sales`);
  return Number((r.rows[0] as any).c);
}

describe("commission math — % of the seller's net, never the fee", () => {
  it("computes and rounds to the cent", () => {
    /* $100 sale, 5% fee = $95 net, creator set 10% → $9.50 */
    expect(affiliateCommissionCents(9500, 1000)).toBe(950);
    /* $50 sale, 5% fee = $47.50 net, 20% → $9.50 */
    expect(affiliateCommissionCents(4750, 2000)).toBe(950);
    /* rounding: 333 net at 10% → 33 (33.3 rounds down), 335 → 34 (33.5 up) */
    expect(affiliateCommissionCents(333, 1000)).toBe(33);
    expect(affiliateCommissionCents(335, 1000)).toBe(34);
    expect(affiliateCommissionCents(0, 5000)).toBe(0);
    expect(affiliateCommissionCents(9500, 10_000)).toBe(9500);
  });
  it("validates creator-set rates", () => {
    expect(isValidCommissionBps(1)).toBe(true);
    expect(isValidCommissionBps(10_000)).toBe(true);
    expect(isValidCommissionBps(0)).toBe(false);
    expect(isValidCommissionBps(10_001)).toBe(false);
    expect(isValidCommissionBps(12.5)).toBe(false);
    expect(isValidCommissionBps(null)).toBe(false);
  });
});

describe("claiming a code", () => {
  it("mints a code for an enabled product, idempotently", async () => {
    const a = await claimAffiliateCode({ affiliateUserId: FAN, surface: "store_product", productId: STORE_PRODUCT });
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.created).toBe(true);
      expect(a.code.code).toMatch(/^AFF-/);
      expect(a.code.seller_user_id).toBe(SELLER);
    }
    const b = await claimAffiliateCode({ affiliateUserId: FAN, surface: "store_product", productId: STORE_PRODUCT });
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.created).toBe(false);
      expect(b.code.code).toBe(a.code.code);
    }
  });
  it("refuses the seller claiming their own product", async () => {
    const r = await claimAffiliateCode({ affiliateUserId: SELLER, surface: "shop_product", productId: SHOP_PRODUCT });
    expect(r.ok).toBe(false);
  });
  it("refuses a product that is not open to affiliates", async () => {
    const p = randomUUID();
    await h.db.execute(sql`INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, affiliate_enabled, affiliate_commission_bps)
                            VALUES (${p}, ${SHOP_ID}, ${SELLER}, 'Closed', 1000, false, null)`);
    const r = await claimAffiliateCode({ affiliateUserId: FAN, surface: "shop_product", productId: p });
    expect(r.ok).toBe(false);
  });
});

describe("recordAffiliateSale — the funnel", () => {
  async function fanCode(surface: "store_product" | "shop_product", productId: string) {
    const r = await claimAffiliateCode({ affiliateUserId: FAN, surface, productId });
    if (!r.ok) throw new Error("claim failed");
    return r.code.code;
  }

  it("records commission owed out of the seller's net, fee untouched", async () => {
    const code = await fanCode("store_product", STORE_PRODUCT);
    const r = await recordAffiliateSale({
      code, surface: "store_product", productId: STORE_PRODUCT, orderRef: "cs_1",
      buyerUserId: BUYER, grossCents: 10000, platformFeeCents: 500,
    });
    expect(r).toEqual({ recorded: true, commissionCents: 950, saleId: expect.any(String) });
    const rows = await h.db.execute(sql`SELECT * FROM affiliate_sales`);
    const row = rows.rows[0] as any;
    expect(Number(row.gross_cents)).toBe(10000);
    expect(Number(row.platform_fee_cents)).toBe(500);
    expect(Number(row.seller_net_cents)).toBe(9500);
    expect(Number(row.commission_bps)).toBe(1000);
    expect(row.status).toBe("owed");
    /* The platform referral ledger is a different program — untouched. */
    const rp = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM referral_payouts`);
    expect(Number((rp.rows[0] as any).c)).toBe(0);
  });

  it("lands exactly once across replays of the same order", async () => {
    const code = await fanCode("shop_product", SHOP_PRODUCT);
    const args = {
      code, surface: "shop_product" as const, productId: SHOP_PRODUCT, orderRef: "group-1",
      buyerEmail: "buyer@example.com", grossCents: 5000, platformFeeCents: 250,
    };
    const first = await recordAffiliateSale(args);
    expect(first.recorded).toBe(true);
    if (first.recorded) expect(first.commissionCents).toBe(950); // 4750 net × 20%
    const replay = await recordAffiliateSale(args);
    expect(replay).toEqual({ recorded: false, reason: "duplicate" });
    expect(await saleCount()).toBe(1);
  });

  it("pays nothing on self-referral — by user id and by account email", async () => {
    const code = await fanCode("store_product", STORE_PRODUCT);
    const byId = await recordAffiliateSale({
      code, surface: "store_product", productId: STORE_PRODUCT, orderRef: "cs_self1",
      buyerUserId: FAN, grossCents: 10000, platformFeeCents: 500,
    });
    expect(byId).toEqual({ recorded: false, reason: "self_referral" });
    const byEmail = await recordAffiliateSale({
      code, surface: "shop_product", productId: SHOP_PRODUCT, orderRef: "g_self2",
      buyerEmail: "Fan@Example.com", grossCents: 5000, platformFeeCents: 250,
    });
    /* wrong-product for the store code → mismatch fires first; use a shop code */
    expect(byEmail.recorded).toBe(false);
    const shopCode = await fanCode("shop_product", SHOP_PRODUCT);
    const byEmail2 = await recordAffiliateSale({
      code: shopCode, surface: "shop_product", productId: SHOP_PRODUCT, orderRef: "g_self3",
      buyerEmail: "fan@example.com", grossCents: 5000, platformFeeCents: 250,
    });
    expect(byEmail2).toEqual({ recorded: false, reason: "self_referral" });
    expect(await saleCount()).toBe(0);
  });

  it("pays nothing on self-dealing (affiliate == seller)", async () => {
    const codeId = randomUUID();
    await h.db.execute(sql`INSERT INTO affiliate_codes (id, code, affiliate_user_id, seller_user_id, surface, product_id)
                            VALUES (${codeId}, 'AFF-SELFDEAL', ${SELLER}, ${SELLER}, 'store_product', ${STORE_PRODUCT})`);
    const r = await recordAffiliateSale({
      code: "AFF-SELFDEAL", surface: "store_product", productId: STORE_PRODUCT, orderRef: "cs_sd",
      buyerUserId: BUYER, grossCents: 10000, platformFeeCents: 500,
    });
    expect(r).toEqual({ recorded: false, reason: "self_dealing" });
    expect(await saleCount()).toBe(0);
  });

  it("refuses wrong-product codes, inactive codes, and products closed after the claim", async () => {
    const code = await fanCode("store_product", STORE_PRODUCT);
    const wrong = await recordAffiliateSale({
      code, surface: "shop_product", productId: SHOP_PRODUCT, orderRef: "g_wrong",
      buyerEmail: "buyer@example.com", grossCents: 5000, platformFeeCents: 250,
    });
    expect(wrong).toEqual({ recorded: false, reason: "product_mismatch" });

    await h.db.execute(sql`UPDATE store_products SET affiliate_enabled = false WHERE id = ${STORE_PRODUCT}`);
    const closed = await recordAffiliateSale({
      code, surface: "store_product", productId: STORE_PRODUCT, orderRef: "cs_closed",
      buyerUserId: BUYER, grossCents: 10000, platformFeeCents: 500,
    });
    expect(closed).toEqual({ recorded: false, reason: "affiliates_disabled" });
    await h.db.execute(sql`UPDATE store_products SET affiliate_enabled = true WHERE id = ${STORE_PRODUCT}`);

    await h.db.execute(sql`UPDATE affiliate_codes SET is_active = false WHERE code = ${code}`);
    const inactive = await recordAffiliateSale({
      code, surface: "store_product", productId: STORE_PRODUCT, orderRef: "cs_inactive",
      buyerUserId: BUYER, grossCents: 10000, platformFeeCents: 500,
    });
    expect(inactive.recorded).toBe(false);
    expect(await saleCount()).toBe(0);
  });

  it("records nothing for a $0 / zero-commission sale", async () => {
    const code = await fanCode("shop_product", SHOP_PRODUCT);
    const r = await recordAffiliateSale({
      code, surface: "shop_product", productId: SHOP_PRODUCT, orderRef: "g_free",
      buyerEmail: "buyer@example.com", grossCents: 0, platformFeeCents: 0,
    });
    expect(r).toEqual({ recorded: false, reason: "zero_commission" });
    expect(await saleCount()).toBe(0);
  });

  it("uses the rate at SALE time, not claim time", async () => {
    const code = await fanCode("store_product", STORE_PRODUCT);
    await h.db.execute(sql`UPDATE store_products SET affiliate_commission_bps = 2000 WHERE id = ${STORE_PRODUCT}`);
    const r = await recordAffiliateSale({
      code, surface: "store_product", productId: STORE_PRODUCT, orderRef: "cs_rate",
      buyerUserId: BUYER, grossCents: 10000, platformFeeCents: 500,
    });
    expect(r.recorded).toBe(true);
    if (r.recorded) expect(r.commissionCents).toBe(1900); // 9500 × 20%
  });
});
