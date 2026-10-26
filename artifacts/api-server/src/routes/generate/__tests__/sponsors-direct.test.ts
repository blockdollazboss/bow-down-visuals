/**
 * Direct profile sponsorship (payfix sponsor-purchase lane).
 *
 * A signed-in user sponsors a SPECIFIC creator from /artist/:slug.
 * Covers: the pre-pay quote (fee constant = SPONSOR_PLATFORM_FEE_BPS,
 * 1500 = 15%), deal creation at the sponsor's OWN amount (no invented
 * price), split math, the sandbox escrow lifecycle end to end, the
 * on-site PaymentIntent funding path (create → resume → verify, exactly
 * once), creator + sponsor dashboard records, public recognition only
 * after funding, and the dashboard loading for a fresh user.
 *
 * pg-mem for DB semantics; Stripe is faked at the stripe-client module
 * boundary (idempotency-key aware, like real Stripe).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  pis: new Map<string, any>(),
  piByKey: new Map<string, any>(),
  piCreateCalls: 0,
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

vi.mock("../../../lib/stripe-client", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createGuardedStripeClient: () => ({
      paymentIntents: {
        create: async (params: any, opts: any) => {
          const key = opts?.idempotencyKey as string | undefined;
          if (key && testState.piByKey.has(key)) return testState.piByKey.get(key);
          testState.piCreateCalls += 1;
          const pi = {
            id: `pi_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
            client_secret: `pi_secret_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
            status: "requires_confirmation",
            amount: params.amount,
            currency: params.currency ?? "usd",
            metadata: params.metadata ?? {},
          };
          testState.pis.set(pi.id, pi);
          if (key) testState.piByKey.set(key, pi);
          return pi;
        },
        retrieve: async (id: string) => {
          const pi = testState.pis.get(id);
          if (!pi) throw new Error(`No such payment_intent: ${id}`);
          return pi;
        },
      },
    }),
  };
});

import router, {
  sponsorFeeSplit,
  SPONSOR_PLATFORM_FEE_BPS,
  buildSponsorEscrowPaymentIntentKey,
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
);
CREATE TABLE creator_profiles (
  user_id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  vertical text NOT NULL DEFAULT 'music',
  is_public boolean NOT NULL DEFAULT true
);`;

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

const SPONSOR = randomUUID();
const CREATOR = randomUUID();
const STRANGER = randomUUID();
const CREATOR_SLUG = "direct-creator";

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
  testState.userId = SPONSOR;
  testState.pis.clear();
  testState.piByKey.clear();
  testState.piCreateCalls = 0;
  delete process.env["STRIPE_SECRET_KEY"];
  vi.clearAllMocks();
  const { sql } = await import("drizzle-orm");
  await testState.db.execute(sql`
    INSERT INTO creator_profiles (user_id, slug, display_name, vertical, is_public)
    VALUES (${CREATOR}, ${CREATOR_SLUG}, ${"Direct Creator"}, ${"music"}, ${true})
  `);
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

function asUser(userId: string) {
  testState.userId = userId;
}

async function createDirect(amountCents = 100000) {
  const { status, json } = await req("POST", `/sponsors/creator/${CREATOR_SLUG}`, {
    amountCents,
    brandName: "Volt Energy",
    deliverables: "Logo on stream + one shoutout post",
    message: "Love the show — keep going.",
  });
  expect(status).toBe(200);
  return json;
}

describe("fee constant", () => {
  it("is the sponsor rail's 1500 bps (15%), applied by sponsorFeeSplit", () => {
    expect(SPONSOR_PLATFORM_FEE_BPS).toBe(1500);
    expect(sponsorFeeSplit(100000)).toEqual({ feeCents: 15000, netCents: 85000 });
    expect(sponsorFeeSplit(12345)).toEqual({ feeCents: 1852, netCents: 10493 });
  });

  it("payment-intent idempotency key is deterministic per funding act", () => {
    const base = { brandUserId: SPONSOR, dealId: randomUUID(), acceptedApplicationId: randomUUID(), amountCents: 5000 };
    expect(buildSponsorEscrowPaymentIntentKey(base)).toBe(buildSponsorEscrowPaymentIntentKey({ ...base }));
    expect(buildSponsorEscrowPaymentIntentKey({ ...base, amountCents: 5001 })).not.toBe(buildSponsorEscrowPaymentIntentKey(base));
  });
});

describe("quote (pre-pay price + split surface)", () => {
  it("returns the creator, the 15/85 split constant, and no sponsors before funding", async () => {
    const { status, json } = await req("GET", `/sponsors/creator/${CREATOR_SLUG}`);
    expect(status).toBe(200);
    expect(json.creator.displayName).toBe("Direct Creator");
    expect(json.feeBps).toBe(1500);
    expect(json.feePct).toBe(15);
    expect(json.creatorPct).toBe(85);
    expect(json.isSelf).toBe(false);
    expect(json.sponsors).toEqual([]);
  });

  it("flags self-sponsorship on the quote", async () => {
    asUser(CREATOR);
    const { json } = await req("GET", `/sponsors/creator/${CREATOR_SLUG}`);
    expect(json.isSelf).toBe(true);
  });

  it("404s for unknown and private creators", async () => {
    expect((await req("GET", "/sponsors/creator/nope")).status).toBe(404);
    const { sql } = await import("drizzle-orm");
    await testState.db.execute(sql`UPDATE creator_profiles SET is_public = false WHERE slug = ${CREATOR_SLUG}`);
    expect((await req("GET", `/sponsors/creator/${CREATOR_SLUG}`)).status).toBe(404);
    expect((await req("POST", `/sponsors/creator/${CREATOR_SLUG}`, {
      amountCents: 5000, brandName: "X", deliverables: "Y",
    })).status).toBe(404);
  });
});

describe("create direct sponsorship", () => {
  it("creates a deal aimed at the creator with an accepted application and the exact split", async () => {
    const json = await createDirect(100000);
    expect(json.deal.postedBy).toBe(SPONSOR);
    expect(json.deal.acceptedUserId).toBe(CREATOR);
    expect(json.deal.agreedAmountCents).toBe(100000);
    expect(json.deal.escrowStatus).toBe("unfunded");
    expect(json.targetCreatorUserId).toBe(CREATOR);
    expect(json.split).toEqual({
      grossCents: 100000, feeCents: 15000, netCents: 85000,
      feeBps: 1500, feePct: 15, creatorPct: 85,
    });

    const { sql } = await import("drizzle-orm");
    const deals = await testState.db.execute(sql`
      SELECT target_creator_user_id FROM sponsor_deals WHERE id = ${json.deal.id}
    `);
    expect((deals.rows[0] as any).target_creator_user_id).toBe(CREATOR);
    const apps = await testState.db.execute(sql`
      SELECT user_id, status FROM sponsor_applications WHERE deal_id = ${json.deal.id}
    `);
    expect(apps.rows).toHaveLength(1);
    expect((apps.rows[0] as any).user_id).toBe(CREATOR);
    expect((apps.rows[0] as any).status).toBe("accepted");
  });

  it("split math follows the constant on odd amounts", async () => {
    const json = await createDirect(12345);
    expect(json.split.feeCents).toBe(1852);
    expect(json.split.netCents).toBe(10493);
    expect(json.split.feeCents + json.split.netCents).toBe(12345);
  });

  it("refuses self-sponsorship and invalid amounts", async () => {
    asUser(CREATOR);
    expect((await req("POST", `/sponsors/creator/${CREATOR_SLUG}`, {
      amountCents: 5000, brandName: "Me", deliverables: "Stuff",
    })).status).toBe(400);
    asUser(SPONSOR);
    expect((await req("POST", `/sponsors/creator/${CREATOR_SLUG}`, {
      amountCents: 50, brandName: "Volt", deliverables: "Stuff",
    })).status).toBe(400);
    expect((await req("POST", `/sponsors/creator/${CREATOR_SLUG}`, {
      amountCents: 5000, deliverables: "Stuff",
    })).status).toBe(400);
  });

  it("unfunded sponsorships do NOT appear in public recognition", async () => {
    await createDirect();
    const { json } = await req("GET", `/sponsors/creator/${CREATOR_SLUG}`);
    expect(json.sponsors).toEqual([]);
  });
});

describe("sandbox escrow lifecycle for a direct sponsorship", () => {
  it("fund → recognise → start → complete → release at 15%, records on both dashboards", async () => {
    const created = await createDirect(100000);
    const dealId = created.deal.id as string;

    /* fund-intent reports sandbox mode when no Stripe key is configured */
    const intent = await req("POST", `/sponsors/deals/${dealId}/fund-intent`, {});
    expect(intent.status).toBe(200);
    expect(intent.json.sandbox).toBe(true);
    expect(intent.json.split.feeCents).toBe(15000);

    const fund = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 100000 });
    expect(fund.status).toBe(200);
    expect(fund.json.sandbox).toBe(true);
    const confirm = await req("POST", "/sponsors/escrow/confirm", { dealId, sessionId: fund.json.sessionId });
    expect(confirm.status).toBe(200);

    /* public recognition appears only now that money funded */
    const quote = await req("GET", `/sponsors/creator/${CREATOR_SLUG}`);
    expect(quote.json.sponsors).toHaveLength(1);
    expect(quote.json.sponsors[0].brandName).toBe("Volt Energy");
    expect(quote.json.sponsors[0].amountCents).toBe(100000);

    asUser(CREATOR);
    expect((await req("POST", `/sponsors/deals/${dealId}/start`)).status).toBe(200);
    expect((await req("POST", `/sponsors/deals/${dealId}/complete`)).status).toBe(200);

    asUser(SPONSOR);
    const release = await req("POST", `/sponsors/deals/${dealId}/release`);
    expect(release.status).toBe(200);
    expect(release.json.grossCents).toBe(100000);
    expect(release.json.platformFeeCents).toBe(15000);
    expect(release.json.creatorPayoutCents).toBe(85000);

    /* release replay is refused and writes no second payout (exactly once) */
    expect((await req("POST", `/sponsors/deals/${dealId}/release`)).status).toBe(409);
    const { sql } = await import("drizzle-orm");
    const payouts = await testState.db.execute(sql`SELECT * FROM sponsor_payouts WHERE deal_id = ${dealId}`);
    expect(payouts.rows).toHaveLength(1);
    expect((payouts.rows[0] as any).fee_cents).toBe(15000);
    expect((payouts.rows[0] as any).net_cents).toBe(85000);

    /* sponsor's record: the posted deal reads paid */
    const sponsorDash = await req("GET", "/sponsors/dashboard");
    expect(sponsorDash.status).toBe(200);
    expect(sponsorDash.json.postedDeals).toHaveLength(1);
    expect(sponsorDash.json.postedDeals[0].status).toBe("paid");
    expect(sponsorDash.json.postedDeals[0].platformFeeCents).toBe(15000);

    /* creator's record: application + payout + earnings total */
    asUser(CREATOR);
    const creatorDash = await req("GET", "/sponsors/dashboard");
    expect(creatorDash.status).toBe(200);
    expect(creatorDash.json.applications).toHaveLength(1);
    expect(creatorDash.json.applications[0].application_status).toBe("accepted");
    expect(creatorDash.json.payouts).toHaveLength(1);
    expect(creatorDash.json.payouts[0].net_cents).toBe(85000);
    expect(creatorDash.json.totalEarnedCents).toBe(85000);
  });

  it("strangers cannot fund, start, complete or release a direct deal", async () => {
    const created = await createDirect();
    const dealId = created.deal.id as string;
    asUser(STRANGER);
    expect((await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 100000 })).status).toBe(403);
    expect((await req("POST", `/sponsors/deals/${dealId}/fund-intent`, {})).status).toBe(403);
    expect((await req("POST", `/sponsors/deals/${dealId}/start`)).status).toBe(403);
    expect((await req("POST", `/sponsors/deals/${dealId}/release`)).status).toBe(403);
  });
});

