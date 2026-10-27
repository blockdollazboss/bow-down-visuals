/**
 * creator-tier-receipts.test.ts — payfix upgrade-path rung 3.
 *
 * Pass 1 (Oct 26) found NO receipt/history row for a paid subscription.
 * These tests drive the real webhook sync handlers over pg-mem and pin:
 *   - checkout completion writes ONE 'subscribed' receipt (replay-safe);
 *   - a subscription.updated tier change writes ONE 'tier_changed'
 *     receipt, keyed on the Stripe event id (replay-safe);
 *   - invoice.paid (renewal) writes ONE 'renewed' receipt per invoice;
 *     the subscription_create invoice writes none (checkout owns it);
 *   - subscription deletion writes ONE 'canceled' receipt.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

const testState = vi.hoisted(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  process.env["STRIPE_PRICE_TIER_PRO"] = "price_pro";
  process.env["STRIPE_PRICE_TIER_ELITE"] = "price_elite";
  return { db: null as any };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});
vi.mock("../email", () => ({
  sendEmail: vi.fn(async () => {}),
  emailShell: (t: string, b: string) => `${t}${b}`,
  emailButton: () => "",
  escapeHtml: (s: string) => s,
  baseUrlForEmail: () => "http://localhost",
}));

import {
  handleTierCheckoutCompleted,
  handleTierSubscriptionEvent,
  handleTierInvoicePaid,
} from "../creator-tier-sync";
import { createTestDb } from "./test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid);
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
CREATE TABLE creator_subscription_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  kind text NOT NULL,
  tier text,
  status text,
  amount_cents integer,
  currency text,
  stripe_subscription_id text,
  stripe_customer_id text,
  stripe_object_id text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

const userId = randomUUID();
const profileId = randomUUID();

async function receipts(): Promise<any[]> {
  const r = await testState.db.execute(sql`SELECT kind, tier, status, amount_cents FROM creator_subscription_receipts ORDER BY created_at, kind`);
  return r.rows;
}

function subEvent(over: Record<string, unknown> = {}): any {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    metadata: { kind: "creator_tier", tier: "elite", user_id: userId, profile_id: profileId },
    items: { data: [{ price: { id: "price_elite" }, current_period_end: 1_800_000_000 }] },
    cancel_at: null,
    ...over,
  };
}

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
  await db.execute(sql`INSERT INTO creator_profiles (id, user_id) VALUES (${profileId}, ${userId})`);
  await db.execute(sql`
    INSERT INTO creator_subscriptions (profile_id, tier, status, stripe_subscription_id, stripe_customer_id)
    VALUES (${profileId}, 'pro', 'active', 'sub_1', 'cus_1')`);
});

describe("subscription receipt rows", () => {
  it("checkout completion writes exactly one 'subscribed' receipt, replay-safe", async () => {
    const session: any = {
      id: "cs_1",
      metadata: { kind: "creator_tier", tier: "pro", user_id: userId, profile_id: profileId },
      subscription: null,
      customer: "cus_1",
      amount_total: 1200,
      currency: "usd",
      customer_details: { email: "a@b.c" },
    };
    await handleTierCheckoutCompleted(session);
    await handleTierCheckoutCompleted(session); // webhook replay
    const rows = await receipts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "subscribed", tier: "pro", amount_cents: 1200 });
  });

  it("tier change via subscription.updated writes exactly one 'tier_changed' receipt, replay-safe", async () => {
    await handleTierSubscriptionEvent(subEvent(), "evt_up_1");
    await handleTierSubscriptionEvent(subEvent(), "evt_up_1"); // replay of the same event
    const rows = await receipts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "tier_changed", tier: "elite" });
    const sub = await testState.db.execute(sql`SELECT tier FROM creator_subscriptions WHERE profile_id = ${profileId}`);
    expect(sub.rows[0].tier).toBe("elite");
  });

  it("a no-change subscription.updated writes no receipt", async () => {
    const same: any = subEvent({ metadata: { kind: "creator_tier", tier: "pro" }, items: { data: [{ price: { id: "price_pro" }, current_period_end: 1_800_000_000 }] } });
    await handleTierSubscriptionEvent(same, "evt_noop_1");
    expect(await receipts()).toHaveLength(0);
  });

  it("invoice.paid renewal writes exactly one 'renewed' receipt per invoice; subscription_create writes none", async () => {
    const inv: any = { id: "in_1", customer: "cus_1", subscription: "sub_1", amount_paid: 2900, amount_due: 2900, currency: "usd", billing_reason: "subscription_cycle" };
    await handleTierInvoicePaid(inv);
    await handleTierInvoicePaid(inv); // replay
    const createInv: any = { ...inv, id: "in_0", billing_reason: "subscription_create" };
    await handleTierInvoicePaid(createInv);
    const rows = await receipts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "renewed", amount_cents: 2900 });
  });

  it("subscription deletion writes a 'canceled' receipt", async () => {
    await handleTierSubscriptionEvent(subEvent({ status: "canceled" }), "evt_del_1");
    const rows = await receipts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "canceled", status: "canceled" });
  });
});
