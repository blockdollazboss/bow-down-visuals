/**
 * Sponsor escrow ABANDONED-CHECKOUT RE-FUND (stack1400 item 5).
 *
 * The bug: a brand who opened the funding Checkout and walked away
 * left the deal in 'funding' forever — every re-fund was refused
 * ("already funding") and the session's expiry freed nothing.
 *
 * The fix pinned here:
 *  - classifyEscrowCheckoutSession: expired / open / paid / pending.
 *  - freeSponsorEscrowFundingForSession (the webhook's door): a
 *    guarded flip that only lands for the exact stored session id —
 *    replays and stale expiries change nothing; a funded deal can
 *    never be freed.
 *  - POST /fund lazily reconciles a 'funding' row against Stripe:
 *    expired → freed + a FRESH session under a superseded-scoped
 *    idempotency key; open → the SAME session handed back (resume,
 *    zero new sessions, so no double charge); paid → 409 (webhook
 *    owns settlement); unverifiable → 503 with no state change.
 *
 * Harness mirrors sponsors-embedded-fund.test.ts (pg-mem; Stripe
 * CONFIGURED, guarded client faked at lib/stripe-client with a
 * session store the tests can age / expire / pay).
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
  sessions: new Map<string, any>(),
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
            const embedded = params.ui_mode === "embedded_page";
            const session = {
              id,
              url: embedded ? null : `https://checkout.example/${testState.sessionSeq}`,
              client_secret: embedded ? `${id}_secret` : null,
              status: "open",
              payment_status: "unpaid",
              payment_intent: `pi_test_${testState.sessionSeq}`,
              metadata: params.metadata ?? {},
            };
            testState.sessions.set(id, session);
            return session;
          }),
          retrieve: vi.fn(async (id: string) => {
            const s = testState.sessions.get(id);
            if (!s) throw new Error("No such checkout session");
            return s;
          }),
        },
      },
    })),
  };
});

import router, {
  buildSponsorEscrowCheckoutKey,
  classifyEscrowCheckoutSession,
  freeSponsorEscrowFundingForSession,
} from "../sponsors";
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
  testState.sessions = new Map();
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
  return { dealId, appId };
}

async function dealRow(dealId: string) {
  const rows = await testState.db.execute(sql`SELECT escrow_status, stripe_session_id FROM sponsor_deals WHERE id = ${dealId}`);
  return (rows.rows as any[])[0];
}

/** Drive a deal into 'funding' with a live (open) session, then age
 *  that session in the fake Stripe store the way the test needs. */
async function fundOnce(dealId: string) {
  const first = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 50000 });
  expect(first.status).toBe(200);
  return first.json.sessionId as string;
}

describe("classifyEscrowCheckoutSession", () => {
  it("reads Stripe session states honestly", () => {
    expect(classifyEscrowCheckoutSession({ status: "expired", payment_status: "unpaid" })).toBe("expired");
    expect(classifyEscrowCheckoutSession({ status: "open", payment_status: "unpaid" })).toBe("open");
    expect(classifyEscrowCheckoutSession({ status: "complete", payment_status: "paid" })).toBe("paid");
    expect(classifyEscrowCheckoutSession({ status: "complete", payment_status: "unpaid" })).toBe("pending");
    expect(classifyEscrowCheckoutSession({ status: null, payment_status: null })).toBe("pending");
  });
});

describe("buildSponsorEscrowCheckoutKey — superseded sessions", () => {
  it("first-attempt keys are unchanged; a supersede gets its own deterministic key", () => {
    const base = { brandUserId: BRAND, dealId: randomUUID(), acceptedApplicationId: randomUUID(), amountCents: 50000 };
    const first = buildSponsorEscrowCheckoutKey(base);
    expect(buildSponsorEscrowCheckoutKey({ ...base, supersededSessionId: null })).toBe(first);
    const superseding = buildSponsorEscrowCheckoutKey({ ...base, supersededSessionId: "cs_dead_1" });
    expect(superseding).not.toBe(first);
    /* Retries of the superseding attempt reuse ITS key (one session). */
    expect(buildSponsorEscrowCheckoutKey({ ...base, supersededSessionId: "cs_dead_1" })).toBe(superseding);
    expect(buildSponsorEscrowCheckoutKey({ ...base, supersededSessionId: "cs_dead_2" })).not.toBe(superseding);
  });
});

