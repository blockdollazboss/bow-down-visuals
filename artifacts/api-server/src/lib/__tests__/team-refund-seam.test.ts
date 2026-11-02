/**
 * team-refund-seam.test.ts — stack1200 lane: route-level refunds after a
 * TEAM-pool charge.
 *
 * The flag (stack1100 Z1 report): a route-level refundCredits() after a
 * charge that drew from a TEAM pool refunded the member's PERSONAL
 * profile — the totals stayed exact, only the pool was wrong.
 *
 * The seam: chargeCredits() already records the paying pool durably —
 * the charge's credit_usage row carries team_id when the team pool paid
 * and NULL when the personal balance paid (deductTeamCredits is only
 * ever called from chargeCredits). refundCredits() therefore pairs on
 * the ledger exactly like the bonus-split pairing (stack1100 Z1), with
 * one stricter guard, because a refund names only (user, base action,
 * amount) and never WHICH charge in the bucket it reverses:
 *
 *   the refund restores the team pool ONLY when the bucket is
 *   pool-unambiguous — every charge in it drew from the same team, and
 *   an unconsumed charge remains. Mixed buckets (personal + team, or
 *   two teams), exhausted buckets, and any lookup failure fail open to
 *   the historical personal restore with exact totals.
 *
 * What's pinned here:
 *  1. Team charge → route refund restores the TEAM pool; the personal
 *     profile is untouched; the refund's ledger row carries the teamId.
 *  2. Personal charge → refund unchanged (no teamId on the refund row).
 *  3. Mixed bucket (team charge + personal charge, same action+amount)
 *     → ambiguous → historical personal restore, exact totals.
 *  4. Two different teams in one bucket → ambiguous → personal restore.
 *  5. A second refund for an already-refunded team charge does NOT
 *     restore the team pool again (bucket exhausted → fail open).
 *  6. Team deleted between charge and refund → the value lands on the
 *     member's personal profile, exactly once.
 *  7. Team lookup failure → fail open to the personal restore.
 *  8. An explicit caller split (the export rail) bypasses the team
 *     lookup entirely — personal restore even over an all-team bucket.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const dialect = new PgDialect();

interface FakeProfile {
  credits: number;
  bonus_credits: number;
  bonus_credits_expires_at: string | null;
}
interface LedgerRow {
  userId: string;
  action: string;
  creditsUsed: number;
  teamId: string | null;
  bonusCreditsUsed: number | null;
  bonusExpiresAt: string | null;
}

const h = vi.hoisted(() => ({
  profile: null as unknown as FakeProfile,
  ledger: [] as LedgerRow[],
  ledgerCalls: [] as Array<Record<string, unknown>>,
  /* Fake team pools: teamId -> pool balance. A missing key = team gone. */
  teams: new Map<string, number>(),
  activeTeamId: null as string | null,
  teamLookupThrows: false,
}));

vi.mock("../logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const table = {
        select: () => table,
        eq: () => table,
        single: async () => ({ data: { ...h.profile }, error: null }),
        update: (vals: Partial<FakeProfile>) => {
          Object.assign(h.profile, vals);
          return { eq: async () => ({ error: null }) };
        },
      };
      return table;
    },
  }),
  addCreditsToProfile: async (_userId: string, amt: number) => {
    const oldCredits = h.profile.credits;
    h.profile.credits += amt;
    return { oldCredits, newCredits: h.profile.credits, created: false };
  },
}));

vi.mock("../payment-record", () => ({
  /* Captures the record AND lands it in the fake ledger the pairing
     lookups read — the same relationship the real strict writer has
     to the real credit_usage table. */
  recordCreditUsageStrict: async (rec: {
    userId: string;
    action: string;
    creditsUsed: number;
    teamId?: string | null;
    bonusCreditsUsed?: number | null;
    bonusExpiresAt?: string | null;
  }) => {
    h.ledgerCalls.push({ ...rec });
    h.ledger.push({
      userId: rec.userId,
      action: rec.action,
      creditsUsed: rec.creditsUsed,
      teamId: rec.teamId ?? null,
      bonusCreditsUsed: rec.bonusCreditsUsed ?? null,
      bonusExpiresAt: rec.bonusExpiresAt ?? null,
    });
  },
}));

