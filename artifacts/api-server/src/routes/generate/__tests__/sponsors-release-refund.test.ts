/**
 * Sponsor escrow release — refund netting (money-hardening round 2,
 * area 1). The release used to split the AGREED amount whenever the
 * deal read completed/funded. But a partial refund against the
 * funding charge leaves the escrow 'funded' BY DESIGN (the reversal
 * engine keeps entitlements on partial refunds; only a full reversal
 * un-funds), so the release promised the creator money the platform
 * had already returned to the brand: released + refunded > charged.
 *
 * The release now splits only what is still HELD — Stripe's live
 * charge state unioned with the reversal ledger (a lost dispute
 * lives only in the ledger) — and its state flip is a conditional
 * claim whose row count is checked, so a reversal landing mid-release
 * can no longer be overwritten back to 'released' with a payable
 * payout row. Real router + real release code over pg-mem; Stripe is
 * faked at the lib/stripe-client seam with a controllable charge.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  charge: null as any,
  chargesThrow: false,
  onChargesList: null as null | (() => Promise<void>),
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = testState.userId;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return testState.db;
    },
  };
});

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(),
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../lib/stripe-client", () => ({
  buildCheckoutSessionIdempotencyKey: vi.fn(() => "k"),
  createGuardedStripeClient: vi.fn(() => ({
    charges: {
      list: async () => {
        if (testState.onChargesList) await testState.onChargesList();
        if (testState.chargesThrow) throw new Error("Stripe is unreachable");
        return { data: testState.charge ? [testState.charge] : [] };
      },
    },
    checkout: {
      sessions: {
        create: async () => {
          throw new Error("session create is not part of this suite");
        },
      },
    },
  })),
}));

import router from "../sponsors";
import { createTestDb } from "../../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE sponsor_deals (
  id uuid PRIMARY KEY,
  brand_name text NOT NULL,
  budget_min integer NOT NULL,
  budget_max integer NOT NULL,
  niche text NOT NULL,
  deliverables text NOT NULL,
  description text NOT NULL,
  deadline timestamptz NOT NULL,
  posted_by text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  agreed_amount_cents integer,
  escrow_status text NOT NULL DEFAULT 'unfunded',
  stripe_session_id text,
  stripe_payment_intent_id text,
  platform_fee_cents integer,
  creator_payout_cents integer,
  accepted_application_id uuid,
  accepted_user_id text,
  paid_at timestamptz
);
CREATE TABLE sponsor_applications (
  id uuid PRIMARY KEY,
  deal_id uuid NOT NULL REFERENCES sponsor_deals(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  pitch text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  portfolio_url text,
  decided_at timestamptz,
  UNIQUE (deal_id, user_id)
);
CREATE TABLE sponsor_payouts (
  id uuid PRIMARY KEY,
  deal_id uuid NOT NULL REFERENCES sponsor_deals(id) ON DELETE CASCADE,
  creator_user_id text NOT NULL,
  gross_cents integer NOT NULL,
  fee_cents integer NOT NULL,
  net_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'released',
  stripe_transfer_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id)
);
CREATE TABLE payment_reversals (
  id uuid PRIMARY KEY,
  stripe_event_id text,
  stripe_charge_id text,
  stripe_payment_intent_id text,
  refunded_cents_seen integer NOT NULL DEFAULT 0,
  charge_amount_cents integer NOT NULL DEFAULT 0,
  dispute_lost boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'completed'
);`;

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

const BRAND = randomUUID();
const CREATOR = randomUUID();
const DEAL_PI = "pi_deal_release";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.none(DDL);
  testState.db = db;
  testState.userId = BRAND;
  testState.charge = { id: "ch_deal_1", amount: 10000, amount_captured: 10000, amount_refunded: 0 };
  testState.chargesThrow = false;
  testState.onChargesList = null;
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake_for_release_netting";
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

/** A completed deal with a funded $100 escrow, ready to release. */
async function seedReleasableDeal(): Promise<string> {
  const id = randomUUID();
  const appId = randomUUID();
  await testState.db.execute(sql`
    INSERT INTO sponsor_deals
      (id, brand_name, budget_min, budget_max, niche, deliverables, description, deadline,
       posted_by, status, agreed_amount_cents, escrow_status, stripe_session_id,
       stripe_payment_intent_id, accepted_application_id, accepted_user_id)
    VALUES (${id}, 'Volt Energy', 500, 2000, 'Music', '1 TikTok', 'Energy drink brand',
            '2027-01-01T00:00:00.000Z', ${BRAND}, 'completed', 10000, 'funded',
            'cs_deal_1', ${DEAL_PI}, ${appId}, ${CREATOR})
  `);
  return id;
}

async function dealRow(id: string) {
  const r = await testState.db.execute(sql`SELECT status, escrow_status, creator_payout_cents FROM sponsor_deals WHERE id = ${id}`);
  return r.rows[0] as Record<string, unknown>;
}
async function payoutRows(id: string) {
  const r = await testState.db.execute(sql`SELECT gross_cents, fee_cents, net_cents FROM sponsor_payouts WHERE deal_id = ${id}`);
  return r.rows as Array<Record<string, unknown>>;
}

