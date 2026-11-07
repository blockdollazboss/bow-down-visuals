/**
 * seller-earnings-ugc-brief.test.ts — C-25: the UGC Briefs escrow
 * rail joins the ONE seller-money truth.
 *
 * A priced brief's approval-release stamps its split on the brief
 * row (released_amount_cents = the HELD gross that was split,
 * platform_fee_cents / creator_payout_cents at the rail's 5%). Those
 * stamps are the settled truth this suite pins:
 *  - a released brief accrues into pending_payout_ledger EXACTLY
 *    ONCE (double sync → one row), copying the recorded split;
 *  - sellerEarningsSummary gains ugcBriefs { net, gross, fee, count }
 *    and its totalCents includes the brief net;
 *  - the pending-payout read includes the brief net;
 *  - a funded-but-unreleased brief accrues nothing; a brief refunded
 *    before release (no stamps) accrues nothing;
 *  - a release later reversed (escrow flips to 'refunded' with the
 *    stamps present) lands a reversal row, the summary excludes it,
 *    and the pending read nets back to zero;
 *  - buildYearStatement counts the brief on its ugcBriefs line,
 *    booked to the RELEASE year, and the totals identity holds:
 *    statement.totalCents − royalties == summary.totalCents.
 *
 * Against real Postgres semantics (pg-mem), DDL copied from
 * seller-earnings.test.ts + year-statement-scope.test.ts.
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
  sellerUgcBriefs,
} from "../seller-earnings";
import { buildYearStatement } from "../../routes/trust";
import { __resetSaleSplitProbes } from "../sale-splits";
import { createTestDb } from "./test-db";

const CREATOR = randomUUID();
const BRAND = randomUUID();
const PROFILE = randomUUID();
const BRIEF = randomUUID();

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

/* The released brief: $100.01 charged, all held, released at 5% —
   stamps gross 10001 / fee 500 / net 9501, released June 2026. */
async function seedReleasedBrief() {
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${PROFILE}, ${CREATOR})`);
  await h.db.execute(sql`
    INSERT INTO ugc_briefs
      (id, brand_user_id, claimed_by_user_id, escrow_status, stripe_session_id,
       released_amount_cents, platform_fee_cents, creator_payout_cents, released_at)
    VALUES
      (${BRIEF}, ${BRAND}, ${CREATOR}, 'released', 'cs_ugc_1', 10001, 500, 9501, '2026-06-01T00:00:00Z')
  `);
}

async function ledgerRows(kind: string) {
  const r = await h.db.execute(sql`
    SELECT entry_type, gross_cents, platform_fee_cents, net_cents, stripe_session_id
    FROM pending_payout_ledger WHERE source_kind = ${kind} ORDER BY entry_type
  `);
  return r.rows as any[];
}

describe("ugc_brief ledger rail", () => {
  it("a released brief accrues its recorded split exactly once", async () => {
    await seedReleasedBrief();
    const first = await syncPendingPayoutLedgerForSeller(CREATOR);
    expect(first.inserted["ugc_brief:accrual"]).toBe(1);
    const rows = await ledgerRows("ugc_brief");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entry_type: "accrual",
      gross_cents: 10001,
      platform_fee_cents: 500,
      net_cents: 9501,
      stripe_session_id: "cs_ugc_1",
    });
    /* Replay: the reconciliation is idempotent — no second row. */
    const second = await syncPendingPayoutLedgerForSeller(CREATOR);
    expect(second.inserted["ugc_brief:accrual"]).toBe(0);
    expect(await ledgerRows("ugc_brief")).toHaveLength(1);
  });

  it("summary + pending read carry the brief net", async () => {
    await seedReleasedBrief();
    const summary = await sellerEarningsSummary(CREATOR);
    expect(summary.ugcBriefs).toEqual({ totalCents: 9501, grossCents: 10001, feeCents: 500, count: 1 });
    /* Brief-only basket: the unified total IS the brief net. */
    expect(summary.totalCents).toBe(9501);
    expect(await sellerUgcBriefs(CREATOR)).toEqual({ totalCents: 9501, grossCents: 10001, feeCents: 500, count: 1 });

    const read = await readPendingPayoutForSeller(CREATOR);
    expect(read.pendingCents).toBe(9501);
    expect(read.rows.filter((r) => r.sourceKind === "ugc_brief")).toHaveLength(1);
  });

  it("unreleased money never accrues: funded brief, and refunded-before-release brief", async () => {
    await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${PROFILE}, ${CREATOR})`);
    await h.db.execute(sql`
      INSERT INTO ugc_briefs (id, brand_user_id, claimed_by_user_id, escrow_status, stripe_session_id)
      VALUES (${BRIEF}, ${BRAND}, ${CREATOR}, 'funded', 'cs_ugc_funded')
    `);
    await h.db.execute(sql`
      INSERT INTO ugc_briefs (brand_user_id, claimed_by_user_id, escrow_status, stripe_session_id)
      VALUES (${BRAND}, ${CREATOR}, 'refunded', 'cs_ugc_refunded')
    `);
    const sync = await syncPendingPayoutLedgerForSeller(CREATOR);
    expect(sync.inserted["ugc_brief:accrual"]).toBe(0);
    expect(await ledgerRows("ugc_brief")).toHaveLength(0);
    const summary = await sellerEarningsSummary(CREATOR);
    expect(summary.ugcBriefs).toEqual({ totalCents: 0, grossCents: 0, feeCents: 0, count: 0 });
  });

  it("a release later reversed lands a reversal row; summary excludes it; pending nets to zero", async () => {
    await seedReleasedBrief();
    await syncPendingPayoutLedgerForSeller(CREATOR);
    await h.db.execute(sql`UPDATE ugc_briefs SET escrow_status = 'refunded' WHERE id = ${BRIEF}`);
    const sync = await syncPendingPayoutLedgerForSeller(CREATOR);
    expect(sync.inserted["ugc_brief:reversal"]).toBe(1);
    const rows = await ledgerRows("ugc_brief");
    expect(rows.map((r) => r.entry_type).sort()).toEqual(["accrual", "reversal"]);

    const summary = await sellerEarningsSummary(CREATOR);
    expect(summary.ugcBriefs.totalCents).toBe(0);
    const read = await readPendingPayoutForSeller(CREATOR);
    expect(read.pendingCents).toBe(0);
  });
});

describe("year statement — ugcBriefs line", () => {
  it("counts the release stamps in the release year; totals identity holds", async () => {
    await seedReleasedBrief();
    const stmt = await buildYearStatement(CREATOR, 2026);
    expect(stmt.partial).toBe(false);
    expect(stmt.sources.ugcBriefs).toEqual({ status: "ok", totalCents: 9501, count: 1 });

    const summary = await sellerEarningsSummary(CREATOR);
    expect(stmt.totalCents - (stmt.sources.royalties.totalCents ?? 0)).toBe(summary.totalCents);
  });

  it("a brief released in another year does not leak into this one", async () => {
    await seedReleasedBrief();
    const stmt = await buildYearStatement(CREATOR, 2025);
    expect(stmt.sources.ugcBriefs).toEqual({ status: "ok", totalCents: 0, count: 0 });
  });
});
