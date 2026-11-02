/**
 * Sponsor escrow fund EMBEDDED checkout (stack1200 hosted-checkout
 * sweep): POST /sponsors/deals/:id/fund accepts uiMode: "embedded"
 * (gated on the EMBEDDED_CHECKOUT kill switch) and creates the SAME
 * escrow session in embedded_page ui_mode — same amount, metadata
 * and buildSponsorEscrowCheckoutKey idempotency — answering
 * clientSecret with checkoutUrl null. Hosted stays the default and
 * the sandbox (no-key) shape is untouched.
 *
 * Harness mirrors sponsors-escrow.test.ts (pg-mem; only the db
 * handle is swapped) with Stripe CONFIGURED and the guarded client
 * faked at lib/stripe-client, recording create params/options.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { sql } from "drizzle-orm";

const testState = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  sessionSeq: 0,
  createCalls: [] as Array<{ params: Record<string, any>; options: any }>,
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
  canUseCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  CreditsDisabledError: class CreditsDisabledError extends Error {},
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../lib/stripe-client", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createGuardedStripeClient: vi.fn(() => ({
      checkout: {
        sessions: {
          create: vi.fn(async (params: Record<string, any>, options: any) => {
            testState.sessionSeq += 1;
            testState.createCalls.push({ params, options });
            const id = `cs_test_${testState.sessionSeq}`;
            if (params.ui_mode === "embedded_page") {
              return { id, url: null, client_secret: `${id}_secret` };
            }
            return { id, url: `https://checkout.example/${testState.sessionSeq}` };
          }),
          retrieve: vi.fn(async (id: string) => ({
            id,
            payment_status: "paid",
            payment_intent: "pi_test_1",
            metadata: {},
          })),
        },
      },
    })),
  };
});

import router from "../sponsors";
import { createTestDb } from "../../../lib/__tests__/test-db";

const V2_DDL = `
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
);`;

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

const BRAND = randomUUID();
const CREATOR = randomUUID();

beforeAll(async () => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake"; /* Stripe configured → real rail */
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
  mem.public.none(V2_DDL);
  testState.db = db;
  testState.userId = BRAND;
  testState.sessionSeq = 0;
  testState.createCalls = [];
  delete process.env["EMBEDDED_CHECKOUT"];
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

/** A deal ready to fund: application accepted at $500.00 agreed. */
async function seedFundableDeal() {
  const dealId = randomUUID();
  const appId = randomUUID();
  await testState.db.execute(sql`
    INSERT INTO sponsor_deals (id, brand_name, budget_min, budget_max, niche, deliverables, description, deadline, posted_by, status, agreed_amount_cents, escrow_status, accepted_application_id, accepted_user_id)
    VALUES (${dealId}, ${"Volt Energy"}, ${500}, ${2000}, ${"Music"}, ${"1 TikTok"}, ${"Energy drink brand"}, ${new Date("2027-01-01").toISOString()}, ${BRAND}, ${"active"}, ${50000}, ${"unfunded"}, ${appId}, ${CREATOR})
  `);
  await testState.db.execute(sql`
    INSERT INTO sponsor_applications (id, deal_id, user_id, pitch, status)
    VALUES (${appId}, ${dealId}, ${CREATOR}, ${"Pick me!"}, 'accepted')
  `);
  return dealId;
}

async function dealRow(dealId: string) {
  const rows = await testState.db.execute(sql`SELECT escrow_status, stripe_session_id FROM sponsor_deals WHERE id = ${dealId}`);
  return (rows.rows as any[])[0];
}

