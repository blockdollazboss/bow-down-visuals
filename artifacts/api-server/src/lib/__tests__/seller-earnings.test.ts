/**
 * seller-earnings.test.ts — ONE seller-money truth + the pending-payout
 * ledger (payfix store-dashboards lane), against real Postgres
 * semantics (pg-mem).
 *
 * Pinned contract (from the Oct 26 payments state check, PASS 2B/5/6):
 *  - a completed sale reads IDENTICALLY everywhere: the unified
 *    earnings summary's per-rail net == the ledger accrual net == its
 *    contribution to the pending-payout figure;
 *  - beat income (15% commission) is ON the unified earnings summary —
 *    the $29.99 Basic sale nets the producer $25.49 there, not only on
 *    the Producer Dashboard;
 *  - pending payout = sum of seller nets (shop $4.75 + beat $25.49
 *    included — the two figures the old pending read showed $0.00 for);
 *  - a refund reverses EXACTLY ONCE (accrual + one reversal, net 0);
 *  - duplicates/replays can never double-accrue: the sync is a
 *    reconciliation over source rows gated by UNIQUE
 *    (source_kind, source_id, entry_type) + ON CONFLICT DO NOTHING;
 *  - unpaid rows never accrue ('pending_sale' shop lines,
 *    'pending_payment' beat licenses);
 *  - bulk settlement: an active creator_payouts row subtracts; a
 *    'failed' one does not.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

const h = vi.hoisted(() => ({ db: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

import {
  syncPendingPayoutLedgerForSeller,
  readPendingPayoutForSeller,
  sellerEarningsSummary,
} from "../seller-earnings";
import { __resetSaleSplitProbes } from "../sale-splits";
import { createTestDb } from "./test-db";

const SELLER = randomUUID();
const PROFILE = randomUUID();
const OTHER = randomUUID();

const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL DEFAULT '', display_name text NOT NULL DEFAULT ''
);
CREATE TABLE digital_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, amount_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0, creator_amount_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text, status text NOT NULL DEFAULT 'completed'
);
CREATE TABLE store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, amount_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0, creator_amount_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text, status text NOT NULL DEFAULT 'completed'
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, event_type text NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text
);
CREATE TABLE beat_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_id uuid NOT NULL, price_cents integer NOT NULL DEFAULT 0,
  commission_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending_payment', stripe_session_id text
);
CREATE TABLE fan_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, price_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text, status text NOT NULL DEFAULT 'active'
);
CREATE TABLE sponsor_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id text NOT NULL, net_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'released', settled_payout_id uuid
);
CREATE TABLE creator_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
);
CREATE TABLE pending_payout_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_user_id uuid NOT NULL,
  seller_profile_id uuid,
  source_kind text NOT NULL,
  source_id uuid NOT NULL,
  entry_type text NOT NULL,
  gross_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0,
  net_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_kind IN ('digital_sale','store_order','shop_event','beat_license','membership')),
  CHECK (entry_type IN ('accrual','reversal'))
);
CREATE UNIQUE INDEX pending_payout_ledger_source_entry_ux
  ON pending_payout_ledger (source_kind, source_id, entry_type);
CREATE INDEX pending_payout_ledger_seller_idx
  ON pending_payout_ledger (seller_user_id, created_at);
CREATE TABLE sale_split_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_kind text NOT NULL, sale_id uuid NOT NULL,
  surface text NOT NULL DEFAULT '', product_id uuid,
  owner_user_id uuid NOT NULL, seller_user_id uuid NOT NULL, seller_profile_id uuid,
  role text NOT NULL, amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'earned'
);
`;

beforeEach(() => {
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
  __resetSaleSplitProbes();
});

async function seedSeller() {
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${PROFILE}, ${SELLER})`);
}

/* The Oct 26 state-check basket: one completed sale per rail. */
async function seedBasket() {
  await seedSeller();
  /* Shop sale $5.00, 5% fee $0.25, net $4.75 (PASS 2B figures). */
  await h.db.execute(sql`
    INSERT INTO shop_events (user_id, event_type, amount_cents, platform_fee_cents, stripe_session_id)
    VALUES (${SELLER}, 'sale', 500, 25, 'cs_shop_1')`);
  /* Unpaid cart line — must never accrue. */
  await h.db.execute(sql`
    INSERT INTO shop_events (user_id, event_type, amount_cents, platform_fee_cents, stripe_session_id)
    VALUES (${SELLER}, 'pending_sale', 999, 50, 'cs_shop_unpaid')`);
  /* Beat Basic license $29.99, 15% commission $4.50, net $25.49 (PASS 5). */
  await h.db.execute(sql`
    INSERT INTO beat_licenses (producer_id, price_cents, commission_cents, status, stripe_session_id)
    VALUES (${SELLER}, 2999, 450, 'completed', 'cs_beat_1')`);
  /* Unpaid beat license — must never accrue. */
  await h.db.execute(sql`
    INSERT INTO beat_licenses (producer_id, price_cents, commission_cents, status, stripe_session_id)
    VALUES (${SELLER}, 9999, 1500, 'pending_payment', 'cs_beat_unpaid')`);
  /* Profile storefront order $10.00, net $9.50. */
  await h.db.execute(sql`
    INSERT INTO store_orders (profile_id, amount_cents, platform_fee_cents, creator_amount_cents, stripe_session_id, status)
    VALUES (${PROFILE}, 1000, 50, 950, 'cs_order_1', 'completed')`);
  /* Digital sale $20.00, net $19.00. */
  await h.db.execute(sql`
    INSERT INTO digital_sales (profile_id, amount_cents, platform_fee_cents, creator_amount_cents, stripe_session_id, status)
    VALUES (${PROFILE}, 2000, 100, 1900, 'cs_digital_1', 'completed')`);
  /* Paid membership $12.00 (no fee split in the model — net = price). */
  await h.db.execute(sql`
    INSERT INTO fan_members (user_id, price_cents, stripe_session_id, status)
    VALUES (${SELLER}, 1200, 'cs_memb_1', 'active')`);
  /* Manual (unpaid) membership row — no session, must never accrue. */
  await h.db.execute(sql`
    INSERT INTO fan_members (user_id, price_cents, stripe_session_id, status)
    VALUES (${SELLER}, 1200, NULL, 'active')`);
  /* Released brand deal $7.00 — rides alongside the ledger, not in it. */
  await h.db.execute(sql`
    INSERT INTO sponsor_payouts (creator_user_id, net_cents, status)
    VALUES (${SELLER}::text, 700, 'released')`);
  /* Another seller's sale — never in this seller's numbers. */
  await h.db.execute(sql`
    INSERT INTO shop_events (user_id, event_type, amount_cents, platform_fee_cents)
    VALUES (${OTHER}, 'sale', 10000, 500)`);
}