vi.mock("../teams", () => ({
  getUserActiveTeam: async () => {
    if (!h.activeTeamId) return null;
    const credits = h.teams.get(h.activeTeamId);
    if (credits === undefined) return null;
    return {
      team: { id: h.activeTeamId, credits, allowPersonalFallback: true },
      membership: { id: "membership-1", teamId: h.activeTeamId, userId: "user-1", status: "active" },
    };
  },
  deductTeamCredits: async (teamId: string, cost: number) => {
    const credits = h.teams.get(teamId);
    if (credits === undefined || credits < cost) {
      const err = new Error("out_of_credits") as Error & { status?: number };
      err.name = "OutOfCreditsError";
      err.status = 402;
      throw err;
    }
    const after = credits - cost;
    h.teams.set(teamId, after);
    return after;
  },
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: async (q: unknown) => {
      const { sql: text, params } = dialect.sqlToQuery(q as never);
      if (text.includes("SELECT team_id FROM credit_usage")) {
        if (h.teamLookupThrows) throw new Error("ledger read failed");
        const [userId, action, amount] = params as [string, string, number];
        const rows = h.ledger
          .filter((r) => r.userId === userId && r.action === action && r.creditsUsed === amount)
          .slice()
          .reverse() // ORDER BY created_at DESC over the insertion-ordered fake
          .map((r) => ({ team_id: r.teamId }));
        return { rows };
      }
      if (text.includes("bonus_credits_used IS NOT NULL")) {
        const [userId, action, amount] = params as [string, string, number];
        const rows = h.ledger
          .filter(
            (r) =>
              r.userId === userId &&
              r.action === action &&
              r.creditsUsed === amount &&
              r.bonusCreditsUsed !== null,
          )
          .slice()
          .reverse()
          .map((r) => ({ bonus_credits_used: r.bonusCreditsUsed, bonus_expires_at: r.bonusExpiresAt }));
        return { rows };
      }
      if (text.includes("starts_with")) {
        const [userId, negAmount, prefix] = params as [string, number, string];
        const n = h.ledger.filter(
          (r) => r.userId === userId && r.creditsUsed === negAmount && r.action.startsWith(prefix),
        ).length;
        return { rows: [{ n }] };
      }
      if (text.includes("UPDATE teams")) {
        const [amount, teamId] = params as [number, string];
        const credits = h.teams.get(teamId);
        if (credits === undefined) return { rows: [] };
        h.teams.set(teamId, credits + amount);
        return { rows: [{ id: teamId }] };
      }
      return { rows: [] };
    },
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
  teamsTable: { id: "id", credits: "credits" },
  creditUsageTable: { id: "id", userId: "user_id", action: "action", idempotencyKey: "idempotency_key", teamId: "team_id" },
}));

import { chargeCredits, refundCredits } from "../credits";

beforeEach(() => {
  h.profile = { credits: 1_000, bonus_credits: 0, bonus_credits_expires_at: null };
  h.ledger = [];
  h.ledgerCalls = [];
  h.teams = new Map([["team-1", 500]]);
  h.activeTeamId = "team-1";
  h.teamLookupThrows = false;
});

describe("team-pool charge → route-level refund", () => {
  it("restores the TEAM pool and leaves the personal profile untouched", async () => {
    const after = await chargeCredits("user-1", 400, { action: "AI Test Feature" });
    expect(after).toBe(100); // the pool balance the charge returned
    expect(h.teams.get("team-1")).toBe(100);
    expect(h.profile.credits).toBe(1_000);
    /* The charge's ledger row names the paying pool — the seam itself. */
    expect(h.ledger[0]).toMatchObject({ creditsUsed: 400, teamId: "team-1" });

    await refundCredits("user-1", 400, { action: "AI Test Feature — Refund (provider failed)" });

    expect(h.teams.get("team-1")).toBe(500); // the pool that paid is repaid
    expect(h.profile.credits).toBe(1_000); // personal never moved
    const refundRow = h.ledger.find((r) => r.creditsUsed === -400);
    expect(refundRow).toMatchObject({ teamId: "team-1" });
  });

  it("two team charges, two refunds: each refund repays the pool, none double-restores", async () => {
    h.teams.set("team-1", 900);
    await chargeCredits("user-1", 400, { action: "AI Test Feature" });
    await chargeCredits("user-1", 400, { action: "AI Test Feature" });
    expect(h.teams.get("team-1")).toBe(100);

    await refundCredits("user-1", 400, { action: "AI Test Feature — Refund (one)" });
    await refundCredits("user-1", 400, { action: "AI Test Feature — Refund (two)" });

    expect(h.teams.get("team-1")).toBe(900);
    expect(h.profile.credits).toBe(1_000);
  });
});

