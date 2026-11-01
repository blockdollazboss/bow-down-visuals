/**
 * Gate #5 (part 5, step 4) reproduction — sponsor deal detail + dashboard
 * load failure on the LIVE stack1000 build.
 *
 * Symptom (live, both accounts, SPA + direct navigation): a freshly posted
 * deal is visible in the /brand-deals marketplace, but GET
 * /api/sponsors/deals/:id answers 500 "Could not load the deal — try
 * again." and GET /api/sponsors/dashboard answers 500 "Could not load your
 * dashboard — try again.", so no Apply/Accept control is ever reachable.
 *
 * Root cause (proven below): the read paths query sponsor_applications
 * columns `status`, `portfolio_url`, `decided_at`. Those columns exist
 * ONLY in migration 0033_sponsor_escrow.sql. The boot runner
 * (lib/db/migrate-boot.mjs) NEVER applies files <= BASELINE (55) to a
 * non-fresh database — it trusts they were "applied manually pre-runner".
 * The one heal file for skipped pre-baseline changes, 0069, re-applied
 * 0033's sponsor_deals columns and the sponsor_payouts table but OMITTED
 * sponsor_applications. So production's sponsor_applications still has its
 * 0010 shape (id, deal_id, user_id, pitch, created_at) and every query
 * naming the 0033 columns throws.
 *
 * Why the marketplace still worked: POST /sponsors/deals and GET
 * /sponsors/deals touch only base sponsor_deals columns.
 *
 * This file builds the database in exactly that production shape
 * (sponsor_deals WITH the 0069-healed escrow columns, sponsor_payouts
 * present, sponsor_applications in its 0010 shape) and drives the REAL
 * routers:
 *   Suite 1 reproduces the gate failure (post/list fine, detail/dashboard
 *   500) on the un-healed shape.
 *   Suite 2 applies migration 0307 (the fix) to the same shape and proves
 *   poster-loads, creator-loads + apply, poster-only application review,
 *   accept, and dashboard-loads all work, with escrow internals still
 *   hidden from non-participants.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  db: null as any,
  mem: null as any,
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
  chargeCredits: vi.fn(async () => 9999),
  refundCredits: vi.fn(async () => undefined),
  canUseCredits: vi.fn(async () => true),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  CreditsDisabledError: class CreditsDisabledError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

/* The public API rate limiter (30 req/min/IP) would throttle this file's
   sequential localhost requests — bypass it in tests like require-auth. */
vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

import router from "../sponsors";
import { createTestDb } from "../../../lib/__tests__/test-db";

/* Production shape: sponsor_deals as healed by 0069 (base + 0033 escrow
   columns), sponsor_payouts as created by 0033/0069, and
   sponsor_applications in its 0010 shape — NO status / portfolio_url /
   decided_at, because no applied migration ever added them. */