describe("on-site PaymentIntent funding (Stripe TEST configured)", () => {
  beforeEach(() => {
    process.env["STRIPE_SECRET_KEY"] = "sk_test_fake_for_unit_tests";
  });

  it("mints one intent, resumes it on replay, and verify settles exactly once", async () => {
    const created = await createDirect(100000);
    const dealId = created.deal.id as string;

    const first = await req("POST", `/sponsors/deals/${dealId}/fund-intent`, {});
    expect(first.status).toBe(200);
    expect(first.json.sandbox).toBe(false);
    expect(first.json.clientSecret).toMatch(/^pi_secret_/);
    expect(first.json.split).toMatchObject({ feeCents: 15000, netCents: 85000 });
    const piId = first.json.paymentIntentId as string;

    /* replay: same intent resumed, no second mint */
    const replay = await req("POST", `/sponsors/deals/${dealId}/fund-intent`, {});
    expect(replay.status).toBe(200);
    expect(replay.json.resumed).toBe(true);
    expect(replay.json.paymentIntentId).toBe(piId);
    expect(testState.piCreateCalls).toBe(1);

    /* verify refuses an unpaid intent */
    const early = await req("POST", "/sponsors/escrow/verify", { dealId, paymentIntentId: piId });
    expect(early.status).toBe(400);

    /* pay it (fake Stripe) and verify */
    testState.pis.get(piId).status = "succeeded";
    const verify = await req("POST", "/sponsors/escrow/verify", { dealId, paymentIntentId: piId });
    expect(verify.status).toBe(200);
    expect(verify.json).toMatchObject({ success: true, escrowStatus: "funded", duplicate: false });

    /* verify replay: duplicate, escrow still settled exactly once */
    const verify2 = await req("POST", "/sponsors/escrow/verify", { dealId, paymentIntentId: piId });
    expect(verify2.status).toBe(200);
    expect(verify2.json.duplicate).toBe(true);
    const detail = await req("GET", `/sponsors/deals/${dealId}`);
    expect(detail.json.deal.escrowStatus).toBe("funded");
    expect(detail.json.deal.status).toBe("funded");

    /* a funded deal cannot be funded again */
    expect((await req("POST", `/sponsors/deals/${dealId}/fund-intent`, {})).status).toBe(409);
  });

  it("verify rejects intents for another deal, wrong amounts, and non-owners", async () => {
    const a = await createDirect(100000);
    const b = await createDirect(200000);
    const intentA = await req("POST", `/sponsors/deals/${a.deal.id}/fund-intent`, {});
    const piA = intentA.json.paymentIntentId as string;
    testState.pis.get(piA).status = "succeeded";

    /* intent minted for deal A presented against deal B */
    const cross = await req("POST", "/sponsors/escrow/verify", { dealId: b.deal.id, paymentIntentId: piA });
    expect(cross.status).toBe(400);

    /* amount tampered after minting */
    testState.pis.get(piA).amount = 1;
    const tampered = await req("POST", "/sponsors/escrow/verify", { dealId: a.deal.id, paymentIntentId: piA });
    expect(tampered.status).toBe(400);
    testState.pis.get(piA).amount = 100000;

    /* a stranger cannot verify the sponsor's funding */
    asUser(STRANGER);
    const stranger = await req("POST", "/sponsors/escrow/verify", { dealId: a.deal.id, paymentIntentId: piA });
    expect(stranger.status).toBe(403);
  });
});

describe("dashboard regression (statecheck: 'Could not load your dashboard')", () => {
  it("loads empty for a user with no sponsor activity at all", async () => {
    asUser(STRANGER);
    const { status, json } = await req("GET", "/sponsors/dashboard");
    expect(status).toBe(200);
    expect(json.postedDeals).toEqual([]);
    expect(json.applications).toEqual([]);
    expect(json.payouts).toEqual([]);
    expect(json.totalEarnedCents).toBe(0);
  });
});
