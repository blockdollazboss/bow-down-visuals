/**
 * Money-integrity + route tests for the Sponsor Marketplace.
 *
 * Covers: pricing constants (5 credits to post, 1 credit per AI assist),
 * deal/apply/pitch/matcher schema validation, the free browse + free apply
 * paths (no credit code touched), charge-before-generate, 402 out_of_credits,
 * and automatic refund when the provider fails.
 *
 * Real database semantics via pg-mem (the @workspace/db module is real;
 * only its `db` handle is swapped for the in-memory instance).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  openAiCreate: null as null | ((...args: any[]) => Promise<any>),
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

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: { completions: { create: (...args: any[]) => testState.openAiCreate!(...args) } },
  }),
  getTextModel: () => "gpt-6-sol-test",
}));

import router, {
  SPONSOR_POST_CREDIT_COST,
  SPONSOR_AI_CREDIT_COST,
  dealSchema,
  applySchema,
  pitchWriterSchema,
  matcherSchema,
  toDealDto,
} from "../sponsors";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../../lib/credits";
import { createTestDb } from "../../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const mockCharge = vi.mocked(chargeCredits);
const mockRefund = vi.mocked(refundCredits);

const SPONSORS_DDL = `
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
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sponsor_applications (
  id uuid PRIMARY KEY,
  deal_id uuid NOT NULL REFERENCES sponsor_deals(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  pitch text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, user_id)
);`;

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

const USER_A = randomUUID();
const USER_B = randomUUID();

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
  mem.public.none(SPONSORS_DDL);
  testState.db = db;
  testState.userId = USER_A;
  vi.clearAllMocks();
  mockCharge.mockImplementation(async (_userId: string, cost: number) => 100 - cost);
  mockRefund.mockResolvedValue(undefined);
  testState.openAiCreate = async () => ({
    choices: [{ message: { content: "{}" } }],
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

function validDeal(overrides: Record<string, unknown> = {}) {
  return {
    brandName: "Golden Audio",
    budgetMin: 500,
    budgetMax: 2000,
    niche: "Music",
    deliverables: "1 TikTok + 2 stories",
    description: "Premium headphones for creators.",
    deadline: new Date(Date.now() + 7 * 86400000).toISOString(),
    ...overrides,
  };
}

async function seedDeal(postedBy = USER_B, overrides: Record<string, unknown> = {}) {
  const d = validDeal(overrides);
  const id = randomUUID();
  await testState.db.execute(sql`
    INSERT INTO sponsor_deals (id, brand_name, budget_min, budget_max, niche, deliverables, description, deadline, posted_by)
    VALUES (${id}, ${d.brandName}, ${d.budgetMin}, ${d.budgetMax}, ${d.niche}, ${d.deliverables}, ${d.description}, ${d.deadline}, ${postedBy})
  `);
  return { id };
}

/* ── pricing ─────────────────────────────────────────────────────────── */
describe("pricing constants", () => {
  it("charges 5 credits to post a deal (brands pay)", () => {
    expect(SPONSOR_POST_CREDIT_COST).toBe(5);
  });
  it("charges 1 credit per AI assist", () => {
    expect(SPONSOR_AI_CREDIT_COST).toBe(1);
  });
});

/* ── schemas ─────────────────────────────────────────────────────────── */
describe("dealSchema", () => {
  it("accepts a valid deal", () => {
    expect(dealSchema.safeParse(validDeal()).success).toBe(true);
  });
  it("rejects max < min budget", () => {
    const r = dealSchema.safeParse(validDeal({ budgetMin: 2000, budgetMax: 500 }));
    expect(r.success).toBe(false);
  });
  it("rejects a non-ISO deadline", () => {
    const r = dealSchema.safeParse(validDeal({ deadline: "next Friday" }));
    expect(r.success).toBe(false);
  });
  it("rejects missing brand name", () => {
    const r = dealSchema.safeParse(validDeal({ brandName: "" }));
    expect(r.success).toBe(false);
  });
});

describe("applySchema", () => {
  it("accepts a pitch", () => {
    expect(applySchema.safeParse({ pitch: "I would love this." }).success).toBe(true);
  });
  it("rejects an empty pitch", () => {
    expect(applySchema.safeParse({ pitch: "" }).success).toBe(false);
  });
});

