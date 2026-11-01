/**
 * royalties-payout-notice.test.ts — email-trigger truth (stack1100 Y6).
 *
 * The "Payout received" email is a transition notice: it may fire when
 * a payout ARRIVES in "received" (recorded that way, or edited into
 * that status) — never when an already-received payout is merely
 * edited. Before the fix, every save of a received payout re-sent the
 * email ("your payout just landed" for a typo fix). These tests drive
 * the real POST /royalties/payouts route over pg-mem with a recording
 * mail stub and pin the transition gate.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = randomUUID();

const testState = vi.hoisted(() => ({ db: null as any }));
const mail = vi.hoisted(() => ({ sends: [] as Array<Record<string, any>> }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});

vi.mock("../../../lib/email", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    isEmailConfigured: () => true,
    sendEmail: vi.fn(async (opts: Record<string, any>) => {
      mail.sends.push(opts);
      return { sent: true, id: "msg_test" };
    }),
  };
});

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER;
    req.userEmail = "creator@x.com";
    req.userCredits = 0;
    next();
  },
}));

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 0),
  refundCredits: vi.fn(async () => {}),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: () => null,
  getTextModel: () => "test-model",
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

import royaltiesRouter from "../royalties";
import { createTestDb } from "../../../lib/__tests__/test-db";

const DDL = `
CREATE TABLE royalty_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  distributor text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  expected_amount numeric(12,2) NOT NULL DEFAULT 0,
  received_amount numeric(12,2),
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'expected',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`;

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  testState.db = db;
  const app = express();
  app.use(express.json());
  app.use("/api", royaltiesRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  mail.sends = [];
});

async function postPayout(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/royalties/payouts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

const basePayout = {
  distributor: "DistroKid",
  period_start: "2026-09-01",
  period_end: "2026-09-30",
  expected_amount: "100.00",
  currency: "USD",
};

describe("payout-received email trigger", () => {
  it("fires once when a payout is recorded as received", async () => {
    const r = await postPayout({ ...basePayout, status: "received", received_amount: "100.00" });
    expect(r.status).toBe(200);
    expect(mail.sends).toHaveLength(1);
    expect(mail.sends[0]!.to).toBe("creator@x.com");
    expect(String(mail.sends[0]!.subject)).toContain("Payout received");
  });

  it("does NOT fire when a payout is recorded as still expected", async () => {
    const r = await postPayout({ ...basePayout, status: "expected" });
    expect(r.status).toBe(200);
    expect(mail.sends).toHaveLength(0);
  });

  it("does NOT re-fire when an already-received payout is edited", async () => {
    const created = await postPayout({ ...basePayout, status: "received", received_amount: "100.00", notes: "first" });
    expect(created.status).toBe(200);
    expect(mail.sends).toHaveLength(1);
    const id = created.json.payout.id as string;

    const edited = await postPayout({ ...basePayout, id, status: "received", received_amount: "100.00", notes: "typo fixed" });
    expect(edited.status).toBe(200);
    expect(mail.sends).toHaveLength(1); /* the edit is not an arrival */

    const editedAgain = await postPayout({ ...basePayout, id, status: "received", received_amount: "101.00", notes: "amount corrected" });
    expect(editedAgain.status).toBe(200);
    expect(mail.sends).toHaveLength(1);
  });

  it("fires when an edit transitions a payout INTO received", async () => {
    const created = await postPayout({ ...basePayout, status: "expected" });
    expect(created.status).toBe(200);
    expect(mail.sends).toHaveLength(0);
    const id = created.json.payout.id as string;

    const landed = await postPayout({ ...basePayout, id, status: "received", received_amount: "100.00" });
    expect(landed.status).toBe(200);
    expect(mail.sends).toHaveLength(1);
  });

  it("still 404s an update for a payout that does not exist", async () => {
    const r = await postPayout({ ...basePayout, id: randomUUID(), status: "received", received_amount: "1.00" });
    expect(r.status).toBe(404);
    expect(mail.sends).toHaveLength(0);
  });
});
