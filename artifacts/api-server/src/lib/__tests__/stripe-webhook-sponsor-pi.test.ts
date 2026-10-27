/**
 * stripe-webhook-sponsor-pi.test.ts — the sponsor escrow twin branch.
 *
 * The profile Sponsor flow funds escrow with an on-site PaymentIntent
 * (metadata.sponsor_deal_id). The client normally settles via
 * POST /api/sponsors/escrow/verify; if the tab closed first, the
 * payment_intent.succeeded webhook delivery must settle the same
 * escrow — and a redelivery must settle nothing twice.
 *
 * Drives the REAL handler + REAL markEscrowFunded over pg-mem;
 * Stripe signature verification is stubbed the same way as
 * stripe-webhook-abandoned.test.ts (constructEvent returns the
 * fixture). The deal row carries stripe_session_id = the PaymentIntent
 * id after settlement — the same key the verify path writes, which is
 * what payment-reversals keys sponsor deals on.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const h = vi.hoisted(() => ({
  db: null as any,
  event: null as unknown,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return h.db;
    },
  };
});

vi.mock("stripe", () => ({
  default: class FakeStripe {
    webhooks = {
      constructEvent: () => h.event,
    };
    charges = { retrieve: vi.fn() };
  },
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
  addCreditsAtomic: vi.fn(),
}));

vi.mock("../../routes/referrals", () => ({
  awardReferralPayout: vi.fn(async () => ({ awarded: false })),
}));

import { stripeWebhookHandler } from "../stripe-webhook";
import { createTestDb } from "./test-db";

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
  paid_at timestamptz,
  target_creator_user_id text
);`;

const BRAND = randomUUID();
const CREATOR = randomUUID();
const DEAL = randomUUID();
const PI_ID = "pi_sponsor_test_1";

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

async function deliver(event: unknown) {
  h.event = event;
  const res = makeRes();
  await stripeWebhookHandler(
    { headers: { "stripe-signature": "sig_test" }, body: Buffer.from("{}") } as never,
    res as never,
  );
  return res;
}

function sponsorPiEvent() {
  return {
    id: `evt_${randomUUID().slice(0, 8)}`,
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: PI_ID,
        status: "succeeded",
        amount: 100000,
        currency: "usd",
        metadata: {
          sponsor_deal_id: DEAL,
          sponsor_escrow: "true",
          source: "sponsor_escrow",
          brand_user_id: BRAND,
          amount_cents: "100000",
        },
      },
    },
  };
}

beforeAll(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fake";
});

afterAll(() => {
  delete process.env["STRIPE_WEBHOOK_SECRET"];
});

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.none(DDL);
  h.db = db;
  vi.clearAllMocks();
  const { sql } = await import("drizzle-orm");
  await h.db.execute(sql`
    INSERT INTO sponsor_deals
      (id, brand_name, budget_min, budget_max, niche, deliverables, description, deadline, posted_by, status,
       agreed_amount_cents, escrow_status, stripe_payment_intent_id, accepted_application_id, accepted_user_id,
       target_creator_user_id)
    VALUES
      (${DEAL}, ${"Volt Energy"}, ${1000}, ${1000}, ${"Direct sponsorship"}, ${"Logo on stream"},
       ${"Direct sponsorship"}, ${new Date("2027-01-01").toISOString()}, ${BRAND}, ${"active"},
       ${100000}, ${"funding"}, ${PI_ID}, ${randomUUID()}, ${CREATOR}, ${CREATOR})
  `);
});

describe("payment_intent.succeeded — sponsor escrow", () => {
  it("settles the funded escrow exactly once across redeliveries", async () => {
    const first = await deliver(sponsorPiEvent());
    expect(first.statusCode).toBe(200);
    expect(first.body).toMatchObject({ received: true, success: true, escrow: "funded" });

    const { sql } = await import("drizzle-orm");
    const rows = await h.db.execute(sql`SELECT escrow_status, status, stripe_session_id FROM sponsor_deals WHERE id = ${DEAL}`);
    expect(rows.rows[0]).toMatchObject({ escrow_status: "funded", status: "funded", stripe_session_id: PI_ID });

    /* Stripe retries the same event — the escrow must not move again. */
    const second = await deliver(sponsorPiEvent());
    expect(second.statusCode).toBe(200);
    expect(second.body).toMatchObject({ received: true, escrow: "funded" });
    const rows2 = await h.db.execute(sql`SELECT escrow_status FROM sponsor_deals WHERE id = ${DEAL}`);
    expect(rows2.rows).toHaveLength(1);
    expect((rows2.rows[0] as any).escrow_status).toBe("funded");
  });

  it("ignores payment_intent.succeeded events that are not sponsor escrow or express pay", async () => {
    const res = await deliver({
      id: "evt_other",
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_other", status: "succeeded", amount: 500, currency: "usd", metadata: {} } },
    });
    expect(res.statusCode).toBe(200);
    const { sql } = await import("drizzle-orm");
    const rows = await h.db.execute(sql`SELECT escrow_status FROM sponsor_deals WHERE id = ${DEAL}`);
    expect((rows.rows[0] as any).escrow_status).toBe("funding");
  });
});
