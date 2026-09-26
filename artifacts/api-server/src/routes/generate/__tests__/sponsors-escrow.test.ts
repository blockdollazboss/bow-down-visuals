/**
 * Sponsor Marketplace v2 — escrow + deal lifecycle tests.
 *
 * Covers: deal detail, application accept/reject (incl. agreed-amount
 * validation against the posted budget), sandbox fund → confirm, the
 * funded → in_progress → completed → paid lifecycle, the 15% platform
 * fee math, the dashboard, and auth boundaries (only the brand funds /
 * releases / reviews; only the accepted creator starts / completes).
 *
 * Real database semantics via pg-mem (the @workspace/db module is real;
 * only its `db` handle is swapped for the in-memory instance).
 * Stripe is NOT configured in tests → all funding runs in sandbox mode.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  db: null as any,
  userId: "",
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

/* The public API rate limiter (30 req/min/IP) would throttle this file's
   ~60 sequential localhost requests — bypass it in tests like require-auth. */
vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

import router, { sponsorFeeSplit, SPONSOR_PLATFORM_FEE_BPS } from "../sponsors";
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
const STRANGER = randomUUID();

beforeAll(async () => {
  delete process.env["STRIPE_SECRET_KEY"]; /* force sandbox mode */
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

function asUser(userId: string) {
  testState.userId = userId;
}

async function seedDeal(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  const { sql } = await import("drizzle-orm");
  await testState.db.execute(sql`
    INSERT INTO sponsor_deals (id, brand_name, budget_min, budget_max, niche, deliverables, description, deadline, posted_by, status)
    VALUES (${id}, ${"Volt Energy"}, ${500}, ${2000}, ${"Music"}, ${"1 TikTok"}, ${"Energy drink brand"}, ${new Date("2027-01-01").toISOString()}, ${BRAND}, ${"active"})
  `);
  void overrides;
  return id;
}

async function seedApplication(dealId: string, userId: string, pitch = "Pick me!") {
  const id = randomUUID();
  const { sql } = await import("drizzle-orm");
  await testState.db.execute(sql`
    INSERT INTO sponsor_applications (id, deal_id, user_id, pitch, status)
    VALUES (${id}, ${dealId}, ${userId}, ${pitch}, 'pending')
  `);
  return id;
}

describe("platform fee math", () => {
  it("takes 15% by default", () => {
    expect(SPONSOR_PLATFORM_FEE_BPS).toBe(1500);
    const { feeCents, netCents } = sponsorFeeSplit(100000); /* $1,000 */
    expect(feeCents).toBe(15000);
    expect(netCents).toBe(85000);
  });

  it("rounds sensibly and always sums to gross", () => {
    for (const gross of [100, 199, 999, 12345, 1000000]) {
      const { feeCents, netCents } = sponsorFeeSplit(gross);
      expect(feeCents + netCents).toBe(gross);
    }
  });
});

describe("deal detail", () => {
  it("returns the full deal with application count", async () => {
    const dealId = await seedDeal();
    await seedApplication(dealId, CREATOR);
    const { status, json } = await req("GET", `/sponsors/deals/${dealId}`);
    expect(status).toBe(200);
    expect(json.deal.id).toBe(dealId);
    expect(json.deal.applicationCount).toBe(1);
    expect(json.deal.myApplicationStatus).toBeNull(); /* brand hasn't applied */
    expect(json.deal.escrowStatus).toBe("unfunded");
  });

  it("shows the creator their application status", async () => {
    const dealId = await seedDeal();
    await seedApplication(dealId, CREATOR);
    asUser(CREATOR);
    const { status, json } = await req("GET", `/sponsors/deals/${dealId}`);
    expect(status).toBe(200);
    expect(json.deal.myApplicationStatus).toBe("pending");
  });

  it("404s on unknown deals and 400s on bad ids", async () => {
    expect((await req("GET", `/sponsors/deals/${randomUUID()}`)).status).toBe(404);
    expect((await req("GET", "/sponsors/deals/nope")).status).toBe(400);
  });
});

describe("application review", () => {
  it("brand accepts with an agreed amount inside the budget", async () => {
    const dealId = await seedDeal();
    const appId = await seedApplication(dealId, CREATOR);
    const otherApp = await seedApplication(dealId, STRANGER);
    const { status, json } = await req("PATCH", `/sponsors/applications/${appId}`, {
      action: "accept",
      agreedAmountCents: 100000, /* $1,000 — inside $500–$2,000 */
    });
    expect(status).toBe(200);
    expect(json.status).toBe("accepted");
    expect(json.agreedAmountCents).toBe(100000);

    /* the other pending application is auto-rejected */
    asUser(BRAND);
    const { json: apps } = await req("GET", `/sponsors/deals/${dealId}/applications`);
    const other = (apps.applications as any[]).find((a) => a.id === otherApp);
    expect(other.status).toBe("rejected");
  });

  it("rejects agreed amounts outside the posted budget", async () => {
    const dealId = await seedDeal();
    const appId = await seedApplication(dealId, CREATOR);
    const { status, json } = await req("PATCH", `/sponsors/applications/${appId}`, {
      action: "accept",
      agreedAmountCents: 100, /* $1 — below the $500 min */
    });
    expect(status).toBe(400);
    expect(json.error).toMatch(/budget/i);
  });

  it("requires an agreed amount to accept", async () => {
    const dealId = await seedDeal();
    const appId = await seedApplication(dealId, CREATOR);
    const { status } = await req("PATCH", `/sponsors/applications/${appId}`, { action: "accept" });
    expect(status).toBe(400);
  });

  it("brand can reject outright", async () => {
    const dealId = await seedDeal();
    const appId = await seedApplication(dealId, CREATOR);
    const { status, json } = await req("PATCH", `/sponsors/applications/${appId}`, { action: "reject" });
    expect(status).toBe(200);
    expect(json.status).toBe("rejected");
  });

  it("non-brand cannot review applications", async () => {
    const dealId = await seedDeal();
    const appId = await seedApplication(dealId, CREATOR);
    asUser(STRANGER);
    expect((await req("PATCH", `/sponsors/applications/${appId}`, { action: "reject" })).status).toBe(403);
    expect((await req("GET", `/sponsors/deals/${dealId}/applications`)).status).toBe(403);
  });

  it("cannot review the same application twice", async () => {
    const dealId = await seedDeal();
    const appId = await seedApplication(dealId, CREATOR);
    await req("PATCH", `/sponsors/applications/${appId}`, { action: "reject" });
    const { status } = await req("PATCH", `/sponsors/applications/${appId}`, { action: "reject" });
    expect(status).toBe(409);
  });
});

describe("escrow lifecycle (sandbox)", () => {
  async function setupFundedDeal() {
    const dealId = await seedDeal();
    const appId = await seedApplication(dealId, CREATOR);
    await req("PATCH", `/sponsors/applications/${appId}`, {
      action: "accept",
      agreedAmountCents: 100000,
    });
    return dealId;
  }

  it("funds in sandbox mode and confirms the escrow", async () => {
    const dealId = await setupFundedDeal();
    const fund = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 100000 });
    expect(fund.status).toBe(200);
    expect(fund.json.sandbox).toBe(true);
    expect(fund.json.sessionId).toMatch(/^sandbox_/);

    const confirm = await req("POST", "/sponsors/escrow/confirm", {
      dealId,
      sessionId: fund.json.sessionId,
    });
    expect(confirm.status).toBe(200);
    expect(confirm.json.escrowStatus).toBe("funded");

    const { json } = await req("GET", `/sponsors/deals/${dealId}`);
    expect(json.deal.escrowStatus).toBe("funded");
    expect(json.deal.status).toBe("funded");
  });

  it("refuses to fund before a creator is accepted", async () => {
    const dealId = await seedDeal();
    const { status, json } = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 100000 });
    expect(status).toBe(409);
    expect(json.error).toMatch(/accept/i);
  });

  it("refuses funding amounts that differ from the agreed payout", async () => {
    const dealId = await setupFundedDeal();
    const { status } = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 99999 });
    expect(status).toBe(400);
  });

  it("non-brand cannot fund", async () => {
    const dealId = await setupFundedDeal();
    asUser(CREATOR);
    expect((await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 100000 })).status).toBe(403);
  });

  it("full lifecycle: start → complete → release with 15% fee", async () => {
    const dealId = await setupFundedDeal();
    const fund = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 100000 });
    await req("POST", "/sponsors/escrow/confirm", { dealId, sessionId: fund.json.sessionId });

    /* creator starts */
    asUser(CREATOR);
    expect((await req("POST", `/sponsors/deals/${dealId}/start`)).status).toBe(200);

    /* creator completes */
    expect((await req("POST", `/sponsors/deals/${dealId}/complete`)).status).toBe(200);

    /* brand releases — 15% fee */
    asUser(BRAND);
    const release = await req("POST", `/sponsors/deals/${dealId}/release`);
    expect(release.status).toBe(200);
    expect(release.json.status).toBe("paid");
    expect(release.json.grossCents).toBe(100000);
    expect(release.json.platformFeeCents).toBe(15000);
    expect(release.json.creatorPayoutCents).toBe(85000);

    const { json } = await req("GET", `/sponsors/deals/${dealId}`);
    expect(json.deal.status).toBe("paid");
    expect(json.deal.escrowStatus).toBe("released");
  });

  it("cannot start before funding, cannot complete before starting", async () => {
    const dealId = await setupFundedDeal();
    asUser(CREATOR);
    expect((await req("POST", `/sponsors/deals/${dealId}/start`)).status).toBe(409);
    expect((await req("POST", `/sponsors/deals/${dealId}/complete`)).status).toBe(409);
  });

  it("cannot release before the creator delivers", async () => {
    const dealId = await setupFundedDeal();
    const fund = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 100000 });
    await req("POST", "/sponsors/escrow/confirm", { dealId, sessionId: fund.json.sessionId });
    const { status } = await req("POST", `/sponsors/deals/${dealId}/release`);
    expect(status).toBe(409);
  });

  it("stranger cannot start/complete/release", async () => {
    const dealId = await setupFundedDeal();
    const fund = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 100000 });
    await req("POST", "/sponsors/escrow/confirm", { dealId, sessionId: fund.json.sessionId });
    asUser(STRANGER);
    expect((await req("POST", `/sponsors/deals/${dealId}/start`)).status).toBe(403);
    expect((await req("POST", `/sponsors/deals/${dealId}/complete`)).status).toBe(403);
    expect((await req("POST", `/sponsors/deals/${dealId}/release`)).status).toBe(403);
  });
});

