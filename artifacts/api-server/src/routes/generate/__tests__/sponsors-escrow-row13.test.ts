/**
 * sponsors-escrow-row13.test.ts — payments-matrix ROW 13, the halves the
 * sandbox suite (sponsors-escrow.test.ts) cannot reach:
 *
 * The existing escrow suite runs with Stripe UNconfigured, so every fund
 * goes through the sandbox stand-in. Row 13's real-money half is pinned
 * here with Stripe configured and faked at the module boundary:
 *
 *  - item 10: the fund endpoint creates a real Checkout Session with the
 *    exact shape the webhook + verify paths rely on (metadata keys,
 *    unit amount, deterministic idempotency key), records the deal in
 *    'funding' with the session id, and writes NO payout ledger row —
 *    held money is not payable money.
 *  - item 11: a second fund on an active deal (escrow 'funding' or
 *    'funded') is refused 409 and never mints a second session — the
 *    single-active-deal invariant.
 *  - item 12 (route half): release at an odd-cent gross splits 15% /
 *    remainder TO THE CENT and writes exactly one sponsor_payouts row;
 *    a second release is refused and the row count never moves. (The
 *    pure split math itself is pinned in sponsors-escrow.test.ts and
 *    sponsors-direct.test.ts.)
 *  - item 13: markEscrowFunded idempotency at the function boundary —
 *    replayed same-session callbacks are a no-op success, a foreign
 *    session against a funded deal is refused without touching the row,
 *    a callback that outruns the fund response (deal still 'unfunded')
 *    still lands, and a released deal can never be re-funded.
 *    (The webhook delivery half of item 13 is pinned in
 *    lib/__tests__/stripe-webhook-sponsor-pi.test.ts.)
 *
 * Item 14 (escrowed funds never enter the Connect payout sweep before
 * release) is pinned in lib/__tests__/sponsor-escrow-payout-exclusion.test.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  createCalls: [] as { params: any; options: any }[],
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
  CreditsDisabledError: class CreditsDisabledError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

/* The guarded client does `new Stripe(key)` — fake the module so the
   fund path's session creation is captured, never sent. */
vi.mock("stripe", () => ({
  default: class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: any, options: any) => {
          testState.createCalls.push({ params, options });
          return {
            id: `cs_test_row13_${testState.createCalls.length}`,
            url: "https://checkout.stripe.test/pay/cs_test_row13",
          };
        },
      },
    };
    paymentIntents = { create: vi.fn(), retrieve: vi.fn() };
    webhooks = { constructEvent: vi.fn() };
  },
}));