describe("freeSponsorEscrowFundingForSession (the webhook door)", () => {
  it("frees a funding deal for its exact dead session — once; replays and stale ids change nothing", async () => {
    const { dealId } = await seedFundableDeal();
    const sessionId = await fundOnce(dealId);

    /* A stale expiry for some OTHER session must not free the live one. */
    expect(await freeSponsorEscrowFundingForSession(dealId, "cs_someone_else")).toBe(false);
    expect((await dealRow(dealId)).escrow_status).toBe("funding");

    expect(await freeSponsorEscrowFundingForSession(dealId, sessionId)).toBe(true);
    const row = await dealRow(dealId);
    expect(row.escrow_status).toBe("unfunded");
    expect(row.stripe_session_id).toBeNull();

    /* Webhook replay: idempotent no-op. */
    expect(await freeSponsorEscrowFundingForSession(dealId, sessionId)).toBe(false);
    expect((await dealRow(dealId)).escrow_status).toBe("unfunded");
  });

  it("can never free a funded deal", async () => {
    const { dealId } = await seedFundableDeal();
    const sessionId = await fundOnce(dealId);
    await testState.db.execute(sql`UPDATE sponsor_deals SET escrow_status = 'funded', status = 'funded' WHERE id = ${dealId}`);
    expect(await freeSponsorEscrowFundingForSession(dealId, sessionId)).toBe(false);
    expect((await dealRow(dealId)).escrow_status).toBe("funded");
  });
});