describe("dashboard", () => {
  it("returns posted deals, applications, payouts and earnings", async () => {
    const dealId = await seedDeal();
    const appId = await seedApplication(dealId, CREATOR);
    await req("PATCH", `/sponsors/applications/${appId}`, { action: "accept", agreedAmountCents: 100000 });
    const fund = await req("POST", `/sponsors/deals/${dealId}/fund`, { amountCents: 100000 });
    await req("POST", "/sponsors/escrow/confirm", { dealId, sessionId: fund.json.sessionId });
    asUser(CREATOR);
    await req("POST", `/sponsors/deals/${dealId}/start`);
    await req("POST", `/sponsors/deals/${dealId}/complete`);
    asUser(BRAND);
    await req("POST", `/sponsors/deals/${dealId}/release`);

    /* brand view */
    const { status, json } = await req("GET", "/sponsors/dashboard");
    expect(status).toBe(200);
    expect(json.postedDeals).toHaveLength(1);
    expect(json.postedDeals[0].status).toBe("paid");
    expect(json.applications).toHaveLength(0);

    /* creator view */
    asUser(CREATOR);
    const creatorView = await req("GET", "/sponsors/dashboard");
    expect(creatorView.json.applications).toHaveLength(1);
    expect(creatorView.json.applications[0].application_status).toBe("accepted");
    expect(creatorView.json.payouts).toHaveLength(1);
    expect(creatorView.json.payouts[0].net_cents).toBe(85000);
    expect(creatorView.json.totalEarnedCents).toBe(85000);
  });
});
