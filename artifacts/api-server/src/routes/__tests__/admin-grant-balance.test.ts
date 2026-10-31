/**
 * Admin truth C6 (stack1100 lane W6) — the credit grant's reported
 * balance must be the spendable balance.
 *
 * POST /api/admin/credits/grant answered `credits` with the raw
 * profiles.credits column after the grant. Both callers render that
 * number as the balance ("New balance: X" on /admin, "Balance: X" in
 * the floating panel), while every other surface — including the
 * same card's standing balance line after refreshProfile — shows
 * lib/credits' one definition: spendableBalance (permanent + live
 * bonus). With a live temporary Bucs pool, the grant confirmation
 * under-reported the balance by the bonus amount. The route now
 * answers the composition over the post-grant row.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ADMIN_ID = "00000000-0000-4000-8000-0000000000a1";
const ADMIN_EMAIL = "king@example.test";

const h = vi.hoisted(() => ({
  profile: null as null | Record<string, any>,
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
  getSupabaseAdmin: () => ({
    from: (_table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        ilike: () => chain,
        limit: () => chain,
        update: (patch: Record<string, any>) => {
          if (h.profile) Object.assign(h.profile, patch);
          return chain;
        },
        single: async () => ({ data: h.profile, error: h.profile ? null : { message: "no rows" } }),
        maybeSingle: async () => ({ data: h.profile, error: null }),
        then: (res: any, rej: any) => Promise.resolve({ data: null, error: null }).then(res, rej),
      };
      return chain;
    },
  }),
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: async () => undefined,
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
}));

/* lib/credits stays REAL — spendableBalance is the definition under
   test. Only the db-touching balance read is stubbed. */
vi.mock("../../lib/credits", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getCreditBalance: async () => 0 };
});

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
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  process.env["ADMIN_EMAILS"] = ADMIN_EMAIL;
});

async function grantSelf(amount: number) {
  const res = await fetch(`${baseUrl}/api/admin/credits/grant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-user": ADMIN_ID,
      "x-test-email": ADMIN_EMAIL,
    },
    body: JSON.stringify({ amount }),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

describe("POST /api/admin/credits/grant — reported balance (C6)", () => {
  it("answers the spendable composition: post-grant permanent + live bonus", async () => {
    h.profile = {
      id: ADMIN_ID,
      credits: 1000,
      bonus_credits: 300,
      bonus_credits_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    };
    const { status, json } = await grantSelf(500);
    expect(status).toBe(200);
    expect(json.granted).toBe(500);
    expect(json.credits).toBe(1800); // 1,500 permanent after grant + 300 live bonus
    expect(h.profile.credits).toBe(1500); // the column write itself is unchanged
  });

  it("an expired bonus pool does not inflate the answer", async () => {
    h.profile = {
      id: ADMIN_ID,
      credits: 1000,
      bonus_credits: 300,
      bonus_credits_expires_at: new Date(Date.now() - 3_600_000).toISOString(),
    };
    const { status, json } = await grantSelf(500);
    expect(status).toBe(200);
    expect(json.credits).toBe(1500);
  });
});
