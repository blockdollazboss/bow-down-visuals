/**
 * Starter grant ledger row (board item 58, payments lane).
 *
 * requireAuth's first-run branch creates the profile with the 300 VB
 * starter grant. That insert used to be the whole story — no
 * credit_usage row, so the starter was invisible on /credit-history
 * (the invisible-ledger disease the referral fix cured for referral
 * grants only). Now the branch writes a strict ledger row keyed
 * `starter-grant:${userId}` via lib/grant-ledger. Pins:
 *  - profile creation → exactly one starter ledger record attempt;
 *  - an existing profile → NO starter record (the grant is once-ever);
 *  - a ledger failure NEVER fails authentication (loud log instead —
 *    auth is not bookkeeping's hostage).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const USER_ID = "00000000-0000-4000-8000-000000000301";

const h = vi.hoisted(() => ({
  profile: null as null | Record<string, unknown>,
  ledgerCalls: [] as Array<{ kind: string; userId: string }>,
  ledgerFails: false,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: USER_ID, email: "new@example.com", user_metadata: {} } },
        error: null,
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: h.profile, error: null }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: async () => ({
            data: { credits: 300 },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("../../lib/kings-welcome", () => ({
  ensureKingsWelcome: async () => undefined,
}));

vi.mock("../require-tier", () => ({
  resolveCreatorTier: async () => ({ tier: "free", profileId: null }),
}));

vi.mock("../../lib/grant-ledger", () => ({
  STARTER_GRANT_CREDITS: 300,
  TRIAL_GRANT_CREDITS: 1000,
  grantLedgerKey: (kind: string, userId: string) => `${kind}-grant:${userId}`,
  recordGrantLedger: async (kind: string, userId: string) => {
    h.ledgerCalls.push({ kind, userId });
    if (h.ledgerFails) throw new Error("ledger down");
    return "recorded";
  },
}));

import { requireAuth } from "../require-auth";

function fakeReqRes() {
  const req: any = { headers: { authorization: "Bearer token" } };
  const res: any = {
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  const next = vi.fn();
  return { req, res, next };
}

beforeEach(() => {
  h.profile = null;
  h.ledgerCalls = [];
  h.ledgerFails = false;
});

describe("requireAuth starter grant ledger", () => {
  it("first-run profile creation writes the starter ledger row", async () => {
    const { req, res, next } = fakeReqRes();
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userCredits).toBe(300);
    expect(h.ledgerCalls).toEqual([{ kind: "starter", userId: USER_ID }]);
  });

  it("an existing profile writes NO starter row (grant is once-ever)", async () => {
    h.profile = { id: USER_ID, credits: 1300, plan: "free", plan_tier: null };
    const { req, res, next } = fakeReqRes();
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(h.ledgerCalls).toHaveLength(0);
  });

  it("a ledger failure never fails authentication", async () => {
    h.ledgerFails = true;
    const { req, res, next } = fakeReqRes();
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
    expect(h.ledgerCalls).toHaveLength(1);
  });
});
