/**
 * Cloud Operator Phase 2, Lane A — the admin readback of the action
 * trail: GET /api/admin/operator-actions.
 *
 * Pins the bench pattern Stack-4 set: guests 401, members-not-admin
 * 403, ADMIN_EMAILS unset = fail-closed 403 for everyone, and the
 * admin sees the trail newest-first with the daily cap and the kill
 * switch state riding along. Rows are seeded straight into the fake
 * (the executor's own writing of them is pinned in
 * lib/__tests__/operator-executor.test.ts).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ADMIN_ID = "00000000-0000-4000-8000-0000000000a1";
const MEMBER_ID = "00000000-0000-4000-8000-0000000000a2";
const ADMIN_EMAIL = "king@example.test";
const MEMBER_EMAIL = "member@example.test";

const h = vi.hoisted(() => ({ fake: null as any }));

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
    throw new Error("supabase must not be touched by the operator bench read");
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
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import adminRouter from "../admin";
import { OPERATOR_DAILY_CHARGED_CAP } from "../../lib/operator-executor";

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
  h.fake.clear();
  process.env["ADMIN_EMAILS"] = ADMIN_EMAIL;
  delete process.env["OPERATOR_HANDS_ENABLED"];
});

async function getTrail(who?: { id: string; email: string }) {
  const res = await fetch(`${baseUrl}/api/admin/operator-actions`, {
    headers: who ? { "x-test-user": who.id, "x-test-email": who.email } : {},
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

describe("GET /api/admin/operator-actions", () => {
  it("guests 401, members 403, unset allowlist 403 for everyone (fail-closed)", async () => {
    expect((await getTrail()).status).toBe(401);
    expect((await getTrail({ id: MEMBER_ID, email: MEMBER_EMAIL })).status).toBe(403);
    delete process.env["ADMIN_EMAILS"];
    expect((await getTrail({ id: ADMIN_ID, email: ADMIN_EMAIL })).status).toBe(403);
  });

  it("the admin reads the trail with the cap + kill-switch state", async () => {
    h.fake.seed("operatorActions", [
      {
        userId: MEMBER_ID, tier: 0, toolId: "credits.balance", summary: "Checked Visual Bucs balance",
        channel: "chat_text", priceQuoted: null, priceCharged: null, result: "done",
        createdAt: new Date(Date.now() - 60_000),
      },
      {
        userId: MEMBER_ID, tier: 3, toolId: "test.charged", summary: "Make the test thing",
        channel: "chat_text", priceQuoted: 400, priceCharged: null, result: "refused",
        resultReason: "no_confirmation", createdAt: new Date(),
      },
    ]);
    const { status, json } = await getTrail({ id: ADMIN_ID, email: ADMIN_EMAIL });
    expect(status).toBe(200);
    expect(json.dailyChargedCap).toBe(OPERATOR_DAILY_CHARGED_CAP);
    expect(json.handsEnabled).toBe(true);
    expect(json.actions).toHaveLength(2);
    // newest first — the refusal (seeded with the later timestamp) leads
    expect(json.actions[0]).toMatchObject({ result: "refused", resultReason: "no_confirmation" });
    expect(json.actions[1]).toMatchObject({ toolId: "credits.balance", result: "done" });
  });

  it("an empty trail is an honest empty list, not an error", async () => {
    const { status, json } = await getTrail({ id: ADMIN_ID, email: ADMIN_EMAIL });
    expect(status).toBe(200);
    expect(json.actions).toEqual([]);
  });
});
