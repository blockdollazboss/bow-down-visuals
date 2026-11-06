/**
 * stripe-webhook-ugc-brief.test.ts — the UGC Briefs escrow Checkout
 * branches (C-25).
 *
 * Brands fund priced briefs through Checkout Sessions with
 * metadata.ugc_brief_id; checkout.session.completed must flip the
 * brief funding → funded AND stamp the nominal 5% split of the
 * agreed price ($100.01 → 500 fee / 9501 net — the briefs rail's fee
 * is 5%, not the sponsors' 15%). A redelivery settles nothing twice.
 * checkout.session.expired must free a brief stuck in 'funding' back
 * to 'unfunded' through the same guarded flip.
 *
 * Drives the REAL handler + REAL markUgcBriefFunded /
 * freeUgcBriefFundingForSession over pg-mem; Stripe signature
 * verification is stubbed the same way as
 * stripe-webhook-sponsor-checkout.test.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";

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
CREATE TABLE ugc_briefs (
  id uuid PRIMARY KEY,
  brand_user_id uuid NOT NULL,
  product_name text NOT NULL,
  product_image_ref text,
  product_url text,
  details text NOT NULL,
  style text NOT NULL,
  deadline timestamptz,
  status text NOT NULL DEFAULT 'open',
  claimed_by_user_id uuid,
  delivered_ad_id uuid,
  price_cents integer,
  escrow_status text NOT NULL DEFAULT 'unfunded',
  stripe_session_id text,
  stripe_payment_intent_id text,
  platform_fee_cents integer,
  creator_payout_cents integer,
  released_amount_cents integer,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`;

const BRAND = randomUUID();
const CREATOR = randomUUID();
const BRIEF = randomUUID();
const SESSION_ID = "cs_test_ugc_brief_1";
const PI_ID = "pi_ugc_brief_1";

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

function briefCheckoutEvent(paymentStatus = "paid") {
  return {
    id: `evt_${randomUUID().slice(0, 8)}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: SESSION_ID,
        payment_status: paymentStatus,
        amount_total: 10001,
        payment_intent: PI_ID,
        metadata: {
          ugc_brief_id: BRIEF,
          ugc_brief_escrow: "true",
          brand_user_id: BRAND,
          amount_cents: "10001",
        },
      },
    },
  };
}

function briefExpiredEvent() {
  return {
    id: `evt_${randomUUID().slice(0, 8)}`,
    type: "checkout.session.expired",
    data: {
      object: {
        id: SESSION_ID,
        payment_status: "unpaid",
        payment_intent: null,
        metadata: {
          ugc_brief_id: BRIEF,
          ugc_brief_escrow: "true",
          brand_user_id: BRAND,
          amount_cents: "10001",
        },
      },
    },
  };
}

async function briefRow() {
  const rows = await h.db.execute(sql`
    SELECT escrow_status, status, stripe_session_id, stripe_payment_intent_id, platform_fee_cents, creator_payout_cents
    FROM ugc_briefs WHERE id = ${BRIEF}
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
  await h.db.execute(sql`
    INSERT INTO ugc_briefs
      (id, brand_user_id, product_name, details, style, status, claimed_by_user_id,
       price_cents, escrow_status, stripe_session_id)
    VALUES
      (${BRIEF}, ${BRAND}, ${"Trail Boots"}, ${"Show the boots in the mud."}, ${"problem-fix"},
       ${"claimed"}, ${CREATOR}, ${10001}, ${"funding"}, ${SESSION_ID})
  `);
});

describe("checkout.session.completed — UGC brief escrow", () => {
  it("flips funding → funded and stamps the 5% split ($100.01 → 500 / 9501)", async () => {
    const res = await deliver(briefCheckoutEvent());
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, success: true, escrow: "funded" });

    const row = await briefRow();
    expect(row).toMatchObject({
      escrow_status: "funded",
      status: "claimed",
      stripe_session_id: SESSION_ID,
      stripe_payment_intent_id: PI_ID,
      platform_fee_cents: 500,
      creator_payout_cents: 9501,
    });
  });

  it("a redelivery settles nothing twice — state and figures stay put", async () => {
    await deliver(briefCheckoutEvent());
    const second = await deliver(briefCheckoutEvent());
    expect(second.statusCode).toBe(200);
    expect(second.body).toMatchObject({ received: true, escrow: "funded" });

    const row = await briefRow();
    expect(row).toMatchObject({
      escrow_status: "funded",
      platform_fee_cents: 500,
      creator_payout_cents: 9501,
    });
  });

  it("an unpaid session completion settles nothing", async () => {
    const res = await deliver(briefCheckoutEvent("unpaid"));
    expect(res.statusCode).toBe(200);
    const row = await briefRow();
    expect(row.escrow_status).toBe("funding");
    expect(row.platform_fee_cents).toBeNull();
    expect(row.creator_payout_cents).toBeNull();
  });

  it("a completed event for a superseded session settles nothing (stale-session guard)", async () => {
    /* The brand re-funded: the row now carries a NEWER session. The
       old session's late completion must not settle against it. */
    await h.db.execute(sql`
      UPDATE ugc_briefs SET stripe_session_id = 'cs_test_ugc_brief_2' WHERE id = ${BRIEF}
    `);
    const res = await deliver(briefCheckoutEvent());
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, warning: expect.stringContaining("stale-session") });
    const row = await briefRow();
    expect(row.escrow_status).toBe("funding");
    expect(row.stripe_session_id).toBe("cs_test_ugc_brief_2");
  });
});

describe("checkout.session.expired — UGC brief escrow", () => {
  it("frees a brief stuck in funding back to unfunded", async () => {
    const res = await deliver(briefExpiredEvent());
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, kind: "ugc_brief_escrow", expired: true, freed: true });
    const row = await briefRow();
    expect(row.escrow_status).toBe("unfunded");
    expect(row.stripe_session_id).toBeNull();
  });

  it("an expiry for a superseded session frees nothing", async () => {
    await h.db.execute(sql`
      UPDATE ugc_briefs SET stripe_session_id = 'cs_test_ugc_brief_2' WHERE id = ${BRIEF}
    `);
    const res = await deliver(briefExpiredEvent());
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ freed: false });
    const row = await briefRow();
    expect(row.escrow_status).toBe("funding");
    expect(row.stripe_session_id).toBe("cs_test_ugc_brief_2");
  });
});