async function ledgerRows(kind?: string): Promise<any[]> {
  const r = kind
    ? await h.db.execute(sql`SELECT * FROM pending_payout_ledger WHERE seller_user_id = ${SELLER} AND source_kind = ${kind} ORDER BY entry_type`)
    : await h.db.execute(sql`SELECT * FROM pending_payout_ledger WHERE seller_user_id = ${SELLER} ORDER BY source_kind, entry_type`);
  return r.rows as any[];
}

describe("ledger sync — accrual", () => {
  it("accrues each completed sale exactly once, with the rail's own net", async () => {
    await seedBasket();
    const res = await syncPendingPayoutLedgerForSeller(SELLER);
    expect(res.totalInserted).toBe(5); // shop, beat, order, digital, membership

    const rows = await ledgerRows();
    expect(rows).toHaveLength(5);
    const byKind = Object.fromEntries(rows.map((r) => [r.source_kind, r]));
    expect(byKind.shop_event).toMatchObject({ entry_type: "accrual", gross_cents: 500, platform_fee_cents: 25, net_cents: 475 });
    expect(byKind.beat_license).toMatchObject({ entry_type: "accrual", gross_cents: 2999, platform_fee_cents: 450, net_cents: 2549 });
    expect(byKind.store_order).toMatchObject({ entry_type: "accrual", net_cents: 950 });
    expect(byKind.digital_sale).toMatchObject({ entry_type: "accrual", net_cents: 1900 });
    expect(byKind.membership).toMatchObject({ entry_type: "accrual", net_cents: 1200, platform_fee_cents: 0 });
  });

  it("never accrues unpaid rows (pending_sale / pending_payment / manual membership)", async () => {
    await seedBasket();
    await syncPendingPayoutLedgerForSeller(SELLER);
    const rows = await ledgerRows();
    expect(rows.every((r) => r.net_cents !== 949 && r.net_cents !== 8499)).toBe(true);
    expect(rows).toHaveLength(5);
  });

  it("duplicates can't double-accrue: re-sync inserts 0 and the figure never moves", async () => {
    await seedBasket();
    const first = await readPendingPayoutForSeller(SELLER);
    const again = await syncPendingPayoutLedgerForSeller(SELLER);
    expect(again.totalInserted).toBe(0);
    const second = await readPendingPayoutForSeller(SELLER);
    expect(second.pendingCents).toBe(first.pendingCents);
    expect(second.accrualCount).toBe(5);
    expect(await ledgerRows()).toHaveLength(5);
  });
});