describe("personal charge → refund unchanged", () => {
  it("restores the personal profile; the refund row carries no teamId", async () => {
    h.activeTeamId = null;
    await chargeCredits("user-1", 400, { action: "AI Test Feature" });
    expect(h.profile.credits).toBe(600);
    expect(h.ledger[0]).toMatchObject({ creditsUsed: 400, teamId: null });

    await refundCredits("user-1", 400, { action: "AI Test Feature — Refund (provider failed)" });

    expect(h.profile.credits).toBe(1_000);
    const refundCall = h.ledgerCalls.find((c) => c["creditsUsed"] === -400);
    expect(refundCall).toBeDefined();
    expect("teamId" in (refundCall as object)).toBe(false);
  });
});

describe("ambiguity fails open to the historical personal restore", () => {
  it("mixed bucket: a team charge and a personal charge for the same action + amount", async () => {
    await chargeCredits("user-1", 400, { action: "AI Test Feature" }); // team pays
    h.activeTeamId = null; // member leaves the team / charges personally next
    await chargeCredits("user-1", 400, { action: "AI Test Feature" }); // personal pays
    expect(h.teams.get("team-1")).toBe(100);
    expect(h.profile.credits).toBe(600);

    await refundCredits("user-1", 400, { action: "AI Test Feature — Refund (provider failed)" });

    /* The refund cannot say which charge it reverses, so no pool guess:
       the historical personal restore lands, totals exact. */
    expect(h.profile.credits).toBe(1_000);
    expect(h.teams.get("team-1")).toBe(100);
  });

  it("two different teams in one bucket", async () => {
    await chargeCredits("user-1", 100, { action: "AI Test Feature" }); // team-1 pays
    h.teams.set("team-2", 300);
    h.activeTeamId = "team-2";
    await chargeCredits("user-1", 100, { action: "AI Test Feature" }); // team-2 pays

    await refundCredits("user-1", 100, { action: "AI Test Feature — Refund (provider failed)" });

    expect(h.profile.credits).toBe(1_100);
    expect(h.teams.get("team-1")).toBe(400);
    expect(h.teams.get("team-2")).toBe(200);
  });

  it("exhausted bucket: a second refund for the same team charge does not repay the pool twice", async () => {
    await chargeCredits("user-1", 400, { action: "AI Test Feature" });
    await refundCredits("user-1", 400, { action: "AI Test Feature — Refund (one)" });
    expect(h.teams.get("team-1")).toBe(500);

    await refundCredits("user-1", 400, { action: "AI Test Feature — Refund (two)" });

    /* No unconsumed charge remains: fail open (historical personal
       restore) rather than minting a second team-pool repayment. */
    expect(h.teams.get("team-1")).toBe(500);
    expect(h.profile.credits).toBe(1_400);
  });

  it("team lookup failure fails open", async () => {
    await chargeCredits("user-1", 400, { action: "AI Test Feature" });
    h.teamLookupThrows = true;

    await refundCredits("user-1", 400, { action: "AI Test Feature — Refund (provider failed)" });

    expect(h.profile.credits).toBe(1_400);
    expect(h.teams.get("team-1")).toBe(100);
  });
});

describe("the paying pool is gone", () => {
  it("team deleted between charge and refund: the value lands personally, exactly once", async () => {
    await chargeCredits("user-1", 400, { action: "AI Test Feature" });
    h.teams.delete("team-1");

    await refundCredits("user-1", 400, { action: "AI Test Feature — Refund (provider failed)" });

    expect(h.profile.credits).toBe(1_400); // +400 once, never +800
    const refundRow = h.ledger.find((r) => r.creditsUsed === -400);
    expect(refundRow).toMatchObject({ teamId: null }); // historical shape
  });
});

describe("explicit caller split bypasses the team lookup (export-rail isolation)", () => {
  it("restores per the caller's split even over an all-team ledger bucket", async () => {
    /* A ledger bucket that WOULD pair to the team… */
    h.ledger.push({
      userId: "user-1",
      action: "Final Video Export",
      creditsUsed: 400,
      teamId: "team-1",
      bonusCreditsUsed: null,
      bonusExpiresAt: null,
    });

    await refundCredits(
      "user-1",
      400,
      { action: "Final Video Export — Refund (render failed)" },
      { split: { fromBonus: 0, fromRegular: 400, bonusExpiresAt: null } },
    );

    expect(h.profile.credits).toBe(1_400); // the caller's split wins
    expect(h.teams.get("team-1")).toBe(500); // pool untouched
  });
});