describe("POST /sponsors/deals/:id/release — refund netting", () => {
  it("a partial refund at Stripe nets out: the release splits only what is still held", async () => {
    const id = await seedReleasableDeal();
    testState.charge = { id: "ch_deal_1", amount: 10000, amount_captured: 10000, amount_refunded: 4000 };

    const res = await req("POST", `/sponsors/deals/${id}/release`, {});
    expect(res.status).toBe(200);
    /* Held is $60: fee 15% = $9, creator $51 — and released ($60) +
       refunded ($40) = charged ($100) exactly. Pre-fix this released
       the full $100 split ($15/$85) against $60 held. */
    expect(res.json.grossCents).toBe(6000);
    expect(res.json.platformFeeCents).toBe(900);
    expect(res.json.creatorPayoutCents).toBe(5100);
    expect(res.json.refundedCents).toBe(4000);

    const payouts = await payoutRows(id);
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({ gross_cents: 6000, fee_cents: 900, net_cents: 5100 });
    expect(await dealRow(id)).toMatchObject({ status: "paid", escrow_status: "released", creator_payout_cents: 5100 });
  });

  it("a partial refund known only to the reversal ledger nets out too", async () => {
    const id = await seedReleasableDeal();
    testState.charge = null; // Stripe has no charge to show (union leg must carry it)
    await testState.db.execute(sql`
      INSERT INTO payment_reversals (id, stripe_payment_intent_id, refunded_cents_seen, charge_amount_cents, dispute_lost)
      VALUES (${randomUUID()}, ${DEAL_PI}, 2500, 10000, false)
    `);

    const res = await req("POST", `/sponsors/deals/${id}/release`, {});
    expect(res.status).toBe(200);
    expect(res.json.grossCents).toBe(7500);
    expect(res.json.platformFeeCents).toBe(1125);
    expect(res.json.creatorPayoutCents).toBe(6375);
  });

  it("a lost dispute means nothing is held: release refuses, no payout row, deal untouched", async () => {
    const id = await seedReleasableDeal();
    /* Stripe's charge object does NOT show dispute debits in
       amount_refunded — the ledger is the only witness. */
    await testState.db.execute(sql`
      INSERT INTO payment_reversals (id, stripe_payment_intent_id, refunded_cents_seen, charge_amount_cents, dispute_lost)
      VALUES (${randomUUID()}, ${DEAL_PI}, 0, 10000, true)
    `);

    const res = await req("POST", `/sponsors/deals/${id}/release`, {});
    expect(res.status).toBe(409);
    expect(await payoutRows(id)).toHaveLength(0);
    expect(await dealRow(id)).toMatchObject({ status: "completed", escrow_status: "funded" });
  });

  it("a full refund at Stripe refuses the release the same way", async () => {
    const id = await seedReleasableDeal();
    testState.charge = { id: "ch_deal_1", amount: 10000, amount_captured: 10000, amount_refunded: 10000 };

    const res = await req("POST", `/sponsors/deals/${id}/release`, {});
    expect(res.status).toBe(409);
    expect(await payoutRows(id)).toHaveLength(0);
  });

  it("when Stripe can't be read, the release fails closed — no money moves on a guess", async () => {
    const id = await seedReleasableDeal();
    testState.chargesThrow = true;

    const res = await req("POST", `/sponsors/deals/${id}/release`, {});
    expect(res.status).toBe(503);
    expect(await payoutRows(id)).toHaveLength(0);
    expect(await dealRow(id)).toMatchObject({ status: "completed", escrow_status: "funded" });
  });

  it("a reversal un-funding the escrow mid-release wins: the flip claims nothing and the payout row is voided", async () => {
    const id = await seedReleasableDeal();
    /* The race, driven deterministically: the held-check's Stripe
       read happens after the deal read and before the state flip —
       exactly where a full-refund reversal's un-fund can land. */
    testState.onChargesList = async () => {
      await testState.db.execute(sql`UPDATE sponsor_deals SET escrow_status = 'unfunded' WHERE id = ${id}`);
    };

    const res = await req("POST", `/sponsors/deals/${id}/release`, {});
    expect(res.status).toBe(409);
    expect(await payoutRows(id)).toHaveLength(0);
    /* The reversal's state stands — the old unconditional UPDATE
       resurrected this deal to paid/released with a payable row. */
    expect(await dealRow(id)).toMatchObject({ status: "completed", escrow_status: "unfunded" });
  });

  it("control: no refund anywhere — the release splits the full agreed amount, as before", async () => {
    const id = await seedReleasableDeal();
    const res = await req("POST", `/sponsors/deals/${id}/release`, {});
    expect(res.status).toBe(200);
    expect(res.json.grossCents).toBe(10000);
    expect(res.json.platformFeeCents).toBe(1500);
    expect(res.json.creatorPayoutCents).toBe(8500);
    expect(res.json.refundedCents).toBeUndefined();
  });

  it("control: sandbox mode (no Stripe key, no payment intent) releases the full amount untouched", async () => {
    delete process.env["STRIPE_SECRET_KEY"];
    const id = randomUUID();
    const appId = randomUUID();
    await testState.db.execute(sql`
      INSERT INTO sponsor_deals
        (id, brand_name, budget_min, budget_max, niche, deliverables, description, deadline,
         posted_by, status, agreed_amount_cents, escrow_status, stripe_session_id,
         stripe_payment_intent_id, accepted_application_id, accepted_user_id)
      VALUES (${id}, 'Volt Energy', 500, 2000, 'Music', '1 TikTok', 'Energy drink brand',
              '2027-01-01T00:00:00.000Z', ${BRAND}, 'completed', 10000, 'funded',
              'sandbox_session', NULL, ${appId}, ${CREATOR})
    `);
    const res = await req("POST", `/sponsors/deals/${id}/release`, {});
    expect(res.status).toBe(200);
    expect(res.json.grossCents).toBe(10000);
    expect(res.json.creatorPayoutCents).toBe(8500);
  });
});
