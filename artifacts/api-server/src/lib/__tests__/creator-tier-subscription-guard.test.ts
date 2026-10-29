/**
 * creator-tier-subscription-guard.test.ts — Gate #4 diagnosis pins.
 *
 * Gate Re-Run #4 (Oct 28, stack600 build): an embedded Pro subscribe
 * completed, the verify sync landed the tier ("You're Pro now"
 * rendered), and minutes later the account read Free again with
 * Billing pointing at no live subscription. The mechanism, proven in
 * creator-tier-sync.ts: handleTierSubscriptionEvent resolved the
 * profile by CUSTOMER and upserted ANY creator_tier subscription
 * event for that customer into the profile's single row — tier,
 * status and stripe_subscription_id — with no identity or ordering
 * guard. stack600's intent hygiene (adoptDanglingSubscription)
 * cancels the member's dangling incomplete subscriptions DURING the
 * subscribe; Stripe delivers the resulting
 * customer.subscription.deleted asynchronously, and a delivery that
 * lands after the verify upsert rewrites the row to the dead
 * subscription.
 *
 * These tests drive the real sync handler over pg-mem through the
 * exact gate sequence and pin the guard:
 *   - verify lands the new tier; a late hygiene deleted event for a
 *     DIFFERENT (dangling) subscription cannot revert it;
 *   - the same deleted event arriving BEFORE the purchase lands
 *     nothing and poisons nothing (no row rewrite, no receipt);
 *   - a foreign live subscription cannot clobber the current plan;
 *   - a live foreign subscription CAN adopt a dead row (the
 *     closed-tab rescue — the purchase webhook is the only sync);
 *   - the current subscription's own deletion still lands;
 *   - a first-ever purchase resolves the profile from the
 *     subscription's stamped user_id even with no prior row.
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

import { handleTierSubscriptionEvent } from "../creator-tier-sync";
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

function sub(over: Record<string, unknown> = {}): any {
  return {
    id: "sub_new",
    customer: "cus_1",
    status: "active",
    metadata: { kind: "creator_tier", tier: "pro", user_id: userId, profile_id: profileId },
    items: { data: [{ price: { id: "price_pro" }, current_period_end: 1_800_000_000 }] },
    cancel_at: null,
    ...over,
  };
}

/** The Gate #2 leftover the stack600 hygiene cancels mid-subscribe. */
const danglingDeleted = () =>
  sub({ id: "sub_dangling", status: "canceled" });

async function row(): Promise<any> {
  const r = await testState.db.execute(
    sql`SELECT tier, status, stripe_subscription_id FROM creator_subscriptions WHERE profile_id = ${profileId}`,
  );
  return r.rows[0] ?? null;
}

async function receipts(): Promise<any[]> {
  const r = await testState.db.execute(
    sql`SELECT kind, tier, status FROM creator_subscription_receipts ORDER BY created_at, kind`,
  );
  return r.rows;
}

async function seedRow(values: { tier: string; status: string; stripeSubscriptionId: string }) {
  await testState.db.execute(sql`
    INSERT INTO creator_subscriptions (profile_id, tier, status, stripe_subscription_id, stripe_customer_id)
    VALUES (${profileId}, ${values.tier}, ${values.status}, ${values.stripeSubscriptionId}, 'cus_1')`);
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
});

describe("Gate #4 sequence — hygiene deleted event vs the verify landing", () => {
  it("verify lands the new tier; the late deleted event for the dangling sub cannot revert it", async () => {
    // Post-Gate-#3 state: the row names the ended plan, account reads Free.
    await seedRow({ tier: "pro", status: "canceled", stripeSubscriptionId: "sub_gate3" });

    // The verify sync (no event id — the route's own call shape).
    await handleTierSubscriptionEvent(sub());
    expect(await row()).toMatchObject({ tier: "pro", status: "active", stripe_subscription_id: "sub_new" });

    // Stripe delivers the hygiene cancel's deleted event AFTERWARDS.
    await handleTierSubscriptionEvent(danglingDeleted(), "evt_late_deleted");

    // The tier must still be landed, on the NEW subscription, and the
    // dead sub must not have written a phantom 'canceled' receipt.
    expect(await row()).toMatchObject({ tier: "pro", status: "active", stripe_subscription_id: "sub_new" });
    const rs = await receipts();
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ kind: "status_changed", status: "active" });
  });

  it("the hygiene deleted event arriving BEFORE the purchase lands nothing and poisons nothing", async () => {
    await seedRow({ tier: "pro", status: "canceled", stripeSubscriptionId: "sub_gate3" });

    await handleTierSubscriptionEvent(danglingDeleted(), "evt_early_deleted");
    expect(await row()).toMatchObject({ tier: "pro", status: "canceled", stripe_subscription_id: "sub_gate3" });
    expect(await receipts()).toHaveLength(0);

    await handleTierSubscriptionEvent(sub());
    expect(await row()).toMatchObject({ tier: "pro", status: "active", stripe_subscription_id: "sub_new" });
  });

  it("a foreign live subscription cannot clobber the current live plan", async () => {
    await seedRow({ tier: "pro", status: "active", stripeSubscriptionId: "sub_current" });
    await handleTierSubscriptionEvent(
      sub({
        id: "sub_other",
        metadata: { kind: "creator_tier", tier: "elite", user_id: userId, profile_id: profileId },
        items: { data: [{ price: { id: "price_elite" }, current_period_end: 1_800_000_000 }] },
      }),
      "evt_foreign_live",
    );
    expect(await row()).toMatchObject({ tier: "pro", status: "active", stripe_subscription_id: "sub_current" });
    expect(await receipts()).toHaveLength(0);
  });

  it("closed-tab rescue: a live foreign subscription adopts a dead row via the webhook alone", async () => {
    await seedRow({ tier: "pro", status: "canceled", stripeSubscriptionId: "sub_old" });
    await handleTierSubscriptionEvent(
      sub({
        id: "sub_new",
        metadata: { kind: "creator_tier", tier: "elite", user_id: userId, profile_id: profileId },
        items: { data: [{ price: { id: "price_elite" }, current_period_end: 1_800_000_000 }] },
      }),
      "evt_rescue",
    );
    expect(await row()).toMatchObject({ tier: "elite", status: "active", stripe_subscription_id: "sub_new" });
  });

  it("the current subscription's own deletion still lands (with its canceled receipt)", async () => {
    await seedRow({ tier: "pro", status: "active", stripeSubscriptionId: "sub_current" });
    await handleTierSubscriptionEvent(sub({ id: "sub_current", status: "canceled" }), "evt_del_current");
    expect(await row()).toMatchObject({ status: "canceled", stripe_subscription_id: "sub_current" });
    const rs = await receipts();
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ kind: "canceled", status: "canceled" });
  });

  it("first purchase: the sync resolves the profile from the subscription's user_id when no row exists yet", async () => {
    // No creator_subscriptions row at all — the customer lookup alone
    // can never resolve this profile.
    await handleTierSubscriptionEvent(sub({ customer: "cus_brand_new" }));
    expect(await row()).toMatchObject({ tier: "pro", status: "active", stripe_subscription_id: "sub_new" });
  });
});