import router, {
  markEscrowFunded,
  buildSponsorEscrowCheckoutKey,
} from "../sponsors";
import { createTestDb } from "../../../lib/__tests__/test-db";

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
);`;

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

const BRAND = randomUUID();
const CREATOR = randomUUID();

beforeAll(async () => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_row13_fake"; /* configured → real-money path */
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  delete process.env["STRIPE_SECRET_KEY"];
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.none(DDL);
  testState.db = db;
  testState.userId = BRAND;
  testState.createCalls = [];
  vi.clearAllMocks();
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

/* A deal with an accepted application at an agreed amount — the state
   the fund endpoint requires. */
async function seedAcceptedDeal(agreedCents = 100000) {
  const dealId = randomUUID();
  const appId = randomUUID();
  const { sql } = await import("drizzle-orm");
  await testState.db.execute(sql`
    INSERT INTO sponsor_deals
      (id, brand_name, budget_min, budget_max, niche, deliverables, description, deadline, posted_by, status,
       agreed_amount_cents, escrow_status, accepted_application_id, accepted_user_id)
    VALUES
      (${dealId}, ${"Volt Energy"}, ${50000}, ${200000}, ${"Music"}, ${"1 TikTok"}, ${"Energy drink brand"},
       ${new Date("2027-01-01").toISOString()}, ${BRAND}, ${"active"},
       ${agreedCents}, ${"unfunded"}, ${appId}, ${CREATOR})
  `);
  await testState.db.execute(sql`
    INSERT INTO sponsor_applications (id, deal_id, user_id, pitch, status)
    VALUES (${appId}, ${dealId}, ${CREATOR}, ${"Pick me!"}, ${"accepted"})
  `);
  return { dealId, appId };
}

async function dealRow(dealId: string) {
  const { sql } = await import("drizzle-orm");
  const r = await testState.db.execute(sql`
    SELECT status, escrow_status, stripe_session_id, stripe_payment_intent_id,
           agreed_amount_cents, platform_fee_cents, creator_payout_cents
    FROM sponsor_deals WHERE id = ${dealId}
  `);
  return (r.rows as any[])[0];
}

async function payoutRows(dealId: string) {
  const { sql } = await import("drizzle-orm");
  const r = await testState.db.execute(sql`
    SELECT gross_cents, fee_cents, net_cents, status FROM sponsor_payouts WHERE deal_id = ${dealId}
  `);
  return r.rows as any[];
}

describe("row 13 — Stripe-configured escrow funding (item 10)", () => {
  it("creates the checkout session with the pinned shape and records 'funding'", async () => {
    const { dealId, appId } = await seedAcceptedDeal(100000);

    const fund = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 100000 });
    expect(fund.status).toBe(200);
    expect(fund.json.sandbox).toBe(false);
    expect(fund.json.sessionId).toBe("cs_test_row13_1");
    expect(fund.json.checkoutUrl).toContain("checkout.stripe.test");

    /* Exactly one session, with the shape the webhook + verify rely on. */
    expect(testState.createCalls).toHaveLength(1);
    const { params, options } = testState.createCalls[0]!;
    expect(params.mode).toBe("payment");
    expect(params.payment_method_types).toEqual(["card"]);
    expect(params.line_items).toHaveLength(1);
    expect(params.line_items[0].price_data.currency).toBe("usd");
    expect(params.line_items[0].price_data.unit_amount).toBe(100000);
    expect(params.line_items[0].quantity).toBe(1);
    expect(params.metadata).toEqual({
      sponsor_deal_id: dealId,
      sponsor_escrow: "true",
      brand_user_id: BRAND,
      amount_cents: "100000",
    });
    /* The idempotency key is the deterministic one for this funding act. */
    expect(options.idempotencyKey).toBe(
      buildSponsorEscrowCheckoutKey({
        brandUserId: BRAND,
        dealId,
        acceptedApplicationId: appId,
        amountCents: 100000,
      }),
    );

    /* The deal records the funding attempt — and NO payout ledger row
       exists yet: held money is not payable money. */
    const row = await dealRow(dealId);
    expect(row.escrow_status).toBe("funding");
    expect(row.stripe_session_id).toBe("cs_test_row13_1");
    expect(row.agreed_amount_cents).toBe(100000);
    expect(await payoutRows(dealId)).toHaveLength(0);
  });

  it("the escrow idempotency key is deterministic and amount-sensitive", () => {
    const base = {
      brandUserId: BRAND,
      dealId: randomUUID(),
      acceptedApplicationId: randomUUID(),
      amountCents: 100000,
    };
    expect(buildSponsorEscrowCheckoutKey(base)).toBe(buildSponsorEscrowCheckoutKey({ ...base }));
    expect(buildSponsorEscrowCheckoutKey({ ...base, amountCents: 99999 })).not.toBe(
      buildSponsorEscrowCheckoutKey(base),
    );
    expect(buildSponsorEscrowCheckoutKey({ ...base, brandUserId: CREATOR })).not.toBe(
      buildSponsorEscrowCheckoutKey(base),
    );
  });
});

describe("row 13 — re-fund refusal (item 11)", () => {
  it("refuses a second fund while 'funding' and after 'funded' — one session ever", async () => {
    const { dealId } = await seedAcceptedDeal(100000);

    const first = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 100000 });
    expect(first.status).toBe(200);

    const second = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 100000 });
    expect(second.status).toBe(409);
    expect(second.json.error).toMatch(/already funding/i);
    expect(testState.createCalls).toHaveLength(1);

    /* Settle it, then try again — still refused, still one session. */
    const settled = await markEscrowFunded(dealId, first.json.sessionId, "pi_row13_1");
    expect(settled.ok).toBe(true);
    const third = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 100000 });
    expect(third.status).toBe(409);
    expect(third.json.error).toMatch(/already funded/i);
    expect(testState.createCalls).toHaveLength(1);
  });
});

describe("row 13 — markEscrowFunded idempotency (item 13)", () => {
  it("a replayed callback for the same session is a no-op success", async () => {
    const { dealId } = await seedAcceptedDeal(100000);
    const fund = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 100000 });

    const first = await markEscrowFunded(dealId, fund.json.sessionId, "pi_row13_1");
    expect(first).toEqual({ ok: true });
    const before = await dealRow(dealId);
    expect(before.escrow_status).toBe("funded");
    expect(before.stripe_payment_intent_id).toBe("pi_row13_1");

    /* Stripe redelivers — even carrying a different PI id, the row must
       not move: the first settlement is the settlement. */
    const replay = await markEscrowFunded(dealId, fund.json.sessionId, "pi_row13_OTHER");
    expect(replay).toEqual({ ok: true, reason: "already-funded" });
    const after = await dealRow(dealId);
    expect(after).toEqual(before);
  });

  it("a foreign session against a funded deal is refused and changes nothing", async () => {
    const { dealId } = await seedAcceptedDeal(100000);
    const fund = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 100000 });
    await markEscrowFunded(dealId, fund.json.sessionId, "pi_row13_1");
    const before = await dealRow(dealId);

    const foreign = await markEscrowFunded(dealId, "cs_test_FOREIGN", "pi_foreign");
    expect(foreign.ok).toBe(false);
    expect(foreign.reason).toBe("bad-state:funded");
    expect(await dealRow(dealId)).toEqual(before);
  });

  it("a callback that outruns the fund response still lands from 'unfunded'", async () => {
    const { dealId } = await seedAcceptedDeal(100000);
    /* No fund call at all — the webhook arrives first (the race the
       'unfunded' arm of the state machine exists for). */
    const result = await markEscrowFunded(dealId, "cs_test_early", "pi_early");
    expect(result).toEqual({ ok: true });
    const row = await dealRow(dealId);
    expect(row.escrow_status).toBe("funded");
    expect(row.status).toBe("funded");
    expect(row.stripe_session_id).toBe("cs_test_early");
  });

  it("a released deal can never be re-funded by a stray callback", async () => {
    const { dealId } = await seedAcceptedDeal(100000);
    const { sql } = await import("drizzle-orm");
    await testState.db.execute(sql`
      UPDATE sponsor_deals SET status = 'paid', escrow_status = 'released' WHERE id = ${dealId}
    `);
    const result = await markEscrowFunded(dealId, "cs_test_late", "pi_late");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad-state:released");
    const row = await dealRow(dealId);
    expect(row.escrow_status).toBe("released");
  });
});

describe("row 13 — release split at the route (item 12)", () => {
  it("splits an odd-cent gross to the cent, writes one payout row, refuses a second release", async () => {
    const { dealId } = await seedAcceptedDeal(99999);
    const { sql } = await import("drizzle-orm");
    await testState.db.execute(sql`
      UPDATE sponsor_deals
      SET status = 'completed', escrow_status = 'funded', stripe_session_id = 'cs_test_row13_1'
      WHERE id = ${dealId}
    `);

    const release = await req("POST", `/sponsors/deals/${dealId}/release`);
    expect(release.status).toBe(200);
    /* 99,999 × 15% = 14,999.85 → 15,000 fee; creator keeps 84,999. */
    expect(release.json.platformFeeCents).toBe(15000);
    expect(release.json.creatorPayoutCents).toBe(84999);
    expect(release.json.grossCents).toBe(99999);

    const rows = await payoutRows(dealId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gross_cents: 99999, fee_cents: 15000, net_cents: 84999, status: "released" });

    const deal = await dealRow(dealId);
    expect(deal.status).toBe("paid");
    expect(deal.escrow_status).toBe("released");
    expect(deal.platform_fee_cents).toBe(15000);
    expect(deal.creator_payout_cents).toBe(84999);

    const again = await req("POST", `/sponsors/deals/${dealId}/release`);
    expect(again.status).toBe(409);
    expect(await payoutRows(dealId)).toHaveLength(1);
  });
});
