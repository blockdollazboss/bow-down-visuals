/**
 * qcproof-market-sale.test.ts — QC-200 Q147 residual pins for the
 * marketplace (customer shop) rail, driving the REAL lib/market-sale
 * flip functions over pg-mem:
 *
 *  1. pending lines flip pending -> sale EXACTLY ONCE (verify door and
 *     webhook door both run markMarketSalePaid; replays flip 0);
 *  2. the receipt reads the server-computed gross / flat-5% fee / net
 *     from the recorded rows;
 *  3. an EXPIRED session's lines are labelled expired and can NEVER be
 *     fulfilled afterwards — a late paid flip must flip 0 rows
 *     (ledger claim Q147: "expired sessions mark lines expired and
 *     never fulfil");
 *  4. expiring an already-sold session un-sells nothing.
 *
 * Sibling ledgers (affiliate / splits / delivery / notify / gift /
 * offers) are stubbed at their module seams — their own exactly-once
 * behaviour is pinned in their own suites; here only the flip guard
 * itself is under test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { createTestDb } from "./test-db";

const h = vi.hoisted(() => ({ db: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../affiliates", () => ({ recordAffiliateSaleSafely: vi.fn(async () => {}) }));
vi.mock("../shop-delivery", () => ({ deliverPaidShopLinesSafely: vi.fn(async () => {}) }));
vi.mock("../job-notifications", () => ({ createJobNotification: vi.fn(async () => true) }));
vi.mock("../push-events", () => ({ notifyUserEvent: vi.fn(async () => {}) }));
vi.mock("../sale-splits", () => ({ recordShopEventSplitsSafely: vi.fn(async () => {}) }));
vi.mock("../gift-cards", () => ({
  findReservation: vi.fn(async () => null),
  redeemReservation: vi.fn(async () => true),
}));
vi.mock("../product-offers", () => ({
  consumeOfferByClaimRef: vi.fn(async () => {}),
  releaseOfferClaimByRef: vi.fn(async () => {}),
}));

import {
  fetchMarketSaleBySession,
  markMarketSalePaid,
  markMarketSaleExpired,
  marketSaleReceipt,
} from "../market-sale";

const DDL = `
CREATE TABLE shop_products (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, user_id uuid NOT NULL,
  name text NOT NULL, price_cents integer NOT NULL DEFAULT 0);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, user_id uuid NOT NULL,
  event_type text NOT NULL, product_id uuid, amount_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0, buyer_email text,
  buyer_user_id uuid, stripe_session_id text, payment_status text, paid_at timestamptz,
  quantity integer NOT NULL DEFAULT 1, checkout_group_id text, discount_code text,
  affiliate_code text, bump_for_product_id uuid,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE shop_discount_codes (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, code text NOT NULL,
  used_count integer NOT NULL DEFAULT 0);
`;

const SHOP = randomUUID();
const SELLER = randomUUID();
const PRODUCT = randomUUID();

async function seedPending(sessionId: string, lines: Array<{ amount: number; fee: number }>) {
  for (const l of lines) {
    await h.db.execute(sql`
      INSERT INTO shop_events (id, shop_id, user_id, event_type, product_id, amount_cents, platform_fee_cents, buyer_email, stripe_session_id, payment_status, quantity)
      VALUES (${randomUUID()}, ${SHOP}, ${SELLER}, 'pending_sale', ${PRODUCT}, ${l.amount}, ${l.fee}, 'buyer@example.com', ${sessionId}, 'pending', 1)
    `);
  }
}

beforeEach(() => {
  const { db, mem } = createTestDb();
  mem.public.none(DDL);
  h.db = db;
});

describe("Q147 market-sale — paid flip exactly once", () => {
  it("two pending lines flip once; a replay (the other door) flips 0 and the receipt keeps the flat-5% split", async () => {
    await seedPending("cs_qc_paid", [
      { amount: 4000, fee: 200 },
      { amount: 500, fee: 25 },
    ]);
    const first = await markMarketSalePaid("cs_qc_paid");
    expect(first.flipped).toBe(2);
    const replay = await markMarketSalePaid("cs_qc_paid");
    expect(replay.flipped).toBe(0);
    const rows = await fetchMarketSaleBySession("cs_qc_paid");
    expect(rows.every((r) => r.event_type === "sale" && r.payment_status === "paid")).toBe(true);
    const receipt = marketSaleReceipt(rows);
    expect(receipt).toMatchObject({ status: "paid", paid: true, gross_cents: 4500, platform_fee_cents: 225, seller_net_cents: 4275 });
  });
});

describe("Q147 market-sale — expired sessions never fulfil", () => {
  it("expiry labels the lines expired, the receipt reads expired, and a late paid flip flips NOTHING", async () => {
    await seedPending("cs_qc_expired", [{ amount: 4000, fee: 200 }]);
    await markMarketSaleExpired("cs_qc_expired");
    const afterExpiry = await fetchMarketSaleBySession("cs_qc_expired");
    expect(afterExpiry[0]?.payment_status).toBe("expired");
    expect(marketSaleReceipt(afterExpiry).status).toBe("expired");

    const lateFlip = await markMarketSalePaid("cs_qc_expired");
    expect(lateFlip.flipped).toBe(0);
    const after = await fetchMarketSaleBySession("cs_qc_expired");
    expect(after[0]?.event_type).toBe("pending_sale");
    expect(after[0]?.payment_status).toBe("expired");
  });

  it("expiring an already-sold session un-sells nothing", async () => {
    await seedPending("cs_qc_sold_then_expired", [{ amount: 4000, fee: 200 }]);
    await markMarketSalePaid("cs_qc_sold_then_expired");
    await markMarketSaleExpired("cs_qc_sold_then_expired");
    const rows = await fetchMarketSaleBySession("cs_qc_sold_then_expired");
    expect(rows[0]?.event_type).toBe("sale");
    expect(rows[0]?.payment_status).toBe("paid");
  });
});