describe("POST /fund — re-fund reconciliation", () => {
  it("expired session: frees the deal and mints a FRESH session under a new key", async () => {
    const { dealId, appId } = await seedFundableDeal();
    const deadId = await fundOnce(dealId);
    const firstKey = testState.createCalls[0]!.options.idempotencyKey;
    testState.sessions.get(deadId).status = "expired";

    const second = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 50000 });
    expect(second.status).toBe(200);
    expect(second.json.sessionId).not.toBe(deadId);
    expect(testState.createCalls).toHaveLength(2);
    /* The fresh session must NOT reuse the dead session's key — Stripe
       would replay the expired session — and its key is exactly the
       superseded-scoped derivation. */
    const newKey = testState.createCalls[1]!.options.idempotencyKey;
    expect(newKey).not.toBe(firstKey);
    expect(newKey).toBe(
      buildSponsorEscrowCheckoutKey({
        brandUserId: BRAND,
        dealId,
        acceptedApplicationId: appId,
        amountCents: 50000,
        requestParams: testState.createCalls[1]!.params,
        supersededSessionId: deadId,
      }),
    );
    const row = await dealRow(dealId);
    expect(row.escrow_status).toBe("funding");
    expect(row.stripe_session_id).toBe(second.json.sessionId);
  });

  it("a second expiry frees again — the deal is never stranded twice", async () => {
    const { dealId } = await seedFundableDeal();
    const first = await fundOnce(dealId);
    testState.sessions.get(first).status = "expired";
    const second = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 50000 });
    expect(second.status).toBe(200);
    testState.sessions.get(second.json.sessionId).status = "expired";
    const third = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 50000 });
    expect(third.status).toBe(200);
    expect(third.json.sessionId).not.toBe(second.json.sessionId);
    expect(testState.createCalls).toHaveLength(3);
    const keys = testState.createCalls.map((c) => c.options.idempotencyKey);
    expect(new Set(keys).size).toBe(3);
  });

  it("still-open session: hands back the SAME session and creates nothing (no double charge)", async () => {
    const { dealId } = await seedFundableDeal();
    const liveId = await fundOnce(dealId);
    const again = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 50000 });
    expect(again.status).toBe(200);
    expect(again.json.resumed).toBe(true);
    expect(again.json.sessionId).toBe(liveId);
    expect(again.json.checkoutUrl).toBe(`https://checkout.example/1`);
    expect(testState.createCalls).toHaveLength(1);
    const row = await dealRow(dealId);
    expect(row.escrow_status).toBe("funding");
    expect(row.stripe_session_id).toBe(liveId);
  });

  it("already-paid session: refuses and creates nothing — settlement stays webhook-owned", async () => {
    const { dealId } = await seedFundableDeal();
    const paidId = await fundOnce(dealId);
    const s = testState.sessions.get(paidId);
    s.status = "complete";
    s.payment_status = "paid";
    const again = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 50000 });
    expect(again.status).toBe(409);
    expect(testState.createCalls).toHaveLength(1);
    const row = await dealRow(dealId);
    expect(row.escrow_status).toBe("funding");
    expect(row.stripe_session_id).toBe(paidId);
  });

  it("complete-but-unpaid session: fails closed (409), creates nothing, changes nothing", async () => {
    const { dealId } = await seedFundableDeal();
    const pendingId = await fundOnce(dealId);
    const s = testState.sessions.get(pendingId);
    s.status = "complete";
    s.payment_status = "unpaid";
    const again = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 50000 });
    expect(again.status).toBe(409);
    expect(testState.createCalls).toHaveLength(1);
    expect((await dealRow(dealId)).stripe_session_id).toBe(pendingId);
  });

  it("unverifiable session (Stripe retrieve fails): 503, creates nothing, deal stays in funding", async () => {
    const { dealId } = await seedFundableDeal();
    await testState.db.execute(sql`
      UPDATE sponsor_deals SET escrow_status = 'funding', stripe_session_id = 'cs_missing' WHERE id = ${dealId}
    `);
    const res = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 50000 });
    expect(res.status).toBe(503);
    expect(testState.createCalls).toHaveLength(0);
    const row = await dealRow(dealId);
    expect(row.escrow_status).toBe("funding");
    expect(row.stripe_session_id).toBe("cs_missing");
  });

  it("funding with no stored session id fails closed (409) — never freed on a guess", async () => {
    const { dealId } = await seedFundableDeal();
    await testState.db.execute(sql`
      UPDATE sponsor_deals SET escrow_status = 'funding', stripe_session_id = NULL WHERE id = ${dealId}
    `);
    const res = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 50000 });
    expect(res.status).toBe(409);
    expect(testState.createCalls).toHaveLength(0);
    expect((await dealRow(dealId)).escrow_status).toBe("funding");
  });

  it("sandbox: an unconfirmed sandbox funding is superseded by a fresh sandbox session on re-fund", async () => {
    delete process.env["STRIPE_SECRET_KEY"]; /* force sandbox mode */
    try {
      const { dealId } = await seedFundableDeal();
      const first = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 50000 });
      expect(first.status).toBe(200);
      expect(first.json.sandbox).toBe(true);
      /* The brand walks away — no confirm. Before the fix this deal
         was stuck in 'funding' forever; now a re-fund supersedes the
         abandoned sandbox session (no real money exists to double). */
      const second = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 50000 });
      expect(second.status).toBe(200);
      expect(second.json.sandbox).toBe(true);
      expect(second.json.sessionId).not.toBe(first.json.sessionId);
      const row = await dealRow(dealId);
      expect(row.escrow_status).toBe("funding");
      expect(row.stripe_session_id).toBe(second.json.sessionId);
      /* The abandoned session can no longer settle the escrow… */
      const confirmOld = await req("POST", "/sponsors/escrow/confirm", { dealId, sessionId: first.json.sessionId });
      expect(confirmOld.status).toBe(400);
      /* …and the fresh one can. */
      const confirmNew = await req("POST", "/sponsors/escrow/confirm", { dealId, sessionId: second.json.sessionId });
      expect(confirmNew.status).toBe(200);
      expect((await dealRow(dealId)).escrow_status).toBe("funded");
    } finally {
      process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
    }
  });

  it("funded and released deals are still refused outright (state machine unchanged)", async () => {
    const { dealId } = await seedFundableDeal();
    await testState.db.execute(sql`UPDATE sponsor_deals SET escrow_status = 'funded' WHERE id = ${dealId}`);
    const res = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 50000 });
    expect(res.status).toBe(409);
    expect(res.json.error).toContain("already funded");
    expect(testState.createCalls).toHaveLength(0);
  });
});
