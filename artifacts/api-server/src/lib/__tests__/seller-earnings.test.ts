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
 *  - memberships credit NET of the rail's 10% platform fee, derived
 *    from price_cents with the Member Dashboard's rounding (Nov 5,
 *    2026 defect: a $5.00 membership's dashboard showed $4.50 net
 *    while Earnings credited the full $5.00 — pending read $31.50
 *    against a true $31.00);
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
  membershipNetCents,
  membershipFeeCents,
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
  CHECK (source_kind IN ('digital_sale','store_order','shop_event','beat_license','membership','shoutout_request','tip_jar_tip','ugc_brief')),
  CHECK (entry_type IN ('accrual','reversal'))
);
CREATE TABLE shoutout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id uuid NOT NULL,
  price_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending_payment',
  stripe_session_id text,
  paid_at timestamptz
);
CREATE TABLE tip_jar_tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_user_id uuid NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending_payment',
  stripe_session_id text,
  paid_at timestamptz
);
CREATE TABLE ugc_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_user_id uuid,
  claimed_by_user_id uuid,
  escrow_status text NOT NULL DEFAULT 'unfunded',
  stripe_session_id text,
  released_amount_cents integer,
  platform_fee_cents integer,
  creator_payout_cents integer,
  released_at timestamptz
);
CREATE TABLE performance_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_user_id text NOT NULL DEFAULT '',
  fee_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'proposed',
  escrow_status text NOT NULL DEFAULT 'unfunded',
  stripe_session_id text,
  platform_fee_cents integer,
  artist_payout_cents integer,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
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
  /* Paid membership $12.00 — no split recorded on the row; the split is
     derived at the rail's 10%: fee $1.20, creator net $10.80. */
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
    expect(byKind.membership).toMatchObject({ entry_type: "accrual", gross_cents: 1200, platform_fee_cents: 120, net_cents: 1080 });
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
    /* 475 shop + 2549 beat + 950 order + 1900 digital + 1080 membership (net of 10%) + 700 sponsor */
    expect(read.accruedCents).toBe(475 + 2549 + 950 + 1900 + 1080);
    expect(read.sponsorReleasedCents).toBe(700);
    expect(read.pendingCents).toBe(7654);
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
    expect(read.pendingCents).toBe(6654);

    await h.db.execute(sql`UPDATE creator_payouts SET status = 'failed' WHERE id = ${payoutId}`);
    read = await readPendingPayoutForSeller(SELLER);
    expect(read.settledCents).toBe(0);
    expect(read.pendingCents).toBe(7654);
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
    expect(read.pendingCents).toBe(7654 - 475);

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
    expect(read.pendingCents).toBe(7654 - 2549);
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

/* The Nov 5 live basket (0323): one settled shoutout + one settled
   tip — the two sales that reached their own dashboards but never
   reached Earnings or the pending figure. */
async function seedShoutoutAndTip() {
  /* No creator_profiles row needed: both rails key the seller by
     user id directly (creator_user_id / page_user_id). */
  /* Paid shoutout $10.00 — flat 5% fee $0.50, creator keeps $9.50. */
  await h.db.execute(sql`
    INSERT INTO shoutout_requests (creator_user_id, price_cents, status, stripe_session_id, paid_at)
    VALUES (${SELLER}, 1000, 'accepted', 'cs_shout_1', now())`);
  /* Priced but UNPAID request — session exists, paid_at null: never accrues. */
  await h.db.execute(sql`
    INSERT INTO shoutout_requests (creator_user_id, price_cents, status, stripe_session_id, paid_at)
    VALUES (${SELLER}, 2500, 'pending_payment', 'cs_shout_unpaid', NULL)`);
  /* Free request accepted by hand — no payment exists: never accrues. */
  await h.db.execute(sql`
    INSERT INTO shoutout_requests (creator_user_id, price_cents, status, stripe_session_id, paid_at)
    VALUES (${SELLER}, 0, 'accepted', NULL, NULL)`);
  /* Paid tip-jar tip $5.00 — NO fee, the full $5.00 is the creator's. */
  await h.db.execute(sql`
    INSERT INTO tip_jar_tips (page_user_id, amount_cents, status, stripe_session_id, paid_at)
    VALUES (${SELLER}, 500, 'paid', 'cs_tip_1', now())`);
  /* Unpaid tip row — never accrues. */
  await h.db.execute(sql`
    INSERT INTO tip_jar_tips (page_user_id, amount_cents, status, stripe_session_id, paid_at)
    VALUES (${SELLER}, 700, 'pending_payment', 'cs_tip_unpaid', NULL)`);
  /* Another creator's settled shoutout + tip — never in this seller's numbers. */
  await h.db.execute(sql`
    INSERT INTO shoutout_requests (creator_user_id, price_cents, status, stripe_session_id, paid_at)
    VALUES (${OTHER}, 1000, 'accepted', 'cs_shout_other', now())`);
  await h.db.execute(sql`
    INSERT INTO tip_jar_tips (page_user_id, amount_cents, status, stripe_session_id, paid_at)
    VALUES (${OTHER}, 900, 'paid', 'cs_tip_other', now())`);
}

