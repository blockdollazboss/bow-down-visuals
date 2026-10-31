/**
 * Developer platform truth (stack1100 X6) — the balance an API key sees.
 *
 * THE house balance definition is spendableBalance() in lib/credits:
 * profiles.credits PLUS the live (unexpired) bonus pool — the number the
 * session rail (requireAuth) attaches as req.userCredits, the number
 * chargeCredits spends (bonus pool first), and the number the website
 * shows the member. The API-key middleware kept its own reader that
 * selected ONLY `credits`, so whenever a temporary bonus was live
 * (King's gift, tutorial grant, promo Bucs):
 *   - GET /api/v1/balance understated the member's balance, and
 *   - POST /api/v1/generate/bio pre-check 402'd members whose permanent
 *     balance alone was under BIO_COST even though the charge rail
 *     would have succeeded drawing the bonus pool first.
 * These pins hold the key-authed balance to the one definition.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const profileRow = vi.hoisted(() => ({
  current: null as null | {
    credits?: number | null;
    bonus_credits?: number | null;
    bonus_credits_expires_at?: string | null;
  },
}));

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: profileRow.current }),
        }),
      }),
    }),
  }),
}));

import { createRequireApiKey } from "../../middlewares/require-api-key";
import type { ResolvedApiKey } from "../api-keys";

const resolved: ResolvedApiKey = {
  keyId: "key-1",
  userId: "user-1",
  scopes: ["earnings:read", "generate:bio"],
};

function mockReqRes(headers: Record<string, string> = {}) {
  const req = { headers } as never as Parameters<ReturnType<typeof createRequireApiKey>>[0] & {
    userId?: string; apiKeyId?: string; userCredits?: number;
  };
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  const next = vi.fn();
  return { req, res, next };
}

async function balanceAttached(): Promise<number | undefined> {
  const mw = createRequireApiKey("earnings:read", async () => resolved);
  const { req, res, next } = mockReqRes({ authorization: "Bearer bdv_live_test" });
  await mw(req as never, res as never, next);
  expect(next).toHaveBeenCalledTimes(1);
  return req.userCredits;
}

describe("API-key balance = the one spendable definition", () => {
  beforeEach(() => {
    profileRow.current = null;
  });

  it("permanent-only balance passes through unchanged", async () => {
    profileRow.current = { credits: 700 };
    await expect(balanceAttached()).resolves.toBe(700);
  });

  it("a LIVE temporary bonus counts — the API sees the balance the site shows", async () => {
    profileRow.current = {
      credits: 50,
      bonus_credits: 100,
      bonus_credits_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    };
    await expect(balanceAttached()).resolves.toBe(150);
  });

  it("an EXPIRED bonus does not count", async () => {
    profileRow.current = {
      credits: 50,
      bonus_credits: 100,
      bonus_credits_expires_at: new Date(Date.now() - 86_400_000).toISOString(),
    };
    await expect(balanceAttached()).resolves.toBe(50);
  });

  it("a bonus with no expiry stamp counts (same rule as spendableBalance)", async () => {
    profileRow.current = { credits: 50, bonus_credits: 30, bonus_credits_expires_at: null };
    await expect(balanceAttached()).resolves.toBe(80);
  });

  it("a missing profile reads 0 — never an invented balance", async () => {
    profileRow.current = null;
    await expect(balanceAttached()).resolves.toBe(0);
  });
});
