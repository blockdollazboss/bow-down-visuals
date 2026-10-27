/**
 * creator-stripe-customer.test.ts — payfix upgrade-path rung 1.
 *
 * Pass 1 (Oct 26): a Pro → Elite "upgrade" created TWO subscriptions on
 * TWO separate Stripe customers ($41/mo) because checkout never passed
 * a `customer` — Stripe minted a new one per purchase. These tests pin
 * the dedupe contract over pg-mem through the real helper:
 *   - first purchase creates ONE customer and persists the mapping;
 *   - every later purchase reuses it (no second create);
 *   - a legacy customer id on the subscription/hosting row is adopted
 *     (pre-fix subscribers keep their customer), never replaced;
 *   - a stored customer Stripe reports missing is replaced once;
 *   - other Stripe errors propagate (fail closed, no silent minting).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

const testState = vi.hoisted(() => ({ db: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});

import { getOrCreateStripeCustomerForUser } from "../creator-stripe-customer";
import { createTestDb } from "./test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE user_stripe_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  stripe_customer_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE creator_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL UNIQUE,
  tier text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  stripe_subscription_id text,
  stripe_customer_id text,
  current_period_end timestamptz,
  cancel_at_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE creator_hosting (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active',
  stripe_subscription_id text,
  stripe_customer_id text,
  current_period_end timestamptz,
  cancel_at_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

function fakeStripe(existing: Set<string>) {
  let seq = 0;
  return {
    created: [] as string[],
    customers: {
      create: vi.fn(async () => {
        const id = `cus_new_${++seq}`;
        existing.add(id);
        return { id };
      }),
      retrieve: vi.fn(async (id: string) => {
        if (!existing.has(id)) {
          throw Object.assign(new Error("No such customer"), { code: "resource_missing" });
        }
        return { id };
      }),
    },
  };
}

const userId = randomUUID();
const profileId = randomUUID();

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
  testState.db = db;
});

describe("getOrCreateStripeCustomerForUser", () => {
  it("creates exactly one customer, persists it, and reuses it on the next purchase", async () => {
    const stripe = fakeStripe(new Set());
    const first = await getOrCreateStripeCustomerForUser(stripe as any, { userId, profileId, email: "a@b.c" });
    const second = await getOrCreateStripeCustomerForUser(stripe as any, { userId, profileId, email: "a@b.c" });
    expect(first).toBe("cus_new_1");
    expect(second).toBe(first);
    expect(stripe.customers.create).toHaveBeenCalledTimes(1);
    const rows = await testState.db.execute(sql`SELECT stripe_customer_id FROM user_stripe_customers WHERE user_id = ${userId}`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].stripe_customer_id).toBe(first);
  });

  it("adopts the legacy customer from creator_subscriptions instead of minting a second", async () => {
    await testState.db.execute(sql`
      INSERT INTO creator_subscriptions (profile_id, tier, status, stripe_subscription_id, stripe_customer_id)
      VALUES (${profileId}, 'pro', 'active', 'sub_legacy', 'cus_legacy')`);
    const stripe = fakeStripe(new Set(["cus_legacy"]));
    const id = await getOrCreateStripeCustomerForUser(stripe as any, { userId, profileId });
    expect(id).toBe("cus_legacy");
    expect(stripe.customers.create).not.toHaveBeenCalled();
  });

  it("adopts the legacy customer from creator_hosting when no subscription row has one", async () => {
    await testState.db.execute(sql`
      INSERT INTO creator_hosting (profile_id, status, stripe_customer_id)
      VALUES (${profileId}, 'active', 'cus_hosting')`);
    const stripe = fakeStripe(new Set(["cus_hosting"]));
    const id = await getOrCreateStripeCustomerForUser(stripe as any, { userId, profileId });
    expect(id).toBe("cus_hosting");
    expect(stripe.customers.create).not.toHaveBeenCalled();
  });

  it("replaces a stored customer Stripe reports missing, exactly once", async () => {
    const stripe = fakeStripe(new Set());
    const first = await getOrCreateStripeCustomerForUser(stripe as any, { userId, profileId });
    expect(first).toBe("cus_new_1");
    // Simulate the stored customer being deleted in Stripe.
    const stripe2 = fakeStripe(new Set());
    const replaced = await getOrCreateStripeCustomerForUser(stripe2 as any, { userId, profileId });
    expect(replaced).toBe("cus_new_1"); // fake's first mint; mapping now points at it
    const rows = await testState.db.execute(sql`SELECT stripe_customer_id FROM user_stripe_customers WHERE user_id = ${userId}`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].stripe_customer_id).toBe(replaced);
  });

  it("propagates non-resource_missing Stripe errors instead of minting a duplicate", async () => {
    const stripe = fakeStripe(new Set(["cus_ok"]));
    await getOrCreateStripeCustomerForUser(stripe as any, { userId, profileId });
    stripe.customers.retrieve.mockRejectedValueOnce(Object.assign(new Error("rate limited"), { code: "rate_limit" }));
    await expect(
      getOrCreateStripeCustomerForUser(stripe as any, { userId, profileId }),
    ).rejects.toThrow("rate limited");
    expect(stripe.customers.create).toHaveBeenCalledTimes(1);
  });
});