describe("pending read — the one figure", () => {
  it("pending = sum of seller nets, beats and shop included (the $0.00 defect)", async () => {
    await seedBasket();
    const read = await readPendingPayoutForSeller(SELLER);
    /* 475 shop + 2549 beat + 950 order + 1900 digital + 1200 membership + 700 sponsor */
    expect(read.accruedCents).toBe(475 + 2549 + 950 + 1900 + 1200);
    expect(read.sponsorReleasedCents).toBe(700);
    expect(read.pendingCents).toBe(7774);
    expect(read.rows).toHaveLength(5);
  });

  it("an active payout subtracts in bulk; a failed payout does not", async () => {
    await seedBasket();
    const payoutId = randomUUID();
    await h.db.execute(sql`
      INSERT INTO creator_payouts (id, profile_id, amount_cents, status)
      VALUES (${payoutId}, ${PROFILE}, 1000, 'paid')`);
    let read = await readPendingPayoutForSeller(SELLER);
    expect(read.settledCents).toBe(1000);
    expect(read.pendingCents).toBe(6774);

    await h.db.execute(sql`UPDATE creator_payouts SET status = 'failed' WHERE id = ${payoutId}`);
    read = await readPendingPayoutForSeller(SELLER);
    expect(read.settledCents).toBe(0);
    expect(read.pendingCents).toBe(7774);
  });
});

describe("refunds — reverse exactly once", () => {
  it("a refunded shop sale accrues + reverses once; pending drops by its net and stays dropped", async () => {
    await seedBasket();
    await readPendingPayoutForSeller(SELLER);
    await h.db.execute(sql`UPDATE shop_events SET event_type = 'refunded_sale' WHERE stripe_session_id = 'cs_shop_1'`);

    const read = await readPendingPayoutForSeller(SELLER);
    expect(read.reversedCents).toBe(475);
    expect(read.reversalCount).toBe(1);
    expect(read.pendingCents).toBe(7774 - 475);

    /* Replay / re-read: still exactly one reversal. */
    const reread = await readPendingPayoutForSeller(SELLER);
    expect(reread.reversalCount).toBe(1);
    expect(reread.pendingCents).toBe(read.pendingCents);
    expect(await ledgerRows("shop_event")).toHaveLength(2);
  });

  it("a refunded beat license reverses its full net once", async () => {
    await seedBasket();
    await h.db.execute(sql`UPDATE beat_licenses SET status = 'refunded' WHERE stripe_session_id = 'cs_beat_1'`);
    const read = await readPendingPayoutForSeller(SELLER);
    expect(read.reversedCents).toBe(2549);
    expect(read.pendingCents).toBe(7774 - 2549);
    const rows = await ledgerRows("beat_license");
    expect(rows.map((r) => r.entry_type).sort()).toEqual(["accrual", "reversal"]);
  });

  it("a sale refunded before its first sync still nets to zero (accrual + reversal)", async () => {
    await seedSeller();
    await h.db.execute(sql`
      INSERT INTO store_orders (profile_id, amount_cents, platform_fee_cents, creator_amount_cents, stripe_session_id, status)
      VALUES (${PROFILE}, 1000, 50, 950, 'cs_order_refunded', 'refunded')`);
    const read = await readPendingPayoutForSeller(SELLER);
    expect(read.accruedCents).toBe(950);
    expect(read.reversedCents).toBe(950);
    expect(read.pendingCents).toBe(0);
  });
});

describe("unified earnings summary — same sale, same story", () => {
  it("beat income is on the unified summary at the Producer Dashboard's own numbers", async () => {
    await seedBasket();
    const summary = await sellerEarningsSummary(SELLER);
    expect(summary.beats).toEqual({ totalCents: 2549, grossCents: 2999, commissionCents: 450, count: 1 });
  });

  it("every rail's summary net equals its ledger accrual net; totals reconcile", async () => {
    await seedBasket();
    const summary = await sellerEarningsSummary(SELLER);
    const read = await readPendingPayoutForSeller(SELLER);
    const accrualByKind = Object.fromEntries(read.rows.map((r) => [r.sourceKind, r.netCents]));

    expect(summary.storeSales.shopSalesCents).toBe(accrualByKind.shop_event);
    expect(summary.storeSales.profileStoreCents).toBe(accrualByKind.store_order);
    expect(summary.storeSales.digitalSalesCents).toBe(accrualByKind.digital_sale);
    expect(summary.beats.totalCents).toBe(accrualByKind.beat_license);
    expect(summary.memberships.totalCents).toBe(accrualByKind.membership);
    /* Summary total (incl. brand deals) == pending figure, pre-payout. */
    expect(summary.totalCents).toBe(7774);
    expect(summary.totalCents).toBe(read.pendingCents);
    expect(summary.storeSales.totalCents).toBe(475 + 950 + 1900);
  });

  it("refunded sales leave the summary (their money is not earnings)", async () => {
    await seedBasket();
    await h.db.execute(sql`UPDATE beat_licenses SET status = 'refunded' WHERE stripe_session_id = 'cs_beat_1'`);
    const summary = await sellerEarningsSummary(SELLER);
    expect(summary.beats.totalCents).toBe(0);
    expect(summary.beats.count).toBe(0);
    expect(summary.totalCents).toBe(7774 - 2549);
  });
});
