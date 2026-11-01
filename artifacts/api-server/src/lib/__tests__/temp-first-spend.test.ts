/**
 * temp-first-spend.test.ts — stack1100 Lane Z1 (Gate #5 live finding,
 * Nov 1 2026): TEMPORARY-FIRST SPEND ORDER.
 *
 * The finding: the owner's clean export −400 VB debited the PERMANENT
 * balance 87,195 → 86,795 while his temporary 300 sat untouched — yet
 * the credit-history page states "Temporary Bucs are spent first — use
 * them before they're gone," and the core deductCredits already spent
 * that way. The convicted paths were the ones that kept a private
 * permanent-only debit (the export rail's reserve + settle), and the
 * refund paths that could only restore to the permanent column because
 * no record kept a charge's pool split.
 *
 * What's pinned here:
 *  1. The Gate #5 shape, exactly, on the export rail: 87,195 permanent
 *     + 300 temporary, reserve 400 → temporary 0, permanent −100, and
 *     the split recorded on the job row.
 *  2. Affordability reads the SPENDABLE balance on the rail: permanent
 *     100 + temporary 500 covers a 400 reserve (the old rail 402'd).
 *  3. Refunds restore the RIGHT pools — the export release through the
 *     job row's recorded split, and chargeCredits refunds through the
 *     ledger pairing (newest-first within user + base action + amount).
 *  4. THE EXPIRY RULE: a refund of a temporary-funded charge whose pool
 *     expired in the meantime lands in PERMANENT credits — the value
 *     never evaporates — and the refund's ledger row says so.
 *  5. chargeCredits' ledger-failure rollback restores the exact pools.
 *  6. A restore never resurrects a stale expired pool remainder.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
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
  bonusCreditsUsed: number | null;
  bonusExpiresAt: string | null;
}

const h = vi.hoisted(() => ({
  profile: null as unknown as FakeProfile,
  ledger: [] as LedgerRow[],
  ledgerWriteFails: false,
  jobFlag: false,
  jobSplit: { fromBonus: null as number | null, expiresAt: null as string | null },
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
  /* The permanent-credit primitive, faithful against the fake profile. */
  addCreditsToProfile: async (_userId: string, amt: number) => {
    const oldCredits = h.profile.credits;
    h.profile.credits += amt;
    return { oldCredits, newCredits: h.profile.credits, created: false };
  },
}));

vi.mock("../payment-record", () => ({
  /* Captures the record AND lands it in the fake ledger the pairing
     lookup reads — the same relationship the real strict writer has
     to the real credit_usage table. */
  recordCreditUsageStrict: async (rec: {
    userId: string;
    action: string;
    creditsUsed: number;
    bonusCreditsUsed?: number | null;
    bonusExpiresAt?: string | null;
  }) => {
    if (h.ledgerWriteFails) throw new Error("ledger down");
    h.ledger.push({
      userId: rec.userId,
      action: rec.action,
      creditsUsed: rec.creditsUsed,
      bonusCreditsUsed: rec.bonusCreditsUsed ?? null,
      bonusExpiresAt: rec.bonusExpiresAt ?? null,
    });
  },
}));

vi.mock("../teams", () => ({
  getUserActiveTeam: async () => null,
  deductTeamCredits: async () => {
    throw new Error("deductTeamCredits must not be called on the personal-balance path");
  },
}));

