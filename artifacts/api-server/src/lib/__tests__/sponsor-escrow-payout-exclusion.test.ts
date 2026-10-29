/**
 * sponsor-escrow-payout-exclusion.test.ts — payments-matrix ROW 13,
 * item 14: escrowed sponsor money must NEVER enter the Connect payout
 * sweep before the brand releases it.
 *
 * Both payout reads are pinned against the real escrow states:
 *  - routes/stripe-connect.ts pendingPayoutCents(profileId) — the figure
 *    the payout door pays from, and
 *  - lib/seller-earnings.ts readPendingPayoutForSeller(userId) — the
 *    unified earnings read (its sponsorReleasedCents term).
 *
 * A deal that is funded (brand's money sitting in escrow, no payout row
 * in existence) contributes ZERO to both. Even a hypothetical
 * sponsor_payouts row in a non-'released' status is excluded. Only a
 * 'released' row admits its net — exactly once, at exactly its amount.
 *
 * The predicate-level half (an 'escrow'-status row is ignored by
 * pendingPayoutCents) is also pinned in
 * routes/__tests__/stripe-connect-settlement.test.ts; this file pins
 * the lifecycle state itself — funded deal, no row — and the earnings
 * read the settlement suite never calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

const h = vi.hoisted(() => ({ db: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

import { pendingPayoutCents } from "../../routes/stripe-connect";
import { readPendingPayoutForSeller } from "../seller-earnings";
import { __resetSaleSplitProbes } from "../sale-splits";
import { createTestDb } from "./test-db";

const CREATOR = randomUUID();
const PROFILE = randomUUID();
const DEAL = randomUUID();

const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL DEFAULT '', display_name text NOT NULL DEFAULT ''
);
CREATE TABLE sponsor_deals (
  id uuid PRIMARY KEY,
  agreed_amount_cents integer,
  escrow_status text NOT NULL DEFAULT 'unfunded',
  status text NOT NULL DEFAULT 'active',
  accepted_user_id text
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
  stripe_session_id text,
  settled_payout_id uuid, settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
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
  stripe_session_id text, status text NOT NULL DEFAULT 'active',
  settled_payout_id uuid, settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sponsor_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid,
  creator_user_id text NOT NULL, net_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'released',
  settled_payout_id uuid, settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE creator_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
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
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pending_payout_ledger_source_entry_ux
  ON pending_payout_ledger (source_kind, source_id, entry_type);
CREATE TABLE sale_split_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_kind text NOT NULL, sale_id uuid NOT NULL,
  surface text NOT NULL DEFAULT '', product_id uuid,
  owner_user_id uuid NOT NULL, seller_user_id uuid NOT NULL, seller_profile_id uuid,
  role text NOT NULL, amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'earned'
);
`;

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
  __resetSaleSplitProbes();
  await h.db.execute(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${PROFILE}, ${CREATOR})`);
  /* The escrow state itself: brand funded $1,000; work not yet
     delivered; NO sponsor_payouts row exists (release creates it). */
  await h.db.execute(sql`
    INSERT INTO sponsor_deals (id, agreed_amount_cents, escrow_status, status, accepted_user_id)
    VALUES (${DEAL}, 100000, 'funded', 'funded', ${CREATOR}::text)
  `);
});

describe("row 13 item 14 — escrowed funds stay out of the payout sweep", () => {
  it("a funded-but-unreleased deal contributes 0 to both payout reads", async () => {
    expect(await pendingPayoutCents(PROFILE)).toBe(0);
    const read = await readPendingPayoutForSeller(CREATOR);
    expect(read.sponsorReleasedCents).toBe(0);
    expect(read.pendingCents).toBe(0);
  });

  it("even a non-'released' payout row is excluded; release admits exactly its net", async () => {
    await h.db.execute(sql`
      INSERT INTO sponsor_payouts (deal_id, creator_user_id, net_cents, status)
      VALUES (${DEAL}, ${CREATOR}::text, 85000, 'escrow')
    `);
    expect(await pendingPayoutCents(PROFILE)).toBe(0);
    expect((await readPendingPayoutForSeller(CREATOR)).sponsorReleasedCents).toBe(0);

    /* The release flips the one row — both reads now see exactly the
       creator's net, neither the gross nor the fee. */
    await h.db.execute(sql`UPDATE sponsor_payouts SET status = 'released' WHERE deal_id = ${DEAL}`);
    expect(await pendingPayoutCents(PROFILE)).toBe(85000);
    const read = await readPendingPayoutForSeller(CREATOR);
    expect(read.sponsorReleasedCents).toBe(85000);
    expect(read.pendingCents).toBe(85000);
  });
});
