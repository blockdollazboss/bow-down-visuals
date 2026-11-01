/**
 * stack1200 — sponsor APPLY failure on the live staging build (stack1100).
 *
 * Symptom (live on staging, Nov 1 2026): a creator applying to a sponsor
 * deal fails every time — the FE shows the apply route's 500 body
 * "Could not send your application — try again." — and ZERO application
 * rows are created (deal page "Applications (0)", poster dashboard 0,
 * applicant dashboard "APPLICATIONS SENT 0"). Posting works, the deal
 * DETAIL page loads (the 0307 heal), dashboards load. Only apply fails.
 *
 * Root cause (proven by Suite 1 below, against the REAL router): the
 * apply insert is
 *   INSERT INTO sponsor_applications (...)
 *   ON CONFLICT (deal_id, user_id) DO NOTHING ...
 * Postgres needs a unique index/constraint on exactly (deal_id, user_id)
 * to arbitrate that clause; without one the statement throws SQLSTATE
 * 42P10 "there is no unique or exclusion constraint matching the ON
 * CONFLICT specification" and the route answers its catch-all 500.
 *
 * The arbiter exists ONLY in 0010's CREATE TABLE (UNIQUE (deal_id,
 * user_id)) — a CREATE TABLE IF NOT EXISTS, so it never lands on a
 * table that already exists — and the drizzle schema declared no such
 * unique, so any database whose sponsor_applications was built from the
 * schema (not by running 0010) carries every column but no arbiter.
 * The 0069 and 0307 heals never touched it.
 *
 * Why G5B's sponsors-deal-load suite missed this: its hand-written
 * "production shape" DDL copied the UNIQUE constraint from 0010 into
 * sponsor_applications, so its apply passed. The suites below use the
 * SCHEMA shape instead — every column the drizzle schema declares,
 * no unique on (deal_id, user_id):
 *   Suite 1 reproduces the live failure exactly (post 200, detail 200,
 *   apply 500 with the verbatim staging error body, zero rows).
 *   Suite 2 applies migration 0309 (the fix) to the same shape and
 *   proves the full path: apply lands, the duplicate guard answers an
 *   honest 409, the arbiter physically exists (a plain duplicate
 *   insert now violates (deal_id, user_id) uniqueness), the poster
 *   sees the pending application, and accept at the $50 budget keeps
 *   the escrow figures intact.
 *
 * Harness honesty note: pg-mem faithfully models the two halves this
 * bug turns on — with no arbiter it throws the real 42P10 (Suite 1),
 * and with the unique index present the ON CONFLICT statement is
 * accepted and lands (Suite 2). What pg-mem does NOT model is
 * conflict-time arbitration against an index (it returns the row
 * instead of DO NOTHING) — the sponsors.ts header already documents
 * pg-mem's "partial ON CONFLICT support", and on real Postgres a
 * unique index on the inference columns is exactly what ON CONFLICT
 * requires. The route's fast-path duplicate check covers the
 * duplicate case in every environment and is asserted directly.
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
import { sql } from "drizzle-orm";

/* Schema shape: sponsor_deals with the 0033 escrow columns + the 0274
   target column; sponsor_applications with EVERY column the drizzle
   schema declares (0010 base + 0033 workflow) — and NO unique on
   (deal_id, user_id), exactly as lib/db/src/schema/sponsor-deals.ts
   declared it before the stack1200 fix. */
const SCHEMA_SHAPE_DDL = `
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
  status text NOT NULL DEFAULT 'pending',
  portfolio_url text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
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

const MIGRATION_0309 = readFileSync(
  fileURLToPath(
    new URL("../../../../../../lib/db/migrations/0309_sponsor_applications_deal_user_unique.sql", import.meta.url),
  ),
  "utf8",
);

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

const BRAND = randomUUID();
const CREATOR = randomUUID();

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
  mem.public.none(SCHEMA_SHAPE_DDL);
  if (heal) mem.public.none(MIGRATION_0309);
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
  brandName: "TEST Brand — delete pre-launch",
  budgetMin: 50 /* dollars — the Gate #5 deal was a $50 deal */,
  budgetMax: 50,
  niche: "Music",
  deliverables: "1 sponsored post",
  description: "$50 sponsor deal posted by the staging Gate #5 re-run.",
  deadline: new Date("2026-12-31").toISOString(),
};

async function postDeal(): Promise<string> {
  asUser(BRAND);
  const { status, json } = await req("POST", "/sponsors/deals", DEAL_BODY);
  expect(status).toBe(200);
  return json.deal.id as string;
}

describe("staging reproduction — schema-shaped sponsor_applications, before the heal", () => {
  beforeEach(() => freshDb(false));

  it("posting and deal detail work — the live symptom split", async () => {
    const dealId = await postDeal();
    asUser(CREATOR);
    const detail = await req("GET", `/sponsors/deals/${dealId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.deal.applicationCount).toBe(0);
  });

  it("the raw apply statement throws the ON CONFLICT arbiter error", async () => {
    const dealId = await postDeal();
    let message = "";
    try {
      await testState.db.execute(sql`
        INSERT INTO sponsor_applications (id, deal_id, user_id, pitch, portfolio_url, status)
        VALUES (${randomUUID()}, ${dealId}, ${CREATOR}, 'pitch', ${null}, 'pending')
        ON CONFLICT (deal_id, user_id) DO NOTHING
        RETURNING id
      `);
    } catch (err) {
      /* drizzle wraps the driver error — the Postgres text lives on
         the cause chain. */
      let cur: unknown = err;
      const parts: string[] = [];
      while (cur) {
        parts.push(String((cur as Error)?.message ?? cur));
        cur = (cur as { cause?: unknown }).cause;
      }
      message = parts.join("\n");
    }
    expect(message).toContain("no unique or exclusion constraint matching the ON CONFLICT specification");
  });

  it("apply fails with the verbatim staging 500 and creates zero applications", async () => {
    const dealId = await postDeal();
    asUser(CREATOR);
    const applied = await req("POST", `/sponsors/deals/${dealId}/apply`, {
      pitch: "I will make the post land.",
      portfolioUrl: "",
    });
    expect(applied.status).toBe(500);
    expect(applied.json.error).toBe("Could not send your application — try again.");

    const detail = await req("GET", `/sponsors/deals/${dealId}`);
    expect(detail.json.deal.applicationCount).toBe(0);
    expect(detail.json.deal.myApplicationStatus).toBeNull();

    const dash = await req("GET", "/sponsors/dashboard");
    expect(dash.status).toBe(200);
    expect(dash.json.applications).toHaveLength(0);
  });
});