vi.mock("@workspace/db", () => ({
  pgSslConfig: () => undefined,
  db: {
    execute: async (q: unknown) => {
      const { sql: text, params } = dialect.sqlToQuery(q as never);
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
          .reverse() // ORDER BY created_at DESC over the insertion-ordered fake
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
      return { rows: [] };
    },
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
  teamsTable: { id: "id", credits: "credits" },
  creditUsageTable: { id: "id", userId: "user_id", action: "action", idempotencyKey: "idempotency_key" },
}));

vi.mock("pg", () => ({ Pool: class Pool {} }));

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: () => ({
    execute: async (q: unknown) => {
      const { sql: text, params } = dialect.sqlToQuery(q as never);
      if (/SET credits_charged = true/.test(text)) {
        if (h.jobFlag) return { rows: [] };
        h.jobFlag = true;
        return { rows: [{ id: "job-1" }] };
      }
      if (/SET credits_charged = false/.test(text)) {
        if (!h.jobFlag) return { rows: [] };
        h.jobFlag = false;
        if (/credits_from_bonus/.test(text)) {
          return {
            rows: [
              {
                id: "job-1",
                credits_from_bonus: h.jobSplit.fromBonus,
                credits_bonus_expires_at: h.jobSplit.expiresAt,
              },
            ],
          };
        }
        return { rows: [{ id: "job-1" }] };
      }
      if (/SET credits_from_bonus/.test(text)) {
        const [fromBonus, expiresAt] = params as [number, string | null];
        h.jobSplit = { fromBonus, expiresAt };
        return { rows: [] };
      }
      if (/FROM export_jobs/.test(text)) {
        return {
          rows: [
            {
              id: "job-1",
              user_id: "user-1",
              project_id: "proj-1",
              state: "active",
              stage: "combining",
              progress: 0,
              params: {},
              result: null,
              error: null,
              credits_charged: h.jobFlag,
              credits_from_bonus: h.jobSplit.fromBonus,
              credits_bonus_expires_at: h.jobSplit.expiresAt,
              attempts: 1,
              created_at: "2026-11-01T00:00:00.000Z",
              updated_at: "2026-11-01T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    },
  }),
}));

import {
  chargeCredits,
  deductCreditsDetailed,
  refundCredits,
  restoreCreditsSplit,
  LedgerWriteError,
} from "../credits";
import {
  reserveCreditsForJob,
  releaseJobReservation,
  chargeCreditsForJob,
} from "../export-jobs";

const HOUR = 3_600_000;
const future = (ms = 48 * HOUR) => new Date(Date.now() + ms).toISOString();
const past = () => new Date(Date.now() - HOUR).toISOString();

/* The Gate #5 profile: 87,195 permanent + 300 temporary, pool live. */
function gate5Profile(): FakeProfile {
  return { credits: 87_195, bonus_credits: 300, bonus_credits_expires_at: future() };
}

beforeAll(() => {
  process.env["DATABASE_URL"] = "postgres://localhost:5432/test";
});

beforeEach(() => {
  h.profile = gate5Profile();
  h.ledger = [];
  h.ledgerWriteFails = false;
  h.jobFlag = false;
  h.jobSplit = { fromBonus: null, expiresAt: null };
});

describe("the core deduction — split surfaced, temporary first", () => {
  it("deductCreditsDetailed on the Gate #5 profile: 300 temporary + 100 permanent", async () => {
    const expiry = h.profile.bonus_credits_expires_at;
    const { balance, split } = await deductCreditsDetailed("user-1", 400);
    expect(split).toEqual({ fromBonus: 300, fromRegular: 100, bonusExpiresAt: expiry });
    expect(balance).toBe(87_095);
    expect(h.profile.bonus_credits).toBe(0);
    expect(h.profile.credits).toBe(87_095);
  });

  it("chargeCredits records the split on the ledger row", async () => {
    const expiry = h.profile.bonus_credits_expires_at;
    await chargeCredits("user-1", 400, { action: "Final Video Export" });
    expect(h.ledger).toHaveLength(1);
    expect(h.ledger[0]).toMatchObject({ creditsUsed: 400, bonusCreditsUsed: 300 });
    expect(h.ledger[0]!.bonusExpiresAt).toBe(expiry);
  });
});

describe("the export rail — the Gate #5 defect, convicted and fixed", () => {
  it("reserve 400 on the Gate #5 profile spends the temporary 300 first (was: permanent 87,195 → 86,795, temporary untouched)", async () => {
    const hold = await reserveCreditsForJob("job-1", "user-1", 400);
    expect(hold.reserved).toBe(true);
    expect(h.profile.bonus_credits).toBe(0);
    expect(h.profile.credits).toBe(87_095);
    expect(hold.creditsAfter).toBe(87_095);
    /* …and the split is recorded on the job row for the release. */
    expect(h.jobSplit.fromBonus).toBe(300);
    expect(h.jobSplit.expiresAt).not.toBeNull();
  });

  it("affordability reads the spendable balance: permanent 100 + temporary 500 covers a 400 reserve (the old rail threw OutOfCreditsError)", async () => {
    h.profile = { credits: 100, bonus_credits: 500, bonus_credits_expires_at: future() };
    const hold = await reserveCreditsForJob("job-1", "user-1", 400);
    expect(hold.reserved).toBe(true);
    expect(h.profile.bonus_credits).toBe(100);
    expect(h.profile.credits).toBe(100);
  });

  it("the settle fallback (chargeCreditsForJob) spends temporary first too", async () => {
    const { charged, creditsAfter } = await chargeCreditsForJob("job-1", "user-1", 400);
    expect(charged).toBe(true);
    expect(creditsAfter).toBe(87_095);
    expect(h.profile.bonus_credits).toBe(0);
    expect(h.profile.credits).toBe(87_095);
    expect(h.jobSplit.fromBonus).toBe(300);
  });

  it("release restores the SAME pools: temporary 300 back under its expiry, permanent whole", async () => {
    const expiry = h.profile.bonus_credits_expires_at;
    await reserveCreditsForJob("job-1", "user-1", 400);
    await releaseJobReservation("job-1", "user-1", 400, "Final Video Export — Refund (render failed)");
    expect(h.profile.bonus_credits).toBe(300);
    expect(h.profile.bonus_credits_expires_at).toBe(expiry);
    expect(h.profile.credits).toBe(87_195);
    const refundRow = h.ledger.find((r) => r.creditsUsed === -400);
    expect(refundRow).toMatchObject({ bonusCreditsUsed: -300 });
  });
});

describe("refunds restore the right pools — ledger pairing", () => {
  it("a chargeCredits refund pairs to its charge and restores the split", async () => {
    const expiry = h.profile.bonus_credits_expires_at;
    await chargeCredits("user-1", 400, { action: "AI Test Feature" });
    expect(h.profile.bonus_credits).toBe(0);

    await refundCredits("user-1", 400, { action: "AI Test Feature — Refund (provider failed)" });
    expect(h.profile.bonus_credits).toBe(300);
    expect(h.profile.bonus_credits_expires_at).toBe(expiry);
    expect(h.profile.credits).toBe(87_195);
    const refundRow = h.ledger.find((r) => r.creditsUsed === -400);
    expect(refundRow).toMatchObject({ bonusCreditsUsed: -300 });
  });

  it("pairs newest-first when the same action charges twice with different splits", async () => {
    const expiry1 = future(48 * HOUR);
    const expiry2 = future(72 * HOUR);
    h.profile = { credits: 1_000, bonus_credits: 300, bonus_credits_expires_at: expiry1 };
    await chargeCredits("user-1", 400, { action: "AI Test Feature" }); // split 300/100
    /* A fresh temporary grant lands before the second charge. */
    h.profile.bonus_credits = 200;
    h.profile.bonus_credits_expires_at = expiry2;
    await chargeCredits("user-1", 400, { action: "AI Test Feature" }); // split 200/200

    await refundCredits("user-1", 400, { action: "AI Test Feature — Refund (one)" });
    /* The newest charge's split (200) returns first, under its expiry. */
    expect(h.profile.bonus_credits).toBe(200);
    expect(h.profile.bonus_credits_expires_at).toBe(expiry2);

    await refundCredits("user-1", 400, { action: "AI Test Feature — Refund (two)" });
    /* Then the older split (300) — pooled, keeping the later expiry. */
    expect(h.profile.bonus_credits).toBe(500);
    expect(h.profile.bonus_credits_expires_at).toBe(expiry2);
    expect(h.profile.credits).toBe(1_000);
  });

  it("a refund with no recorded split restores to permanent, as it always has", async () => {
    h.profile = { credits: 500, bonus_credits: 0, bonus_credits_expires_at: null };
    await refundCredits("user-1", 200, { action: "Untracked — Refund" });
    expect(h.profile.credits).toBe(700);
    expect(h.profile.bonus_credits).toBe(0);
  });
});

describe("THE EXPIRY RULE — a refund never evaporates with an expired pool", () => {
  it("the pool expired between charge and refund: the temporary portion lands in permanent credits", async () => {
    await chargeCredits("user-1", 400, { action: "AI Test Feature" });
    expect(h.profile.bonus_credits).toBe(0);
    /* Time passes: the pool the charge drew from reaches its expiry
       (the ledger keeps the expiry recorded at charge time). */
    h.ledger[0]!.bonusExpiresAt = past();

    await refundCredits("user-1", 400, { action: "AI Test Feature — Refund (late failure)" });
    /* All 400 back — as permanent. Nothing sits in a dead pool. */
    expect(h.profile.credits).toBe(87_495);
    expect(h.profile.bonus_credits).toBe(0);
    const refundRow = h.ledger.find((r) => r.creditsUsed === -400);
    /* The row tells the truth: none of it went back into the pool. */
    expect(refundRow?.bonusCreditsUsed ?? null).toBeNull();
  });

  it("restoreCreditsSplit applies the same rule when called directly", async () => {
    h.profile = { credits: 100, bonus_credits: 0, bonus_credits_expires_at: null };
    const { restoredToBonus } = await restoreCreditsSplit("user-1", {
      fromBonus: 300,
      fromRegular: 100,
      bonusExpiresAt: past(),
    });
    expect(restoredToBonus).toBe(0);
    expect(h.profile.credits).toBe(500);
    expect(h.profile.bonus_credits).toBe(0);
  });

  it("a restore never resurrects a stale expired remainder sitting in the pool columns", async () => {
    h.profile = { credits: 0, bonus_credits: 700, bonus_credits_expires_at: past() };
    const expiry = future();
    const { restoredToBonus } = await restoreCreditsSplit("user-1", {
      fromBonus: 100,
      fromRegular: 0,
      bonusExpiresAt: expiry,
    });
    expect(restoredToBonus).toBe(100);
    expect(h.profile.bonus_credits).toBe(100); // not 800 — the stale 700 stayed dead
    expect(h.profile.bonus_credits_expires_at).toBe(expiry);
  });
});

describe("chargeCredits rollback — split-exact", () => {
  it("a ledger failure restores the exact pools the deduction drew from", async () => {
    const expiry = h.profile.bonus_credits_expires_at;
    h.ledgerWriteFails = true;
    await expect(
      chargeCredits("user-1", 400, { action: "AI Test Feature" }),
    ).rejects.toBeInstanceOf(LedgerWriteError);
    expect(h.profile.bonus_credits).toBe(300);
    expect(h.profile.bonus_credits_expires_at).toBe(expiry);
    expect(h.profile.credits).toBe(87_195);
  });
});