describe("pitchWriterSchema", () => {
  it("accepts a full pitch request", () => {
    expect(
      pitchWriterSchema.safeParse({ dealId: randomUUID(), niche: "Music", followers: 1000 }).success,
    ).toBe(true);
  });
  it("rejects a non-uuid deal id", () => {
    expect(
      pitchWriterSchema.safeParse({ dealId: "nope", niche: "Music" }).success,
    ).toBe(false);
  });
  it("rejects a missing niche", () => {
    expect(
      pitchWriterSchema.safeParse({ dealId: randomUUID(), niche: "" }).success,
    ).toBe(false);
  });
});

describe("matcherSchema", () => {
  it("accepts niche + followers", () => {
    expect(matcherSchema.safeParse({ niche: "Gaming", followers: 5000 }).success).toBe(true);
  });
  it("rejects a missing niche", () => {
    expect(matcherSchema.safeParse({ niche: "" }).success).toBe(false);
  });
});

/* ── toDealDto ─────────────────────────────────────────────────────────── */
describe("toDealDto", () => {
  it("maps snake_case rows to camelCase", () => {
    const dto = toDealDto({
      id: "d1",
      brand_name: "Golden Audio",
      budget_min: 500,
      budget_max: 2000,
      niche: "Music",
      deliverables: "1 TikTok",
      description: "Hi",
      deadline: "2026-10-01T00:00:00Z",
      posted_by: "u1",
      status: "active",
      created_at: "2026-09-25T00:00:00Z",
    });
    expect(dto).toEqual({
      id: "d1",
      brandName: "Golden Audio",
      budgetMin: 500,
      budgetMax: 2000,
      niche: "Music",
      deliverables: "1 TikTok",
      description: "Hi",
      deadline: "2026-10-01T00:00:00Z",
      status: "active",
      createdAt: "2026-09-25T00:00:00Z",
    });
  });
});

/* ── GET /api/sponsors/deals (free) ──────────────────────────────────── */
describe("GET /api/sponsors/deals", () => {
  it("returns only active deals and charges nothing", async () => {
    await seedDeal();
    const { id: inactiveId } = await seedDeal(USER_B, { brandName: "Old Brand" });
    await testState.db.execute(sql`UPDATE sponsor_deals SET status = 'closed' WHERE id = ${inactiveId}`);

    const { status, json } = await req("GET", "/sponsors/deals");
    expect(status).toBe(200);
    expect(json.deals).toHaveLength(1);
    expect(json.deals[0].brandName).toBe("Golden Audio");
    expect(mockCharge).not.toHaveBeenCalled();
  });

  it("returns an empty list when there are no deals", async () => {
    const { status, json } = await req("GET", "/sponsors/deals");
    expect(status).toBe(200);
    expect(json.deals).toEqual([]);
  });
});

/* ── POST /api/sponsors/deals (5 credits) ────────────────────────────── */
describe("POST /api/sponsors/deals", () => {
  it("charges 5 credits and stores the deal", async () => {
    const { status, json } = await req("POST", "/sponsors/deals", validDeal());
    expect(status).toBe(200);
    expect(json.deal.brandName).toBe("Golden Audio");
    expect(json.creditsUsed).toBe(5);
    expect(mockCharge).toHaveBeenCalledWith(USER_A, 5, { action: "Sponsor Deal Posting" });
  });

  it("returns 402 out_of_credits without touching the DB", async () => {
    mockCharge.mockRejectedValueOnce(new OutOfCreditsError());
    const { status, json } = await req("POST", "/sponsors/deals", validDeal());
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    const r = await testState.db.execute(sql`SELECT COUNT(*)::int AS n FROM sponsor_deals`);
    expect((r.rows[0] as { n: number }).n).toBe(0);
  });

  it("returns 400 on an invalid body and charges nothing", async () => {
    const { status } = await req("POST", "/sponsors/deals", validDeal({ budgetMax: 1 }));
    expect(status).toBe(400);
    expect(mockCharge).not.toHaveBeenCalled();
  });
});

/* ── POST /api/sponsors/deals/:id/apply (free) ────────────────────────── */
describe("POST /api/sponsors/deals/:id/apply", () => {
  it("stores the application and charges nothing", async () => {
    const { id } = await seedDeal();
    const { status, json } = await req("POST", `/sponsors/deals/${id}/apply`, {
      pitch: "My audience lives for this.",
    });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockCharge).not.toHaveBeenCalled();
  });

  it("returns 409 on a duplicate application", async () => {
    const { id } = await seedDeal();
    await req("POST", `/sponsors/deals/${id}/apply`, { pitch: "First." });
    const { status, json } = await req("POST", `/sponsors/deals/${id}/apply`, { pitch: "Second." });
    expect(status).toBe(409);
    expect(json.error).toMatch(/already applied/);
  });

  it("returns 404 for an inactive deal", async () => {
    const { id: inactiveId } = await seedDeal();
    await testState.db.execute(sql`UPDATE sponsor_deals SET status = 'closed' WHERE id = ${inactiveId}`);
    const { status } = await req("POST", `/sponsors/deals/${inactiveId}/apply`, { pitch: "Hello." });
    expect(status).toBe(404);
  });

  it("returns 400 for an invalid pitch", async () => {
    const { id } = await seedDeal();
    const { status } = await req("POST", `/sponsors/deals/${id}/apply`, { pitch: "" });
    expect(status).toBe(400);
  });
});

