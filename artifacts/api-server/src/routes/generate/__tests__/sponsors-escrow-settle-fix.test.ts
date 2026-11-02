/**
 * Sponsor escrow return-URL fix (stack1300 escrow-settle lane,
 * Gate #5 Nov 2 evidence, defect 1a of the re-run checklist):
 *
 * POST /sponsors/deals/:id/fund built its success/return/cancel
 * URLs from REPLIT_DOMAINS alone with an "http://localhost"
 * fallback. On Render (REPLIT_DOMAINS unset) every deployed
 * funding session sent the brand's browser to
 * http://localhost/sponsors/<id>?funded=1 after paying. Sponsors
 * was the only money rail missing the getBaseUrl(req) fallback
 * chain every sibling uses (REPLIT_DOMAINS → REPLIT_DEV_DOMAIN →
 * x-forwarded-proto + host header → localhost last resort).
 *
 * The fix derives through the shared checkoutBaseUrl(req) — the
 * lib implementation of that same chain — and fails closed on a
 * deployed runtime when the only derivable base is loopback.
 *
 * Settlement is NOT pinned here because it is not this defect:
 * escrow settlement is webhook-owned (checkout.session.completed →
 * markEscrowFunded, idempotent, 500-on-failure so Stripe retries)
 * and is pinned by the webhook sponsor suites. The localhost
 * return only ever broke the post-payment landing.
 *
 * Harness mirrors sponsors-embedded-fund.test.ts (pg-mem; guarded
 * Stripe client faked at lib/stripe-client, recording create
 * params) plus a proxy-header simulator for the deployed shape.
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
  simHost: null as string | null,
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
  /* Simulate Render's proxy: a deployed request carries the public
     host + forwarded proto. The fund route must derive its return
     base from these, exactly as it would in production. */
  app.use((req: any, _res: any, next: any) => {
    if (testState.simHost) {
      req.headers.host = testState.simHost;
      req.headers["x-forwarded-proto"] = "https";
    }
    next();
  });
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
  testState.simHost = null;
  delete process.env["EMBEDDED_CHECKOUT"];
  delete process.env["REPLIT_DOMAINS"];
  delete process.env["REPLIT_DEV_DOMAIN"];
  delete process.env["RENDER"];
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

/** A deal with an accepted application at $50.00 agreed. */
async function seedDeal() {
  const dealId = randomUUID();
  const appId = randomUUID();
  await testState.db.execute(sql`
    INSERT INTO sponsor_deals (id, brand_name, budget_min, budget_max, niche, deliverables, description, deadline, posted_by, status, agreed_amount_cents, escrow_status, accepted_application_id, accepted_user_id)
    VALUES (${dealId}, ${"TEST Brand"}, ${500}, ${2000}, ${"Music"}, ${"1 post"}, ${"Gate 5 test"}, ${new Date("2027-01-01").toISOString()}, ${BRAND}, ${"active"}, ${5000}, ${"unfunded"}, ${appId}, ${CREATOR})
  `);
  await testState.db.execute(sql`
    INSERT INTO sponsor_applications (id, deal_id, user_id, pitch, status)
    VALUES (${appId}, ${dealId}, ${CREATOR}, ${"Pick me!"}, 'accepted')
  `);
  return dealId;
}

async function dealRow(dealId: string) {
  const rows = await testState.db.execute(sql`
    SELECT escrow_status, stripe_session_id FROM sponsor_deals WHERE id = ${dealId}
  `);
  return (rows.rows as any[])[0];
}

describe("fund return_url — never localhost on a deployed build", () => {
  it("derives the embedded return_url (and hosted success_url) from the request's public host", async () => {
    testState.simHost = "bow-down-visuals-staging.onrender.com";
    const dealId = await seedDeal();
    const { status } = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 5000, uiMode: "embedded" });
    expect(status).toBe(200);
    expect(testState.createCalls[0]!.params.return_url).toBe(
      `https://bow-down-visuals-staging.onrender.com/sponsors/${dealId}?funded=1`,
    );

    const dealId2 = await seedDeal();
    await req("POST", `/sponsors/deals/${dealId2}/fund`, { amountCents: 5000 });
    expect(testState.createCalls[1]!.params.success_url).toBe(
      `https://bow-down-visuals-staging.onrender.com/sponsors/${dealId2}?funded=1`,
    );
    expect(testState.createCalls[1]!.params.cancel_url).toContain("bow-down-visuals-staging.onrender.com");
    for (const call of testState.createCalls) {
      expect(JSON.stringify(call.params)).not.toContain("localhost");
    }
  });

  it("fails closed on a deployed runtime when the only derivable base is loopback", async () => {
    process.env["RENDER"] = "true"; /* deployed signal; no public host on this request */
    const dealId = await seedDeal();
    const { status, json } = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 5000, uiMode: "embedded" });
    expect(status).toBe(500);
    expect(json.error).toContain("Could not start the funding flow");
    expect(testState.createCalls).toHaveLength(0);
    const row = await dealRow(dealId);
    expect(row.escrow_status).toBe("unfunded");
    expect(row.stripe_session_id).toBeNull();
  });

  it("honours an explicit REPLIT_DOMAINS deployment domain ahead of the request host", async () => {
    process.env["REPLIT_DOMAINS"] = "bowdownvisuals.com";
    testState.simHost = "bow-down-visuals-staging.onrender.com";
    const dealId = await seedDeal();
    const { status } = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 5000 });
    expect(status).toBe(200);
    expect(testState.createCalls[0]!.params.success_url).toBe(
      `https://bowdownvisuals.com/sponsors/${dealId}?funded=1`,
    );
  });
});
