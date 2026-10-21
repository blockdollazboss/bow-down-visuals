/**
 * Tests for requireAuth's effective-plan derivation (middlewares/require-auth).
 *
 * THE REGRESSION (split-brain): requireAuth set req.userPlan from
 * Supabase profiles.plan — a column written exactly once ("free", by
 * requireAuth's own first-run insert) and never updated again. The real
 * tier sources are profiles.plan_tier (the 1–6 ladder) and
 * creator_subscriptions.tier (Render PG). So every payer read as "free"
 * downstream: the export watermark gate watermarked paying creators'
 * videos and the storefront Pro gate bounced them to /pricing.
 *
 * These tests run the REAL requireAuth with a mocked Supabase client
 * (profiles row) and a fake @workspace/db (creator profile +
 * subscription rows, consumed by resolveCreatorTier), and assert on
 * req.userPlan through the consumers' own vocabulary: meetsProTier
 * (storefront gate), tierFromLegacyPlan (tier gate), and the export
 * watermark's FREE_PLANS list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  state: {
    supabaseProfile: null as null | Record<string, unknown>,
    creatorProfile: null as null | Record<string, unknown>,
    subscription: null as null | Record<string, unknown>,
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async (_token: string) => ({
        data: { user: { id: USER_ID, email: "owner@example.com", user_metadata: {} } },
        error: null,
      }),
    },
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          single: async () => ({ data: h.state.supabaseProfile, error: null }),
        }),
      }),
      insert: (_row: unknown) => ({
        select: (_cols: string) => ({
          single: async () => ({ data: null, error: new Error("not seeded") }),
        }),
      }),
    }),
  }),
}));

vi.mock("../../lib/kings-welcome", () => ({
  ensureKingsWelcome: async () => undefined,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { creatorProfilesTable, creatorSubscriptionsTable } = actual;

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: async (_n: number) => {
            if (table === creatorProfilesTable) {
              return state.creatorProfile ? [state.creatorProfile] : [];
            }
            if (table === creatorSubscriptionsTable) {
              return state.subscription ? [state.subscription] : [];
            }
            return [];
          },
        }),
      }),
    }),
  };

  return { ...actual, db: fakeDb };
});

import { requireAuth } from "../require-auth";
import { tierFromLegacyPlan } from "../../lib/platform-fees";
import { meetsProTier } from "../../routes/generate/storefronts";

const FREE_PLANS = ["", "free", "trial", "none", "null"]; // export-video.ts watermark gate

beforeEach(() => {
  h.state.supabaseProfile = null;
  h.state.creatorProfile = null;
  h.state.subscription = null;
});

async function runAuth() {
  const req: any = { headers: { authorization: "Bearer test-token" } };
  const res: any = {
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  const next = vi.fn();
  await requireAuth(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  return req;
}

describe("requireAuth — effective plan derivation", () => {
  it("a creator-subscription payer reads as Pro even though profiles.plan says 'free'", async () => {
    h.state.supabaseProfile = { id: USER_ID, credits: 500, plan: "free", plan_tier: 1 };
    h.state.creatorProfile = { id: PROFILE_ID };
    h.state.subscription = { tier: "pro", status: "active" };

    const req = await runAuth();

    expect(req.userPlan).not.toBe("free");
    expect(meetsProTier(req.userPlan)).toBe(true); // storefront Pro gate opens
    expect(tierFromLegacyPlan(req.userPlan)).toBe("pro"); // tier gate agrees
    expect(FREE_PLANS.includes(String(req.userPlan).toLowerCase().trim())).toBe(false); // no watermark
  });

  it("an elite subscription payer reads as elite", async () => {
    h.state.supabaseProfile = { id: USER_ID, credits: 500, plan: "free", plan_tier: 2 };
    h.state.creatorProfile = { id: PROFILE_ID };
    h.state.subscription = { tier: "elite", status: "trialing" };

    const req = await runAuth();

    expect(tierFromLegacyPlan(req.userPlan)).toBe("elite");
    expect(meetsProTier(req.userPlan)).toBe(true);
  });

  it("a plan_tier 6 (Kingpin) creator reads as elite with no subscription row", async () => {
    h.state.supabaseProfile = { id: USER_ID, credits: 500, plan: "free", plan_tier: 6 };

    const req = await runAuth();

    expect(tierFromLegacyPlan(req.userPlan)).toBe("elite");
    expect(meetsProTier(req.userPlan)).toBe(true);
  });

  it("a plan_tier 4 (Shot Caller) creator reads as Pro with no subscription row", async () => {
    h.state.supabaseProfile = { id: USER_ID, credits: 500, plan: "free", plan_tier: 4 };

    const req = await runAuth();

    expect(tierFromLegacyPlan(req.userPlan)).toBe("pro");
    expect(meetsProTier(req.userPlan)).toBe(true);
  });

  it("a genuinely free user still reads free everywhere", async () => {
    h.state.supabaseProfile = { id: USER_ID, credits: 300, plan: "free", plan_tier: 2 };
    h.state.creatorProfile = { id: PROFILE_ID };
    h.state.subscription = { tier: "free", status: "active" };

    const req = await runAuth();

    expect(req.userPlan).toBe("free");
    expect(meetsProTier(req.userPlan)).toBe(false);
    expect(tierFromLegacyPlan(req.userPlan)).toBe("free");
    expect(FREE_PLANS.includes(String(req.userPlan).toLowerCase().trim())).toBe(true); // watermarked
  });

  it("a CANCELED subscription does not pay — reads free", async () => {
    h.state.supabaseProfile = { id: USER_ID, credits: 300, plan: "free", plan_tier: 1 };
    h.state.creatorProfile = { id: PROFILE_ID };
    h.state.subscription = { tier: "elite", status: "canceled" };

    const req = await runAuth();

    expect(req.userPlan).toBe("free");
    expect(meetsProTier(req.userPlan)).toBe(false);
  });
});