describe("after migration 0309 heals the (deal_id, user_id) arbiter", () => {
  beforeEach(() => freshDb(true));

  it("a creator applies end-to-end; poster sees the pending application", async () => {
    const dealId = await postDeal();
    asUser(CREATOR);
    const applied = await req("POST", `/sponsors/deals/${dealId}/apply`, {
      pitch: "I will make the post land.",
      portfolioUrl: "",
    });
    expect(applied.status).toBe(200);
    expect(applied.json.success).toBe(true);
    expect(applied.json.application.status).toBe("pending");
    expect(applied.json.application.user_id).toBe(CREATOR);

    const detail = await req("GET", `/sponsors/deals/${dealId}`);
    expect(detail.json.deal.applicationCount).toBe(1);
    expect(detail.json.deal.myApplicationStatus).toBe("pending");

    asUser(BRAND);
    const apps = await req("GET", `/sponsors/deals/${dealId}/applications`);
    expect(apps.status).toBe(200);
    expect(apps.json.applications).toHaveLength(1);
    expect(apps.json.applications[0].pitch).toBe("I will make the post land.");
    expect(apps.json.applications[0].status).toBe("pending");
  });

  it("a second apply answers an honest 409, not a 500", async () => {
    const dealId = await postDeal();
    asUser(CREATOR);
    const first = await req("POST", `/sponsors/deals/${dealId}/apply`, { pitch: "One.", portfolioUrl: "" });
    expect(first.status).toBe(200);
    const second = await req("POST", `/sponsors/deals/${dealId}/apply`, { pitch: "Two.", portfolioUrl: "" });
    expect(second.status).toBe(409);
    expect(second.json.error).toBe("You've already applied to this deal.");
  });

  it("after 0309 the (deal_id, user_id) uniqueness physically exists", async () => {
    const dealId = await postDeal();
    asUser(CREATOR);
    const applied = await req("POST", `/sponsors/deals/${dealId}/apply`, { pitch: "First.", portfolioUrl: "" });
    expect(applied.status).toBe(200);
    /* A plain duplicate insert (no ON CONFLICT, fresh id) must now be
       refused by the (deal_id, user_id) uniqueness 0309 created — the
       arbiter the apply statement names. pg-mem enforces this half
       faithfully (its error even keys on (deal_id, user_id)); the
       conflict-time DO NOTHING arbitration is the half it models
       partially — see the header note. */
    let message = "";
    try {
      await testState.db.execute(sql`
        INSERT INTO sponsor_applications (id, deal_id, user_id, pitch, portfolio_url, status)
        VALUES (${randomUUID()}, ${dealId}, ${CREATOR}, 'Duplicate.', ${null}, 'pending')
      `);
    } catch (err) {
      let cur: unknown = err;
      const parts: string[] = [];
      while (cur) {
        parts.push(String((cur as Error)?.message ?? cur));
        cur = (cur as { cause?: unknown }).cause;
      }
      message = parts.join("\n");
    }
    expect(message).toContain("duplicate key value violates unique constraint");
    expect(message).toContain("(deal_id,user_id)");
    const detail = await req("GET", `/sponsors/deals/${dealId}`);
    expect(detail.json.deal.applicationCount).toBe(1);
  });

  it("poster accepts at the $50 budget — escrow figures stay intact", async () => {
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
    expect(accepted.json.agreedAmountCents).toBe(5000);

    const detail = await req("GET", `/sponsors/deals/${dealId}`);
    expect(detail.status).toBe(200);
    expect(detail.json.deal.acceptedUserId).toBe(CREATOR);
    expect(detail.json.deal.agreedAmountCents).toBe(5000);
    expect(detail.json.deal.escrowStatus).toBe("unfunded");
  });

  it("migration 0309 is idempotent — applying it twice changes nothing", async () => {
    testState.mem.public.none(MIGRATION_0309);
    const dealId = await postDeal();
    asUser(CREATOR);
    const applied = await req("POST", `/sponsors/deals/${dealId}/apply`, { pitch: "Still works.", portfolioUrl: "" });
    expect(applied.status).toBe(200);
  });
});
