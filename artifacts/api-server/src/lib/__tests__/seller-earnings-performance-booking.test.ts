/**
 * seller-earnings-performance-booking.test.ts — stack200 M1: the
 * performance-bookings escrow rail joins the ONE seller-money truth.
 *
 * Before migration 0325 a released booking's release flip stamped
 * its split on the booking row (platform_fee_cents /
 * artist_payout_cents at the rail's 15%) and told the artist "You
 * were paid $X" — yet NO earnings surface read the stamps: the
 * pending-payout ledger had no booking kind, seller-earnings had no
 * bookings reader, /api/earnings and the year statement omitted it,
 * and the Connect cash-out pays only the pending figure, so the
 * money stranded forever. Gate #5 live-proved the shape ($250
 * funded → $37.50 fee / $212.50 artist); this suite pins that the
 * shape now lands:
 *  - a released booking accrues into pending_payout_ledger EXACTLY
 *    ONCE (double sync / replay → one row), copying the recorded
 *    split, with gross = fee + payout (the HELD amount the release
 *    split — a partial-refund-shrunk release accrues the held
 *    figure, never the agreed fee);
 *  - sellerEarningsSummary gains bookings { net, gross, fee, count }
 *    and its totalCents includes the booking net;
 *  - the pending-payout read includes the booking net (so the
 *    Connect cash-out can actually pay it out);
 *  - a funded-but-unreleased booking accrues nothing; a booking
 *    refunded/cancelled before release (no stamps) accrues nothing;
 *  - a release later marked refunded (escrow flips to 'refunded'
 *    with the stamps present) lands a reversal row, the summary
 *    excludes it, and the pending read nets back to zero;
 *  - buildYearStatement counts the booking on its bookings line,
 *    booked to the RELEASE year (the flip's paid_at), and the
 *    totals identity holds: statement.totalCents − royalties ==
 *    summary.totalCents.
 *
 * Against real Postgres semantics (pg-mem), DDL copied from
 * seller-earnings-ugc-brief.test.ts with the 0325 ledger CHECK.
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
  sellerBookings,
} from "../seller-earnings";
import { buildYearStatement } from "../../routes/trust";
import { __resetSaleSplitProbes } from "../sale-splits";
import { createTestDb } from "./test-db";

const ARTIST = randomUUID();
const PROMOTER = randomUUID();
const PROFILE = randomUUID();
const BOOKING = randomUUID();

const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL DEFAULT '', display_name text NOT NULL DEFAULT ''
);
CREATE TABLE digital_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, amount_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0, creator_amount_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text, status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, amount_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0, creator_amount_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text, status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, event_type text NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE beat_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_id uuid NOT NULL, price_cents integer NOT NULL DEFAULT 0,
  commission_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending_payment', stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE fan_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, price_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text, status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sponsor_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id text NOT NULL, net_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'released', settled_payout_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
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
  CHECK (source_kind IN ('digital_sale','store_order','shop_event','beat_license','membership','shoutout_request','tip_jar_tip','ugc_brief','performance_booking')),
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
CREATE TABLE royalty_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, gross_amount numeric NOT NULL DEFAULT 0,
  period_end timestamptz NOT NULL DEFAULT now()
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

/* The Gate #5 basket: $250.00 agreed fee, fully held, released at
   the rail's 15% — stamps fee 3750 / payout 21250, released (paid_at)
   June 2026. */
