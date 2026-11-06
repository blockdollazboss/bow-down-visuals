/**
 * year-statement-scope.test.ts — LANE L9: the annual earnings
 * statement's SOURCE SCOPE, against pg-mem (the trust-money pattern).
 *
 * The statement (buildYearStatement, routes/trust.ts) shipped with
 * five sources (store orders, shop events, memberships, brand deals,
 * royalties). The unified earnings summary (lib/seller-earnings) —
 * built ten days later as "the single aggregation every surface
 * reads" — counts MORE rails: digital sales and beat licenses were
 * never added to the statement, and neither were shoutouts / tip jar
 * when those rails settled for real. No comment, test, or doc ever
 * recorded the narrower list as a choice; the statement's own face
 * claims full scope ("statement_of_platform_recorded_earnings").
 * Verdict: neglect. The statement now counts the same settled rails.
 *
 * Pinned here:
 *  - a basket covering EVERY source: each statement line equals the
 *    summary's figure for that rail (for the rails this base's
 *    summary has), and the totals reconcile exactly;
 *  - refunded / unpaid / pending rows contribute NOTHING on any rail;
 *  - the new rails book to the year the money settled and never leak
 *    across creators.
 *
 * JOIN RECONCILIATION (stack1600 join crew): on THIS base (join5) the
 * summary has no shoutout/tipJar readers and counts memberships
 * GROSS, so the totals identity below subtracts the statement-only
 * royalties + the two new rails. When L1 (memberships net-of-10%
 * everywhere) and L2 (summary gains sellerShoutouts/sellerTipJar with
 * the same formulas used here) land, the identity becomes
 *   statement.totalCents − royalties == summary.totalCents
 * with no change to this file's per-rail assertions: memberships are
 * asserted AGAINST sellerMemberships(), never against a hard-coded
 * gross/net figure.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { DataType } from "pg-mem";

const testState = vi.hoisted(() => ({ db: null as any, userId: "" }));
vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = testState.userId; next(); },
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});
vi.mock("../../lib/rate-limit", () => ({ publicApiLimiter: (_q: any, _s: any, n: any) => n() }));

import { buildYearStatement } from "../trust";
import { sellerEarningsSummary } from "../../lib/seller-earnings";
import { __resetSaleSplitProbes } from "../../lib/sale-splits";
import { createTestDb } from "../../lib/__tests__/test-db";

const DDL = `
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text, display_name text);
CREATE TABLE store_orders (id uuid PRIMARY KEY, profile_id uuid NOT NULL, creator_amount_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'completed', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE digital_sales (id uuid PRIMARY KEY, profile_id uuid NOT NULL, amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0, creator_amount_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'completed', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE shop_events (id uuid PRIMARY KEY, user_id uuid NOT NULL, event_type text NOT NULL, amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE beat_licenses (id uuid PRIMARY KEY, producer_id uuid NOT NULL, price_cents integer NOT NULL DEFAULT 0, commission_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'pending_payment', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE fan_members (id uuid PRIMARY KEY, user_id uuid NOT NULL, price_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'active', stripe_session_id text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sponsor_payouts (id uuid PRIMARY KEY, creator_user_id text NOT NULL, net_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'released', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE royalty_entries (id uuid PRIMARY KEY, user_id uuid NOT NULL, song_title text NOT NULL, platform text NOT NULL, period_start date NOT NULL, period_end date NOT NULL, gross_amount numeric NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE shoutout_requests (id uuid PRIMARY KEY, creator_user_id uuid NOT NULL, price_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'pending_payment', paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE tip_jar_tips (id uuid PRIMARY KEY, page_user_id uuid NOT NULL, amount_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'pending_payment', paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sale_split_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_kind text NOT NULL, sale_id uuid NOT NULL, surface text NOT NULL DEFAULT '', product_id uuid, owner_user_id uuid NOT NULL, seller_user_id uuid NOT NULL, seller_profile_id uuid, role text NOT NULL, amount_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'earned');
`;

const OWNER = randomUUID(), STRANGER = randomUUID(), PROFILE = randomUUID();

beforeEach(() => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({ name: "gen_random_uuid", returns: DataType.uuid, implementation: () => randomUUID() });
  mem.public.none(DDL);
  testState.db = db; testState.userId = OWNER;
  __resetSaleSplitProbes();
});

describe("annual statement source scope (L9)", () => {
  it("covers every settled rail: each statement line equals the summary's figure, totals reconcile", async () => {
    const db = testState.db;
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug) VALUES (${PROFILE}, ${OWNER}, 'me')`);
    /* Digital sales — completed counts (creator net on the row); refunded does not. */
    await db.execute(sql`INSERT INTO digital_sales (id, profile_id, amount_cents, platform_fee_cents, creator_amount_cents, status, created_at) VALUES (${randomUUID()}, ${PROFILE}, 3158, 158, 3000, 'completed', '2026-02-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO digital_sales (id, profile_id, amount_cents, platform_fee_cents, creator_amount_cents, status, created_at) VALUES (${randomUUID()}, ${PROFILE}, 10526, 527, 9999, 'refunded', '2026-02-02T00:00:00Z')`);
    /* Store orders + shop events (the statement's original rails). */
    await db.execute(sql`INSERT INTO store_orders (id, profile_id, creator_amount_cents, status, created_at) VALUES (${randomUUID()}, ${PROFILE}, 5000, 'completed', '2026-03-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO shop_events (id, user_id, event_type, amount_cents, platform_fee_cents, created_at) VALUES (${randomUUID()}, ${OWNER}, 'sale', 2000, 100, '2026-04-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO shop_events (id, user_id, event_type, amount_cents, platform_fee_cents, created_at) VALUES (${randomUUID()}, ${OWNER}, 'refund', 7777, 0, '2026-04-02T00:00:00Z')`);
    /* Beat licenses — completed counts net of the 15% commission; pending does not. */
    await db.execute(sql`INSERT INTO beat_licenses (id, producer_id, price_cents, commission_cents, status, created_at) VALUES (${randomUUID()}, ${OWNER}, 2000, 300, 'completed', '2026-05-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO beat_licenses (id, producer_id, price_cents, commission_cents, status, created_at) VALUES (${randomUUID()}, ${OWNER}, 8888, 0, 'pending_payment', '2026-05-02T00:00:00Z')`);
    /* Memberships — settled (session set) counts; refunded excluded on BOTH surfaces. */
    await db.execute(sql`INSERT INTO fan_members (id, user_id, price_cents, status, stripe_session_id, created_at) VALUES (${randomUUID()}, ${OWNER}, 1500, 'active', 'cs_1', '2026-05-03T00:00:00Z')`);
    await db.execute(sql`INSERT INTO fan_members (id, user_id, price_cents, status, stripe_session_id, created_at) VALUES (${randomUUID()}, ${OWNER}, 1500, 'refunded', 'cs_2', '2026-05-04T00:00:00Z')`);
    /* Brand deals — released escrow net. */
    await db.execute(sql`INSERT INTO sponsor_payouts (id, creator_user_id, net_cents, status, created_at) VALUES (${randomUUID()}, ${OWNER}, 4000, 'released', '2026-06-01T00:00:00Z')`);
    /* Shoutouts — settled = paid_at set, net of the flat 5% fee; unpaid and refunded excluded. */
    await db.execute(sql`INSERT INTO shoutout_requests (id, creator_user_id, price_cents, status, paid_at, created_at) VALUES (${randomUUID()}, ${OWNER}, 1000, 'accepted', '2026-07-01T00:00:00Z', '2026-06-28T00:00:00Z')`);
    await db.execute(sql`INSERT INTO shoutout_requests (id, creator_user_id, price_cents, status, paid_at, created_at) VALUES (${randomUUID()}, ${OWNER}, 1000, 'pending_payment', NULL, '2026-07-02T00:00:00Z')`);
    await db.execute(sql`INSERT INTO shoutout_requests (id, creator_user_id, price_cents, status, paid_at, created_at) VALUES (${randomUUID()}, ${OWNER}, 1000, 'refunded', '2026-07-03T00:00:00Z', '2026-07-01T00:00:00Z')`);
    /* Tip jar — paid tips at the full amount (no fee); pending is not earnings. */
    await db.execute(sql`INSERT INTO tip_jar_tips (id, page_user_id, amount_cents, status, paid_at, created_at) VALUES (${randomUUID()}, ${OWNER}, 500, 'paid', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO tip_jar_tips (id, page_user_id, amount_cents, status, paid_at, created_at) VALUES (${randomUUID()}, ${OWNER}, 700, 'pending_payment', NULL, '2026-08-02T00:00:00Z')`);
    /* Royalties — recorded platform earnings the payout summary never carried (statement-only). */
    await db.execute(sql`INSERT INTO royalty_entries (id, user_id, song_title, platform, period_start, period_end, gross_amount) VALUES (${randomUUID()}, ${OWNER}, 'S', 'manual', '2026-01-01', '2026-01-31', 12.34)`);

    const stmt: any = await buildYearStatement(OWNER, 2026);
    expect(stmt.partial).toBe(false);
    expect(stmt.sources.digitalSales).toEqual({ status: "ok", totalCents: 3000, count: 1 });
    expect(stmt.sources.storeSales).toEqual({ status: "ok", totalCents: 5000, count: 1 });
    expect(stmt.sources.shopSales).toEqual({ status: "ok", totalCents: 1900, count: 1 });
    expect(stmt.sources.beats).toEqual({ status: "ok", totalCents: 1700, count: 1 });
    expect(stmt.sources.memberships).toEqual({ status: "ok", totalCents: 1500, count: 1 });
    expect(stmt.sources.shoutouts).toEqual({ status: "ok", totalCents: 950, count: 1 });
    expect(stmt.sources.tipJar).toEqual({ status: "ok", totalCents: 500, count: 1 });
    expect(stmt.sources.brandDeals).toEqual({ status: "ok", totalCents: 4000, count: 1 });
    expect(stmt.sources.royalties).toEqual({ status: "ok", totalCents: 1234, count: 1 });
    expect(stmt.totalCents).toBe(3000 + 5000 + 1900 + 1700 + 1500 + 950 + 500 + 4000 + 1234);

    /* The same basket through the unified summary: every shared rail
       must tell the identical story. (All basket rows sit in 2026, so
       the summary's all-time figures are this year's figures.) */
    const summary: any = await sellerEarningsSummary(OWNER);
    expect(stmt.sources.digitalSales.totalCents).toBe(summary.storeSales.digitalSalesCents);
    expect(stmt.sources.storeSales.totalCents).toBe(summary.storeSales.profileStoreCents);
    expect(stmt.sources.shopSales.totalCents).toBe(summary.storeSales.shopSalesCents);
    expect(stmt.sources.beats.totalCents).toBe(summary.beats.totalCents);
    expect(stmt.sources.memberships.totalCents).toBe(summary.memberships.totalCents);
    expect(stmt.sources.brandDeals.totalCents).toBe(summary.brandDeals.totalCents);
    /* Join5 reconciliation (see header): minus the statement-only
       royalties and the two rails this base's summary lacks, the
       totals are the same number. */
    expect(
      stmt.totalCents - stmt.sources.royalties.totalCents - stmt.sources.shoutouts.totalCents - stmt.sources.tipJar.totalCents,
    ).toBe(summary.totalCents);
  });

  it("books the new rails to the year the money settled — other years and cross-year settlements stay out", async () => {
    const db = testState.db;
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug) VALUES (${PROFILE}, ${OWNER}, 'me')`);
    await db.execute(sql`INSERT INTO digital_sales (id, profile_id, creator_amount_cents, status, created_at) VALUES (${randomUUID()}, ${PROFILE}, 1111, 'completed', '2025-03-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO beat_licenses (id, producer_id, price_cents, commission_cents, status, created_at) VALUES (${randomUUID()}, ${OWNER}, 1000, 150, 'completed', '2025-04-01T00:00:00Z')`);
    /* This row's two timestamps deliberately sit in different years
       (created 2026, paid_at 2025) so the test proves the statement
       books shoutouts by the settlement year (paid_at), never by the
       request year. */
    await db.execute(sql`INSERT INTO shoutout_requests (id, creator_user_id, price_cents, status, paid_at, created_at) VALUES (${randomUUID()}, ${OWNER}, 1000, 'accepted', '2025-12-20T00:00:00Z', '2026-01-15T00:00:00Z')`);
    await db.execute(sql`INSERT INTO tip_jar_tips (id, page_user_id, amount_cents, status, paid_at, created_at) VALUES (${randomUUID()}, ${OWNER}, 300, 'paid', '2025-06-01T00:00:00Z', '2025-06-01T00:00:00Z')`);

    const y26: any = await buildYearStatement(OWNER, 2026);
    expect(y26.sources.digitalSales.totalCents).toBe(0);
    expect(y26.sources.beats.totalCents).toBe(0);
    expect(y26.sources.shoutouts.totalCents).toBe(0);
    expect(y26.sources.tipJar.totalCents).toBe(0);

    const y25: any = await buildYearStatement(OWNER, 2025);
    expect(y25.sources.digitalSales.totalCents).toBe(1111);
    expect(y25.sources.beats.totalCents).toBe(850);
    expect(y25.sources.shoutouts.totalCents).toBe(950);
    expect(y25.sources.tipJar.totalCents).toBe(300);
  });

  it("owner-scoping holds on the new rails — another creator's rows never enter the statement", async () => {
    const db = testState.db;
    const STRANGER_PROFILE = randomUUID();
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug) VALUES (${PROFILE}, ${OWNER}, 'me')`);
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug) VALUES (${STRANGER_PROFILE}, ${STRANGER}, 'them')`);
    await db.execute(sql`INSERT INTO digital_sales (id, profile_id, creator_amount_cents, status, created_at) VALUES (${randomUUID()}, ${STRANGER_PROFILE}, 2222, 'completed', '2026-02-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO beat_licenses (id, producer_id, price_cents, commission_cents, status, created_at) VALUES (${randomUUID()}, ${STRANGER}, 2000, 300, 'completed', '2026-05-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO shoutout_requests (id, creator_user_id, price_cents, status, paid_at, created_at) VALUES (${randomUUID()}, ${STRANGER}, 1000, 'accepted', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z')`);
    await db.execute(sql`INSERT INTO tip_jar_tips (id, page_user_id, amount_cents, status, paid_at, created_at) VALUES (${randomUUID()}, ${STRANGER}, 500, 'paid', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`);

    const mine: any = await buildYearStatement(OWNER, 2026);
    expect(mine.sources.digitalSales.totalCents).toBe(0);
    expect(mine.sources.beats.totalCents).toBe(0);
    expect(mine.sources.shoutouts.totalCents).toBe(0);
    expect(mine.sources.tipJar.totalCents).toBe(0);
    expect(mine.totalCents).toBe(0);

    const theirs: any = await buildYearStatement(STRANGER, 2026);
    expect(theirs.sources.digitalSales.totalCents).toBe(2222);
    expect(theirs.sources.beats.totalCents).toBe(1700);
    expect(theirs.sources.shoutouts.totalCents).toBe(950);
    expect(theirs.sources.tipJar.totalCents).toBe(500);
  });
});