describe("sponsor escrow fund — embedded checkout (sweep)", () => {
  it("embedded ask answers clientSecret + checkoutUrl null and creates the session embedded", async () => {
    const dealId = await seedFundableDeal();
    const { status, json } = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 50000, uiMode: "embedded" });
    expect(status).toBe(200);
    expect(json.sandbox).toBe(false);
    expect(json.checkoutUrl).toBeNull();
    expect(json.clientSecret).toBe("cs_test_1_secret");
    expect(json.uiMode).toBe("embedded");
    expect(json.sessionId).toBe("cs_test_1");
    const { params } = testState.createCalls[0]!;
    expect(params.ui_mode).toBe("embedded_page");
    expect(params.return_url).toContain(`/sponsors/${dealId}?funded=1`);
    expect(params.success_url).toBeUndefined();
    const row = await dealRow(dealId);
    expect(row.stripe_session_id).toBe("cs_test_1");
    expect(row.escrow_status).toBe("funding");
  });

  it("embedded and hosted create the identical session but for presentation (same amount + metadata; different idempotency key — stack1300)", async () => {
    const dealId = await seedFundableDeal();
    await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 50000, uiMode: "embedded" });
    /* Reset to unfunded so the same durable funding act can be
       re-driven in the hosted shape for comparison. */
    await testState.db.execute(sql`UPDATE sponsor_deals SET escrow_status = 'unfunded', stripe_session_id = NULL WHERE id = ${dealId}`);
    await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 50000 });
    const [emb, host] = testState.createCalls;
    const strip = (p: Record<string, any>) => {
      const { ui_mode, return_url, success_url, cancel_url, ...rest } = p;
      return rest;
    };
    expect(strip(emb!.params)).toEqual(strip(host!.params));
    expect(emb!.params.line_items[0].price_data.unit_amount).toBe(50000);
    expect(emb!.params.metadata).toMatchObject({
      sponsor_deal_id: dealId,
      sponsor_escrow: "true",
      amount_cents: "50000",
    });
    /* Different presentations = different Stripe requests; the key
       fingerprints the exact parameters, so they must NOT share one
       (a shared key is what Stripe refused on staging). */
    expect(emb!.options.idempotencyKey).not.toBe(host!.options.idempotencyKey);
  });

  it("hosted stays the default and the explicit shape", async () => {
    const dealId = await seedFundableDeal();
    const dflt = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 50000 });
    expect(dflt.json.checkoutUrl).toContain("checkout.example");
    expect(dflt.json.clientSecret).toBeUndefined();
    expect(testState.createCalls[0]!.params.ui_mode).toBeUndefined();
    expect(testState.createCalls[0]!.params.success_url).toContain("?funded=1");

    const dealId2 = await seedFundableDeal();
    const expl = await req("POST", `/sponsors/deals/${dealId2}/fund`, { amountCents: 50000, uiMode: "hosted" });
    expect(expl.json.checkoutUrl).toContain("checkout.example");
    expect(testState.createCalls[1]!.params.ui_mode).toBeUndefined();
  });

  it("EMBEDDED_CHECKOUT=off forces hosted even when embedded is asked", async () => {
    process.env["EMBEDDED_CHECKOUT"] = "off";
    const dealId = await seedFundableDeal();
    const { status, json } = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 50000, uiMode: "embedded" });
    expect(status).toBe(200);
    expect(json.checkoutUrl).toContain("checkout.example");
    expect(json.clientSecret).toBeUndefined();
    expect(testState.createCalls[0]!.params.ui_mode).toBeUndefined();
  });

  it("unknown uiMode is a 400 and no session is created", async () => {
    const dealId = await seedFundableDeal();
    const { status } = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 50000, uiMode: "popup" });
    expect(status).toBe(400);
    expect(testState.createCalls).toHaveLength(0);
    const row = await dealRow(dealId);
    expect(row.escrow_status).toBe("unfunded");
  });

  it("money math untouched: a $500.00 fund at the 15% fee splits $75.00 / $425.00 downstream", async () => {
    /* The fund itself moves the gross into escrow; the split is
       sponsorFeeSplit's — pinned here against the funded amount so
       the presentation change can never drift it. */
    const { sponsorFeeSplit } = await import("../sponsors");
    expect(sponsorFeeSplit(50000)).toEqual({ feeCents: 7500, netCents: 42500 });
  });
});
