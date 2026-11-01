/**
 * Sponsor lifecycle fan-out (stack1100 Y3). The whole escrow lifecycle
 * used to run with zero notifications. These tests pin the new tells:
 * each fires through the sponsor seam exactly once, on the landed
 * transition only — replays and already-decided repeats stay silent —
 * and money copy names the amounts that actually moved. The door's
 * own preference gate is proven in the push suites.
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
  chargeCredits: vi.fn(async () => 1000),
  refundCredits: vi.fn(async () => undefined),
  canUseCredits: () => true,
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  CreditsDisabledError: class CreditsDisabledError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: { completions: { create: async () => ({ choices: [{ message: { content: "{}" } }] }) } },
  }),
  getTextModel: () => "gpt-6-sol-test",
}));

import router, {
  __setSponsorEventNotifier,
  buildSponsorEvent,
  markEscrowFunded,
} from "../sponsors";
import type { UserEventInput } from "../../../lib/push-events";
import { createTestDb } from "../../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

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
  target_creator_user_id text,
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
const CREATOR2 = randomUUID();

let events: UserEventInput[];

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  __setSponsorEventNotifier(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.none(DDL);
  testState.db = db;
  testState.userId = BRAND;
  events = [];
  __setSponsorEventNotifier(async (input) => {
    events.push(input);
  });
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

async function seedDeal(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  await testState.db.execute(sql`
    INSERT INTO sponsor_deals (id, brand_name, budget_min, budget_max, niche, deliverables, description, deadline, posted_by, status, escrow_status, accepted_user_id, agreed_amount_cents)
    VALUES (${id}, 'Golden Audio', 500, 2000, 'Music', '1 TikTok', 'Headphones.', now(), ${BRAND},
            ${String(overrides["status"] ?? "active")}, ${String(overrides["escrow_status"] ?? "unfunded")},
            ${overrides["accepted_user_id"] ? String(overrides["accepted_user_id"]) : null},
            ${overrides["agreed_amount_cents"] ? Number(overrides["agreed_amount_cents"]) : null})
  `);
  return id;
}

async function seedApplication(dealId: string, userId: string) {
  const id = randomUUID();
  await testState.db.execute(sql`
    INSERT INTO sponsor_applications (id, deal_id, user_id, pitch, status)
    VALUES (${id}, ${dealId}, ${userId}, 'Pick me.', 'pending')
  `);
  return id;
}

describe("buildSponsorEvent", () => {
  it("builds a money event deep-linked to the deal", () => {
    expect(buildSponsorEvent({ userId: "u", dealId: "d1", kind: "k", title: "t", body: "b" })).toEqual({
      userId: "u",
      category: "money",
      kind: "k",
      title: "t",
      body: "b",
      link: "/sponsors/d1",
    });
  });
});

describe("apply → brand", () => {
  it("fires once on the landed application; a duplicate apply stays silent", async () => {
    const dealId = await seedDeal();
    testState.userId = CREATOR;
    const first = await req("POST", `/sponsors/deals/${dealId}/apply`, { pitch: "I love these headphones." });
    expect(first.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: BRAND, kind: "sponsor_application", category: "money", link: `/sponsors/${dealId}` });

    const dup = await req("POST", `/sponsors/deals/${dealId}/apply`, { pitch: "Again." });
    expect(dup.status).toBe(409);
    expect(events).toHaveLength(1);
  });
});

describe("review → creator", () => {
  it("reject tells the creator once; a repeat review is a silent 409", async () => {
    const dealId = await seedDeal();
    const appId = await seedApplication(dealId, CREATOR);
    testState.userId = BRAND;
    const r1 = await req("PATCH", `/sponsors/applications/${appId}`, { action: "reject" });
    expect(r1.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: CREATOR, kind: "sponsor_application_rejected" });

    const r2 = await req("PATCH", `/sponsors/applications/${appId}`, { action: "reject" });
    expect(r2.status).toBe(409);
    expect(events).toHaveLength(1);
  });

  it("accept tells the winner the agreed payout and tells the auto-rejected loser — once each", async () => {
    const dealId = await seedDeal();
    const winnerApp = await seedApplication(dealId, CREATOR);
    await seedApplication(dealId, CREATOR2);
    testState.userId = BRAND;
    const r = await req("PATCH", `/sponsors/applications/${winnerApp}`, { action: "accept", agreedAmountCents: 1000_00 });
    expect(r.status).toBe(200);
    const accepted = events.filter((e) => e.kind === "sponsor_application_accepted");
    const rejected = events.filter((e) => e.kind === "sponsor_application_rejected");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.userId).toBe(CREATOR);
    expect(accepted[0]!.body).toContain("$1,000.00");
    expect(accepted[0]!.body).toContain("Golden Audio");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.userId).toBe(CREATOR2);
  });
});

describe("escrow funded → creator", () => {
  it("markEscrowFunded tells once; the webhook replay returns already-funded and stays silent", async () => {
    const dealId = await seedDeal({ accepted_user_id: CREATOR, agreed_amount_cents: 100_00, escrow_status: "funding" });
    const first = await markEscrowFunded(dealId, "cs_test_1", "pi_test_1");
    expect(first).toEqual({ ok: true });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: CREATOR, kind: "sponsor_escrow_funded" });
    expect(events[0]!.body).toContain("$100.00");

    const replay = await markEscrowFunded(dealId, "cs_test_1", "pi_test_1");
    expect(replay).toEqual({ ok: true, reason: "already-funded" });
    expect(events).toHaveLength(1);
  });
});

describe("complete → brand, release → creator", () => {
  it("complete fires once on the flip; a repeat complete is a silent 409", async () => {
    const dealId = await seedDeal({ status: "in_progress", escrow_status: "funded", accepted_user_id: CREATOR, agreed_amount_cents: 100_00 });
    testState.userId = CREATOR;
    const c1 = await req("POST", `/sponsors/deals/${dealId}/complete`);
    expect(c1.status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: BRAND, kind: "sponsor_deal_completed" });
    const c2 = await req("POST", `/sponsors/deals/${dealId}/complete`);
    expect(c2.status).toBe(409);
    expect(events).toHaveLength(1);
  });

  it("release tells the creator the NET that landed (85% after the 15% fee)", async () => {
    const dealId = await seedDeal({ status: "completed", escrow_status: "funded", accepted_user_id: CREATOR, agreed_amount_cents: 100_00 });
    testState.userId = BRAND;
    const r = await req("POST", `/sponsors/deals/${dealId}/release`);
    expect(r.status).toBe(200);
    expect(r.json.creatorPayoutCents).toBe(85_00);
    const released = events.filter((e) => e.kind === "sponsor_payment_released");
    expect(released).toHaveLength(1);
    expect(released[0]!.userId).toBe(CREATOR);
    expect(released[0]!.body).toContain("$85.00");
  });
});

describe("notifySponsorEscrowReversed", () => {
  it("tells the accepted creator the escrow emptied", async () => {
    const { notifySponsorEscrowReversed } = await import("../sponsors");
    const dealId = await seedDeal({ accepted_user_id: CREATOR, escrow_status: "unfunded" });
    await notifySponsorEscrowReversed(dealId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: CREATOR, kind: "sponsor_escrow_reversed" });
  });
});
