/**
 * stripe-webhook-sponsor-checkout.test.ts — the sponsor escrow
 * Checkout branch (twin of stripe-webhook-sponsor-pi.test.ts).
 *
 * Brands fund sponsorship deals through Checkout Sessions with
 * metadata.sponsor_deal_id; checkout.session.completed must flip
 * the deal Funding → Funded AND stamp the 15% split of the agreed
 * amount ($50.00 → $7.50 fee / $42.50 creator) so the deal page
 * prints real figures the moment the money lands (Gate #5, Nov 2:
 * the flip used to leave both columns NULL — only release wrote
 * them — so a funded deal read "—" / "—"). A redelivery must settle
 * nothing twice.
 *
 * Drives the REAL handler + REAL markEscrowFunded over pg-mem;
 * Stripe signature verification is stubbed the same way as
 * stripe-webhook-sponsor-pi.test.ts.
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
const SESSION_ID = "cs_test_escrow_1";
const PI_ID = "pi_escrow_1";

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

function sponsorCheckoutEvent(paymentStatus = "paid") {
  return {
    id: `evt_${randomUUID().slice(0, 8)}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: SESSION_ID,
        payment_status: paymentStatus,
        amount_total: 5000,
        payment_intent: PI_ID,
        metadata: {
          sponsor_deal_id: DEAL,
          sponsor_escrow: "true",
          brand_user_id: BRAND,
          amount_cents: "5000",
        },
      },
    },
  };
}

async function dealRow() {
  const { sql } = await import("drizzle-orm");
  const rows = await h.db.execute(sql`
    SELECT escrow_status, status, stripe_session_id, stripe_payment_intent_id, platform_fee_cents, creator_payout_cents
    FROM sponsor_deals WHERE id = ${DEAL}
  `);
  return (rows.rows as any[])[0];
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
       agreed_amount_cents, escrow_status, stripe_session_id, accepted_application_id, accepted_user_id,
       target_creator_user_id)
    VALUES
      (${DEAL}, ${"TEST Brand"}, ${500}, ${2000}, ${"Music"}, ${"1 post"},
       ${"Gate 5 test"}, ${new Date("2027-01-01").toISOString()}, ${BRAND}, ${"active"},
       ${5000}, ${"funding"}, ${SESSION_ID}, ${randomUUID()}, ${CREATOR}, ${CREATOR})
  `);
});

describe("checkout.session.completed — sponsor escrow", () => {
  it("flips Funding → Funded and stamps the 15% split ($50 → $7.50 / $42.50)", async () => {
    const res = await deliver(sponsorCheckoutEvent());
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, success: true, escrow: "funded" });

    const row = await dealRow();
    expect(row).toMatchObject({
      escrow_status: "funded",
      status: "funded",
      stripe_session_id: SESSION_ID,
      stripe_payment_intent_id: PI_ID,
      platform_fee_cents: 750,
      creator_payout_cents: 4250,
    });
  });

  it("a redelivery settles nothing twice — state and figures stay put", async () => {
    await deliver(sponsorCheckoutEvent());
    const second = await deliver(sponsorCheckoutEvent());
    expect(second.statusCode).toBe(200);
    expect(second.body).toMatchObject({ received: true, escrow: "funded" });

    const row = await dealRow();
    expect(row).toMatchObject({
      escrow_status: "funded",
      platform_fee_cents: 750,
      creator_payout_cents: 4250,
    });
    const { sql } = await import("drizzle-orm");
    const rows = await h.db.execute(sql`SELECT id FROM sponsor_deals WHERE id = ${DEAL}`);
    expect(rows.rows).toHaveLength(1);
  });

  it("an unpaid session completion settles nothing", async () => {
    const res = await deliver(sponsorCheckoutEvent("unpaid"));
    expect(res.statusCode).toBe(200);
    const row = await dealRow();
    expect(row.escrow_status).toBe("funding");
    expect(row.platform_fee_cents).toBeNull();
    expect(row.creator_payout_cents).toBeNull();
  });
});
