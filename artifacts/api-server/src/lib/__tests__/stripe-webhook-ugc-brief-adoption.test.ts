/**
 * stripe-webhook-ugc-brief-adoption.test.ts — Stack 400 lane
 * s400-ugc-escrow (C-34).
 *
 * The C-34 wreckage: a fund call creates a real Stripe Checkout
 * session, then the save of its id fails (or lands on a row whose
 * funding claim already moved on). The brand can still pay the live
 * session, but the brief's row names no session — settlement used
 * to have no honest way to reconcile it.
 *
 * Two halves, both pinned here against the REAL webhook handler +
 * REAL markUgcBriefFunded over pg-mem:
 *  - the fund route now persists the session id through a guarded
 *    update tied to the open funding claim (route side; the
 *    persistence guard itself is exercised by the escrow suites'
 *    fund flows staying green);
 *  - a completed session whose metadata names a brief whose row
 *    carries NO session id is ADOPTED — but only while the funding
 *    claim is still open ('funding'). Against a freed claim the
 *    session is an orphan: refused, logged at error level, and the
 *    row stays exactly as it was.
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
import { logger } from "../logger";

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
);
CREATE TABLE performance_bookings (
  id uuid PRIMARY KEY,
  artist_user_id text NOT NULL DEFAULT '',
  fee_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'proposed',
  escrow_status text NOT NULL DEFAULT 'unfunded',
  stripe_session_id text,
  platform_fee_cents integer,
  artist_payout_cents integer,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`;

const BRAND = randomUUID();
const CREATOR = randomUUID();
const BRIEF = randomUUID();
const ORPHAN_SESSION = "cs_test_ugc_orphan_1";
const OTHER_SESSION = "cs_test_ugc_orphan_2";
const PI_ID = "pi_ugc_orphan_1";

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

function completedEvent(sessionId: string) {
  return {
    id: `evt_${randomUUID().slice(0, 8)}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
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

async function seedBrief(opts: {
  status: string;
  escrowStatus: string;
  sessionId: string | null;
}) {
  await h.db.execute(sql`
    INSERT INTO ugc_briefs
      (id, brand_user_id, product_name, details, style, status, claimed_by_user_id,
       price_cents, escrow_status, stripe_session_id)
    VALUES
      (${BRIEF}, ${BRAND}, ${"Trail Boots"}, ${"Show the boots in the mud."}, ${"problem-fix"},
       ${opts.status}, ${CREATOR}, ${10001}, ${opts.escrowStatus}, ${opts.sessionId})
  `);
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
});

describe("C-34 — orphaned-session adoption on checkout.session.completed", () => {
  it("adopts the completed session when the row names none and the funding claim is open — settles and stamps the 5% split", async () => {
    await seedBrief({ status: "claimed", escrowStatus: "funding", sessionId: null });
    const res = await deliver(completedEvent(ORPHAN_SESSION));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, success: true, escrow: "funded" });

    const row = await briefRow();
    expect(row).toMatchObject({
      escrow_status: "funded",
      status: "claimed",
      stripe_session_id: ORPHAN_SESSION,
      stripe_payment_intent_id: PI_ID,
      platform_fee_cents: 500,
      creator_payout_cents: 9501,
    });

    /* A redelivery of the adopted session is the usual exactly-once
       no-op, and a DIFFERENT session's late completion is refused
       as stale — adoption never reopens the door. */
    const again = await deliver(completedEvent(ORPHAN_SESSION));
    expect(again.statusCode).toBe(200);
    expect(again.body).toMatchObject({ received: true, escrow: "funded" });

    const other = await deliver(completedEvent(OTHER_SESSION));
    expect(other.statusCode).toBe(200);
    expect(other.body).toMatchObject({
      received: true,
      warning: expect.stringContaining("stale-session"),
    });
    const after = await briefRow();
    expect(after.stripe_session_id).toBe(ORPHAN_SESSION);
    expect(after.escrow_status).toBe("funded");
  });

  it("refuses an orphan against a FREED claim — no settlement, the row is untouched, and the orphan is logged at error level", async () => {
    await seedBrief({ status: "claimed", escrowStatus: "unfunded", sessionId: null });
    const res = await deliver(completedEvent(ORPHAN_SESSION));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      received: true,
      warning: expect.stringContaining("orphaned-session"),
    });

    const row = await briefRow();
    expect(row).toMatchObject({
      escrow_status: "unfunded",
      status: "claimed",
      stripe_session_id: null,
      stripe_payment_intent_id: null,
      platform_fee_cents: null,
      creator_payout_cents: null,
    });

    const errorCalls = (logger.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(
      errorCalls.some((c) => JSON.stringify(c).includes("orphaned session")),
    ).toBe(true);
  });

  it("never adopts against a closed brief — the late payment stays unsettled", async () => {
    await seedBrief({ status: "closed", escrowStatus: "unfunded", sessionId: null });
    const res = await deliver(completedEvent(ORPHAN_SESSION));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      received: true,
      warning: expect.stringContaining("bad-state:closed"),
    });
    const row = await briefRow();
    expect(row.escrow_status).toBe("unfunded");
    expect(row.stripe_session_id).toBeNull();
  });
});