describe("shoutouts + tip jar — the missing rails (0323)", () => {
  it("accrues a settled shoutout at its $9.50 keep and a settled tip at the full $5.00", async () => {
    await seedShoutoutAndTip();
    const res = await syncPendingPayoutLedgerForSeller(SELLER);
    expect(res.totalInserted).toBe(2);
    expect(res.inserted["shoutout_request:accrual"]).toBe(1);
    expect(res.inserted["tip_jar_tip:accrual"]).toBe(1);

    const shout = await ledgerRows("shoutout_request");
    expect(shout).toHaveLength(1);
    expect(shout[0]).toMatchObject({ entry_type: "accrual", gross_cents: 1000, platform_fee_cents: 50, net_cents: 950 });
    const tip = await ledgerRows("tip_jar_tip");
    expect(tip).toHaveLength(1);
    expect(tip[0]).toMatchObject({ entry_type: "accrual", gross_cents: 500, platform_fee_cents: 0, net_cents: 500 });

    const read = await readPendingPayoutForSeller(SELLER);
    expect(read.pendingCents).toBe(950 + 500);
  });

  it("never accrues unpaid shoutouts, free shoutouts, or unpaid tips", async () => {
    await seedShoutoutAndTip();
    await syncPendingPayoutLedgerForSeller(SELLER);
    const rows = await ledgerRows();
    /* Exactly the two settled sales — the $25.00 unpaid request, the
       free request, the $7.00 unpaid tip and the other creator's
       money all stay out. */
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.net_cents === 950 || r.net_cents === 500)).toBe(true);
  });

  it("duplicate settlement replays can't double-accrue: re-syncs and re-reads insert 0", async () => {
    await seedShoutoutAndTip();
    const first = await readPendingPayoutForSeller(SELLER);
    /* Webhook retries + a racing return-verify settle the SOURCE row
       once (guarded flip); the sync scans source rows, so replayed
       settlement events have nothing new to accrue — ever. */
    const again = await syncPendingPayoutLedgerForSeller(SELLER);
    expect(again.totalInserted).toBe(0);
    const second = await readPendingPayoutForSeller(SELLER);
    expect(second.pendingCents).toBe(first.pendingCents);
    expect(second.accrualCount).toBe(2);
    expect(await ledgerRows()).toHaveLength(2);
  });

  it("the per-row fee rounds like the dashboard's netAfterFee (half-cent rounds up)", async () => {
    await seedSeller();
    /* $10.50 × 95% = $9.975 → $9.98 keep, $0.52 fee — the same figure
       netAfterFee(1050) = Math.round(1050 × 95 / 100) gives in TS. */
    await h.db.execute(sql`
      INSERT INTO shoutout_requests (creator_user_id, price_cents, status, stripe_session_id, paid_at)
      VALUES (${SELLER}, 1050, 'delivered', 'cs_shout_round', now())`);
    await syncPendingPayoutLedgerForSeller(SELLER);
    const rows = await ledgerRows("shoutout_request");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gross_cents: 1050, platform_fee_cents: 52, net_cents: 998 });
  });

  it("a refunded shoutout accrues + reverses exactly once; pending drops by $9.50 and stays dropped", async () => {
    await seedShoutoutAndTip();
    await readPendingPayoutForSeller(SELLER);
    await h.db.execute(sql`UPDATE shoutout_requests SET status = 'refunded' WHERE stripe_session_id = 'cs_shout_1'`);

    const read = await readPendingPayoutForSeller(SELLER);
    expect(read.reversedCents).toBe(950);
    expect(read.reversalCount).toBe(1);
    expect(read.pendingCents).toBe(500);

    const reread = await readPendingPayoutForSeller(SELLER);
    expect(reread.reversalCount).toBe(1);
    expect(reread.pendingCents).toBe(500);
    const rows = await ledgerRows("shoutout_request");
    expect(rows.map((r) => r.entry_type).sort()).toEqual(["accrual", "reversal"]);
  });

  it("a refunded tip accrues + reverses exactly once at the full amount", async () => {
    await seedShoutoutAndTip();
    await h.db.execute(sql`UPDATE tip_jar_tips SET status = 'refunded' WHERE stripe_session_id = 'cs_tip_1'`);
    const read = await readPendingPayoutForSeller(SELLER);
    expect(read.accruedCents).toBe(950 + 500);
    expect(read.reversedCents).toBe(500);
    expect(read.pendingCents).toBe(950);
    const rows = await ledgerRows("tip_jar_tip");
    expect(rows.map((r) => r.entry_type).sort()).toEqual(["accrual", "reversal"]);
  });

  it("summary nets equal the ledger accrual nets; the totals reconcile with the other rails", async () => {
    await seedBasket();
    await seedShoutoutAndTip();
    const summary = await sellerEarningsSummary(SELLER);
    expect(summary.shoutouts).toEqual({ totalCents: 950, grossCents: 1000, feeCents: 50, count: 1 });
    expect(summary.tipJar).toEqual({ totalCents: 500, count: 1 });

    const read = await readPendingPayoutForSeller(SELLER);
    const accrualByKind = Object.fromEntries(
      read.rows.filter((r) => r.entryType === "accrual").map((r) => [r.sourceKind, r.netCents]),
    );
    expect(summary.shoutouts.totalCents).toBe(accrualByKind.shoutout_request);
    expect(summary.tipJar.totalCents).toBe(accrualByKind.tip_jar_tip);
    /* Basket 7654 (membership at its fee-net $10.80, w8 membership lane)
       + shoutout 950 + tip 500 — summary and pending agree. */
    expect(summary.totalCents).toBe(7654 + 950 + 500);
    expect(summary.totalCents).toBe(read.pendingCents);
  });

  it("refunded shoutouts and tips leave the summary (their money is not earnings)", async () => {
    await seedShoutoutAndTip();
    await h.db.execute(sql`UPDATE shoutout_requests SET status = 'refunded' WHERE stripe_session_id = 'cs_shout_1'`);
    await h.db.execute(sql`UPDATE tip_jar_tips SET status = 'refunded' WHERE stripe_session_id = 'cs_tip_1'`);
    const summary = await sellerEarningsSummary(SELLER);
    expect(summary.shoutouts.totalCents).toBe(0);
    expect(summary.shoutouts.count).toBe(0);
    expect(summary.tipJar.totalCents).toBe(0);
    expect(summary.tipJar.count).toBe(0);
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
    expect(summary.totalCents).toBe(7654);
    expect(summary.totalCents).toBe(read.pendingCents);
    expect(summary.storeSales.totalCents).toBe(475 + 950 + 1900);
  });

  it("refunded sales leave the summary (their money is not earnings)", async () => {
    await seedBasket();
    await h.db.execute(sql`UPDATE beat_licenses SET status = 'refunded' WHERE stripe_session_id = 'cs_beat_1'`);
    const summary = await sellerEarningsSummary(SELLER);
    expect(summary.beats.totalCents).toBe(0);
    expect(summary.beats.count).toBe(0);
    expect(summary.totalCents).toBe(7654 - 2549);
  });
});