async function seedReleasedBooking() {
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${PROFILE}, ${ARTIST})`);
  await h.db.execute(sql`
    INSERT INTO performance_bookings
      (id, artist_user_id, fee_cents, status, escrow_status, stripe_session_id,
       platform_fee_cents, artist_payout_cents, paid_at)
    VALUES
      (${BOOKING}, ${ARTIST}, 25000, 'paid', 'released', 'cs_perf_1', 3750, 21250, '2026-06-01T00:00:00Z')
  `);
}

async function ledgerRows(kind: string) {
  const r = await h.db.execute(sql`
    SELECT entry_type, gross_cents, platform_fee_cents, net_cents, stripe_session_id
    FROM pending_payout_ledger WHERE source_kind = ${kind} ORDER BY entry_type
  `);
  return r.rows as any[];
}

describe("performance_booking ledger rail", () => {
  it("the Gate #5 shape accrues its recorded split exactly once", async () => {
    await seedReleasedBooking();
    const first = await syncPendingPayoutLedgerForSeller(ARTIST);
    expect(first.inserted["performance_booking:accrual"]).toBe(1);
    const rows = await ledgerRows("performance_booking");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entry_type: "accrual",
      gross_cents: 25000,
      platform_fee_cents: 3750,
      net_cents: 21250,
      stripe_session_id: "cs_perf_1",
    });
    /* Replay (webhook / verify / double-release reconciliation):
       the sync is idempotent — no second row, no double credit. */
    const second = await syncPendingPayoutLedgerForSeller(ARTIST);
    expect(second.inserted["performance_booking:accrual"]).toBe(0);
    expect(await ledgerRows("performance_booking")).toHaveLength(1);
  });

  it("summary + pending read carry the booking net", async () => {
    await seedReleasedBooking();
    const summary = await sellerEarningsSummary(ARTIST);
    expect(summary.bookings).toEqual({ totalCents: 21250, grossCents: 25000, feeCents: 3750, count: 1 });
    /* Booking-only basket: the unified total IS the booking net. */
    expect(summary.totalCents).toBe(21250);
    expect(await sellerBookings(ARTIST)).toEqual({ totalCents: 21250, grossCents: 25000, feeCents: 3750, count: 1 });

    const read = await readPendingPayoutForSeller(ARTIST);
    expect(read.pendingCents).toBe(21250);
    expect(read.rows.filter((r) => r.sourceKind === "performance_booking")).toHaveLength(1);
  });

  it("a partial refund before release shrinks the accrual to what was held, not the agreed fee", async () => {
    await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${PROFILE}, ${ARTIST})`);
    /* Agreed fee $200.00; part of the escrow was refunded first, so
       the release split only the $100.01 still held (15% → fee 1500
       / payout 8501 — the stamps the release flip records). */
    await h.db.execute(sql`
      INSERT INTO performance_bookings
        (id, artist_user_id, fee_cents, status, escrow_status, stripe_session_id,
         platform_fee_cents, artist_payout_cents, paid_at)
      VALUES
        (${BOOKING}, ${ARTIST}, 20000, 'paid', 'released', 'cs_perf_partial', 1500, 8501, '2026-06-01T00:00:00Z')
    `);
    await syncPendingPayoutLedgerForSeller(ARTIST);
    const rows = await ledgerRows("performance_booking");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gross_cents: 10001, platform_fee_cents: 1500, net_cents: 8501 });
    const summary = await sellerEarningsSummary(ARTIST);
    expect(summary.bookings).toEqual({ totalCents: 8501, grossCents: 10001, feeCents: 1500, count: 1 });
  });

  it("unreleased money never accrues: funded booking, and a booking refunded/cancelled before release", async () => {
    await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${PROFILE}, ${ARTIST})`);
    await h.db.execute(sql`
      INSERT INTO performance_bookings (id, artist_user_id, fee_cents, status, escrow_status, stripe_session_id)
      VALUES (${BOOKING}, ${ARTIST}, 25000, 'completed', 'funded', 'cs_perf_funded')
    `);
    await h.db.execute(sql`
      INSERT INTO performance_bookings (artist_user_id, fee_cents, status, escrow_status, stripe_session_id)
      VALUES (${ARTIST}, 25000, 'cancelled', 'refunded', 'cs_perf_cancelled')
    `);
    /* Another artist's released booking is not this artist's money. */
    await h.db.execute(sql`
      INSERT INTO performance_bookings (artist_user_id, fee_cents, status, escrow_status, stripe_session_id,
        platform_fee_cents, artist_payout_cents, paid_at)
      VALUES (${PROMOTER}, 25000, 'paid', 'released', 'cs_perf_other', 3750, 21250, '2026-06-01T00:00:00Z')
    `);
    const sync = await syncPendingPayoutLedgerForSeller(ARTIST);
    expect(sync.inserted["performance_booking:accrual"]).toBe(0);
    expect(await ledgerRows("performance_booking")).toHaveLength(0);
    const summary = await sellerEarningsSummary(ARTIST);
    expect(summary.bookings).toEqual({ totalCents: 0, grossCents: 0, feeCents: 0, count: 0 });
  });

  it("a release later marked refunded lands a reversal row; summary excludes it; pending nets to zero", async () => {
    await seedReleasedBooking();
    await syncPendingPayoutLedgerForSeller(ARTIST);
    await h.db.execute(sql`UPDATE performance_bookings SET escrow_status = 'refunded' WHERE id = ${BOOKING}`);
    const sync = await syncPendingPayoutLedgerForSeller(ARTIST);
    expect(sync.inserted["performance_booking:reversal"]).toBe(1);
    const rows = await ledgerRows("performance_booking");
    expect(rows.map((r) => r.entry_type).sort()).toEqual(["accrual", "reversal"]);

    const summary = await sellerEarningsSummary(ARTIST);
    expect(summary.bookings.totalCents).toBe(0);
    const read = await readPendingPayoutForSeller(ARTIST);
    expect(read.pendingCents).toBe(0);
  });
});

describe("year statement — bookings line", () => {
  it("counts the release stamps in the release year; totals identity holds", async () => {
    await seedReleasedBooking();
    const stmt = await buildYearStatement(ARTIST, 2026);
    expect(stmt.partial).toBe(false);
    expect(stmt.sources.bookings).toEqual({ status: "ok", totalCents: 21250, count: 1 });

    const summary = await sellerEarningsSummary(ARTIST);
    expect(stmt.totalCents - (stmt.sources.royalties.totalCents ?? 0)).toBe(summary.totalCents);
  });

  it("a booking released in another year does not leak into this one", async () => {
    await seedReleasedBooking();
    const stmt = await buildYearStatement(ARTIST, 2025);
    expect(stmt.sources.bookings).toEqual({ status: "ok", totalCents: 0, count: 0 });
  });
});
