/**
 * stack1100 Lane Y2 — the resolve verb's route contract:
 * POST /api/admin/payment-reversals/:id/resolve.
 *
 * The money logic itself (conditional claim, engine legs, audit row,
 * exactly-once) is pinned against pg-mem in
 * lib/__tests__/payment-reversals-resolve.test.ts. This suite pins
 * the HTTP shell in the house bench pattern: guests 401, members 403,
 * ADMIN_EMAILS unset = fail-closed 403 for everyone, body validation
 * (a decision is required; a dismissal requires the admin's note),
 * and the outcome mapping (resolved / already_resolved → 200 with
 * the row + its recorded resolution, conflict → 409, missing → 404).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ADMIN_ID = "00000000-0000-4000-8000-0000000000a1";
const MEMBER_ID = "00000000-0000-4000-8000-0000000000a2";
const ADMIN_EMAIL = "king@example.test";
const MEMBER_EMAIL = "member@example.test";
const ROW_ID = "12345678-1234-4234-8234-123456789012";

const stub = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  resolveResult: null as any,
  getRow: null as any,
  listRows: [] as any[],
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(user);
    req.userEmail = req.headers["x-test-email"] ? String(req.headers["x-test-email"]) : undefined;
    next();
  },
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => {
    throw new Error("supabase must not be touched by the resolve route test");
  },
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: async () => undefined,
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
}));

vi.mock("../../lib/credits", () => ({
  getCreditBalance: async () => 0,
}));

vi.mock("../../lib/payment-reversals", () => ({
  resolvePaymentReversal: async (input: Record<string, unknown>) => {
    stub.calls.push(input);
    return stub.resolveResult;
  },
  getPaymentReversal: async () => stub.getRow,
  listPaymentReversals: async () => stub.listRows,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    operatorActions: actual.operatorActionsTable,
    operatorPendingActions: actual.operatorPendingActionsTable,
    artistVaults: actual.artistVaultsTable,
    spotlightInquiries: actual.spotlightInquiriesTable,
    contactMessages: actual.contactMessagesTable,
    dmcaReports: actual.dmcaReportsTable,
    contentReports: actual.contentReportsTable,
    posts: actual.postsTable,
    creatorProfiles: actual.creatorProfilesTable,
  });
  return { ...actual, db: fake.db };
});

import adminRouter from "../admin";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    next();
  });
  app.use("/api", adminRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  process.env["ADMIN_EMAILS"] = ADMIN_EMAIL;
  stub.calls = [];
  stub.resolveResult = null;
  stub.getRow = null;
  stub.listRows = [];
});

const ADMIN = { id: ADMIN_ID, email: ADMIN_EMAIL };
const MEMBER = { id: MEMBER_ID, email: MEMBER_EMAIL };

async function postResolve(
  who: { id: string; email: string } | undefined,
  id: string,
  body: unknown,
) {
  const res = await fetch(`${baseUrl}/api/admin/payment-reversals/${id}/resolve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(who ? { "x-test-user": who.id, "x-test-email": who.email } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

const RESOLVED_ROW = {
  id: ROW_ID,
  stripe_event_id: "evt_1",
  stripe_charge_id: "ch_1",
  stripe_payment_intent_id: "pi_1",
  trigger: "charge.refunded",
  rail: "sponsor_deal",
  user_id: null,
  session_id: "cs_1",
  granted_credits: 0,
  credits_clawed: 0,
  referral_credits_clawed: 0,
  refunded_cents_seen: 5000,
  charge_amount_cents: 5000,
  dispute_lost: false,
  entitlement_revoked: true,
  seller_reversed: true,
  shortfall_credits: 0,
  status: "completed",
  details: {},
  created_at: "2026-11-01T00:00:00.000Z",
  updated_at: "2026-11-01T01:00:00.000Z",
  resolution_id: "res-1",
  resolution_decision: "complete",
  resolution_admin_user_id: ADMIN_ID,
  resolution_admin_email: ADMIN_EMAIL,
  resolution_note: "Reconciled.",
  resolution_created_at: "2026-11-01T01:00:00.000Z",
};

describe("POST /api/admin/payment-reversals/:id/resolve", () => {
  it("guests 401, members 403, unset allowlist 403 for everyone (fail-closed)", async () => {
    expect((await postResolve(undefined, ROW_ID, { decision: "complete" })).status).toBe(401);
    expect((await postResolve(MEMBER, ROW_ID, { decision: "complete" })).status).toBe(403);
    delete process.env["ADMIN_EMAILS"];
    expect((await postResolve(ADMIN, ROW_ID, { decision: "complete" })).status).toBe(403);
    expect(stub.calls).toHaveLength(0);
  });

  it("validates the body: a real decision is required, and a dismissal requires the note", async () => {
    expect((await postResolve(ADMIN, ROW_ID, {})).status).toBe(400);
    expect((await postResolve(ADMIN, ROW_ID, { decision: "maybe" })).status).toBe(400);
    const noNote = await postResolve(ADMIN, ROW_ID, { decision: "dismiss" });
    expect(noNote.status).toBe(400);
    expect(noNote.json.error).toMatch(/note is required/i);
    expect(stub.calls).toHaveLength(0);
  });

  it("a malformed id is a 404, never a query", async () => {
    expect((await postResolve(ADMIN, "not-a-uuid", { decision: "complete" })).status).toBe(404);
    expect(stub.calls).toHaveLength(0);
  });

  it("complete: the verb receives the admin identity + note, and the answer carries the recorded resolution", async () => {
    stub.resolveResult = { outcome: "resolved", row: {}, resolution: {} };
    stub.getRow = RESOLVED_ROW;
    const { status, json } = await postResolve(ADMIN, ROW_ID, { decision: "complete", note: "Reconciled." });
    expect(status).toBe(200);
    expect(stub.calls).toEqual([
      {
        reversalId: ROW_ID,
        decision: "complete",
        adminUserId: ADMIN_ID,
        adminEmail: ADMIN_EMAIL,
        note: "Reconciled.",
      },
    ]);
    expect(json.outcome).toBe("resolved");
    expect(json.reversal.status).toBe("completed");
    expect(json.reversal.resolution).toEqual({
      id: "res-1",
      decision: "complete",
      adminUserId: ADMIN_ID,
      adminEmail: ADMIN_EMAIL,
      note: "Reconciled.",
      resolvedAt: "2026-11-01T01:00:00.000Z",
    });
  });

  it("an idempotent retry answers 200 with the recorded outcome", async () => {
    stub.resolveResult = { outcome: "already_resolved", row: {}, resolution: {} };
    stub.getRow = RESOLVED_ROW;
    const { status, json } = await postResolve(ADMIN, ROW_ID, { decision: "complete", note: "Reconciled." });
    expect(status).toBe(200);
    expect(json.outcome).toBe("already_resolved");
    expect(json.reversal.resolution.decision).toBe("complete");
  });

  it("conflict answers 409 with the row's current status; a missing row answers 404", async () => {
    stub.resolveResult = { outcome: "conflict", status: "completed" };
    const conflict = await postResolve(ADMIN, ROW_ID, { decision: "dismiss", note: "too late" });
    expect(conflict.status).toBe(409);
    expect(conflict.json.status).toBe("completed");

    stub.resolveResult = { outcome: "not_found" };
    expect((await postResolve(ADMIN, ROW_ID, { decision: "complete" })).status).toBe(404);
  });

  it("GET list rows carry the resolution nested (and null when unresolved)", async () => {
    stub.listRows = [
      RESOLVED_ROW,
      { ...RESOLVED_ROW, id: "12345678-1234-4234-8234-123456789099", status: "needs_manual_review", resolution_id: null },
    ];
    const res = await fetch(`${baseUrl}/api/admin/payment-reversals`, {
      headers: { "x-test-user": ADMIN_ID, "x-test-email": ADMIN_EMAIL },
    });
    const json = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(json.reversals[0].resolution.decision).toBe("complete");
    expect(json.reversals[1].resolution).toBeNull();
  });
});