describe("membership fee — net of the 10% platform fee (Nov 5, 2026 defect)", () => {
  it("the split helpers match the Member Dashboard's netAfterFee, to the cent", () => {
    /* Same amounts the membership-join fee pin proves against
       netAfterFee in routes/generate/memberships.ts — the dashboard
       and the payout must round identically, including odd cents. */
    const cases: Array<[number, number, number]> = [
      // [price, fee, net]
      [0, 0, 0],
      [100, 10, 90],
      [500, 50, 450], // the $5.00 TEST Membership from the live run
      [1200, 120, 1080],
      [999, 100, 899], // net rounds 899.1 → 899, platform keeps 100
      [105, 10, 95], // net rounds 94.5 → 95 (half up), platform keeps 10
      [1, 0, 1], // 1¢: net rounds 0.9 → 1, fee 0 — still reconciles
    ];
    for (const [price, fee, net] of cases) {
      expect(membershipFeeCents(price)).toBe(fee);
      expect(membershipNetCents(price)).toBe(net);
      expect(membershipFeeCents(price) + membershipNetCents(price)).toBe(price);
    }
  });

  it("the Nov 5 live basket: a $5.00 membership credits $4.50 and pending recomputes to $31.00 across sources", async () => {
    await seedSeller();
    /* Store sale net $9.50 (the live run's store leg). */
    await h.db.execute(sql`
      INSERT INTO store_orders (profile_id, amount_cents, platform_fee_cents, creator_amount_cents, stripe_session_id, status)
      VALUES (${PROFILE}, 1000, 50, 950, 'cs_live_order', 'completed')`);
    /* Beat license net $17.00 (the live run's beats leg: $20.00 − 15%). */
    await h.db.execute(sql`
      INSERT INTO beat_licenses (producer_id, price_cents, commission_cents, status, stripe_session_id)
      VALUES (${SELLER}, 2000, 300, 'completed', 'cs_live_beat')`);
    /* The $5.00 TEST Membership — dashboard showed "$4.50 after 10%
       platform fee" while Earnings credited the full $5.00. */
    await h.db.execute(sql`
      INSERT INTO fan_members (user_id, price_cents, stripe_session_id, status)
      VALUES (${SELLER}, 500, 'cs_live_memb', 'active')`);

    const read = await readPendingPayoutForSeller(SELLER);
    const memb = read.rows.find((r) => r.sourceKind === "membership");
    expect(memb).toMatchObject({ grossCents: 500, platformFeeCents: 50, netCents: 450 });
    /* 950 store + 1700 beats + 450 membership = 3100 — NOT 3150. */
    expect(read.accruedCents).toBe(3100);
    expect(read.pendingCents).toBe(3100);

    const summary = await sellerEarningsSummary(SELLER);
    expect(summary.memberships).toEqual({ totalCents: 450, count: 1 });
    expect(summary.totalCents).toBe(3100);
  });

  it("odd-cent membership prices split in SQL with the dashboard's rounding", async () => {
    await seedSeller();
    for (const [i, price] of [105, 999, 1].entries()) {
      await h.db.execute(sql`
        INSERT INTO fan_members (user_id, price_cents, stripe_session_id, status)
        VALUES (${SELLER}, ${price}, ${"cs_odd_" + i}, 'active')`);
    }
    await syncPendingPayoutLedgerForSeller(SELLER);
    const rows = (await ledgerRows("membership"))
      .map((r) => ({ gross: r.gross_cents, fee: r.platform_fee_cents, net: r.net_cents }))
      .sort((a, b) => a.gross - b.gross);
    expect(rows).toEqual([
      { gross: 1, fee: 0, net: 1 },
      { gross: 105, fee: 10, net: 95 },
      { gross: 999, fee: 100, net: 899 },
    ]);
    const summary = await sellerEarningsSummary(SELLER);
    expect(summary.memberships.totalCents).toBe(1 + 95 + 899);
  });

  it("a refunded membership reverses its NET ($4.50), not its gross", async () => {
    await seedSeller();
    await h.db.execute(sql`
      INSERT INTO fan_members (user_id, price_cents, stripe_session_id, status)
      VALUES (${SELLER}, 500, 'cs_memb_refund', 'active')`);
    let read = await readPendingPayoutForSeller(SELLER);
    expect(read.pendingCents).toBe(450);

    await h.db.execute(sql`UPDATE fan_members SET status = 'refunded' WHERE stripe_session_id = 'cs_memb_refund'`);
    read = await readPendingPayoutForSeller(SELLER);
    expect(read.reversedCents).toBe(450);
    expect(read.reversalCount).toBe(1);
    expect(read.pendingCents).toBe(0);
    const rows = await ledgerRows("membership");
    expect(rows.map((r) => r.entry_type).sort()).toEqual(["accrual", "reversal"]);
    expect(rows.every((r) => r.net_cents === 450 && r.platform_fee_cents === 50)).toBe(true);
  });

  /* C-12 (stack400): the reversal must copy the ACCRUAL's amounts, not
     re-derive them from the row's CURRENT price. If price_cents is
     edited after accrual (tier price change applied to the row, admin
     correction), a re-derived reversal no longer cancels the accrual
     and pending payout is silently wrong by the difference, forever. */
  it("C-12: a price change between accrual and refund still nets the pair to EXACTLY zero", async () => {
    await seedSeller();
    /* Accrue at price X = $12.00 (net $10.80 at the rail's 10%). */
    await h.db.execute(sql`
      INSERT INTO fan_members (user_id, price_cents, stripe_session_id, status)
      VALUES (${SELLER}, 1200, 'cs_memb_drift', 'active')`);
    let read = await readPendingPayoutForSeller(SELLER);
    expect(read.pendingCents).toBe(1080);

    /* The tier's price changes and the edit lands on the row: Y = $15.00.
       Then the membership is refunded. */
    await h.db.execute(sql`UPDATE fan_members SET price_cents = 1500 WHERE stripe_session_id = 'cs_memb_drift'`);
    await h.db.execute(sql`UPDATE fan_members SET status = 'refunded' WHERE stripe_session_id = 'cs_memb_drift'`);
    read = await readPendingPayoutForSeller(SELLER);

    /* The reversal copies the accrual (gross 1200 / fee 120 / net 1080) —
       NOT the split of the new $15.00 price (which would be net 1350 and
       leave pending at −270, floored to a silent lie). */
    const rows = await ledgerRows("membership");
    expect(rows.map((r) => r.entry_type).sort()).toEqual(["accrual", "reversal"]);
    const accrual = rows.find((r) => r.entry_type === "accrual");
    const reversal = rows.find((r) => r.entry_type === "reversal");
    expect(reversal.gross_cents).toBe(accrual.gross_cents);
    expect(reversal.platform_fee_cents).toBe(accrual.platform_fee_cents);
    expect(reversal.net_cents).toBe(accrual.net_cents);
    expect(read.accruedCents).toBe(1080);
    expect(read.reversedCents).toBe(1080);
    expect(read.accruedCents - read.reversedCents).toBe(0);
    expect(read.pendingCents).toBe(0);

    /* Replay: still exactly one pair, still zero. */
    const reread = await readPendingPayoutForSeller(SELLER);
    expect(reread.reversalCount).toBe(1);
    expect(reread.pendingCents).toBe(0);
  });

  it("C-12: refund + price change BEFORE the first sync also nets to zero in one pass", async () => {
    await seedSeller();
    /* The row is created already-refunded at $12.00, then its price is
       edited to $15.00 before any sync ever ran — the accrual and the
       reversal land in the SAME sync and must still cancel exactly. */
    await h.db.execute(sql`
      INSERT INTO fan_members (user_id, price_cents, stripe_session_id, status)
      VALUES (${SELLER}, 1200, 'cs_memb_drift_early', 'refunded')`);
    await h.db.execute(sql`UPDATE fan_members SET price_cents = 1500 WHERE stripe_session_id = 'cs_memb_drift_early'`);
    const read = await readPendingPayoutForSeller(SELLER);
    expect(read.accrualCount).toBe(1);
    expect(read.reversalCount).toBe(1);
    expect(read.accruedCents).toBe(read.reversedCents);
    expect(read.pendingCents).toBe(0);
    const rows = await ledgerRows("membership");
    const accrual = rows.find((r) => r.entry_type === "accrual");
    const reversal = rows.find((r) => r.entry_type === "reversal");
    expect(reversal.net_cents).toBe(accrual.net_cents);
  });
});
