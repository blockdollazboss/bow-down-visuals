/**
 * Claim pin (money-hardening round 2, area 4) — a credit-pack grant
 * must move the amount the payment RECORD carries, never whatever a
 * later delivery happens to claim.
 *
 * The hole this pins: claimStripePayment's reclaim (a 'failed' or
 * stale 'processing' row) keeps the FIRST delivery's recorded
 * user_id / credits_amount, but fulfillCreditPurchase used to grant
 * the RECLAIMING caller's numbers. A replay of the same session id
 * carrying a different credits_amount — the webhook trusts its event
 * body; the verify doors re-read Stripe live, so any disagreement
 * between copies lands exactly here — granted the new amount while
 * the row (and the reversal engine's clawback, which reads the row)
 * kept the old one: granted ≠ recorded ≠ clawed.
 *
 * The pin: after winning the claim, the grant is checked against the
 * record. A mismatch marks the claim failed and throws (the webhook
 * 500s, Stripe retries; the matching delivery is the one that can
 * ever grant). These tests run the REAL claim + fulfill code over
 * pg-mem with the production stripe_payments shape.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const USER_ID = "1596b9a1-bbd0-4bda-8bf2-a22443e6ace8";
const OTHER_USER_ID = "2696b9a1-bbd0-4bda-8bf2-a22443e6ace9";
const KEY = "cs_test_claim_pin";

const h = vi.hoisted(() => ({
  db: null as any,
  balance: 0,
  grantCalls: 0,
  failNextGrant: false,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
  addCreditsAtomic: vi.fn(async (_userId: string, amount: number) => {
    h.grantCalls++;
    if (h.failNextGrant) {
      h.failNextGrant = false;
      throw new Error("simulated grant failure (transient)");
    }
    h.balance += amount;
    return { newCredits: h.balance };
  }),
}));

import { fulfillCreditPurchase, __setPackEventNotifier } from "../payment-record";
import { createTestDb } from "./test-db";

const DDL = `
  CREATE TABLE stripe_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stripe_session_id text UNIQUE NOT NULL,
    stripe_payment_intent_id text,
    user_id uuid NOT NULL,
    credit_pack text,
    credits_amount integer NOT NULL,
    amount_total integer,
    currency text,
    status text DEFAULT 'completed',
    created_at timestamptz NOT NULL DEFAULT now()
  );
`;

beforeAll(async () => {
  /* createTestDb carries the house pg-mem shim (drizzle rowMode /
     types translation) the query-builder paths in payment-record
     need; its own tables are harmless extras here. */
  const { db, mem } = createTestDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: "uuid" as never,
    implementation: () => randomUUID(),
    impure: true,
  });
  h.db = db;
  await h.db.execute(DDL);
  __setPackEventNotifier(async () => undefined);
});

beforeEach(async () => {
  await h.db.execute(`DELETE FROM stripe_payments`);
  h.balance = 0;
  h.grantCalls = 0;
  h.failNextGrant = false;
});

async function paymentRow() {
  const r = await h.db.execute(
    `SELECT user_id, credits_amount, status FROM stripe_payments WHERE stripe_session_id = '${KEY}'`,
  );
  return r.rows[0] as Record<string, unknown> | undefined;
}

function purchase(overrides: Partial<{ userId: string; creditsAmount: number }> = {}) {
  return {
    idempotencyKey: KEY,
    stripePaymentIntentId: "pi_claim_pin",
    userId: overrides.userId ?? USER_ID,
    creditPack: "1,000 Visual Bucs",
    creditsAmount: overrides.creditsAmount ?? 1000,
    amountTotal: 900,
    currency: "usd",
  };
}

describe("fulfillCreditPurchase — the claim pin", () => {
  it("a failed first grant, retried with a DIFFERENT amount, grants nothing and throws", async () => {
    /* First delivery: the true purchase (1,000 VB) — the grant itself
       fails transiently, so the claim row lands 'failed' with the
       recorded 1,000. */
    h.failNextGrant = true;
    await expect(fulfillCreditPurchase(purchase())).rejects.toThrow();
    expect(h.balance).toBe(0);
    const failed = await paymentRow();
    expect(failed?.["status"]).toBe("failed");
    expect(failed?.["credits_amount"]).toBe(1000);

    /* The replay carries a different amount for the same session id.
       Pre-fix this reclaimed the row and granted 50,000 against a
       record (and a future clawback) of 1,000. */
    await expect(
      fulfillCreditPurchase(purchase({ creditsAmount: 50000 })),
    ).rejects.toThrow(/claim mismatch/);
    expect(h.balance).toBe(0);
    expect(h.grantCalls).toBe(1); // only the first, failed attempt ever reached the grant

    const row = await paymentRow();
    expect(row?.["credits_amount"]).toBe(1000); // the record never moved
    expect(row?.["status"]).toBe("failed"); // still retryable — by a MATCHING delivery
  });

  it("a failed first grant, retried with a different MEMBER, grants nothing and throws", async () => {
    h.failNextGrant = true;
    await expect(fulfillCreditPurchase(purchase())).rejects.toThrow();

    await expect(
      fulfillCreditPurchase(purchase({ userId: OTHER_USER_ID })),
    ).rejects.toThrow(/claim mismatch/);
    expect(h.balance).toBe(0);
    expect(h.grantCalls).toBe(1);
  });

  it("control: a failed first grant retried with the SAME facts grants exactly the recorded amount, once", async () => {
    h.failNextGrant = true;
    await expect(fulfillCreditPurchase(purchase())).rejects.toThrow();

    const retry = await fulfillCreditPurchase(purchase());
    expect(retry.outcome).toBe("granted");
    expect(h.balance).toBe(1000);
    expect((await paymentRow())?.["status"]).toBe("completed");

    /* And a later replay — even carrying different numbers — is a
       plain duplicate: a completed claim never reopens. */
    const replay = await fulfillCreditPurchase(purchase({ creditsAmount: 50000 }));
    expect(replay.outcome).toBe("duplicate");
    expect(h.balance).toBe(1000);
    expect(h.grantCalls).toBe(2); // the failed attempt + the one true grant
  });

  it("control: the happy path is unchanged — first delivery grants and completes", async () => {
    const res = await fulfillCreditPurchase(purchase());
    expect(res.outcome).toBe("granted");
    expect(h.balance).toBe(1000);
    const row = await paymentRow();
    expect(row?.["status"]).toBe("completed");
    expect(row?.["credits_amount"]).toBe(1000);
  });
});
