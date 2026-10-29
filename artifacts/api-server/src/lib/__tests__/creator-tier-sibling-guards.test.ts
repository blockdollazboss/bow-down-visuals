/**
 * creator-tier-sibling-guards.test.ts — Gate #4 sibling-guard pins.
 *
 * The Gate #4 diagnosis (gate4-pass1-diagnosis.md) proved that
 * handleTierSubscriptionEvent upserted ANY creator_tier subscription
 * event for a customer into the profile's single row — no identity
 * guard — and fixed it on gate4/pass1-tier-landing (b3e5943be): an
 * event whose subscription is not the row's recorded subscription may
 * write only to adopt a dead row when it is itself live (the
 * closed-tab rescue); every other foreign-subscription event is
 * ignored.
 *
 * That lane flagged two siblings with the same "by customer, not by
 * subscription" assumption. These tests drive the real handlers over
 * pg-mem and pin the same guard discipline on both:
 *
 *   1. handleHostingSubscriptionEvent — the creator_hosting row is the
 *      same single-row upsert (ON CONFLICT (profile_id)); it resolved
 *      by stamped profile_id first, which narrows but does not
 *      eliminate cross-subscription overwrites between two hosting
 *      subs on one profile. A late deleted event for a dead hosting
 *      sub could revert a live hosting entitlement exactly the way
 *      the dangling tier sub reverted Gate #4's landed Pro.
 *
 *   2. handleTierInvoiceFailed — invoice.payment_failed updated BOTH
 *      the tier row and the hosting row by CUSTOMER for every failed
 *      invoice, regardless of which subscription the invoice belongs
 *      to (the webhook dispatcher applies no kind/subscription check
 *      either). A failed invoice for a different subscription on the
 *      same customer — a dangling sub's retry, the member's other
 *      plan — marked the live plan past_due. The fix scopes each
 *      row's past_due to the invoice's OWN subscription, using the
 *      same extraction and the same known-identity gate as
 *      handleTierInvoicePaid in the same file: scoping applies only
 *      when both the invoice's and the row's subscription ids are
 *      known and differ; unknowable identity keeps the legacy
 *      behavior (identity — not timing — is the guard).
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

import { handleHostingSubscriptionEvent, handleTierInvoiceFailed } from "../creator-tier-sync";
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

function hostingSub(over: Record<string, unknown> = {}): any {
  return {
    id: "sub_host_new",
    customer: "cus_1",
    status: "active",
    metadata: { kind: "creator_hosting", profile_id: profileId },
    items: { data: [{ price: { id: "price_hosting" }, current_period_end: 1_800_000_000 }] },
    cancel_at: null,
    ...over,
  };
}

function failedInvoice(over: Record<string, unknown> = {}): any {
  return {
    id: "in_1",
    customer: "cus_1",
    subscription: "sub_tier_current",
    amount_due: 1200,
    currency: "usd",
    ...over,
  };
}

async function tierRow(): Promise<any> {
  const r = await testState.db.execute(
    sql`SELECT tier, status, stripe_subscription_id FROM creator_subscriptions WHERE profile_id = ${profileId}`,
  );
  return r.rows[0] ?? null;
}

async function hostingRow(): Promise<any> {
  const r = await testState.db.execute(
    sql`SELECT status, stripe_subscription_id FROM creator_hosting WHERE profile_id = ${profileId}`,
  );
  return r.rows[0] ?? null;
}

async function receipts(): Promise<any[]> {
  const r = await testState.db.execute(
    sql`SELECT kind, tier, status, stripe_object_id FROM creator_subscription_receipts ORDER BY created_at, kind`,
  );
  return r.rows;
}

async function seedTierRow(values: { status: string; stripeSubscriptionId: string }) {
  await testState.db.execute(sql`
    INSERT INTO creator_subscriptions (profile_id, tier, status, stripe_subscription_id, stripe_customer_id)
    VALUES (${profileId}, 'pro', ${values.status}, ${values.stripeSubscriptionId}, 'cus_1')`);
}

async function seedHostingRow(values: { status: string; stripeSubscriptionId: string }) {
  await testState.db.execute(sql`
    INSERT INTO creator_hosting (profile_id, status, stripe_subscription_id, stripe_customer_id)
    VALUES (${profileId}, ${values.status}, ${values.stripeSubscriptionId}, 'cus_1')`);
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

describe("handleHostingSubscriptionEvent — current-subscription guard", () => {
  it("a late deleted event for a dead dangling hosting sub cannot revert the live hosting row", async () => {
    await seedHostingRow({ status: "active", stripeSubscriptionId: "sub_host_current" });

    await handleHostingSubscriptionEvent(hostingSub({ id: "sub_host_dangling", status: "canceled" }));

    expect(await hostingRow()).toMatchObject({ status: "active", stripe_subscription_id: "sub_host_current" });
  });

  it("a foreign live hosting subscription cannot clobber the current live hosting plan", async () => {
    await seedHostingRow({ status: "active", stripeSubscriptionId: "sub_host_current" });

    await handleHostingSubscriptionEvent(hostingSub({ id: "sub_host_other", status: "active" }));

    expect(await hostingRow()).toMatchObject({ status: "active", stripe_subscription_id: "sub_host_current" });
  });

  it("a dead foreign hosting event cannot move a dead row (the row keeps naming its own subscription)", async () => {
    await seedHostingRow({ status: "canceled", stripeSubscriptionId: "sub_host_old" });

    await handleHostingSubscriptionEvent(hostingSub({ id: "sub_host_dangling", status: "canceled" }));

    expect(await hostingRow()).toMatchObject({ status: "canceled", stripe_subscription_id: "sub_host_old" });
  });

  it("closed-tab rescue: a live foreign hosting subscription adopts a dead row", async () => {
    await seedHostingRow({ status: "canceled", stripeSubscriptionId: "sub_host_old" });

    await handleHostingSubscriptionEvent(hostingSub({ id: "sub_host_new", status: "active" }));

    expect(await hostingRow()).toMatchObject({ status: "active", stripe_subscription_id: "sub_host_new" });
  });

  it("the current hosting subscription's own deletion still lands", async () => {
    await seedHostingRow({ status: "active", stripeSubscriptionId: "sub_host_current" });

    await handleHostingSubscriptionEvent(hostingSub({ id: "sub_host_current", status: "canceled" }));

    expect(await hostingRow()).toMatchObject({ status: "canceled", stripe_subscription_id: "sub_host_current" });
  });
});

describe("handleTierInvoiceFailed — scoped to the invoice's own subscription", () => {
  it("a failed invoice for a foreign (dead dangling) subscription does not mark the live tier row past_due and writes no receipt", async () => {
    await seedTierRow({ status: "active", stripeSubscriptionId: "sub_tier_current" });

    await handleTierInvoiceFailed(failedInvoice({ id: "in_foreign", subscription: "sub_dangling_dead" }));

    expect(await tierRow()).toMatchObject({ tier: "pro", status: "active", stripe_subscription_id: "sub_tier_current" });
    expect(await receipts()).toHaveLength(0);
  });

  it("a failed invoice for the current tier subscription still marks past_due, with its payment_failed receipt", async () => {
    await seedTierRow({ status: "active", stripeSubscriptionId: "sub_tier_current" });

    await handleTierInvoiceFailed(failedInvoice({ id: "in_current" }));

    expect(await tierRow()).toMatchObject({ status: "past_due", stripe_subscription_id: "sub_tier_current" });
    const rs = await receipts();
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ kind: "payment_failed", status: "past_due", stripe_object_id: "in_current" });
  });

  it("a failed TIER invoice does not mark the hosting row past_due", async () => {
    await seedTierRow({ status: "active", stripeSubscriptionId: "sub_tier_current" });
    await seedHostingRow({ status: "active", stripeSubscriptionId: "sub_host_current" });

    await handleTierInvoiceFailed(failedInvoice({ id: "in_tier" }));

    expect(await tierRow()).toMatchObject({ status: "past_due" });
    expect(await hostingRow()).toMatchObject({ status: "active", stripe_subscription_id: "sub_host_current" });
  });

  it("a failed HOSTING invoice marks hosting past_due but leaves the tier row and its receipts alone", async () => {
    await seedTierRow({ status: "active", stripeSubscriptionId: "sub_tier_current" });
    await seedHostingRow({ status: "active", stripeSubscriptionId: "sub_host_current" });

    await handleTierInvoiceFailed(failedInvoice({ id: "in_hosting", subscription: "sub_host_current" }));

    expect(await hostingRow()).toMatchObject({ status: "past_due", stripe_subscription_id: "sub_host_current" });
    expect(await tierRow()).toMatchObject({ status: "active", stripe_subscription_id: "sub_tier_current" });
    expect(await receipts()).toHaveLength(0);
  });

  it("an invoice with no subscription identity keeps the legacy by-customer behavior", async () => {
    await seedTierRow({ status: "active", stripeSubscriptionId: "sub_tier_current" });
    const inv = failedInvoice({ id: "in_unknown" });
    delete inv.subscription;

    await handleTierInvoiceFailed(inv);

    expect(await tierRow()).toMatchObject({ status: "past_due" });
  });
});