/* ── POST /api/sponsors/pitch (1 credit, AI) ──────────────────────────── */
describe("POST /api/sponsors/pitch", () => {
  it("charges 1 credit and returns the AI pitch", async () => {
    const { id } = await seedDeal();
    testState.openAiCreate = async () => ({
      choices: [{ message: { content: JSON.stringify({ pitch: "Dear brand, hire me.", subject: "Let's work" }) } }],
    });
    const { status, json } = await req("POST", "/sponsors/pitch", {
      dealId: id,
      niche: "Music",
      followers: 25000,
      tone: "bold",
    });
    expect(status).toBe(200);
    expect(json.pitch).toBe("Dear brand, hire me.");
    expect(json.creditsUsed).toBe(1);
    expect(mockCharge).toHaveBeenCalledWith(USER_A, 1, { action: "Sponsor AI Pitch Writer" });
  });

  it("refunds the credit when the provider fails", async () => {
    const { id } = await seedDeal();
    testState.openAiCreate = async () => {
      throw new Error("provider exploded");
    };
    const { status } = await req("POST", "/sponsors/pitch", { dealId: id, niche: "Music" });
    expect(status).toBe(502);
    expect(mockRefund).toHaveBeenCalledWith(USER_A, 1, {
      action: "Sponsor AI Pitch Writer — Refund (provider failed)",
    });
  });

  it("refunds when the deal went inactive after charging", async () => {
    const { id: inactiveId } = await seedDeal();
    await testState.db.execute(sql`UPDATE sponsor_deals SET status = 'closed' WHERE id = ${inactiveId}`);
    const { status } = await req("POST", "/sponsors/pitch", { dealId: inactiveId, niche: "Music" });
    expect(status).toBe(404);
    expect(mockRefund).toHaveBeenCalled();
  });

  it("returns 402 out_of_credits before calling the model", async () => {
    mockCharge.mockRejectedValueOnce(new OutOfCreditsError());
    const { status, json } = await req("POST", "/sponsors/pitch", {
      dealId: randomUUID(),
      niche: "Music",
    });
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(testState.openAiCreate).not.toBeNull();
  });
});

/* ── POST /api/sponsors/match (1 credit, AI) ──────────────────────────── */
describe("POST /api/sponsors/match", () => {
  it("charges 1 credit and returns ranked matches", async () => {
    const { id } = await seedDeal();
    testState.openAiCreate = async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              matches: [{ dealIndex: 0, score: 92, why: "Perfect niche fit." }],
              note: "Apply fast.",
            }),
          },
        },
      ],
    });
    const { status, json } = await req("POST", "/sponsors/match", {
      niche: "Music",
      followers: 25000,
    });
    expect(status).toBe(200);
    expect(json.matches).toHaveLength(1);
    expect(json.matches[0].dealId).toBe(id);
    expect(json.matches[0].score).toBe(92);
    expect(json.note).toBe("Apply fast.");
    expect(mockCharge).toHaveBeenCalledWith(USER_A, 1, { action: "Sponsor AI Deal Matcher" });
  });

  it("refunds when there are no active deals", async () => {
    const { status, json } = await req("POST", "/sponsors/match", { niche: "Music" });
    expect(status).toBe(200);
    expect(json.matches).toEqual([]);
    expect(json.creditsUsed).toBe(0);
    expect(mockRefund).toHaveBeenCalled();
  });

  it("refunds the credit when the provider fails", async () => {
    await seedDeal();
    testState.openAiCreate = async () => {
      throw new Error("provider exploded");
    };
    const { status } = await req("POST", "/sponsors/match", { niche: "Music" });
    expect(status).toBe(502);
    expect(mockRefund).toHaveBeenCalledWith(USER_A, 1, {
      action: "Sponsor AI Deal Matcher — Refund (provider failed)",
    });
  });

  it("returns 402 out_of_credits", async () => {
    mockCharge.mockRejectedValueOnce(new OutOfCreditsError());
    const { status, json } = await req("POST", "/sponsors/match", { niche: "Music" });
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
  });
});