const PROD_SHAPE_DDL = `
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

const MIGRATION_0307 = readFileSync(
  fileURLToPath(
    new URL("../../../../../../lib/db/migrations/0307_sponsor_applications_escrow_columns.sql", import.meta.url),
  ),
  "utf8",
);

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

function freshDb(heal: boolean) {
  const { db, mem } = createTestDb();
  mem.public.none(PROD_SHAPE_DDL);
  if (heal) mem.public.none(MIGRATION_0307);
  testState.db = db;
  testState.mem = mem;
  testState.userId = BRAND;
}

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

const DEAL_BODY = {
  brandName: "Gate Five Energy",
  budgetMin: 50 /* dollars — the Gate #5 deal was a $50 deal */,
  budgetMax: 50,
  niche: "Music",
  deliverables: "1 sponsored post",
  description: "$50 sponsor deal posted by the Gate #5 test.",
  deadline: new Date("2027-02-01").toISOString(),
};

async function postDeal(): Promise<string> {
  asUser(BRAND);
  const { status, json } = await req("POST", "/sponsors/deals", DEAL_BODY);
  expect(status).toBe(200);
  return json.deal.id as string;
}

describe("Gate #5 reproduction — production-shaped schema, before the heal", () => {
  beforeEach(() => freshDb(false));

  it("posting and marketplace browse work (base columns only)", async () => {
    const dealId = await postDeal();
    asUser(CREATOR);
    const list = await req("GET", "/sponsors/deals");
    expect(list.status).toBe(200);
    expect(list.json.deals.map((d: any) => d.id)).toContain(dealId);
  });

  it("deal detail fails to load for the poster — the gate failure", async () => {
    const dealId = await postDeal();
    asUser(BRAND);
    const { status, json } = await req("GET", `/sponsors/deals/${dealId}`);
    expect(status).toBe(500);
    expect(json.error).toBe("Could not load the deal — try again.");
  });

  it("deal detail fails to load for another signed-in creator too", async () => {
    const dealId = await postDeal();
    asUser(CREATOR);
    const { status } = await req("GET", `/sponsors/deals/${dealId}`);
    expect(status).toBe(500);
  });

  it("the sponsor dashboard fails to load its data", async () => {
    await postDeal();
    asUser(BRAND);
    const { status, json } = await req("GET", "/sponsors/dashboard");
    expect(status).toBe(500);
    expect(json.error).toBe("Could not load your dashboard — try again.");
  });
});

describe("after migration 0307 heals sponsor_applications", () => {
  beforeEach(() => freshDb(true));

  it("poster loads the deal detail", async () => {
    const dealId = await postDeal();
    asUser(BRAND);
    const { status, json } = await req("GET", `/sponsors/deals/${dealId}`);
    expect(status).toBe(200);
    expect(json.deal.id).toBe(dealId);
    expect(json.deal.brandName).toBe(DEAL_BODY.brandName);
    expect(json.deal.postedBy).toBe(BRAND);
    expect(json.deal.applicationCount).toBe(0);
    expect(json.deal.escrowStatus).toBe("unfunded");
  });

  it("an eligible creator loads the deal and can apply; escrow internals stay hidden", async () => {
    const dealId = await postDeal();
    asUser(CREATOR);
    const detail = await req("GET", `/sponsors/deals/${dealId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.deal.myApplicationStatus).toBeNull();
    /* Non-participant: no escrow internals. */
    expect(detail.json.deal.platformFeeCents).toBeNull();
    expect(detail.json.deal.creatorPayoutCents).toBeNull();

    const applied = await req("POST", `/sponsors/deals/${dealId}/apply`, {
      pitch: "I will make the post land.",
      portfolioUrl: "",
    });
    expect(applied.status).toBe(200);

    const after = await req("GET", `/sponsors/deals/${dealId}`);
    expect(after.json.deal.myApplicationStatus).toBe("pending");
    expect(after.json.deal.applicationCount).toBe(1);
  });

  it("application review is poster-only — a stranger gets an honest refusal", async () => {
    const dealId = await postDeal();
    asUser(CREATOR);
    await req("POST", `/sponsors/deals/${dealId}/apply`, { pitch: "Pick me.", portfolioUrl: "" });

    asUser(STRANGER);
    const refused = await req("GET", `/sponsors/deals/${dealId}/applications`);
    expect(refused.status).toBe(403);
    expect(refused.json.error).toMatch(/Only the brand that posted this deal/);

    asUser(BRAND);
    const mine = await req("GET", `/sponsors/deals/${dealId}/applications`);
    expect(mine.status).toBe(200);
    expect(mine.json.applications).toHaveLength(1);
    expect(mine.json.applications[0].user_id).toBe(CREATOR);
    expect(mine.json.applications[0].status).toBe("pending");
  });

  it("poster can accept the application — the escrow flow can start", async () => {
    const dealId = await postDeal();
    asUser(CREATOR);
    await req("POST", `/sponsors/deals/${dealId}/apply`, { pitch: "Pick me.", portfolioUrl: "" });
    asUser(BRAND);
    const apps = await req("GET", `/sponsors/deals/${dealId}/applications`);
    const appId = apps.json.applications[0].id;

    const accepted = await req("PATCH", `/sponsors/applications/${appId}`, {
      action: "accept",
      agreedAmountCents: 5000,
    });
    expect(accepted.status).toBe(200);

    const detail = await req("GET", `/sponsors/deals/${dealId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.deal.acceptedUserId).toBe(CREATOR);
    expect(detail.json.deal.agreedAmountCents).toBe(5000);
  });

  it("the dashboard loads its real numbers for both parties", async () => {
    const dealId = await postDeal();

    asUser(BRAND);
    const brandDash = await req("GET", "/sponsors/dashboard");
    expect(brandDash.status).toBe(200);
    expect(brandDash.json.postedDeals.map((d: any) => d.id)).toContain(dealId);
    expect(brandDash.json.totalEarnedCents).toBe(0);

    asUser(CREATOR);
    await req("POST", `/sponsors/deals/${dealId}/apply`, { pitch: "Pick me.", portfolioUrl: "" });
    const creatorDash = await req("GET", "/sponsors/dashboard");
    expect(creatorDash.status).toBe(200);
    expect(creatorDash.json.applications).toHaveLength(1);
    expect(creatorDash.json.applications[0].application_status).toBe("pending");
    expect(creatorDash.json.applications[0].brand_name).toBe(DEAL_BODY.brandName);
  });

  it("a nonexistent deal still answers an honest 404, and a malformed id a 400", async () => {
    asUser(BRAND);
    expect((await req("GET", `/sponsors/deals/${randomUUID()}`)).status).toBe(404);
    expect((await req("GET", "/sponsors/deals/nope")).status).toBe(400);
  });
});
