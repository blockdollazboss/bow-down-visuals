/**
 * earnings-statement-refund-filter.test.ts — L7: refunded memberships
 * must not count in the annual earnings statement.
 *
 * sellerMemberships() (lib/seller-earnings.ts, behind GET /api/earnings)
 * has always excluded status='refunded' rows; buildYearStatement in
 * routes/trust.ts summed fan_members WITHOUT that exclusion, so a
 * refunded membership still inflated the statement (and its PDF) while
 * /api/earnings disagreed. These tests drive the REAL buildYearStatement
 * against real Postgres semantics (pg-mem) and pin the agreement:
 *   - a refunded membership contributes 0 cents and 0 records;
 *   - an active paid membership still counts in full;
 *   - the statement's membership figure EQUALS sellerMemberships().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

const h = vi.hoisted(() => ({ db: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

import { buildYearStatement } from "../trust";
import { sellerMemberships } from "../../lib/seller-earnings";
import { createTestDb } from "../../lib/__tests__/test-db";

const USER = randomUUID();
const OTHER = randomUUID();
const YEAR = 2026;

const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL
);
CREATE TABLE store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, creator_amount_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, event_type text NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0,
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
  status text NOT NULL DEFAULT 'released',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE royalty_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, gross_amount numeric NOT NULL DEFAULT 0,
  period_end timestamptz NOT NULL DEFAULT now()
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
});

async function seedMember(userId: string, priceCents: number, status: string, session: string | null, createdAt: string) {
  await h.db.execute(sql`
    INSERT INTO fan_members (user_id, price_cents, status, stripe_session_id, created_at)
    VALUES (${userId}, ${priceCents}, ${status}, ${session}, ${createdAt}::timestamptz)`);
}

describe("buildYearStatement — memberships source excludes refunded rows", () => {
  it("a refunded membership contributes 0; an active paid one counts; statement agrees with sellerMemberships", async () => {
    await seedMember(USER, 500, "active", "cs_active", "2026-03-01T00:00:00Z");
    await seedMember(USER, 700, "refunded", "cs_refunded", "2026-04-01T00:00:00Z");
    /* Manual row (no verified checkout) — never counted, before or after. */
    await seedMember(USER, 900, "active", null, "2026-05-01T00:00:00Z");
    /* Another creator's refund must not leak into this statement. */
    await seedMember(OTHER, 1100, "active", "cs_other", "2026-03-01T00:00:00Z");

    const stmt = await buildYearStatement(USER, YEAR);
    expect(stmt.sources.memberships.status).toBe("ok");
    expect(stmt.sources.memberships.totalCents).toBe(500);
    expect(stmt.sources.memberships.count).toBe(1);

    const viaEarnings = await sellerMemberships(USER);
    expect(stmt.sources.memberships.totalCents).toBe(viaEarnings.totalCents);
    expect(stmt.sources.memberships.count).toBe(viaEarnings.count);
  });

  it("a creator whose only membership was refunded reads 0 / 0", async () => {
    await seedMember(USER, 700, "refunded", "cs_refunded", "2026-04-01T00:00:00Z");
    const stmt = await buildYearStatement(USER, YEAR);
    expect(stmt.sources.memberships.totalCents).toBe(0);
    expect(stmt.sources.memberships.count).toBe(0);
    expect(stmt.totalCents).toBe(0);
  });

  it("a refunded membership from another year stays out of that year's statement too", async () => {
    await seedMember(USER, 500, "active", "cs_active", "2026-03-01T00:00:00Z");
    await seedMember(USER, 700, "refunded", "cs_refunded", "2025-04-01T00:00:00Z");
    const stmt2025 = await buildYearStatement(USER, 2025);
    expect(stmt2025.sources.memberships.totalCents).toBe(0);
    expect(stmt2025.sources.memberships.count).toBe(0);
  });
});
